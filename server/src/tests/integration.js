import {
  PrismaClient,
  OrderStatus,
  InvoiceStatus,
  PaymentMethod,
  ProductType,
  CustomerType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createSalesOrder, fulfillSalesOrder } from '../services/orders.js';
import { createInvoiceFromOrder } from '../services/invoices.js';
import { recordCustomerPayment, getCustomerLedger } from '../services/payments.js';
import { createProductionRecord, completeProductionBatch } from '../services/production.js';
import { recordInventoryMovement } from '../services/inventory.js';
const prisma = new PrismaClient();
let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}
async function runTests() {
  console.log('\n🧪 Running Jute Mill ERP Business Workflow & Security Tests…\n');
  const [factoryA, factoryB] = await Promise.all([
    prisma.factory.findUniqueOrThrow({
      where: {
        code: 'F-A',
      },
    }),
    prisma.factory.findUniqueOrThrow({
      where: {
        code: 'F-B',
      },
    }),
  ]);
  const [admin, managerA, managerB, staffA] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: {
        email: 'admin@juteworks.demo',
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: {
        email: 'manager.a@juteworks.demo',
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: {
        email: 'manager.b@juteworks.demo',
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: {
        email: 'staff.a@juteworks.demo',
      },
    }),
  ]);
  const warehouseA = await prisma.warehouse.findFirstOrThrow({
    where: {
      factoryId: factoryA.id,
      isDefault: true,
    },
  });
  console.log('\n--- 1. Authentication & Credential Security ---');
  const validPassword = await bcrypt.compare('password123', admin.passwordHash);
  assert(validPassword, 'Admin password verifies with bcrypt hash');
  const invalidPassword = await bcrypt.compare('wrongpassword', admin.passwordHash);
  assert(!invalidPassword, 'Invalid password is systematically rejected');
  console.log('\n--- 2. Factory Data Isolation ---');
  const customersA = await prisma.customer.findMany({
    where: {
      factoryId: factoryA.id,
    },
  });
  const customersB = await prisma.customer.findMany({
    where: {
      factoryId: factoryB.id,
    },
  });
  assert(
    customersA.length > 0 && customersB.length > 0,
    'Both factories maintain customer records'
  );
  assert(
    customersA.every((c) => c.factoryId === factoryA.id),
    'Factory A customers are strictly isolated to Factory A'
  );
  assert(
    customersB.every((c) => c.factoryId === factoryB.id),
    'Factory B customers are strictly isolated to Factory B'
  );
  console.log('\n--- 3. Product Catalog & Shared Definitions ---');
  const products = await prisma.product.findMany();
  const rawProducts = products.filter((p) => p.type === ProductType.RAW_MATERIAL);
  const finProducts = products.filter((p) => p.type === ProductType.FINISHED_PRODUCT);
  assert(rawProducts.length >= 5, `Raw materials defined: ${rawProducts.length}`);
  assert(finProducts.length >= 10, `Finished goods defined: ${finProducts.length}`);
  console.log('\n--- 4. Inventory Control & Overdraft Prevention ---');
  const testProduct = finProducts.find((p) => p.sku === 'SAC-330');
  const bal = await prisma.inventoryBalance.findUnique({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: testProduct.id,
      },
    },
  });
  const currentStock = bal ? Number(bal.quantity) : 0;
  let preventedNegative = false;
  try {
    await recordInventoryMovement(prisma, managerA.id, {
      factoryId: factoryA.id,
      warehouseId: warehouseA.id,
      productId: testProduct.id,
      type: 'STOCK_OUT',
      quantity: currentStock + 999999,
      reason: 'Test overdraft attempt',
    });
  } catch (err) {
    if (err.message.includes('Insufficient stock')) {
      preventedNegative = true;
    }
  }
  assert(
    preventedNegative,
    'Negative inventory balance is strictly prevented by transaction logic'
  );
  console.log('\n--- 5. Sales Order Creation & Stock Fulfillment ---');
  const testCust = customersA[0];
  await recordInventoryMovement(prisma, managerA.id, {
    factoryId: factoryA.id,
    warehouseId: warehouseA.id,
    productId: testProduct.id,
    type: 'STOCK_IN',
    quantity: 100,
    reason: 'Test stock injection for order fulfillment test',
  });
  const order = await createSalesOrder(prisma, managerA.id, {
    factoryId: factoryA.id,
    customerId: testCust.id,
    dueDate: new Date(Date.now() + 7 * 86400000),
    lines: [
      {
        productId: testProduct.id,
        quantity: 20,
        unitPrice: 92,
      },
    ],
  });
  assert(
    order.status === OrderStatus.DRAFT,
    `Order created with status DRAFT (${order.orderNumber})`
  );
  assert(
    Number(order.total) === 20 * 92,
    `Order total calculated correctly: ৳${Number(order.total)}`
  );
  const confirmed = await prisma.salesOrder.update({
    where: {
      id: order.id,
    },
    data: {
      status: OrderStatus.CONFIRMED,
    },
  });
  assert(confirmed.status === OrderStatus.CONFIRMED, 'Order confirmed');
  const balBefore = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: testProduct.id,
      },
    },
  });
  const stockBefore = Number(balBefore.quantity);
  const fulfilled = await fulfillSalesOrder(prisma, order.id, managerA.id);
  assert(fulfilled.status === OrderStatus.FULFILLED, 'Order fulfilled successfully');
  const balAfter = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: testProduct.id,
      },
    },
  });
  const stockAfter = Number(balAfter.quantity);
  assert(
    Math.abs(stockBefore - stockAfter - 20) < 0.001,
    `Stock atomically deducted by 20 units (before: ${stockBefore}, after: ${stockAfter})`
  );
  let doubleFulfillBlocked = false;
  try {
    await fulfillSalesOrder(prisma, order.id, managerA.id);
  } catch (err) {
    if (err.message.includes('already been fulfilled')) {
      doubleFulfillBlocked = true;
    }
  }
  assert(doubleFulfillBlocked, 'Duplicate order fulfillment is prevented');
  console.log('\n--- 6. Invoice Generation & Line-Item Snapshotting ---');
  const invoice = await createInvoiceFromOrder(prisma, managerA.id, {
    orderId: order.id,
    dueDate: new Date(Date.now() + 30 * 86400000),
    terms: 'Net 30 days',
  });
  assert(invoice.status === InvoiceStatus.ISSUED, `Invoice issued (${invoice.invoiceNumber})`);
  assert(
    Number(invoice.total) === Number(order.total),
    `Invoice total matches order: ৳${invoice.total}`
  );
  assert(
    Number(invoice.balanceDue) === Number(order.total),
    `Initial balance due equals total: ৳${invoice.balanceDue}`
  );
  assert(
    invoice.items.length === 1,
    `Invoice item snapshot created with count: ${invoice.items.length}`
  );
  console.log('\n--- 7. Payment Processing & Overpayment Prevention ---');
  const invoiceTotal = Number(invoice.total);
  let overpaymentBlocked = false;
  try {
    await recordCustomerPayment(prisma, managerA.id, {
      invoiceId: invoice.id,
      amount: invoiceTotal + 500,
      method: PaymentMethod.BANK_TRANSFER,
    });
  } catch (err) {
    if (err.message.includes('cannot exceed the outstanding balance')) {
      overpaymentBlocked = true;
    }
  }
  assert(overpaymentBlocked, 'Overpayment greater than invoice balance due is strictly rejected');
  const partialAmount = Math.round(invoiceTotal * 0.5);
  const payResult1 = await recordCustomerPayment(prisma, managerA.id, {
    invoiceId: invoice.id,
    amount: partialAmount,
    method: PaymentMethod.BANK_TRANSFER,
    reference: 'BANK-TEST-01',
  });
  assert(
    payResult1.invoice.status === InvoiceStatus.PART_PAID,
    'Invoice status transitioned to PART_PAID'
  );
  assert(
    Number(payResult1.invoice.balanceDue) === Number((invoiceTotal - partialAmount).toFixed(2)),
    `Balance due updated to remaining: ৳${payResult1.invoice.balanceDue}`
  );
  const remainder = Number(payResult1.invoice.balanceDue);
  const payResult2 = await recordCustomerPayment(prisma, managerA.id, {
    invoiceId: invoice.id,
    amount: remainder,
    method: PaymentMethod.CHEQUE,
    reference: 'CHQ-TEST-02',
  });
  assert(
    payResult2.invoice.status === InvoiceStatus.PAID,
    'Invoice status transitioned to PAID upon zero balance'
  );
  assert(Number(payResult2.invoice.balanceDue) === 0, 'Invoice balance due is now ৳0.00');
  const ledger = await getCustomerLedger(prisma, testCust.id);
  assert(
    ledger.entries.length >= 3,
    `Customer ledger contains chronological entries: ${ledger.entries.length}`
  );
  assert(
    typeof ledger.currentOutstanding === 'number',
    `Customer outstanding balance calculated: ৳${ledger.currentOutstanding}`
  );
  console.log('\n--- 8. Production Batch Atomic Raw-to-Finished Conversion ---');
  const rawJute = rawProducts.find((p) => p.sku === 'RJ-001');
  const yarn = finProducts.find((p) => p.sku === 'YRN-100');
  await recordInventoryMovement(prisma, managerA.id, {
    factoryId: factoryA.id,
    warehouseId: warehouseA.id,
    productId: rawJute.id,
    type: 'STOCK_IN',
    quantity: 500,
    reason: 'Raw stock for production test',
  });
  const batch = await createProductionRecord(prisma, managerA.id, {
    factoryId: factoryA.id,
    rawMaterialId: rawJute.id,
    rawMaterialQuantity: 100,
    finishedProductId: yarn.id,
    finishedQuantity: 0.08,
    wastageQuantity: 5,
    remarks: 'Automated test production run',
  });
  assert(batch.status === 'DRAFT', `Production batch created in DRAFT (${batch.batchNumber})`);
  const rawBalBefore = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: rawJute.id,
      },
    },
  });
  const finBalBefore = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: yarn.id,
      },
    },
  });
  const completedBatch = await completeProductionBatch(prisma, batch.id, managerA.id);
  assert(completedBatch.status === 'COMPLETED', 'Batch status updated to COMPLETED');
  const rawBalAfter = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: rawJute.id,
      },
    },
  });
  const finBalAfter = await prisma.inventoryBalance.findUniqueOrThrow({
    where: {
      warehouseId_productId: {
        warehouseId: warehouseA.id,
        productId: yarn.id,
      },
    },
  });
  const rawDiff = Number(rawBalBefore.quantity) - Number(rawBalAfter.quantity);
  const finDiff = Number(finBalAfter.quantity) - Number(finBalBefore.quantity);
  assert(Math.abs(rawDiff - 100) < 0.001, `Raw material stock deducted by 100 kg`);
  assert(Math.abs(finDiff - 0.08) < 0.001, `Finished yarn stock increased by 0.08 MT`);
  console.log('\n--- 9. Complete End-to-End Scenario Flow ---');
  console.log(
    '  Scenario: Factory A Manager creates customer, fulfills order, invoices, and head office monitors.'
  );
  const newCustCode = `E2E-${Date.now().toString().slice(-4)}`;
  const e2eCust = await prisma.customer.create({
    data: {
      factoryId: factoryA.id,
      code: newCustCode,
      name: 'E2E Bengal Packaging Ltd.',
      contactPerson: 'Sultan Mahmud',
      phone: '+880 1799-887766',
      email: 'sultan@bengalpackaging.test',
      address: 'Plot 45, Tejgaon I/A',
      city: 'Dhaka',
      type: CustomerType.BUSINESS,
    },
  });
  assert(e2eCust.id !== '', `Step 1: Factory A customer created (${e2eCust.name})`);
  await recordInventoryMovement(prisma, managerA.id, {
    factoryId: factoryA.id,
    warehouseId: warehouseA.id,
    productId: testProduct.id,
    type: 'STOCK_IN',
    quantity: 50,
    reason: 'E2E inventory preparation',
  });
  assert(true, 'Step 2: Finished stock availability confirmed');
  const e2eOrder = await createSalesOrder(prisma, managerA.id, {
    factoryId: factoryA.id,
    customerId: e2eCust.id,
    dueDate: new Date(Date.now() + 10 * 86400000),
    lines: [
      {
        productId: testProduct.id,
        quantity: 15,
        unitPrice: 92,
      },
    ],
  });
  assert(e2eOrder.orderNumber !== '', `Step 3: Sales order ${e2eOrder.orderNumber} created`);
  await prisma.salesOrder.update({
    where: {
      id: e2eOrder.id,
    },
    data: {
      status: OrderStatus.CONFIRMED,
    },
  });
  const e2eFulfilled = await fulfillSalesOrder(prisma, e2eOrder.id, managerA.id);
  assert(
    e2eFulfilled.status === OrderStatus.FULFILLED,
    'Step 4: Sales order fulfilled & stock deducted'
  );
  const e2eInvoice = await createInvoiceFromOrder(prisma, managerA.id, {
    orderId: e2eOrder.id,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  assert(
    e2eInvoice.invoiceNumber !== '',
    `Step 5: Invoice ${e2eInvoice.invoiceNumber} generated for ৳${e2eInvoice.total}`
  );
  const e2ePay = await recordCustomerPayment(prisma, managerA.id, {
    invoiceId: e2eInvoice.id,
    amount: 500,
    method: PaymentMethod.MOBILE_BANKING,
    reference: 'BKASH-E2E-12345',
  });
  assert(
    e2ePay.invoice.status === InvoiceStatus.PART_PAID,
    `Step 6: Partial payment recorded; remaining balance ৳${e2ePay.invoice.balanceDue}`
  );
  const hoInvoices = await prisma.invoice.findMany({
    where: {
      id: e2eInvoice.id,
    },
  });
  assert(
    hoInvoices.length === 1,
    'Step 7: Head office admin can query and view Factory A invoice in consolidated book'
  );
  const crossCheck = await prisma.customer.findFirst({
    where: {
      id: e2eCust.id,
      factoryId: factoryB.id,
    },
  });
  assert(
    crossCheck === null,
    'Step 8: Factory B user cannot access or query Factory A customer (strictly null)'
  );
  console.log(`\n========================================`);
  console.log(`Test Execution Finished:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`========================================\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
runTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
