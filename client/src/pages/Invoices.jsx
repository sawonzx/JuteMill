import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Ban, Building2, CreditCard, Printer, Search } from 'lucide-react';
import {
  createInvoice,
  getFactories,
  getInvoice,
  getInvoices,
  getOrder,
  recordPayment,
  voidInvoice,
} from '../api';
import {
  BackLink,
  EmptyState,
  ErrorState,
  FormRow,
  LoadingState,
  Notice,
  PageTitle,
  Pagination,
  useDemoRole as useCurrentRole,
} from './shared';
import { Button } from '../components/ui/button';
const money = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 0,
});
export default function InvoicesPage() {
  const { id } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const createFromOrder = searchParams.get('createFromOrder');
  if (createFromOrder) return <CreateInvoiceFromOrder orderId={createFromOrder} />;
  if (id) return <InvoiceDetailView id={id} />;
  return <InvoiceListView />;
}
function StatusChip({ status }) {
  const cls = status.toLowerCase();
  return (
    <span className={`p2-badge ${cls}`}>
      <i />
      {status.replace('_', ' ')}
    </span>
  );
}
function InvoiceListView() {
  const { isAdmin } = useCurrentRole();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const invoicesQuery = useQuery({
    queryKey: [
      'invoices',
      {
        q,
        status,
        factoryId,
        page,
      },
    ],
    queryFn: () =>
      getInvoices({
        search: q,
        status,
        factoryId: isAdmin ? factoryId : undefined,
        page,
        pageSize: 10,
      }),
  });
  return (
    <div className="p2-page">
      <PageTitle
        title="Invoices"
        description="Accounts receivable billing, sales order invoices, and payment tracking."
      />

      <section className="p2-panel">
        <div className="p2-toolbar">
          <label className="p2-search">
            <Search size={16} />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search invoice # or customer…"
            />
          </label>
          <select
            className="p2-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="ISSUED">Issued (Unpaid)</option>
            <option value="PART_PAID">Part Paid</option>
            <option value="PAID">Fully Paid</option>
            <option value="VOID">Void</option>
          </select>
          {isAdmin && (
            <select
              className="p2-select"
              value={factoryId}
              onChange={(e) => {
                setFactoryId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Both factories</option>
              {(factoriesQuery.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {invoicesQuery.isLoading ? (
          <LoadingState label="Loading invoices…" />
        ) : invoicesQuery.error ? (
          <ErrorState
            message={invoicesQuery.error.message}
            retry={() => void invoicesQuery.refetch()}
          />
        ) : invoicesQuery.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    {isAdmin && <th>Factory</th>}
                    <th>Status</th>
                    <th>Issue Date</th>
                    <th>Due Date</th>
                    <th className="p2-right">Total</th>
                    <th className="p2-right">Balance Due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoicesQuery.data.items.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link className="p2-record-link" to={`/invoices/${inv.id}`}>
                          {inv.invoiceNumber}
                          {inv.salesOrder && <small>Order: {inv.salesOrder.orderNumber}</small>}
                        </Link>
                      </td>
                      <td>
                        <strong>{inv.customer.name}</strong>
                        <small className="p2-subtext">{inv.customer.city}</small>
                      </td>
                      {isAdmin && (
                        <td>
                          <span className="p2-factory">
                            <Building2 size={13} />
                            {inv.factory.code}
                          </span>
                        </td>
                      )}
                      <td>
                        <StatusChip status={inv.status} />
                      </td>
                      <td>{new Date(inv.issueDate).toLocaleDateString('en-GB')}</td>
                      <td>{new Date(inv.dueDate).toLocaleDateString('en-GB')}</td>
                      <td className="p2-right">{money.format(inv.total)}</td>
                      <td className="p2-right amount-cell">
                        <strong
                          style={{
                            color: inv.balanceDue > 0 ? '#b83b32' : '#238b54',
                          }}
                        >
                          {money.format(inv.balanceDue)}
                        </strong>
                      </td>
                      <td className="p2-actions">
                        <Link to={`/invoices/${inv.id}`} title="View Invoice">
                          <ArrowRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={invoicesQuery.data.page}
              totalPages={invoicesQuery.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No invoices found"
            detail="Fulfill sales orders to automatically or manually generate customer invoices."
          />
        )}
      </section>
    </div>
  );
}
function CreateInvoiceFromOrder({ orderId }) {
  const navigate = useNavigate();
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrder(orderId),
  });
  const createMut = useMutation({
    mutationFn: (data) => createInvoice(data),
    onSuccess: (newInv) => {
      navigate(`/invoices/${newInv.id}`);
    },
    onError: (err) => {
      const details = err.details?.length
        ? `: ${err.details.map((d) => d.message || d.field).join(', ')}`
        : '';
      setErrorMsg((err.message ?? 'Failed to create invoice') + details);
    },
  });
  if (isLoading) return <LoadingState label="Loading sales order…" />;
  if (!order) return <ErrorState message="Could not find sales order" />;
  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    createMut.mutate({
      orderId,
      dueDate: dueDate ? new Date(dueDate).toISOString() : new Date().toISOString(),
      notes: notes || undefined,
    });
  };
  return (
    <div className="p2-page">
      <BackLink to={`/sales/${orderId}`}>Back to Sales Order</BackLink>
      <PageTitle
        title={`Generate Invoice for ${order.orderNumber}`}
        description={`Customer: ${order.customer.name} · Factory: ${order.factory.name}`}
      />

      {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

      <form
        onSubmit={handleSubmit}
        className="p2-panel"
        style={{
          padding: '24px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '18px',
          }}
        >
          <FormRow label="Order Reference">
            <input type="text" className="p2-input" value={order.orderNumber} disabled />
          </FormRow>
          <FormRow label="Customer">
            <input type="text" className="p2-input" value={order.customer.name} disabled />
          </FormRow>
          <FormRow label="Payment Due Date" required>
            <input
              type="date"
              className="p2-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </FormRow>
        </div>

        <div
          style={{
            marginTop: '20px',
          }}
        >
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
            }}
          >
            Itemized Snapshot to be Invoiced:
          </strong>
          <table
            className="p2-line-table"
            style={{
              marginTop: '8px',
            }}
          >
            <thead>
              <tr>
                <th>Product</th>
                <th>Unit</th>
                <th className="p2-right">Quantity</th>
                <th className="p2-right">Unit Price</th>
                <th className="p2-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.product.name}</td>
                  <td>{l.product.unit}</td>
                  <td className="p2-right">{l.quantity}</td>
                  <td className="p2-right">{money.format(l.unitPrice)}</td>
                  <td className="p2-right amount-cell">{money.format(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: '16px',
          }}
        >
          <FormRow label="Invoice Payment Terms / Notes">
            <textarea
              className="p2-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Payment due within 15 days via bank transfer to Dhaka Bank Ltd."
            />
          </FormRow>
        </div>

        <div
          style={{
            marginTop: '24px',
            paddingTop: '18px',
            borderTop: '1px solid #e7eee9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '13px',
                color: '#6a7870',
              }}
            >
              Invoice Total:{' '}
            </span>
            <strong
              style={{
                fontSize: '20px',
                color: '#1a3124',
                marginLeft: '6px',
              }}
            >
              {money.format(order.total)}
            </strong>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '10px',
            }}
          >
            <Button type="button" variant="outline" onClick={() => navigate(`/sales/${orderId}`)}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Generating…' : 'Generate & Issue Invoice'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
function InvoiceDetailView({ id }) {
  const { isManager } = useCurrentRole();
  const client = useQueryClient();
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [payModal, setPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER');
  const [payRef, setPayRef] = useState('');
  const [payError, setPayError] = useState(null);
  const {
    data: inv,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoice(id),
  });
  const voidMut = useMutation({
    mutationFn: () => voidInvoice(id, voidReason || 'Administrative cancellation'),
    onSuccess: () => {
      setVoidModal(false);
      void client.invalidateQueries({
        queryKey: ['invoices'],
      });
      void refetch();
    },
  });
  const payMut = useMutation({
    mutationFn: () =>
      recordPayment({
        invoiceId: id,
        amount: Number(payAmount),
        paymentMethod: payMethod,
        reference: payRef || undefined,
      }),
    onSuccess: () => {
      setPayModal(false);
      setPayAmount('');
      setPayRef('');
      void client.invalidateQueries({
        queryKey: ['invoices'],
      });
      void client.invalidateQueries({
        queryKey: ['payments'],
      });
      void refetch();
    },
    onError: (err) => setPayError(err.message),
  });
  if (isLoading) return <LoadingState label="Loading invoice…" />;
  if (error || !inv)
    return (
      <ErrorState message={error?.message ?? 'Invoice not found'} retry={() => void refetch()} />
    );
  const printInvoice = () => {
    window.print();
  };
  return (
    <div className="p2-page">
      <div className="no-print">
        <BackLink to="/invoices">Back to invoices</BackLink>
        <div
          className="p2-title-row"
          style={{
            marginTop: '10px',
          }}
        >
          <div>
            <h1>{inv.invoiceNumber}</h1>
            <p>
              Status: <StatusChip status={inv.status} /> · Balance Due:{' '}
              <strong
                style={{
                  color: inv.balanceDue > 0 ? '#b83b32' : '#238b54',
                }}
              >
                {money.format(inv.balanceDue)}
              </strong>
            </p>
          </div>
          <div className="p2-title-action">
            <Button variant="outline" onClick={printInvoice}>
              <Printer size={15} /> Print Invoice
            </Button>
            {inv.status !== 'PAID' && inv.status !== 'VOID' && (
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                onClick={() => {
                  setPayAmount(String(inv.balanceDue));
                  setPayModal(true);
                }}
              >
                <CreditCard size={15} /> Record Payment
              </Button>
            )}
            {isManager &&
              inv.status !== 'PAID' &&
              inv.status !== 'VOID' &&
              inv.paidAmount === 0 && (
                <Button
                  variant="outline"
                  className="text-red-700 border-red-300"
                  onClick={() => setVoidModal(true)}
                >
                  <Ban size={15} /> Void
                </Button>
              )}
          </div>
        </div>
      </div>

      {}
      <div className="printable-area invoice-print-sheet">
        <div className="invoice-print-header">
          <div className="invoice-print-brand">
            <h2>Bengal Jute Industries Ltd.</h2>
            <p>
              {inv.factory.name} · {inv.factory.location}, Bangladesh
            </p>
            <p>VAT Reg: BIN-00129384920 · Email: info@bengaljute.com</p>
          </div>
          <div className="invoice-print-meta">
            <h1>TAX INVOICE</h1>
            <p>
              <strong>Invoice #: </strong> {inv.invoiceNumber}
            </p>
            <p>
              <strong>Date: </strong> {new Date(inv.issueDate).toLocaleDateString('en-GB')}
            </p>
            <p>
              <strong>Payment Due: </strong> {new Date(inv.dueDate).toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>

        <div className="invoice-print-parties">
          <div>
            <h4>Billed To (Customer):</h4>
            <p>
              <strong>{inv.customer.name}</strong>
            </p>
            <p>Attn: {inv.customer.contactPerson}</p>
            <p>{inv.customer.address}</p>
            <p>{inv.customer.city}, Bangladesh</p>
            <p>Phone: {inv.customer.phone}</p>
          </div>
          <div>
            <h4>Dispatch & Mill Details:</h4>
            <p>
              <strong>Mill Unit:</strong> {inv.factory.name}
            </p>
            {inv.salesOrder && (
              <p>
                <strong>Sales Order Ref:</strong> {inv.salesOrder.orderNumber}
              </p>
            )}
            <p>
              <strong>Payment Status:</strong> {inv.status.replace('_', ' ')}
            </p>
          </div>
        </div>

        <table className="invoice-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Description / Product</th>
              <th>Unit</th>
              <th className="p2-right">Quantity</th>
              <th className="p2-right">Unit Price (BDT)</th>
              <th className="p2-right">Total (BDT)</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((item, idx) => (
              <tr key={item.id}>
                <td>{idx + 1}</td>
                <td>
                  <strong>{item.description}</strong>
                </td>
                <td>{item.product?.unit || item.unit || 'Unit'}</td>
                <td className="p2-right">{item.quantity}</td>
                <td className="p2-right">{money.format(item.unitPrice)}</td>
                <td className="p2-right amount-cell">{money.format(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          <div>
            <span>Subtotal:</span>
            <span>{money.format(inv.subtotal)}</span>
          </div>
          {inv.taxAmount > 0 && (
            <div>
              <span>VAT:</span>
              <span>{money.format(inv.taxAmount)}</span>
            </div>
          )}
          <div className="grand-total">
            <span>Invoice Total:</span>
            <span>{money.format(inv.total)}</span>
          </div>
          <div>
            <span>Amount Paid:</span>
            <span>{money.format(inv.paidAmount)}</span>
          </div>
          <div className="balance-due">
            <span>Balance Due:</span>
            <span>{money.format(inv.balanceDue)}</span>
          </div>
        </div>

        {inv.notes && (
          <div
            style={{
              marginTop: '20px',
              padding: '12px',
              background: '#f8faf8',
              borderRadius: '5px',
              fontSize: '12.5px',
            }}
          >
            <strong>Notes / Bank Details:</strong>
            <p
              style={{
                margin: '4px 0 0',
              }}
            >
              {inv.notes}
            </p>
          </div>
        )}

        {inv.payments.length > 0 && (
          <div
            style={{
              marginTop: '24px',
            }}
          >
            <h4
              style={{
                fontSize: '13px',
                color: '#4d5d53',
                marginBottom: '8px',
              }}
            >
              Payment Receipts Received:
            </h4>
            <table
              className="p2-table"
              style={{
                fontSize: '12.5px',
              }}
            >
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="p2-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => {
                  const receiptNo = p.receiptNumber || p.receiptNo || '—';
                  const pDate = p.paymentDate || p.paidAt;
                  const pMethod = (p.paymentMethod || p.method || 'BANK_TRANSFER').replace(
                    /_/g,
                    ' '
                  );
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{receiptNo}</strong>
                      </td>
                      <td>{pDate ? new Date(pDate).toLocaleDateString('en-GB') : '—'}</td>
                      <td>{pMethod}</td>
                      <td>{p.reference || '—'}</td>
                      <td className="p2-right font-medium">{money.format(p.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {}
      {payModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '420px',
              maxWidth: '90%',
            }}
          >
            <h3
              style={{
                margin: '0 0 14px',
                fontSize: '18px',
                color: '#1a2e22',
              }}
            >
              Record Payment
            </h3>
            {payError && <Notice kind="error">{payError}</Notice>}
            <FormRow label="Balance Due">
              <input
                type="text"
                className="p2-input"
                value={money.format(inv.balanceDue)}
                disabled
              />
            </FormRow>
            <FormRow label="Payment Amount (BDT)" required>
              <input
                type="number"
                step="0.01"
                max={inv.balanceDue}
                className="p2-input"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </FormRow>
            <FormRow label="Payment Method" required>
              <select
                className="p2-select"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              >
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="MOBILE_BANKING">bKash / Nagad</option>
              </select>
            </FormRow>
            <FormRow label="Transaction Ref / Cheque No">
              <input
                type="text"
                className="p2-input"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. TXN-998822 / Cheque #49281"
              />
            </FormRow>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '18px',
              }}
            >
              <Button variant="outline" onClick={() => setPayModal(false)}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                onClick={() => payMut.mutate()}
                disabled={payMut.isPending || !Number(payAmount)}
              >
                {payMut.isPending ? 'Processing…' : 'Confirm Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {}
      {voidModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '400px',
              maxWidth: '90%',
            }}
          >
            <h3
              style={{
                margin: '0 0 10px',
                fontSize: '18px',
                color: '#92261f',
              }}
            >
              Void Invoice
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: '#56665d',
              }}
            >
              Are you sure you want to void invoice {inv.invoiceNumber}? This action cannot be
              reversed.
            </p>
            <FormRow label="Reason for voiding">
              <input
                type="text"
                className="p2-input"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Order cancelled, billing mistake"
              />
            </FormRow>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '18px',
              }}
            >
              <Button variant="outline" onClick={() => setVoidModal(false)}>
                Cancel
              </Button>
              <Button
                className="bg-red-700 hover:bg-red-800 text-white"
                onClick={() => voidMut.mutate()}
                disabled={voidMut.isPending}
              >
                {voidMut.isPending ? 'Voiding…' : 'Confirm Void'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
