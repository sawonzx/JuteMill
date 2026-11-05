import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck,
  FileText,
  Package,
  Plus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  cancelOrder,
  confirmOrder,
  createOrder,
  fulfillOrder,
  getCustomers,
  getFactories,
  getOrder,
  getOrders,
  getProducts,
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
export default function OrdersPage() {
  const { id } = useParams();
  const location = window.location.pathname;
  if (location.endsWith('/new')) return <NewOrderForm />;
  if (id) return <OrderDetailView id={id} />;
  return <OrderListView />;
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
function OrderListView() {
  const { isAdmin, isManager } = useCurrentRole();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const ordersQuery = useQuery({
    queryKey: [
      'orders',
      {
        q,
        status,
        factoryId,
        page,
      },
    ],
    queryFn: () =>
      getOrders({
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
        title="Sales Orders"
        description="Customer purchase commitments, fulfillment workflows, and order-to-cash lifecycle."
        action={
          isManager ? (
            <Link className="p2-button primary" to="/sales/new">
              <Plus size={15} /> Create sales order
            </Link>
          ) : undefined
        }
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
              placeholder="Search order number or customer…"
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
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="IN_PRODUCTION">In Production</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="CANCELLED">Cancelled</option>
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

        {ordersQuery.isLoading ? (
          <LoadingState label="Loading sales orders…" />
        ) : ordersQuery.error ? (
          <ErrorState
            message={ordersQuery.error.message}
            retry={() => void ordersQuery.refetch()}
          />
        ) : ordersQuery.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    {isAdmin && <th>Factory</th>}
                    <th>Status</th>
                    <th>Due Date</th>
                    <th className="p2-right">Items</th>
                    <th className="p2-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ordersQuery.data.items.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link className="p2-record-link" to={`/sales/${order.id}`}>
                          {order.orderNumber}
                          <small>{new Date(order.orderDate).toLocaleDateString('en-GB')}</small>
                        </Link>
                      </td>
                      <td>
                        <strong>{order.customer.name}</strong>
                        <small className="p2-subtext">{order.customer.phone}</small>
                      </td>
                      {isAdmin && (
                        <td>
                          <span className="p2-factory">
                            <Building2 size={13} />
                            {order.factory.code}
                          </span>
                        </td>
                      )}
                      <td>
                        <StatusChip status={order.status} />
                      </td>
                      <td>{new Date(order.dueDate).toLocaleDateString('en-GB')}</td>
                      <td className="p2-right">{order.lineCount ?? 0} lines</td>
                      <td className="p2-right amount-cell">
                        <strong>{money.format(order.total)}</strong>
                      </td>
                      <td className="p2-actions">
                        <Link to={`/sales/${order.id}`} title="View Order Details">
                          <ArrowRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={ordersQuery.data.page}
              totalPages={ordersQuery.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No sales orders found"
            detail={
              q || status
                ? 'No orders match the current filter.'
                : 'Create a sales order to get started.'
            }
          />
        )}
      </section>
    </div>
  );
}
function OrderDetailView({ id }) {
  const { isManager } = useCurrentRole();
  const client = useQueryClient();
  const [errorMsg, setErrorMsg] = useState(null);
  const {
    data: order,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id),
  });
  const confirmMut = useMutation({
    mutationFn: () => confirmOrder(id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['orders'],
      });
      void refetch();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const fulfillMut = useMutation({
    mutationFn: () => fulfillOrder(id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['orders'],
      });
      void client.invalidateQueries({
        queryKey: ['inventory'],
      });
      void refetch();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelOrder(id, 'Cancelled from order screen'),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['orders'],
      });
      void refetch();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  if (isLoading) return <LoadingState label="Loading order details…" />;
  if (error || !order)
    return (
      <ErrorState message={error?.message ?? 'Order not found'} retry={() => void refetch()} />
    );
  return (
    <div className="p2-page">
      <BackLink to="/sales">Back to sales orders</BackLink>
      {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

      <div className="p2-title-row">
        <div>
          <h1>{order.orderNumber}</h1>
          <p>
            Placed on {new Date(order.orderDate).toLocaleDateString('en-GB')} by{' '}
            {order.createdBy.name}
          </p>
        </div>
        <div className="p2-title-action">
          <StatusChip status={order.status} />
          {isManager && order.status === 'DRAFT' && (
            <>
              <Button
                variant="outline"
                className="text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => {
                  if (confirm('Cancel this sales order?')) cancelMut.mutate();
                }}
                disabled={cancelMut.isPending}
              >
                <XCircle size={15} /> Cancel Order
              </Button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                onClick={() => confirmMut.mutate()}
                disabled={confirmMut.isPending}
              >
                <CheckCircle2 size={15} /> Confirm Order
              </Button>
            </>
          )}
          {isManager && (order.status === 'CONFIRMED' || order.status === 'IN_PRODUCTION') && (
            <>
              <Button
                variant="outline"
                className="text-red-700 border-red-300 hover:bg-red-50"
                onClick={() => {
                  if (confirm('Cancel this sales order?')) cancelMut.mutate();
                }}
                disabled={cancelMut.isPending}
              >
                <XCircle size={15} /> Cancel
              </Button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                onClick={() => {
                  if (
                    confirm(
                      'Fulfill order now? Finished goods will be atomically deducted from factory warehouse.'
                    )
                  )
                    fulfillMut.mutate();
                }}
                disabled={fulfillMut.isPending}
              >
                <Package size={15} /> Fulfill Order (Deduct Stock)
              </Button>
            </>
          )}
          {order.status === 'FULFILLED' && !order.invoice && (
            <Link className="p2-button primary" to={`/invoices?createFromOrder=${order.id}`}>
              <FileText size={15} /> Create Invoice
            </Link>
          )}
          {order.invoice && (
            <Link className="p2-button secondary" to={`/invoices/${order.invoice.id}`}>
              <FileCheck size={15} /> View Invoice ({order.invoice.invoiceNumber})
            </Link>
          )}
        </div>
      </div>

      <div className="p2-summary-grid">
        <div className="p2-card">
          <span>Customer</span>
          <strong>{order.customer.name}</strong>
          <small>
            {order.customer.phone} · {order.customer.address}
          </small>
        </div>
        <div className="p2-card">
          <span>Fulfillment Factory</span>
          <strong>{order.factory.name}</strong>
          <small>Factory Code: {order.factory.code}</small>
        </div>
        <div className="p2-card">
          <span>Target Delivery Date</span>
          <strong>{new Date(order.dueDate).toLocaleDateString('en-GB')}</strong>
          <small>Scheduled delivery window</small>
        </div>
        <div className="p2-card">
          <span>Total Order Value</span>
          <strong>{money.format(order.total)}</strong>
          <small>{order.lines.length} ordered line item(s)</small>
        </div>
      </div>

      <section className="p2-panel">
        <div className="p2-toolbar">
          <strong
            style={{
              fontSize: '15px',
              color: '#2c3b32',
            }}
          >
            Line Items Breakdown
          </strong>
        </div>
        <div className="p2-table-wrap">
          <table className="p2-table">
            <thead>
              <tr>
                <th>Product / Description</th>
                <th>SKU</th>
                <th>Unit</th>
                <th className="p2-right">Quantity</th>
                <th className="p2-right">Unit Price (BDT)</th>
                <th className="p2-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <strong>{line.product.name}</strong>
                    {line.notes && <small className="p2-subtext">{line.notes}</small>}
                  </td>
                  <td>{line.product.sku}</td>
                  <td>{line.product.unit}</td>
                  <td className="p2-right font-medium">{line.quantity}</td>
                  <td className="p2-right">{money.format(line.unitPrice)}</td>
                  <td className="p2-right amount-cell">
                    <strong>{money.format(line.subtotal)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: '20px',
            borderTop: '1px solid #edf0ed',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            style={{
              width: '280px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                color: '#68776f',
                fontSize: '13.5px',
              }}
            >
              <span>Subtotal:</span>
              <span>{money.format(order.subtotal)}</span>
            </div>
            {order.taxAmount > 0 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: '#68776f',
                  fontSize: '13.5px',
                }}
              >
                <span>Tax ({order.taxRate}%):</span>
                <span>{money.format(order.taxAmount)}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '2px solid #23583c',
                paddingTop: '8px',
                fontSize: '16px',
                fontWeight: 700,
                color: '#1a2e22',
              }}
            >
              <span>Total:</span>
              <span>{money.format(order.total)}</span>
            </div>
          </div>
        </div>
      </section>

      {order.notes && (
        <section
          className="p2-panel"
          style={{
            padding: '16px 20px',
          }}
        >
          <strong
            style={{
              fontSize: '13px',
              color: '#69776f',
              textTransform: 'uppercase',
            }}
          >
            Special Instructions / Notes:
          </strong>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '14px',
              color: '#2b3b31',
            }}
          >
            {order.notes}
          </p>
        </section>
      )}
    </div>
  );
}
function NewOrderForm() {
  const navigate = useNavigate();
  const { isAdmin, user } = useCurrentRole();
  const [factoryId, setFactoryId] = useState(user?.factory?.id ?? '');
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([
    {
      productId: '',
      quantity: 10,
      unitPrice: 0,
    },
  ]);
  const [formError, setFormError] = useState(null);
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const effectiveFactoryId = isAdmin ? factoryId || factories.data?.[0]?.id : user?.factory?.id;
  const customersQuery = useQuery({
    queryKey: ['customers-list', effectiveFactoryId],
    queryFn: () =>
      getCustomers({
        factoryId: effectiveFactoryId,
        status: 'ACTIVE',
        pageSize: 100,
      }),
    enabled: !!effectiveFactoryId,
  });
  const productsQuery = useQuery({
    queryKey: ['products-list'],
    queryFn: () =>
      getProducts({
        status: 'ACTIVE',
        pageSize: 100,
      }),
  });
  const orderMutation = useMutation({
    mutationFn: (data) => createOrder(data),
    onSuccess: (newOrder) => {
      navigate(`/sales/${newOrder.id}`);
    },
    onError: (err) => {
      setFormError(err.message ?? 'Failed to create sales order');
    },
  });
  const handleProductChange = (index, pId) => {
    const prod = productsQuery.data?.items.find((p) => p.id === pId);
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        productId: pId,
        unitPrice: prod?.standardPrice ?? 0,
      };
      return copy;
    });
  };
  const handleQtyChange = (index, qty) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        quantity: Math.max(1, qty),
      };
      return copy;
    });
  };
  const handlePriceChange = (index, price) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        unitPrice: Math.max(0, price),
      };
      return copy;
    });
  };
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        productId: '',
        quantity: 10,
        unitPrice: 0,
      },
    ]);
  };
  const removeLine = (idx) => {
    if (lines.length > 1) {
      setLines((prev) => prev.filter((_, i) => i !== idx));
    }
  };
  const subtotal = lines.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!customerId) {
      setFormError('Please select a customer.');
      return;
    }
    const validLines = lines.filter((l) => l.productId && l.quantity > 0);
    if (!validLines.length) {
      setFormError('Please add at least one valid product line with quantity > 0.');
      return;
    }
    orderMutation.mutate({
      factoryId: effectiveFactoryId,
      customerId,
      dueDate,
      notes: notes || undefined,
      lines: validLines,
    });
  };
  return (
    <div className="p2-page">
      <BackLink to="/sales">Cancel and return to sales orders</BackLink>
      <PageTitle
        title="Create Sales Order"
        description="Draft a new purchase commitment with customer terms and line items."
      />

      {formError && <Notice kind="error">{formError}</Notice>}

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
          {isAdmin && (
            <FormRow label="Factory" required>
              <select
                className="p2-select"
                value={factoryId}
                onChange={(e) => {
                  setFactoryId(e.target.value);
                  setCustomerId('');
                }}
              >
                {(factories.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </option>
                ))}
              </select>
            </FormRow>
          )}

          <FormRow label="Customer" required>
            <select
              className="p2-select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="">Select customer…</option>
              {(customersQuery.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}) - {c.city}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Delivery Due Date" required>
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
            marginTop: '24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <strong
              style={{
                fontSize: '15px',
                color: '#213328',
              }}
            >
              Ordered Products
            </strong>
            <button type="button" className="p2-button secondary" onClick={addLine}>
              <Plus size={14} /> Add Line Item
            </button>
          </div>

          <table className="p2-line-table">
            <thead>
              <tr>
                <th
                  style={{
                    width: '45%',
                  }}
                >
                  Product
                </th>
                <th
                  style={{
                    width: '15%',
                  }}
                >
                  Quantity
                </th>
                <th
                  style={{
                    width: '20%',
                  }}
                >
                  Unit Price (BDT)
                </th>
                <th
                  style={{
                    width: '15%',
                    textAlign: 'right',
                  }}
                >
                  Subtotal
                </th>
                <th
                  style={{
                    width: '5%',
                  }}
                />
              </tr>
            </thead>
            <tbody>
              {lines.map((item, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      className="p2-select"
                      style={{
                        width: '100%',
                      }}
                      value={item.productId}
                      onChange={(e) => handleProductChange(idx, e.target.value)}
                      required
                    >
                      <option value="">Select product…</option>
                      {(productsQuery.data?.items ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku}) · {p.unit}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      className="p2-input"
                      value={item.quantity}
                      onChange={(e) => handleQtyChange(idx, Number(e.target.value))}
                      required
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="p2-input"
                      value={item.unitPrice}
                      onChange={(e) => handlePriceChange(idx, Number(e.target.value))}
                      required
                    />
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 600,
                      color: '#1f3327',
                    }}
                  >
                    {money.format(item.quantity * item.unitPrice)}
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        style={{
                          border: 0,
                          background: 'none',
                          color: '#a23932',
                          cursor: 'pointer',
                        }}
                        title="Remove line"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
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
          <FormRow
            label="Special Instructions / Shipping Notes"
            hint="Optional notes printed on invoice and delivery slip"
          >
            <textarea
              className="p2-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Export packing in sea-worthy jute bales, delivery to Chittagong port depot."
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
              Estimated Subtotal:{' '}
            </span>
            <strong
              style={{
                fontSize: '20px',
                color: '#1a3124',
                marginLeft: '6px',
              }}
            >
              {money.format(subtotal)}
            </strong>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '10px',
            }}
          >
            <Button type="button" variant="outline" onClick={() => navigate('/sales')}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              disabled={orderMutation.isPending}
            >
              {orderMutation.isPending ? 'Saving…' : 'Save Sales Order'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
