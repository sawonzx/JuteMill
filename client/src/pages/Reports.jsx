import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Factory,
  FileSpreadsheet,
  Receipt,
  ShoppingCart,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  Users,
  ChevronDown,
  Table,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getExportUrl,
  getFactories,
  getOrdersReport,
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

const compactMoney = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  notation: 'compact',
  maximumFractionDigits: 1,
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
          <div style={{ display: 'flex', gap: '8px' }}>
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
        <div className="p2-toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="p2-tab-nav" style={{ border: 0, padding: 0 }}>
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

        <div style={{ padding: '20px' }}>
          {activeTab === 'sales' && <SalesReportView factoryId={factoryId} />}
          {activeTab === 'orders' && <OrdersReportView factoryId={factoryId} />}
          {activeTab === 'receivables' && <ReceivablesReportView factoryId={factoryId} />}
        </div>
      </div>
    </div>
  );
}

function SalesReportView({ factoryId }) {
  const { isAdmin } = useCurrentRole();
  const [showMonthlyTable, setShowMonthlyTable] = useState(false);
  const [showCustomersTable, setShowCustomersTable] = useState(false);
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

  const totalInvoiced = summary.totalInvoiced || 1;
  const collectionPct = Math.min(100, Math.round(((summary.totalRevenue || 0) / totalInvoiced) * 1000) / 10);
  const outstandingPct = Math.min(100, Math.round(((summary.totalOutstanding || 0) / totalInvoiced) * 1000) / 10);

  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Collected Revenue</span>
          <strong style={{ color: '#1e683f' }}>{money.format(summary.totalRevenue)}</strong>
          <small>Verified payments received</small>
        </div>
        <div className="p2-card">
          <span>Gross Invoiced Value</span>
          <strong style={{ color: '#1c2e23' }}>{money.format(summary.totalInvoiced)}</strong>
          <small>{summary.invoiceCount} invoices issued</small>
        </div>
        <div className="p2-card">
          <span>Outstanding Receivables</span>
          <strong style={{ color: '#b2352c' }}>{money.format(summary.totalOutstanding)}</strong>
          <small>{summary.paidInvoiceCount} fully settled</small>
        </div>
      </div>

      {/* Collection Realization Visual Progress Bar */}
      <div className="report-realization-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong style={{ fontSize: '13.5px', color: '#1f3227', display: 'block' }}>
              Collection Realization Rate: {collectionPct}%
            </strong>
            <small style={{ fontSize: '12px', color: '#6d7d73' }}>
              {summary.paidInvoiceCount} of {summary.invoiceCount} issued invoices fully reconciled
            </small>
          </div>
          <div className="report-legend-row">
            <span className="report-legend-item">
              <i className="report-legend-dot" style={{ background: '#247351' }} />
              Collected ({collectionPct}%)
            </span>
            <span className="report-legend-item">
              <i className="report-legend-dot" style={{ background: '#d4a46b' }} />
              Outstanding ({outstandingPct}%)
            </span>
          </div>
        </div>
        <div className="report-progress-bar-wrap">
          <div
            className="report-progress-segment"
            style={{ width: `${collectionPct}%`, background: '#247351' }}
            title={`Collected: ${collectionPct}%`}
          />
          <div
            className="report-progress-segment"
            style={{ width: `${outstandingPct}%`, background: '#d4a46b' }}
            title={`Outstanding: ${outstandingPct}%`}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          marginTop: '16px',
        }}
      >
        {/* Monthly Collections Trend Bar Chart */}
        <div className="p2-panel report-chart-card">
          <div className="report-chart-header">
            <div>
              <h3 className="report-chart-title">Monthly Collections Trend (BDT)</h3>
              <p className="report-chart-subtitle">Inflow trajectory over the past 6 rolling months</p>
            </div>
          </div>

          <div style={{ width: '100%', height: '240px', marginTop: '6px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={monthly}
                margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#edf0ed" strokeDasharray="3 4" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#627067' }}
                  dy={4}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#88948d' }}
                  tickFormatter={(v) => compactMoney.format(v)}
                />
                <Tooltip
                  formatter={(val, name) => [
                    money.format(val),
                    name === 'factoryA'
                      ? 'Dhaka Mill (F-A)'
                      : name === 'factoryB'
                        ? 'Khulna Mill (F-B)'
                        : 'Collected Revenue',
                  ]}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #e2eae4',
                    boxShadow: '0 6px 20px #12271912',
                    fontSize: 12.5,
                  }}
                />
                {isAdmin ? (
                  <>
                    <Bar dataKey="factoryA" name="Dhaka Mill (F-A)" fill="#247351" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="factoryB" name="Khulna Mill (F-B)" fill="#c79a65" radius={[4, 4, 0, 0]} />
                  </>
                ) : (
                  <Bar dataKey="total" name="Collected Revenue" fill="#247351" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="report-card-toggle-bar">
            <button
              type="button"
              className="report-toggle-table-btn"
              onClick={() => setShowMonthlyTable(!showMonthlyTable)}
            >
              <Table size={13} />
              <span>{showMonthlyTable ? 'Hide monthly table' : 'View monthly table'}</span>
              <ChevronDown
                size={13}
                style={{
                  transform: showMonthlyTable ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>

          {showMonthlyTable && (
            <div className="report-table-collapse">
              <table className="p2-table" style={{ fontSize: '13px' }}>
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
                      <td><strong>{row.month}</strong></td>
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
          )}
        </div>

        {/* Top Customer Contributors Horizontal Bar Chart */}
        <div className="p2-panel report-chart-card">
          <div className="report-chart-header">
            <div>
              <h3 className="report-chart-title">Top Customer Contributors</h3>
              <p className="report-chart-subtitle">Highest billing accounts by cumulative invoice value</p>
            </div>
          </div>

          {topCustomers.length > 0 ? (
            <div style={{ width: '100%', height: '240px', marginTop: '6px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={topCustomers.slice(0, 5)}
                  margin={{ top: 8, right: 20, left: 10, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#edf0ed" strokeDasharray="3 4" />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#88948d' }}
                    tickFormatter={(v) => compactMoney.format(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11.5, fill: '#34453b', fontWeight: 600 }}
                  />
                  <Tooltip
                    formatter={(val) => [money.format(val), 'Cumulative Sales']}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                  <Bar dataKey="totalSales" fill="#247351" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ padding: '30px', textAlign: 'center', color: '#88948d' }}>No customer data available</div>
          )}

          <div className="report-card-toggle-bar">
            <button
              type="button"
              className="report-toggle-table-btn"
              onClick={() => setShowCustomersTable(!showCustomersTable)}
            >
              <Table size={13} />
              <span>{showCustomersTable ? 'Hide customer table' : 'View customer table'}</span>
              <ChevronDown
                size={13}
                style={{
                  transform: showCustomersTable ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>

          {showCustomersTable && (
            <div className="report-table-collapse">
              <table className="p2-table" style={{ fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                    <th>Customer</th>
                    {isAdmin && <th>Factory</th>}
                    <th className="p2-right">Invoices</th>
                    <th className="p2-right">Total (BDT)</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.slice(0, 7).map((cust, idx) => (
                    <tr key={cust.id}>
                      <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td><strong>{cust.name}</strong></td>
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
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  CONFIRMED: '#247351',
  IN_PRODUCTION: '#629e80',
  PROCESSING: '#629e80',
  FULFILLED: '#1b543f',
  DRAFT: '#94a3b8',
  CANCELLED: '#d97706',
};

function OrdersReportView({ factoryId }) {
  const { isAdmin } = useCurrentRole();
  const [showStatusTable, setShowStatusTable] = useState(false);
  const [showFactoryTable, setShowFactoryTable] = useState(false);
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
  const totalOrders = data.totalOrders ?? 0;
  const totalValue = data.totalValue ?? 0;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalValue / totalOrders) : 0;

  const inFlightCount = byStatus
    .filter((s) => ['CONFIRMED', 'IN_PRODUCTION', 'PROCESSING'].includes(s.status))
    .reduce((acc, s) => acc + s.count, 0);

  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Orders</span>
          <strong>{totalOrders}</strong>
          <small>Across active records</small>
        </div>
        <div className="p2-card">
          <span>Gross Order Value</span>
          <strong style={{ color: '#1a3325' }}>{money.format(totalValue)}</strong>
          <small>Combined sales book value</small>
        </div>
        <div className="p2-card">
          <span>Average Order Value</span>
          <strong style={{ color: '#247351' }}>{money.format(avgOrderValue)}</strong>
          <small>Per customer commitment</small>
        </div>
        <div className="p2-card">
          <span>Active In-Flight Orders</span>
          <strong style={{ color: '#1f6e42' }}>{inFlightCount}</strong>
          <small>Confirmed & in production</small>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          marginTop: '16px',
        }}
      >
        {/* Status Distribution Donut Chart */}
        <div className="p2-panel report-chart-card">
          <div className="report-chart-header">
            <div>
              <h3 className="report-chart-title">Status Distribution</h3>
              <p className="report-chart-subtitle">Order volume breakdown by fulfillment stage</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px', flexWrap: 'wrap', padding: '10px 0' }}>
            <div className="report-donut-wrapper" style={{ width: '180px', height: '180px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byStatus}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                  >
                    {byStatus.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={STATUS_COLORS[entry.status] || '#738379'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name) => [`${val} orders`, name.replace('_', ' ')]}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="report-donut-center">
                <div className="report-donut-center-val">{totalOrders}</div>
                <div className="report-donut-center-lbl">Orders</div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {byStatus.map((s) => {
                const color = STATUS_COLORS[s.status] || '#738379';
                const pct = totalOrders > 0 ? Math.round((s.count / totalOrders) * 100) : 0;
                return (
                  <div
                    key={s.status}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '13px',
                      padding: '4px 0',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                      <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                      <span style={{ fontWeight: 550, color: '#33443a' }}>{s.status.replace('_', ' ')}</span>
                    </span>
                    <span style={{ color: '#68776f', fontSize: '12.5px' }}>
                      <b>{s.count}</b> ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="report-card-toggle-bar">
            <button
              type="button"
              className="report-toggle-table-btn"
              onClick={() => setShowStatusTable(!showStatusTable)}
            >
              <Table size={13} />
              <span>{showStatusTable ? 'Hide status table' : 'View status table'}</span>
              <ChevronDown
                size={13}
                style={{
                  transform: showStatusTable ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s ease',
                }}
              />
            </button>
          </div>

          {showStatusTable && (
            <div className="report-table-collapse">
              <table className="p2-table" style={{ fontSize: '13px' }}>
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
          )}
        </div>

        {/* Distribution by Factory (Admin) or Order Value Distribution */}
        {isAdmin && byFactory.length > 0 ? (
          <div className="p2-panel report-chart-card">
            <div className="report-chart-header">
              <div>
                <h3 className="report-chart-title">Distribution by Factory</h3>
                <p className="report-chart-subtitle">Order volume & financial book comparison</p>
              </div>
            </div>

            <div style={{ width: '100%', height: '200px', marginTop: '6px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byFactory}
                  margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="#edf0ed" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="factoryCode"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: '#627067' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#88948d' }}
                    tickFormatter={(v) => compactMoney.format(v)}
                  />
                  <Tooltip
                    formatter={(val) => [money.format(val), 'Total Order Value']}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                  <Bar dataKey="totalValue" fill="#247351" radius={[4, 4, 0, 0]} barSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="report-card-toggle-bar">
              <button
                type="button"
                className="report-toggle-table-btn"
                onClick={() => setShowFactoryTable(!showFactoryTable)}
              >
                <Table size={13} />
                <span>{showFactoryTable ? 'Hide factory table' : 'View factory table'}</span>
                <ChevronDown
                  size={13}
                  style={{
                    transform: showFactoryTable ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                />
              </button>
            </div>

            {showFactoryTable && (
              <div className="report-table-collapse">
                <table className="p2-table" style={{ fontSize: '13px' }}>
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
        ) : (
          <div className="p2-panel report-chart-card">
            <div className="report-chart-header">
              <div>
                <h3 className="report-chart-title">Value Allocation by Stage</h3>
                <p className="report-chart-subtitle">Financial commitments committed per status</p>
              </div>
            </div>

            <div style={{ width: '100%', height: '220px', marginTop: '6px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byStatus}
                  margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="#edf0ed" strokeDasharray="3 4" />
                  <XAxis
                    dataKey="status"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#627067' }}
                    tickFormatter={(v) => v.replace('_', ' ')}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#88948d' }}
                    tickFormatter={(v) => compactMoney.format(v)}
                  />
                  <Tooltip
                    formatter={(val) => [money.format(val), 'Order Value']}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                  <Bar dataKey="value" fill="#247351" radius={[4, 4, 0, 0]} barSize={28}>
                    {byStatus.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#247351'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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

  const currentVal = aging.current ?? 0;
  const days30Val = aging.days30 ?? aging.overdue1to30 ?? 0;
  const overdueVal = (aging.days60 ?? aging.overdue31to60 ?? 0) + (aging.days90Plus ?? aging.overdue60plus ?? 0);

  const totalAging = currentVal + days30Val + overdueVal || 1;
  const currentPct = Math.round((currentVal / totalAging) * 100);
  const days30Pct = Math.round((days30Val / totalAging) * 100);
  const overduePct = Math.round((overdueVal / totalAging) * 100);

  const agingSlices = [
    { name: 'Current (0-30d)', value: currentVal, color: '#247351' },
    { name: 'Past Due (31-60d)', value: days30Val, color: '#d97706' },
    { name: 'Overdue (60+d)', value: overdueVal, color: '#dc2626' },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Total Outstanding Receivables</span>
          <strong style={{ color: '#b2352c' }}>{money.format(totalOutstanding)}</strong>
          <small>{customerCount} customers with unpaid balances</small>
        </div>
        <div className="p2-card">
          <span>Current (0 - 30 Days)</span>
          <strong style={{ color: '#1e683f' }}>{money.format(currentVal)}</strong>
          <small>Healthy aging profile ({currentPct}%)</small>
        </div>
        <div className="p2-card">
          <span>Past Due (31 - 60 Days)</span>
          <strong style={{ color: '#b8751f' }}>{money.format(days30Val)}</strong>
          <small>Follow-up required ({days30Pct}%)</small>
        </div>
        <div className="p2-card">
          <span>Overdue (60+ Days)</span>
          <strong style={{ color: '#b2352c' }}>{money.format(overdueVal)}</strong>
          <small>High collection priority ({overduePct}%)</small>
        </div>
      </div>

      {/* Aging Schedule Risk Waterfall Segment Bar */}
      <div className="report-realization-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong style={{ fontSize: '13.5px', color: '#1f3227', display: 'block' }}>
              Receivables Aging Portfolio Health
            </strong>
            <small style={{ fontSize: '12px', color: '#6d7d73' }}>
              {currentPct}% within credit term, {overduePct}% critical overdue
            </small>
          </div>
          <div className="report-legend-row">
            <span className="report-legend-item">
              <i className="report-legend-dot" style={{ background: '#247351' }} />
              Current ({currentPct}%)
            </span>
            <span className="report-legend-item">
              <i className="report-legend-dot" style={{ background: '#d97706' }} />
              31-60 Days ({days30Pct}%)
            </span>
            <span className="report-legend-item">
              <i className="report-legend-dot" style={{ background: '#dc2626' }} />
              60+ Days ({overduePct}%)
            </span>
          </div>
        </div>
        <div className="report-progress-bar-wrap">
          <div
            className="report-progress-segment"
            style={{ width: `${currentPct}%`, background: '#247351' }}
            title={`Current: ${currentPct}%`}
          />
          <div
            className="report-progress-segment"
            style={{ width: `${days30Pct}%`, background: '#d97706' }}
            title={`Past Due 31-60d: ${days30Pct}%`}
          />
          <div
            className="report-progress-segment"
            style={{ width: `${overduePct}%`, background: '#dc2626' }}
            title={`Overdue 60+d: ${overduePct}%`}
          />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '20px',
          marginTop: '16px',
        }}
      >
        {/* Aging Schedule Donut Chart */}
        <div className="p2-panel report-chart-card">
          <div className="report-chart-header">
            <div>
              <h3 className="report-chart-title">Aging Risk Breakdown</h3>
              <p className="report-chart-subtitle">Proportion of outstanding balance by payment delinquency</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', flexWrap: 'wrap', padding: '10px 0' }}>
            <div className="report-donut-wrapper" style={{ width: '180px', height: '180px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={agingSlices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                  >
                    {agingSlices.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val) => [money.format(val), 'Balance Due']}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="report-donut-center">
                <div className="report-donut-center-val" style={{ fontSize: '18px' }}>
                  {compactMoney.format(totalOutstanding)}
                </div>
                <div className="report-donut-center-lbl">Receivables</div>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: '160px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {agingSlices.map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    padding: '4px 0',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                    <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
                    <span style={{ fontWeight: 550, color: '#33443a' }}>{s.name}</span>
                  </span>
                  <span style={{ color: '#68776f', fontSize: '12.5px', fontWeight: 600 }}>
                    {compactMoney.format(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top 5 Exposure Customers Horizontal Bar Chart */}
        <div className="p2-panel report-chart-card">
          <div className="report-chart-header">
            <div>
              <h3 className="report-chart-title">Top Exposure Balances</h3>
              <p className="report-chart-subtitle">Customers holding highest outstanding exposure</p>
            </div>
          </div>

          {customers.length > 0 ? (
            <div style={{ width: '100%', height: '220px', marginTop: '6px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={customers.slice(0, 5)}
                  margin={{ top: 8, right: 20, left: 10, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="#edf0ed" strokeDasharray="3 4" />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#88948d' }}
                    tickFormatter={(v) => compactMoney.format(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11.5, fill: '#34453b', fontWeight: 600 }}
                  />
                  <Tooltip
                    formatter={(val) => [money.format(val), 'Outstanding Balance']}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2eae4',
                      boxShadow: '0 6px 20px #12271912',
                      fontSize: 12.5,
                    }}
                  />
                  <Bar
                    dataKey="outstandingBalance"
                    fill="#b2352c"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ padding: '30px', textAlign: 'center', color: '#88948d' }}>No outstanding customer accounts</div>
          )}
        </div>
      </div>

      {/* Customer Balances Table */}
      <div className="p2-panel" style={{ marginTop: '16px' }}>
        <div className="p2-toolbar">
          <strong style={{ fontSize: '14px', color: '#27382f' }}>
            Customer Outstanding Balances Ledger
          </strong>
        </div>
        <div className="p2-table-wrap">
          <table className="p2-table">
            <thead>
              <tr>
                <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                <th>Customer</th>
                {isAdmin && <th>Factory</th>}
                <th>Contact</th>
                <th className="p2-right">Open Invoices</th>
                <th className="p2-right">Outstanding (BDT)</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, cIdx) => (
                <tr key={c.id}>
                  <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                    {String(cIdx + 1).padStart(2, '0')}
                  </td>
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
                    <strong style={{ color: '#b2352c' }}>
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
