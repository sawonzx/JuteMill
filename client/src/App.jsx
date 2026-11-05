import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './components/ui/button';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Building2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Factory,
  FileCheck,
  FileText,
  LayoutDashboard,
  Menu,
  Package,
  PanelLeftClose,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getDashboard, getDemoUsers, getFactories } from './api';
import CustomersPage from './pages/Customers';
import ProductsPage from './pages/Products';
import InventoryPage from './pages/Inventory';
import OrdersPage from './pages/Orders';
import InvoicesPage from './pages/Invoices';
import PaymentsPage from './pages/Payments';
import ReportsPage from './pages/Reports';
import AdminPage from './pages/Admin';
import './pages/phase2.css';
import './pages/phase2-extra.css';
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
const navItems = [
  {
    label: 'Overview',
    path: '/',
    icon: LayoutDashboard,
    groups: ['all'],
  },
  {
    label: 'Sales Orders',
    path: '/sales',
    icon: ShoppingCart,
    groups: ['admin', 'manager', 'accountant', 'staff'],
  },
  {
    label: 'Invoices',
    path: '/invoices',
    icon: FileCheck,
    groups: ['admin', 'manager', 'accountant'],
  },
  {
    label: 'Finance & Ledger',
    path: '/finance',
    icon: Wallet,
    groups: ['admin', 'accountant'],
  },
  {
    label: 'Inventory',
    path: '/inventory',
    icon: Boxes,
    groups: ['admin', 'manager', 'accountant', 'staff'],
  },
  {
    label: 'Products',
    path: '/products',
    icon: Package,
    groups: ['admin', 'manager', 'accountant', 'staff'],
  },
  {
    label: 'Customers',
    path: '/customers',
    icon: Users,
    groups: ['admin', 'manager', 'accountant'],
  },
];
const roleName = {
  HEAD_OFFICE_ADMIN: 'Head Office Admin',
  FACTORY_MANAGER: 'Factory Manager',
  ACCOUNTANT: 'Accountant',
  STAFF: 'Staff',
};
const roleKey = (user) =>
  !user
    ? 'staff'
    : user.role === 'HEAD_OFFICE_ADMIN'
      ? 'admin'
      : user.role === 'FACTORY_MANAGER'
        ? 'manager'
        : user.role === 'ACCOUNTANT'
          ? 'accountant'
          : 'staff';
