import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Building2, ChevronDown, ChevronUp, ChevronsUpDown, Plus, Receipt, Search } from 'lucide-react';
import {
  getCustomerLedger,
  getCustomers,
  getFactories,
  getGeneralLedger,
  getInvoices,
  getPayments,
  recordPayment,
} from '../api';
import {
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
export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState('receipts');
  return (
    <div className="p2-page finance-page">
      <PageTitle
        title="Payments & Customer Ledger"
        description="Cash collections, remittance entries, and chronological customer running balances."
      />

      <div className="p2-panel">
        <div className="p2-tab-nav">
          <button
            className={`p2-tab-button ${activeTab === 'receipts' ? 'active' : ''}`}
            onClick={() => setActiveTab('receipts')}
          >
            <Receipt size={15} /> Payment Receipts
          </button>
          <button
            className={`p2-tab-button ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => setActiveTab('ledger')}
          >
            <BookOpen size={15} /> Financial & Customer Ledger
          </button>
        </div>

        {activeTab === 'receipts' ? <ReceiptsView /> : <CustomerLedgerView />}
      </div>
    </div>
  );
}
function ReceiptsView() {
  const { isAdmin } = useCurrentRole();
  const [q, setQ] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const [sortOrder, setSortOrder] = useState(''); // '' | 'desc' | 'asc'
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleToggleAmountSort = () => {
    setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    setPage(1);
  };

  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const paymentsQuery = useQuery({
    queryKey: [
      'payments',
      {
        q,
        factoryId,
        page,
        sortBy: sortOrder ? 'amount' : undefined,
        sortOrder: sortOrder || undefined,
      },
    ],
    queryFn: () =>
      getPayments({
        q,
        search: q,
        factoryId: isAdmin ? factoryId : undefined,
        page,
        pageSize: 10,
        sortBy: sortOrder ? 'amount' : undefined,
        sortOrder: sortOrder || undefined,
      }),
  });
  return (
    <div>
      <div className="p2-toolbar">
        <label className="p2-search">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search receipt #, customer, reference…"
          />
        </label>
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
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span className="p2-toolbar-count">
            {paymentsQuery.data?.total ?? paymentsQuery.data?.items?.length ?? 0} payments
          </span>
          <Button
            className="bg-emerald-800 hover:bg-emerald-900 text-white"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={15} /> Record Payment
          </Button>
        </div>
      </div>

      {paymentsQuery.isLoading ? (
        <LoadingState label="Loading payment receipts…" />
      ) : paymentsQuery.error ? (
        <ErrorState
          message={paymentsQuery.error.message}
          retry={() => void paymentsQuery.refetch()}
        />
      ) : paymentsQuery.data?.items.length ? (
        <>
          <div className="p2-table-wrap">
            <table className="p2-table payments-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Receipt #</th>
                  <th>Customer</th>
                  <th>Invoice Ref</th>
                  {isAdmin && <th>Factory</th>}
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th className="amount-header" style={{ textAlign: 'left' }}>
                    <button
                      type="button"
                      onClick={handleToggleAmountSort}
                      className="p2-sort-header-btn"
                      title={
                        sortOrder === 'desc'
                          ? 'Sorted: High to Low. Click to sort Low to High'
                          : sortOrder === 'asc'
                            ? 'Sorted: Low to High. Click to sort High to Low'
                            : 'Click to sort Amount High to Low'
                      }
                    >
                      <span>Amount (<span className="p2-taka-sign">৳</span>)</span>
                      <span className={`p2-sort-icon-wrap ${sortOrder ? 'active' : ''}`}>
                        {sortOrder === 'desc' ? (
                          <ChevronDown size={14} />
                        ) : sortOrder === 'asc' ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronsUpDown size={14} />
                        )}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paymentsQuery.data.items.map((p, index) => (
                  <tr key={p.id}>
                    <td>
                      {String((page - 1) * 10 + index + 1).padStart(2, '0')}
                    </td>
                    <td>
                      <strong
                        style={{
                          color: '#1f3427',
                        }}
                      >
                        {p.receiptNumber ?? p.receiptNo}
                      </strong>
                    </td>
                    <td>
                      <strong>{p.customer.name}</strong>
                    </td>
                    <td>
                      <Link className="p2-record-link" to={`/invoices/${p.invoice.id}`}>
                        {p.invoice.invoiceNumber}
                      </Link>
                    </td>
                    {isAdmin && (
                      <td>
                        <span className="p2-factory">
                          <Building2 size={13} />
                          {p.factory?.code ?? '—'}
                        </span>
                      </td>
                    )}
                    <td>
                      <span className="p2-badge in_progress">
                        {(p.paymentMethod ?? p.method ?? 'BANK_TRANSFER').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>{p.reference || '—'}</td>
                    <td>
                      {new Date(p.paymentDate ?? p.paidAt ?? Date.now()).toLocaleDateString(
                        'en-GB'
                      )}
                    </td>
                    <td className="amount-cell">
                      <strong
                        style={{
                          color: '#207e4d',
                        }}
                      >
                        +{Number(p.amount || 0).toLocaleString('en-BD')} /-
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paymentsQuery.data.page}
            totalPages={paymentsQuery.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No payments recorded"
          detail="Record customer collections to maintain ledger balances."
        />
      )}

      {isModalOpen && <RecordPaymentModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
function RecordPaymentModal({ onClose }) {
  const client = useQueryClient();
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const openInvoicesQuery = useQuery({
    queryKey: ['open-invoices'],
    queryFn: () =>
      getInvoices({
        pageSize: 100,
      }),
  });
  const openInvoices = (openInvoicesQuery.data?.items ?? []).filter(
    (inv) => (inv.status === 'ISSUED' || inv.status === 'PART_PAID') && inv.balanceDue > 0
  );
  const selectedInvoice = openInvoices.find((i) => i.id === invoiceId);
  const payMut = useMutation({
    mutationFn: () =>
      recordPayment({
        invoiceId,
        amount: Number(amount),
        paymentMethod: method,
        reference: reference || undefined,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['payments'],
      });
      void client.invalidateQueries({
        queryKey: ['invoices'],
      });
      void client.invalidateQueries({
        queryKey: ['dashboard'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!invoiceId) {
      setErrorMsg('Please select an outstanding invoice.');
      return;
    }
    const num = Number(amount);
    if (!num || num <= 0) {
      setErrorMsg('Payment amount must be greater than zero.');
      return;
    }
    if (selectedInvoice && num > selectedInvoice.balanceDue) {
      setErrorMsg(
        `Amount cannot exceed balance due of ${money.format(selectedInvoice.balanceDue)}`
      );
      return;
    }
    payMut.mutate();
  };
  return (
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
          width: '480px',
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
          Record Customer Payment
        </h3>
        {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

        <form onSubmit={handleSubmit}>
          <FormRow label="Select Outstanding Invoice" required>
            <select
              className="p2-select"
              value={invoiceId}
              onChange={(e) => {
                setInvoiceId(e.target.value);
                const found = openInvoices.find((i) => i.id === e.target.value);
                if (found) setAmount(String(found.balanceDue));
              }}
              required
            >
              <option value="">Select open invoice…</option>
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — {inv.customer.name} (Due: {money.format(inv.balanceDue)})
                </option>
              ))}
            </select>
          </FormRow>

          {selectedInvoice && (
            <div
              style={{
                background: '#f4f8f5',
                padding: '10px 14px',
                borderRadius: '5px',
                margin: '10px 0',
                fontSize: '13px',
              }}
            >
              <div>
                <strong>Customer:</strong> {selectedInvoice.customer.name}
              </div>
              <div>
                <strong>Invoice Total:</strong> {money.format(selectedInvoice.total)}
              </div>
              <div
                style={{
                  color: '#b2352c',
                  fontWeight: 600,
                }}
              >
                <strong>Current Balance Due:</strong> {money.format(selectedInvoice.balanceDue)}
              </div>
            </div>
          )}

          <FormRow label="Payment Amount (BDT)" required>
            <input
              type="number"
              step="0.01"
              max={selectedInvoice?.balanceDue}
              className="p2-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </FormRow>

          <FormRow label="Payment Method" required>
            <select
              className="p2-select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="BANK_TRANSFER">Bank Transfer (EFT/NPSB)</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="MOBILE_BANKING">bKash / Nagad / Rocket</option>
            </select>
          </FormRow>

          <FormRow label="Reference / Cheque Number">
            <input
              type="text"
              className="p2-input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. Deposit slip #48921 / Cheque #0912384"
            />
          </FormRow>

          <FormRow label="Remarks / Notes">
            <input
              type="text"
              className="p2-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes"
            />
          </FormRow>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '20px',
            }}
          >
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              disabled={payMut.isPending}
            >
              {payMut.isPending ? 'Processing…' : 'Record Payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function CustomerLedgerView() {
  const { isAdmin } = useCurrentRole();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const customersQuery = useQuery({
    queryKey: ['customers-list-ledger'],
    queryFn: () =>
      getCustomers({
        pageSize: 100,
      }),
  });
  const customers = customersQuery.data?.items ?? [];
  const ledgerQuery = useQuery({
    queryKey: [
      'financial-ledger',
      {
        customerId: selectedCustomerId,
        factoryId: isAdmin ? factoryId : undefined,
      },
    ],
    queryFn: () =>
      getGeneralLedger({
        customerId: selectedCustomerId || undefined,
        factoryId: isAdmin ? factoryId : undefined,
      }),
  });
  const isCustomerFiltered = Boolean(selectedCustomerId);
  const selectedCustomerObj = customers.find((c) => c.id === selectedCustomerId);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const filteredEntries = (ledgerQuery.data?.entries ?? []).filter((entry) => {
    if (!ledgerSearch.trim()) return true;
    const term = ledgerSearch.toLowerCase();
    const doc = (entry.reference || entry.id || '').toLowerCase();
    const desc = (entry.description || '').toLowerCase();
    const cust = (entry.customer?.name || entry.customerName || '').toLowerCase();
    const type = (entry.type || '').toLowerCase();
    return doc.includes(term) || desc.includes(term) || cust.includes(term) || type.includes(term);
  });
  return (
    <div
      style={{
        padding: '20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <strong
            style={{
              fontSize: '14px',
              color: '#27382e',
            }}
          >
            Ledger Filter:
          </strong>
          <select
            className="p2-select"
            style={{
              minWidth: '300px',
            }}
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
          >
            <option value="">All Customers (Full General Ledger)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code}){isAdmin ? ` — ${c.factory?.code}` : ''}
              </option>
            ))}
          </select>
        </div>

        {isAdmin && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <strong
              style={{
                fontSize: '14px',
                color: '#27382e',
              }}
            >
              Factory:
            </strong>
            <select
              className="p2-select"
              value={factoryId}
              onChange={(e) => setFactoryId(e.target.value)}
            >
              <option value="">Both factories</option>
              {(factoriesQuery.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="p2-search" style={{ minWidth: '240px' }}>
          <Search size={15} />
          <input
            value={ledgerSearch}
            onChange={(e) => setLedgerSearch(e.target.value)}
            placeholder="Search ledger entries…"
          />
        </label>
      </div>

      {ledgerQuery.isLoading ? (
        <LoadingState label="Computing ledger running balances…" />
      ) : ledgerQuery.error ? (
        <ErrorState message={ledgerQuery.error.message} retry={() => void ledgerQuery.refetch()} />
      ) : ledgerQuery.data ? (
        <>
          <div className="p2-summary-grid">
            <div className="p2-card">
              <span>Total Invoiced (Gross)</span>
              <strong
                style={{
                  color: '#1d3425',
                }}
              >
                {money.format(ledgerQuery.data.totalInvoiced)}
              </strong>
              <small>
                {isCustomerFiltered
                  ? 'Gross billing for customer'
                  : 'Cumulative gross billed across all customers'}
              </small>
            </div>
            <div className="p2-card">
              <span>Total Collections Received</span>
              <strong
                style={{
                  color: '#1e683f',
                }}
              >
                {money.format(ledgerQuery.data.totalPaid)}
              </strong>
              <small>
                {isCustomerFiltered
                  ? 'Receipts collected from customer'
                  : 'Cash & bank receipts across all customers'}
              </small>
            </div>
            <div className="p2-card">
              <span>Outstanding Receivable</span>
              <strong
                style={{
                  color:
                    (ledgerQuery.data.outstandingBalance ??
                      ledgerQuery.data.currentOutstanding ??
                      0) > 0
                      ? '#b2352c'
                      : '#1e683f',
                }}
              >
                {money.format(
                  ledgerQuery.data.outstandingBalance ?? ledgerQuery.data.currentOutstanding ?? 0
                )}
              </strong>
              <small>
                {isCustomerFiltered
                  ? 'Net receivable due from customer'
                  : 'Total net accounts receivable outstanding'}
              </small>
            </div>
          </div>

          <div
            className="p2-panel"
            style={{
              marginTop: '16px',
            }}
          >
            <div
              className="p2-toolbar"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong
                style={{
                  fontSize: '14px',
                  color: '#213328',
                }}
              >
                {isCustomerFiltered
                  ? `Chronological Transaction History for ${selectedCustomerObj?.name || ledgerQuery.data.customer?.name || 'Customer'}`
                  : 'Full Financial Ledger — All Customer Invoices & Payment Collections'}
              </strong>
              <span
                className="p2-subtext"
                style={{
                  fontSize: '12.5px',
                }}
              >
                {filteredEntries.length} transaction
                {filteredEntries.length === 1 ? '' : 's'} recorded
              </span>
            </div>

            {filteredEntries.length ? (
              <div className="p2-table-wrap">
                <table className="p2-table payments-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Reference / Doc</th>
                      <th>Customer</th>
                      {isAdmin && <th>Factory</th>}
                      <th>Description</th>
                      <th className="amount-header">
                        Debit (<span className="p2-taka-sign">৳</span>)
                      </th>
                      <th className="amount-header">
                        Credit (<span className="p2-taka-sign">৳</span>)
                      </th>
                      <th className="amount-header">
                        Running Balance (<span className="p2-taka-sign">৳</span>)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((entry, eIdx) => (
                      <tr key={entry.id}>
                        <td>
                          {String(eIdx + 1).padStart(2, '0')}
                        </td>
                        <td>{new Date(entry.date).toLocaleDateString('en-GB')}</td>
                        <td>
                          <span
                            className={`p2-badge ${entry.type === 'INVOICE' ? 'issued' : 'fulfilled'}`}
                          >
                            {entry.type}
                          </span>
                        </td>
                        <td>
                          {entry.type === 'INVOICE' ? (
                            <Link className="p2-record-link" to={`/invoices/${entry.id}`}>
                              {entry.reference}
                            </Link>
                          ) : (
                            <strong>{entry.reference}</strong>
                          )}
                        </td>
                        <td>
                          <strong>{entry.customer?.name ?? '—'}</strong>
                          {entry.customer?.code && (
                            <small className="p2-subtext">{entry.customer.code}</small>
                          )}
                        </td>
                        {isAdmin && (
                          <td>
                            <span className="p2-factory">
                              <Building2 size={13} />
                              {entry.factory?.code ?? '—'}
                            </span>
                          </td>
                        )}
                        <td>{entry.description}</td>
                        <td className="amount-cell">
                          {entry.debit > 0 ? `${Number(entry.debit).toLocaleString('en-BD')} /-` : '—'}
                        </td>
                        <td
                          className="amount-cell"
                          style={{
                            color: '#207e4d',
                          }}
                        >
                          {entry.credit > 0 ? `-${Number(entry.credit).toLocaleString('en-BD')} /-` : '—'}
                        </td>
                        <td className="amount-cell">
                          <strong
                            style={{
                              color: (entry.balance ?? 0) > 0 ? '#b2352c' : '#1e683f',
                            }}
                          >
                            {Number(entry.balance ?? 0).toLocaleString('en-BD')} /-
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No ledger entries found"
                detail="Transactions will populate once sales orders are invoiced or payments received."
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
