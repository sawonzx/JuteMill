import { Prisma, InvoiceStatus } from '@prisma/client';
import { resolveActorId } from './audit.js';
export class PaymentOperationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function generateReceiptNumber(prisma, factoryId) {
  const factory = await prisma.factory.findUnique({
    where: {
      id: factoryId,
    },
    select: {
      code: true,
    },
  });
  const prefix = factory ? `RCT-${factory.code}` : 'RCT';
  const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
  const count = await prisma.payment.count({
    where: {
      factoryId,
    },
  });
  const seq = String(count + 1).padStart(4, '0');
  const candidate = `${prefix}-${yearMonth}-${seq}`;
  const existing = await prisma.payment.findUnique({
    where: {
      receiptNo: candidate,
    },
  });
  if (existing) {
    return `${prefix}-${yearMonth}-${String(count + 10).padStart(4, '0')}`;
  }
  return candidate;
}
export async function recordCustomerPayment(prisma, actorId, input) {
  if (input.amount <= 0) {
    throw new PaymentOperationError('Payment amount must be greater than zero.', 400);
  }
  return await prisma.$transaction(
    async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: {
          id: input.invoiceId,
        },
        include: {
          customer: true,
          factory: true,
        },
      });
      if (!invoice) throw new PaymentOperationError('Invoice not found.', 404);
      if (invoice.status === InvoiceStatus.VOID) {
        throw new PaymentOperationError('Cannot record payment against a void invoice.', 400);
      }
      const currentTotal = Number(invoice.total);
      const currentPaid = Number(invoice.paidAmount);
      const currentBalanceDue = Number(invoice.balanceDue);
      const paymentAmount = Number(input.amount.toFixed(2));
      if (paymentAmount > currentBalanceDue + 0.001) {
        throw new PaymentOperationError(
          `Payment amount (৳${paymentAmount.toLocaleString()}) cannot exceed the outstanding balance (৳${currentBalanceDue.toLocaleString()}).`,
          400
        );
      }
      const newPaidAmount = Number((currentPaid + paymentAmount).toFixed(2));
      const newBalanceDue = Math.max(0, Number((currentTotal - newPaidAmount).toFixed(2)));
      const newStatus = newBalanceDue <= 0.001 ? InvoiceStatus.PAID : InvoiceStatus.PART_PAID;
      const receiptNo = await generateReceiptNumber(prisma, invoice.factoryId);
      const safeActorId = await resolveActorId(tx, actorId);
      const payment = await tx.payment.create({
        data: {
          receiptNo,
          factoryId: invoice.factoryId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          amount: paymentAmount,
          method: input.method,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          paidAt: input.paidAt ?? new Date(),
          createdById: safeActorId,
        },
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              total: true,
              balanceDue: true,
              status: true,
            },
          },
        },
      });
      const updatedInvoice = await tx.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          paidAmount: newPaidAmount,
          balanceDue: newBalanceDue,
          status: newStatus,
        },
      });
      return {
        payment,
        invoice: updatedInvoice,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );
}
export async function getCustomerLedger(prisma, customerId) {
  const customer = await prisma.customer.findUnique({
    where: {
      id: customerId,
    },
    select: {
      id: true,
      name: true,
      code: true,
      factoryId: true,
    },
  });
  if (!customer) throw new PaymentOperationError('Customer not found.', 404);
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerId,
        status: {
          not: InvoiceStatus.VOID,
        },
      },
      orderBy: {
        issueDate: 'asc',
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        total: true,
        status: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        customerId,
      },
      orderBy: {
        paidAt: 'asc',
      },
      select: {
        id: true,
        receiptNo: true,
        paidAt: true,
        amount: true,
        method: true,
        reference: true,
        invoiceId: true,
      },
    }),
  ]);
  const items = [
    ...invoices.map((inv) => ({
      kind: 'INVOICE',
      date: new Date(inv.issueDate),
      invoice: inv,
    })),
    ...payments.map((p) => ({
      kind: 'PAYMENT',
      date: new Date(p.paidAt),
      payment: p,
    })),
  ];
  items.sort((a, b) => a.date.getTime() - b.date.getTime());
  let runningBalance = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;
  const entries = items.map((item) => {
    if (item.kind === 'INVOICE') {
      const amount = Number(item.invoice.total);
      totalInvoiced += amount;
      runningBalance += amount;
      return {
        id: item.invoice.id,
        date: item.date,
        type: 'INVOICE',
        reference: item.invoice.invoiceNumber,
        description: `Invoice ${item.invoice.invoiceNumber}`,
        debit: amount,
        credit: 0,
        balance: Math.round(runningBalance * 100) / 100,
        status: item.invoice.status,
      };
    } else {
      const amount = Number(item.payment.amount);
      totalPaid += amount;
      runningBalance -= amount;
      return {
        id: item.payment.id,
        date: item.date,
        type: 'PAYMENT',
        reference: item.payment.receiptNo,
        description: `Payment received (${item.payment.method}) ref: ${item.payment.reference ?? 'N/A'}`,
        debit: 0,
        credit: amount,
        balance: Math.round(runningBalance * 100) / 100,
      };
    }
  });
  const netOutstanding = Math.round((totalInvoiced - totalPaid) * 100) / 100;
  return {
    customer,
    entries: entries.map((e) => ({
      ...e,
      runningBalance: e.balance,
    })),
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    currentOutstanding: netOutstanding,
    outstandingBalance: netOutstanding,
  };
}