export default function App() {
  const usersQuery = useQuery({
    queryKey: ['demo-users'],
    queryFn: getDemoUsers,
  });
  const users = usersQuery.data ?? [];
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem('jute-demo-user-id') ?? ''
  );
  const [activeFactoryId, setActiveFactoryId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (users.length && !users.some((u) => u.id === selectedId)) {
      setSelectedId(users.find((u) => u.role === 'HEAD_OFFICE_ADMIN')?.id ?? users[0].id);
    }
  }, [users, selectedId]);
  useEffect(() => {
    if (selectedId) localStorage.setItem('jute-demo-user-id', selectedId);
  }, [selectedId]);
  const user = users.find((item) => item.id === selectedId);
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: user?.role === 'HEAD_OFFICE_ADMIN',
  });
  const factories = factoriesQuery.data ?? [];
  const dashboardQuery = useQuery({
    queryKey: ['dashboard', selectedId, activeFactoryId],
    queryFn: () => getDashboard(selectedId, activeFactoryId || undefined),
    enabled: !!selectedId,
    refetchInterval: 60_000,
  });
  const currentPath = useLocation().pathname;
  const section = useMemo(
    () =>
      currentPath === '/'
        ? 'Overview'
        : (navItems.find(
            (item) => currentPath === item.path || currentPath.startsWith(`${item.path}/`)
          )?.label ??
          {
            '/settings': 'Administration',
            '/admin': 'Administration',
            '/reports': 'Reports',
          }[currentPath] ??
          'Module'),
    [currentPath]
  );
  const chooseUser = (id) => {
    setSelectedId(id);
    setActiveFactoryId('');
    setMenuOpen(false);
    localStorage.setItem('jute-demo-user-id', id);
    window.dispatchEvent(new Event('demo-user-changed'));
    queryClient.removeQueries({
      predicate: (q) => q.queryKey[0] !== 'demo-users',
    });
  };
  const sidebar = <Sidebar user={user} onNavigate={() => setMobileOpen(false)} />;
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          aria-label="Close menu"
          className="mobile-scrim"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <span>JM</span>
          </div>
          <div>
            <strong
              style={{
                fontSize: '17px',
                letterSpacing: '-0.01em',
              }}
            >
              JuteMill
            </strong>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>
        {sidebar}
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>
            <div className="breadcrumbs">
              <strong>{section}</strong>
            </div>
          </div>

          <div className="top-actions">
            {}
            {user?.role === 'HEAD_OFFICE_ADMIN' && currentPath === '/' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Building2
                  size={15}
                  style={{
                    color: '#277047',
                  }}
                />
                <select
                  className="p2-select"
                  style={{
                    height: '32px',
                    fontSize: '12.5px',
                    padding: '0 8px',
                    fontWeight: 600,
                    color: '#1d3425',
                  }}
                  value={activeFactoryId}
                  onChange={(e) => setActiveFactoryId(e.target.value)}
                  title="Filter dashboard perspective by factory"
                >
                  <option value="">Consolidated (Both Mills)</option>
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="user-switch-wrap">
              <button
                className="user-switch"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
              >
                <span className="avatar">{initials(user?.name)}</span>
                <span className="user-label">
                  <b>{user?.name ?? 'Choose demo user'}</b>
                  <small>{user ? roleName[user.role] : 'Loading identities'}</small>
                </span>
                <ChevronDown size={15} className="chevron" />
              </button>
              {menuOpen && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="Close user menu"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="user-menu">
                    <div className="menu-heading">SWITCH ACCOUNTS</div>
                    {users.map((item) => (
                      <button
                        key={item.id}
                        className={`user-option ${item.id === selectedId ? 'selected' : ''}`}
                        onClick={() => chooseUser(item.id)}
                      >
                        <span className="avatar small-avatar">{initials(item.name)}</span>
                        <span>
                          <b>{item.name}</b>
                          <small>{item.factory?.name ?? 'All factories · Head Office'}</small>
                        </span>
                        {item.id === selectedId && <span className="selected-dot" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard query={dashboardQuery} />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/new" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomersPage />} />
            <Route path="/customers/:id/edit" element={<CustomersPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/new" element={<ProductsPage />} />
            <Route path="/products/:id" element={<ProductsPage />} />
            <Route path="/products/:id/edit" element={<ProductsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/stock-in" element={<InventoryPage />} />
            <Route path="/inventory/stock-out" element={<InventoryPage />} />
            <Route path="/inventory/adjustment" element={<InventoryPage />} />
            <Route path="/inventory/movements" element={<InventoryPage />} />
            <Route path="/inventory/low-stock" element={<InventoryPage />} />
            <Route path="/sales" element={<OrdersPage />} />
            <Route path="/sales/new" element={<OrdersPage />} />
            <Route path="/sales/:id" element={<OrdersPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/invoices/:id" element={<InvoicesPage />} />
            <Route path="/finance" element={<PaymentsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            {}
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/settings" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
function Sidebar({ user, onNavigate }) {
  const key = roleKey(user);
  return (
    <nav className="sidebar-nav">
      <div className="nav-caption">WORKSPACE</div>
      {navItems
        .filter((item) => item.groups.includes('all') || item.groups.includes(key))
        .map(({ label, path, icon: Icon }) => (
          <NavLink
            end={path === '/'}
            onClick={onNavigate}
            key={path}
            to={path}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}

      <div className="nav-caption nav-caption-gap">ANALYTICS & GOVERNANCE</div>
      <NavLink
        onClick={onNavigate}
        to="/reports"
        className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
      >
        <ClipboardList size={17} strokeWidth={1.8} />
        <span>Reports</span>
      </NavLink>

      {key === 'admin' && (
        <NavLink
          onClick={onNavigate}
          to="/admin"
          className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
        >
          <Settings size={17} strokeWidth={1.8} />
          <span>Administration</span>
        </NavLink>
      )}

      <div className="scope-card">
        <div className="scope-top">
          <Building2 size={15} />
          <span>ACTIVE SCOPE</span>
        </div>
        <b>
          {user?.role === 'HEAD_OFFICE_ADMIN'
            ? 'Head Office (Dhaka)'
            : (user?.factory?.name ?? 'Loading scope')}
        </b>
        <small>
          {user?.role === 'HEAD_OFFICE_ADMIN'
            ? 'All factories · Consolidated'
            : (user?.factory?.location ?? 'Mill operations')}
        </small>
      </div>
    </nav>
  );
}
function Dashboard({ query }) {
  const data = query.data;
  if (query.isLoading)
    return (
      <div className="loading-panel">
        <div className="spinner" />
        <span>Loading live demo dashboard…</span>
      </div>
    );
  if (query.error || !data)
    return (
      <div className="error-panel">
        <AlertTriangle size={19} />
        <div>
          <b>Dashboard unavailable</b>
          <span>{query.error?.message ?? 'Could not load dashboard data.'}</span>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  const headOffice = data.perspective === 'head-office';
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const permissions = data.permissions ?? {
    finance: true,
    sales: true,
    operations: true,
  };
  const trend = (data.cashTrend ?? data.monthlyTrend ?? []).map((point) => ({
    label: point.month,
    a: point.factoryA,
    b: point.factoryB,
  }));
  const primarySeries = data.user.factory?.code === 'F-B' ? 'b' : 'a';
  const revenue = data.metrics.revenue ?? data.metrics.totalCollected ?? 0;
  const receivables = data.metrics.receivables ?? data.metrics.totalReceivables ?? 0;
  const orderCount = data.metrics.orderCount ?? data.metrics.activeOrders ?? 0;
  const activeFactories = data.metrics.activeFactories ?? data.factories?.length ?? 2;
  const productionBatches =
    data.metrics.productionBatches ?? data.metrics.activeProductionBatches ?? 0;
  const ordersByStatus = data.ordersByStatus ?? [];
  const factoryPerformance = data.factoryPerformance ?? [];
  const recentOrders = data.recentOrders ?? [];
  const lowStock = data.lowStock ?? [];
  const statCards = [
    {
      label: 'Cash received',
      value: compactMoney.format(revenue),
      icon: Wallet,
      delta: '+8.2%',
      positive: true,
      foot: 'Collections received to date',
    },
    {
      label: 'Open receivables',
      value: compactMoney.format(receivables),
      icon: FileText,
      delta: 'Active invoices',
      positive: false,
      foot: 'Outstanding customer balances',
    },
    {
      label: 'Sales orders',
      value: String(orderCount).padStart(2, '0'),
      icon: ShoppingCart,
      delta: `${ordersByStatus.filter((s) => s.status === 'IN_PRODUCTION' || s.status === 'CONFIRMED').reduce((sum, s) => sum + s.count, 0)} active`,
      positive: true,
      foot: 'Total customer commitments',
    },
    ...(headOffice
      ? [
          {
            label: 'Active factories',
            value: String(activeFactories).padStart(2, '0'),
            icon: Building2,
            delta: 'All operational',
            positive: true,
            foot: 'Dhaka & Khulna mills',
          },
        ]
      : []),
  ]
    .filter(
      (card) => permissions.finance || !['Cash received', 'Open receivables'].includes(card.label)
    )
    .filter((card) => permissions.sales || card.label !== 'Sales orders')
    .filter((card) => permissions.operations || card.label !== 'Production batches');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {headOffice ? 'Good day, Executive Admin' : `Good day, ${data.user.name.split(' ')[0]}`}
          </h1>
          <p>
            {headOffice
              ? 'Consolidated operational overview across Dhaka Jute Mill and Khulna Jute Mill.'
              : `Current operational performance at ${data.user.factory?.name}.`}
          </p>
        </div>
        <div className="heading-meta">
          <span className="heading-date">{today}</span>
        </div>
      </div>

      <div className="metric-grid">
        {statCards.map(({ label, value, icon: Icon, delta, positive, foot }) => (
          <article key={label} className="metric-card">
            <div className="metric-top">
              <span>{label}</span>
              <span className="metric-icon">
                <Icon size={17} />
              </span>
            </div>
            <div className="metric-value">{value}</div>
            <div className="metric-foot">
              <span className={positive ? 'delta-up' : 'delta-neutral'}>
                {positive ? <ArrowUpRight size={13} /> : <Activity size={13} />}
                {delta}
              </span>
              <span>{foot}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <section
          className="panel chart-panel"
          style={
            !permissions.finance
              ? {
                  display: 'none',
                }
              : undefined
          }
        >
          <div className="panel-header">
            <div>
              <h2>Financial overview</h2>
              <p>
                {headOffice
                  ? 'Consolidated performance across both factories'
                  : `Performance · ${data.user.factory?.name}`}
              </p>
            </div>
            <span className="period-select">Last 7 months</span>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-green" />
              {headOffice ? 'Dhaka Mill (F-A)' : 'Cash received'}
            </span>
            {headOffice && (
              <span>
                <i className="legend-sand" />
                Khulna Mill (F-B)
              </span>
            )}
            <span className="chart-unit">BDT · millions</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trend}
                margin={{
                  top: 8,
                  right: 4,
                  left: -16,
                  bottom: 0,
                }}
              >
                <defs>
                  <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2e8061" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#2e8061" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="factoryGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a46b" stopOpacity={0.14} />
                    <stop offset="95%" stopColor="#d4a46b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0ed" strokeDasharray="3 5" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: '#89928d',
                    fontSize: 12,
                  }}
                  dy={9}
                />
                <YAxis
                  tickFormatter={(v) => `${v}`}
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: '#89928d',
                    fontSize: 12,
                  }}
                />
                <Tooltip
                  formatter={(value) => [`৳${Number(value).toFixed(2)}m`, 'Cash received']}
                  contentStyle={{
                    borderRadius: 9,
                    border: '1px solid #e9eeea',
                    boxShadow: '0 8px 24px #12271912',
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={headOffice ? 'a' : primarySeries}
                  stroke="#247351"
                  strokeWidth={2.2}
                  fill="url(#cashGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="b"
                  stroke="#c79a65"
                  strokeWidth={2}
                  fill="url(#factoryGradient)"
                  style={
                    headOffice
                      ? undefined
                      : {
                          display: 'none',
                        }
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-summary">
            <span>
              <i className="summary-dot" />
              Total Collections Received
            </span>
            <b>{money.format(revenue)}</b>
            <span className="summary-change">
              <Activity size={13} /> Reconciled Ledger
            </span>
          </div>
        </section>

        <section
          className="panel factory-panel"
          style={
            !permissions.sales
              ? {
                  display: 'none',
                }
              : undefined
          }
        >
          <div className="panel-header">
            <div>
              <h2>{headOffice ? 'Factory performance' : 'Order pipeline'}</h2>
              <p>
                {headOffice ? 'Current order book by location' : 'Sales order status breakdown'}
              </p>
            </div>
          </div>
          {headOffice ? (
            <div className="factory-list">
              {factoryPerformance.map((factory, i) => (
                <div key={factory.factoryId} className="factory-item">
                  <div className={`factory-symbol factory-symbol-${i}`}>
                    <Factory size={17} />
                  </div>
                  <div className="factory-details">
                    <b>{factory.name}</b>
                    <small>{factory.orderCount} open orders</small>
                  </div>
                  <div className="factory-total">
                    <b>{compactMoney.format(factory.orderValue)}</b>
                    <small>order value</small>
                  </div>
                  <div className="factory-bar">
                    <i
                      style={{
                        width: `${Math.max(18, (factory.orderValue / Math.max(1, ...factoryPerformance.map((f) => f.orderValue))) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pipeline-list">
              {ordersByStatus.length ? (
                ordersByStatus.map((row) => (
                  <div className="pipeline-row" key={row.status}>
                    <span className={`status-dot status-${row.status.toLowerCase()}`} />
                    <span>{pretty(row.status)}</span>
                    <b>{row.count}</b>
                    <small>{compactMoney.format(row.value)}</small>
                  </div>
                ))
              ) : (
                <Empty label="No orders in the pipeline yet." />
              )}
            </div>
          )}
          <Link className="text-link" to={headOffice ? '/reports' : '/sales'}>
            {headOffice ? 'View full factory report' : 'View sales orders'} <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      <div className="lower-grid">
        <section
          className="panel table-panel"
          style={
            !permissions.sales
              ? {
                  display: 'none',
                }
              : undefined
          }
        >
          <div className="panel-header">
            <div>
              <h2>Recent sales orders</h2>
              <p>A snapshot of your latest customer commitments</p>
            </div>
            <Link className="panel-link" to="/sales">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>CUSTOMER</th>
                  {headOffice && <th>FACTORY</th>}
                  <th>STATUS</th>
                  <th>DUE DATE</th>
                  <th className="align-right">VALUE</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.orderNumber}>
                    <td>
                      <b className="order-number">{order.orderNumber}</b>
                    </td>
                    <td>{order.customer}</td>
                    {headOffice && (
                      <td>
                        <span
                          className={`factory-tag ${order.factoryCode === 'F-A' ? 'tag-a' : 'tag-b'}`}
                        >
                          {order.factoryCode}
                        </span>{' '}
                        {typeof order.factory === 'object' && order.factory !== null
                          ? order.factory.name
                          : String(order.factory ?? '')}
                      </td>
                    )}
                    <td>
                      <Status status={order.status} />
                    </td>
                    <td>
                      {new Date(order.dueDate).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </td>
                    <td className="align-right amount-cell">{money.format(order.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentOrders.length === 0 && <Empty label="No sales orders have been recorded yet." />}
        </section>

        <section
          className="panel stock-panel"
          style={
            !permissions.operations
              ? {
                  display: 'none',
                }
              : undefined
          }
        >
          <div className="panel-header">
            <div>
              <h2>Stock watch</h2>
              <p>Items approaching reorder levels</p>
            </div>
            <span className="alert-count">{lowStock.length}</span>
          </div>
          <div className="stock-list">
            {lowStock.length ? (
              lowStock.slice(0, 4).map((item) => {
                const facName =
                  typeof item.factory === 'object' && item.factory !== null
                    ? item.factory.name
                    : String(item.factory ?? '');
                const prodName =
                  typeof item.product === 'object' && item.product !== null
                    ? item.product.name
                    : String(item.product ?? '');
                const unitName =
                  typeof item.unit === 'object' && item.unit !== null
                    ? item.unit.name
                    : String(item.unit ?? '');
                return (
                  <div key={`${facName}-${prodName}`} className="stock-item">
                    <div className="stock-icon">
                      <Package size={16} />
                    </div>
                    <div className="stock-details">
                      <b>{prodName}</b>
                      <small>
                        {headOffice ? facName : `Reorder point · ${item.reorderLevel} ${unitName}`}
                      </small>
                    </div>
                    <div className="stock-quantity">
                      <b>{item.quantity}</b>
                      <small>{unitName} left</small>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty label="All tracked items are above their reorder levels." />
            )}
          </div>
          <Link className="text-link" to="/inventory">
            Open inventory <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </>
  );
}
function Status({ status }) {
  return (
    <span className={`status-chip chip-${status.toLowerCase()}`}>
      <i />
      {pretty(status)}
    </span>
  );
}
function Empty({ label }) {
  return (
    <div className="empty-state">
      <Package size={18} />
      <span>{label}</span>
    </div>
  );
}
function pretty(value) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
function initials(name) {
  return (
    name
      ?.split(' ')
      .filter((s) => !['A', 'B'].includes(s))
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase() ?? 'JM'
  );
}
