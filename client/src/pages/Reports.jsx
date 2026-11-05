import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Factory,
  FileSpreadsheet,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import {
  getExportUrl,
  getFactories,
  getOrdersReport,
  getProductionReport,
  getReceivablesReport,
  getSalesReport,
} from '../api';
import { ErrorState, LoadingState, PageTitle, useDemoRole as useCurrentRole } from './shared';
import { Button } from '../components/ui/button';
const money = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 0,
});
export default function ReportsPage() {
  const { isAdmin } = useCurrentRole();
  const [activeTab, setActiveTab] = useState('sales');
  const [factoryId, setFactoryId] = useState('');
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const handleExport = (type) => {
    const url = getExportUrl(type, {
      factoryId: isAdmin && factoryId ? factoryId : undefined,
    });
    window.open(url, '_blank');
  };
  return (
    <div className="p2-page">
      <PageTitle
        title="Business Reports"
        description="Factory-level and consolidated operational performance, aging accounts, and CSV data exports."
        action={
          <div
            style={{
              display: 'flex',
              gap: '8px',
            }}
          >
            <Button variant="outline" onClick={() => handleExport(activeTab)}>
              <Download size={14} /> Export {activeTab.toUpperCase()} CSV
            </Button>
            <Button variant="outline" onClick={() => handleExport('inventory')}>
              <FileSpreadsheet size={14} /> Export Inventory CSV
            </Button>
          </div>
        }
      />

      <div className="p2-panel">
        <div
          className="p2-toolbar"
          style={{
            justifyContent: 'space-between',
          }}
        >
          <div
            className="p2-tab-nav"
            style={{
              border: 0,
              padding: 0,
            }}
          >
            <button
              className={`p2-tab-button ${activeTab === 'sales' ? 'active' : ''}`}
              onClick={() => setActiveTab('sales')}
            >
              <TrendingUp size={15} /> Sales & Collections
            </button>
            <button
              className={`p2-tab-button ${activeTab === 'orders' ? 'active' : ''}`}
              onClick={() => setActiveTab('orders')}
            >
              <ShoppingCart size={15} /> Sales Orders Book
            </button>
            <button
              className={`p2-tab-button ${activeTab === 'receivables' ? 'active' : ''}`}
              onClick={() => setActiveTab('receivables')}
            >
              <Receipt size={15} /> Receivables Aging
            </button>
            {}
          </div>

          {isAdmin && (
            <select
              className="p2-select"
              value={factoryId}
              onChange={(e) => setFactoryId(e.target.value)}
            >
              <option value="">Both factories (Consolidated)</option>
              {(factoriesQuery.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div
          style={{
            padding: '20px',
          }}
        >
          {activeTab === 'sales' && <SalesReportView factoryId={factoryId} />}
          {activeTab === 'orders' && <OrdersReportView factoryId={factoryId} />}
          {activeTab === 'receivables' && <ReceivablesReportView factoryId={factoryId} />}
          {}
        </div>
      </div>
    </div>
  );
}
function SalesReportView({ factoryId }) {
  const { isAdmin } = useCurrentRole();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report-sales', factoryId],
    queryFn: () =>
      getSalesReport({
        factoryId: factoryId || undefined,
      }),
  });
  if (isLoading) return <LoadingState label="Computing sales and collections metrics…" />;
  if (error || !data)
    return (
      <ErrorState message={error?.message ?? 'Report unavailable'} retry={() => void refetch()} />
    );
  const summary = data.summary ?? {
    totalRevenue: data.totalCollected ?? 0,
    totalInvoiced: data.totalInvoiced ?? 0,
    totalOutstanding: data.totalOutstanding ?? 0,
    invoiceCount: 0,
    paidInvoiceCount: 0,
  };
  const monthly = data.monthly ?? [];
  const topCustomers = data.topCustomers ?? [];
  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Collected Revenue</span>
          <strong
            style={{
              color: '#1e683f',
            }}
          >
            {money.format(summary.totalRevenue)}
          </strong>
          <small>Verified payments received</small>
        </div>
        <div className="p2-card">
          <span>Gross Invoiced Value</span>
          <strong
            style={{
              color: '#1c2e23',
            }}
          >
            {money.format(summary.totalInvoiced)}
          </strong>
          <small>{summary.invoiceCount} invoices issued</small>
        </div>
        <div className="p2-card">
          <span>Outstanding Receivables</span>
          <strong
            style={{
              color: '#b2352c',
            }}
          >
            {money.format(summary.totalOutstanding)}
          </strong>
          <small>{summary.paidInvoiceCount} fully settled</small>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
          marginTop: '14px',
        }}
      >
        <div
          className="p2-panel"
          style={{
            padding: '16px',
          }}
        >
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
              display: 'block',
              marginBottom: '12px',
            }}
          >
            Monthly Collections Trend (BDT)
          </strong>
          <table
            className="p2-table"
            style={{
              fontSize: '13px',
            }}
          >
            <thead>
              <tr>
                <th>Month</th>
                {isAdmin && <th className="p2-right">Dhaka Mill</th>}
                {isAdmin && <th className="p2-right">Khulna Mill</th>}
                <th className="p2-right">{isAdmin ? 'Combined' : 'Total (BDT)'}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={row.month}>
                  <td>
                    <strong>{row.month}</strong>
                  </td>
                  {isAdmin && <td className="p2-right">{money.format(row.factoryA)}</td>}
                  {isAdmin && <td className="p2-right">{money.format(row.factoryB)}</td>}
                  <td className="p2-right amount-cell">
                    <strong>{money.format(row.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="p2-panel"
          style={{
            padding: '16px',
          }}
        >
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
              display: 'block',
              marginBottom: '12px',
            }}
          >
            Top Customer Contributors
          </strong>
          <table
            className="p2-table"
            style={{
              fontSize: '13px',
            }}
          >
            <thead>
              <tr>
                <th>Customer</th>
                {isAdmin && <th>Factory</th>}
                <th className="p2-right">Invoices</th>
                <th className="p2-right">Total (BDT)</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((cust) => (
                <tr key={cust.id}>
                  <td>
                    <strong>{cust.name}</strong>
                  </td>
                  {isAdmin && <td>{cust.factoryCode}</td>}
                  <td className="p2-right">{cust.invoiceCount}</td>
                  <td className="p2-right amount-cell">
                    <strong>{money.format(cust.totalSales)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function OrdersReportView({ factoryId }) {
  const { isAdmin } = useCurrentRole();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report-orders', factoryId],
    queryFn: () =>
      getOrdersReport({
        factoryId: factoryId || undefined,
      }),
  });
  if (isLoading) return <LoadingState label="Computing order book statistics…" />;
  if (error || !data)
    return (
      <ErrorState message={error?.message ?? 'Report unavailable'} retry={() => void refetch()} />
    );
  const byStatus = data.byStatus ?? [];
  const byFactory = data.byFactory ?? [];
  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Orders</span>
          <strong>{data.totalOrders ?? 0}</strong>
          <small>Across active records</small>
        </div>
        <div className="p2-card">
          <span>Gross Order Value</span>
          <strong
            style={{
              color: '#1a3325',
            }}
          >
            {money.format(data.totalValue ?? 0)}
          </strong>
          <small>Combined sales book value</small>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
          marginTop: '14px',
        }}
      >
        <div
          className="p2-panel"
          style={{
            padding: '16px',
          }}
        >
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
              display: 'block',
              marginBottom: '12px',
            }}
          >
            Status Distribution
          </strong>
          <table
            className="p2-table"
            style={{
              fontSize: '13px',
            }}
          >
            <thead>
              <tr>
                <th>Status</th>
                <th className="p2-right">Count</th>
                <th className="p2-right">Order Value</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((s) => (
                <tr key={s.status}>
                  <td>
                    <span className={`p2-badge ${s.status.toLowerCase()}`}>
                      {s.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p2-right font-medium">{s.count}</td>
                  <td className="p2-right amount-cell">{money.format(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isAdmin && byFactory.length > 0 && (
          <div
            className="p2-panel"
            style={{
              padding: '16px',
            }}
          >
            <strong
              style={{
                fontSize: '14px',
                color: '#27382f',
                display: 'block',
                marginBottom: '12px',
              }}
            >
              Distribution by Factory
            </strong>
            <table
              className="p2-table"
              style={{
                fontSize: '13px',
              }}
            >
              <thead>
                <tr>
                  <th>Factory</th>
                  <th className="p2-right">Count</th>
                  <th className="p2-right">Total Value</th>
                </tr>
              </thead>
              <tbody>
                {byFactory.map((f) => (
                  <tr key={f.factoryId}>
                    <td>
                      <strong>{f.factoryName}</strong> ({f.factoryCode})
                    </td>
                    <td className="p2-right font-medium">{f.count}</td>
                    <td className="p2-right amount-cell">
                      <strong>{money.format(f.totalValue)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
function ReceivablesReportView({ factoryId }) {
  const { isAdmin } = useCurrentRole();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report-receivables', factoryId],
    queryFn: () =>
      getReceivablesReport({
        factoryId: factoryId || undefined,
      }),
  });
  if (isLoading) return <LoadingState label="Computing receivables aging schedule…" />;
  if (error || !data)
    return (
      <ErrorState message={error?.message ?? 'Report unavailable'} retry={() => void refetch()} />
    );
  const totalOutstanding = data.totalOutstanding ?? data.totalReceivables ?? 0;
  const aging = data.aging ?? {
    current: 0,
    days30: 0,
    days60: 0,
    days90Plus: 0,
  };
  const customerCount = data.customerCount ?? data.customers?.length ?? 0;
  const customers = data.customers ?? [];
  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Outstanding Receivables</span>
          <strong
            style={{
              color: '#b2352c',
            }}
          >
            {money.format(totalOutstanding)}
          </strong>
          <small>{customerCount} customers with unpaid balances</small>
        </div>
        <div className="p2-card">
          <span>Current (0 - 30 Days)</span>
          <strong
            style={{
              color: '#1e683f',
            }}
          >
            {money.format(aging.current ?? 0)}
          </strong>
          <small>Healthy aging profile</small>
        </div>
        <div className="p2-card">
          <span>Past Due (31 - 60 Days)</span>
          <strong
            style={{
              color: '#b8751f',
            }}
          >
            {money.format(aging.days30 ?? aging.overdue1to30 ?? 0)}
          </strong>
          <small>Follow-up required</small>
        </div>
        <div className="p2-card">
          <span>Overdue (60+ Days)</span>
          <strong
            style={{
              color: '#b2352c',
            }}
          >
            {money.format(
              (aging.days60 ?? aging.overdue31to60 ?? 0) +
                (aging.days90Plus ?? aging.overdue60plus ?? 0)
            )}
          </strong>
          <small>High collection priority</small>
        </div>
      </div>

      <div
        className="p2-panel"
        style={{
          marginTop: '16px',
        }}
      >
        <div className="p2-toolbar">
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
            }}
          >
            Customer Outstanding Balances
          </strong>
        </div>
        <div className="p2-table-wrap">
          <table className="p2-table">
            <thead>
              <tr>
                <th>Customer</th>
                {isAdmin && <th>Factory</th>}
                <th>Contact</th>
                <th className="p2-right">Open Invoices</th>
                <th className="p2-right">Outstanding (BDT)</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <small className="p2-subtext">{c.code}</small>
                  </td>
                  {isAdmin && (
                    <td>
                      {typeof c.factory === 'object' && c.factory !== null
                        ? c.factory.name
                        : String(c.factory ?? '')}
                    </td>
                  )}
                  <td>{c.phone}</td>
                  <td className="p2-right">{c.overdueInvoices ?? c.invoiceCount ?? 0}</td>
                  <td className="p2-right amount-cell">
                    <strong
                      style={{
                        color: '#b2352c',
                      }}
                    >
                      {money.format(c.outstandingBalance ?? c.totalBalance ?? 0)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
function ProductionReportView({ factoryId }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['report-production', factoryId],
    queryFn: () =>
      getProductionReport({
        factoryId: factoryId || undefined,
      }),
  });
  if (isLoading) return <LoadingState label="Computing production output metrics…" />;
  if (error || !data)
    return (
      <ErrorState message={error?.message ?? 'Report unavailable'} retry={() => void refetch()} />
    );
  const totalRawConsumed = data.totalRawConsumed ?? {};
  const totalFinishedProduced = data.totalFinishedProduced ?? {};
  const byProduct = data.byProduct ?? [];
  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Batches Scheduled</span>
          <strong>{data.totalBatches ?? 0}</strong>
          <small>{data.completedBatches ?? 0} batches completed & yielded</small>
        </div>
        <div className="p2-card">
          <span>Raw Jute Consumed</span>
          <strong
            style={{
              color: '#886214',
            }}
          >
            {Object.entries(totalRawConsumed)
              .map(([unit, qty]) => `${qty} ${unit}`)
              .join(', ') || '0 units'}
          </strong>
          <small>Total raw materials processed</small>
        </div>
        <div className="p2-card">
          <span>Finished Goods Produced</span>
          <strong
            style={{
              color: '#1f6e42',
            }}
          >
            {Object.entries(totalFinishedProduced)
              .map(([unit, qty]) => `${qty} ${unit}`)
              .join(', ') || '0 units'}
          </strong>
          <small>Output deposited into stock</small>
        </div>
      </div>

      <div
        className="p2-panel"
        style={{
          marginTop: '16px',
        }}
      >
        <div className="p2-toolbar">
          <strong
            style={{
              fontSize: '14px',
              color: '#27382f',
            }}
          >
            Production Output by Product
          </strong>
        </div>
        <div className="p2-table-wrap">
          <table className="p2-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Unit</th>
                <th className="p2-right">Completed Batches</th>
                <th className="p2-right">Total Quantity Yielded</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <strong>{p.productName}</strong>
                  </td>
                  <td>{p.unit}</td>
                  <td className="p2-right">{p.batchCount}</td>
                  <td className="p2-right amount-cell">
                    <strong>
                      {p.totalProduced} {p.unit}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
