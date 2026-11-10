import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, Pencil, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import {
  ApiError,
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomers,
  getFactories,
  setCustomerStatus,
  updateCustomer,
} from '../api';
import {
  BackLink,
  ConfirmModal,
  EmptyState,
  ErrorState,
  FormRow,
  InvertedInfoIcon,
  LoadingState,
  Notice,
  PageTitle,
  Pagination,
  StatusLabel,
  useDemoRole as useCurrentRole,
} from './shared';
import { Button } from '../components/ui/button';
const blank = {
  name: '',
  code: '',
  contactPerson: '',
  phone: '',
  email: null,
  address: '',
  city: '',
  type: 'BUSINESS',
  status: 'ACTIVE',
  notes: null,
};
const listKey = ['customers'];
const money = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 0,
});
export default function CustomersPage() {
  const location = useLocation();
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/customers/new') return <CustomerFormPage />;
  const edit = path.match(/^\/customers\/([^/]+)\/edit$/);
  if (edit) return <CustomerFormPage id={decodeURIComponent(edit[1])} />;
  const detail = path.match(/^\/customers\/([^/]+)$/);
  if (detail) return <CustomerDetailPage id={decodeURIComponent(detail[1])} />;
  return <CustomerListPage />;
}
function CustomerListPage() {
  const { isAdmin, isManager } = useCurrentRole();
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [
      ...listKey,
      {
        q,
        status,
        factoryId,
        page,
      },
    ],
    queryFn: () =>
      getCustomers({
        q,
        status,
        factoryId: isAdmin ? factoryId : undefined,
        page,
        pageSize: 10,
      }),
  });
  const [statusModalCustomer, setStatusModalCustomer] = useState(null);
  const client = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: ({ id, value }) => setCustomerStatus(id, value),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: listKey,
      });
      setStatusModalCustomer(null);
    },
  });
  const toggleStatus = (customer) => {
    statusMutation.reset();
    setStatusModalCustomer(customer);
  };
  return (
    <div className="p2-page">
      <PageTitle
        title="Customers"
        description="Factory scoped customer records and order history."
        action={
          isManager ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <Link className="p2-button secondary" to="/trash?type=CUSTOMER">
                <Trash2 size={14} /> Trash Can
              </Link>
              <Link className="p2-button primary" to="/customers/new">
                <Plus size={15} /> Add customer
              </Link>
            </div>
          ) : undefined
        }
      />
      {statusMutation.error && <Notice>{statusMutation.error.message}</Notice>}
      <section className="p2-panel">
        <div className="p2-toolbar">
          <label className="p2-search">
            <Search size={16} />
            <input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, code or phone"
            />
          </label>
          <select
            className="p2-select"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="ACTIVE">Active customers</option>
            <option value="INACTIVE">Inactive customers</option>
            <option value="ALL">All statuses</option>
          </select>
          {isAdmin && (
            <select
              className="p2-select"
              value={factoryId}
              onChange={(event) => {
                setFactoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Both factories</option>
              {(factoriesQuery.data ?? []).map((factory) => (
                <option key={factory.id} value={factory.id}>
                  {factory.code} · {factory.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {query.isLoading ? (
          <LoadingState label="Loading customers…" />
        ) : query.error ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table customer-table">
                <thead>
                  <tr>
                    <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                    <th>Customer</th>
                    <th>Contact</th>
                    {isAdmin && <th>Factory</th>}
                    <th>Type</th>
                    <th>Status</th>
                    <th className="p2-right">Created</th>
                    <th className="p2-right" style={{ width: '60px', minWidth: '60px' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((customer, index) => (
                    <tr key={customer.id}>
                      <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                        {String((page - 1) * 10 + index + 1).padStart(2, '0')}
                      </td>
                      <td>
                        <Link className="p2-record-link" to={`/customers/${customer.id}`}>
                          {customer.name}
                          <small>{customer.code}</small>
                        </Link>
                      </td>
                      <td>
                        {customer.contactPerson}
                        <small className="p2-subtext">{customer.phone}</small>
                      </td>
                      {isAdmin && (
                        <td>
                          <span className="p2-factory">
                            <Building2 size={13} />
                            {customer.factory.code}
                          </span>
                        </td>
                      )}
                      <td>{customer.type === 'BUSINESS' ? 'Business' : 'Individual'}</td>
                      <td>
                        <StatusLabel status={customer.status} />
                      </td>
                      <td className="p2-right">
                        {new Date(customer.createdAt).toLocaleDateString('en-GB')}
                      </td>
                      <td className="p2-actions">
                        <Link
                          aria-label={`View ${customer.name}`}
                          title="View details"
                          to={`/customers/${customer.id}`}
                        >
                          <InvertedInfoIcon size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={query.data.page}
              totalPages={query.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No customers found"
            detail={q ? 'Try a different search or filter.' : 'Add a customer to get started.'}
          />
        )}
      </section>
      <ConfirmModal
        open={!!statusModalCustomer}
        title={
          statusModalCustomer?.status === 'ACTIVE' ? 'Deactivate Customer' : 'Activate Customer'
        }
        subtitle={
          statusModalCustomer
            ? `${statusModalCustomer.code} · ${statusModalCustomer.city}`
            : undefined
        }
        message={
          statusModalCustomer ? (
            <>
              Are you sure you want to{' '}
              {statusModalCustomer.status === 'ACTIVE' ? 'deactivate' : 'activate'}{' '}
              <strong>{statusModalCustomer.name}</strong> ({statusModalCustomer.code})?
            </>
          ) : null
        }
        confirmLabel={statusModalCustomer?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        tone={statusModalCustomer?.status === 'ACTIVE' ? 'warning' : 'primary'}
        icon={UserRound}
        isPending={statusMutation.isPending}
        error={statusMutation.error}
        onClose={() => {
          if (!statusMutation.isPending) setStatusModalCustomer(null);
        }}
        onConfirm={() => {
          if (!statusModalCustomer) return;
          const next = statusModalCustomer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
          statusMutation.mutate({
            id: statusModalCustomer.id,
            value: next,
          });
        }}
      />
    </div>
  );
}
function CustomerFormPage({ id }) {
  const { isAdmin, isManager, user } = useCurrentRole();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const returnTo = searchParams.get('returnTo');
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const existing = useQuery({
    queryKey: ['customer', id],
    queryFn: () => getCustomer(id),
    enabled: !!id,
  });
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(blank);
  const [factoryId, setFactoryId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [customError, setCustomError] = useState('');
  useEffect(() => {
    if (user?.factory?.id && !factoryId) setFactoryId(user.factory.id);
  }, [user, factoryId]);
  useEffect(() => {
    if (isAdmin && !id && !factoryId && factories.data?.length) {
      setFactoryId(factories.data[0].id);
    }
  }, [isAdmin, id, factoryId, factories.data]);
  useEffect(() => {
    if (existing.data && !loaded) {
      const data = existing.data;
      setForm({
        name: data.name,
        code: data.code,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address,
        city: data.city,
        type: data.type,
        status: data.status,
        notes: data.notes,
      });
      setFactoryId(data.factory.id);
      setLoaded(true);
    }
  }, [existing.data, loaded]);
  const mutation = useMutation({
    mutationFn: (data) => (id ? updateCustomer(id, data) : createCustomer(data)),
    onSuccess: async (customer) => {
      await client.invalidateQueries({
        queryKey: listKey,
      });
      await client.invalidateQueries({
        queryKey: ['customer', id],
      });
      if (returnTo) {
        navigate(`${returnTo}${returnTo.includes('?') ? '&' : '?'}selectedCustomer=${customer.id}`);
      } else {
        navigate(id ? `/customers/${customer.id}` : `/customers/${customer.id}`);
      }
    },
  });
  const update = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  const submit = (event) => {
    event.preventDefault();
    setCustomError('');
    if (isAdmin && !id && !factoryId) {
      setCustomError('Please select a target factory for the customer.');
      return;
    }
    mutation.mutate({
      ...form,
      email: form.email?.trim() || '',
      notes: form.notes?.trim() || '',
      ...(isAdmin
        ? {
            factoryId,
          }
        : {}),
    });
  };
  if (!isManager)
    return (
      <div className="p2-page">
        <BackLink to="/customers" />
        <Notice>This demo role has read only customer access.</Notice>
      </div>
    );
  if (id && (existing.isLoading || !loaded))
    return (
      <div className="p2-page">
        <LoadingState label="Loading customer…" />
      </div>
    );
  if (id && existing.error)
    return (
      <div className="p2-page">
        <ErrorState message={existing.error.message} retry={() => void existing.refetch()} />
      </div>
    );
  return (
    <div className="p2-page narrow-page">
      <BackLink to={returnTo || (id ? `/customers/${id}` : '/customers')} />
      <PageTitle
        title={id ? 'Edit customer' : 'Add customer'}
        description="Maintain the factory's customer contact record."
      />
      <form className="p2-panel p2-form" onSubmit={submit}>
        {customError && <Notice>{customError}</Notice>}
        {mutation.error && <Notice>{formatError(mutation.error)}</Notice>}
        {isAdmin && !id && (
          <FormRow label="Factory" required>
            <select
              className="p2-input"
              required
              value={factoryId}
              onChange={(event) => {
                setFactoryId(event.target.value);
                setCustomError('');
              }}
            >
              <option value="">Select factory</option>
              {(factories.data ?? []).map((factory) => (
                <option value={factory.id} key={factory.id}>
                  {factory.code} · {factory.name}
                </option>
              ))}
            </select>
          </FormRow>
        )}
        <div className="p2-form-grid">
          <FormRow label="Customer name" required>
            <input
              className="p2-input"
              required
              maxLength={150}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </FormRow>
          <FormRow label="Customer code" required>
            <input
              className="p2-input"
              required
              maxLength={32}
              value={form.code}
              onChange={(e) => update('code', e.target.value)}
            />
            <small>Unique within this factory.</small>
          </FormRow>
          <FormRow label="Contact person" required>
            <input
              className="p2-input"
              required
              value={form.contactPerson}
              onChange={(e) => update('contactPerson', e.target.value)}
            />
          </FormRow>
          <FormRow label="Phone number" required>
            <input
              className="p2-input"
              required
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
            />
          </FormRow>
          <FormRow label="Email address">
            <input
              className="p2-input"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => update('email', e.target.value || null)}
            />
          </FormRow>
          <FormRow label="Customer type">
            <select
              className="p2-input"
              value={form.type}
              onChange={(e) => update('type', e.target.value)}
            >
              <option value="BUSINESS">Business</option>
              <option value="INDIVIDUAL">Individual</option>
            </select>
          </FormRow>
          <FormRow label="City" required>
            <input
              className="p2-input"
              required
              value={form.city}
              onChange={(e) => update('city', e.target.value)}
            />
          </FormRow>
          <FormRow label="Status">
            <select
              className="p2-input"
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </FormRow>
        </div>
        <FormRow label="Business address" required>
          <textarea
            className="p2-input p2-textarea"
            required
            value={form.address}
            onChange={(e) => update('address', e.target.value)}
          />
        </FormRow>
        <FormRow label="Notes">
          <textarea
            className="p2-input p2-textarea"
            maxLength={2000}
            value={form.notes ?? ''}
            onChange={(e) => update('notes', e.target.value || null)}
          />
        </FormRow>
        <div className="p2-form-footer">
          <Button
            variant="outline"
            type="button"
            onClick={() => navigate(id ? `/customers/${id}` : '/customers')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : id ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
function CustomerDetailPage({ id }) {
  const { isManager, isAdmin } = useCurrentRole();
  const navigate = useNavigate();
  const [deleteModal, setDeleteModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: () => getCustomer(id),
  });
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status) => setCustomerStatus(id, status),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['customer', id],
      });
      await client.invalidateQueries({
        queryKey: listKey,
      });
      setStatusModal(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteCustomer(id),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: listKey,
      });
      navigate('/customers');
    },
  });

  if (query.isLoading)
    return (
      <div className="p2-page">
        <LoadingState label="Loading customer details…" />
      </div>
    );
  if (query.error || !query.data)
    return (
      <div className="p2-page">
        <ErrorState
          message={query.error?.message ?? 'Customer not found.'}
          retry={() => void query.refetch()}
        />
      </div>
    );
  const customer = query.data;
  const orderCount = customer._count?.orders ?? customer.orders?.length ?? 0;

  return (
    <div className="p2-page customer-detail-page">
      <BackLink to="/customers" />
      <PageTitle
        title={customer.name}
        description={isAdmin ? `${customer.factory.code} · ${customer.factory.name}` : undefined}
        action={
          <div className="p2-page-actions">
            {isManager && (
              <Link className="p2-button secondary" to={`/customers/${id}/edit`}>
                <Pencil size={14} /> Edit
              </Link>
            )}
            {isManager && (
              <Button
                variant="outline"
                onClick={() => setStatusModal(true)}
              >
                {customer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            {isManager && (
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                onClick={() => setDeleteModal(true)}
              >
                <Trash2 size={14} /> Delete Customer
              </Button>
            )}
          </div>
        }
      />
      {mutation.error && <Notice>{mutation.error.message}</Notice>}
      <div className="p2-detail-grid">
        <section className="p2-panel">
          <div className="p2-panel-heading">
            <div className="p2-icon-box">
              <UserRound size={17} />
            </div>
            <div>
              <h2>Contact information</h2>
              <p>Customer profile and factory assignment</p>
            </div>
            <StatusLabel status={customer.status} />
          </div>
          <dl className="p2-details">
            <div>
              <dt>Contact person</dt>
              <dd>{customer.contactPerson}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{customer.phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{customer.email || '—'}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{customer.type === 'BUSINESS' ? 'Business' : 'Individual'}</dd>
            </div>
            <div className="full">
              <dt>Business address</dt>
              <dd>{customer.address}</dd>
            </div>
            <div>
              <dt>City</dt>
              <dd>{customer.city}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(customer.createdAt).toLocaleDateString('en-GB')}</dd>
            </div>
            <div className="full">
              <dt>Notes</dt>
              <dd>{customer.notes || 'No notes recorded.'}</dd>
            </div>
          </dl>
        </section>
        <section className="p2-panel">
          <div className="p2-panel-heading">
            <div className="p2-icon-box">
              <Building2 size={17} />
            </div>
            <div>
              <h2>Transaction history</h2>
              <p>Read only sales order history</p>
            </div>
          </div>
          {customer.orders.length ? (
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="p2-right">Order value</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.orders.map((order, index) => (
                    <tr key={order.id}>
                      <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td>{order.orderNumber}</td>
                      <td>{new Date(order.orderDate).toLocaleDateString('en-GB')}</td>
                      <td>
                        <span className="p2-order-status">
                          {order.status.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p2-right">{money.format(order.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No transactions yet"
              detail="Sales order history will appear here when available."
            />
          )}
          <p className="p2-muted-footnote">
            Invoice totals and customer balances are reserved for a later accounting phase.
          </p>
        </section>
      </div>

      {deleteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteMut.isPending) setDeleteModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '500px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>
                  Delete Customer
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  {customer.name} · {customer.code}
                </small>
              </div>
            </div>

            {deleteMut.error && (
              <div
                style={{
                  padding: '10px 14px',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  borderRadius: '6px',
                  fontSize: '13px',
                  marginBottom: '14px',
                  border: '1px solid #fecaca',
                }}
              >
                {deleteMut.error.message || 'Failed to delete customer.'}
              </div>
            )}

            {/* Consequent Orders Display */}
            <div
              style={{
                borderRadius: '8px',
                padding: '14px 16px',
                marginBottom: '16px',
                background: orderCount > 0 ? '#fff7ed' : '#f0fdf4',
                border: orderCount > 0 ? '1px solid #fed7aa' : '1px solid #bbf7d0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {orderCount > 0 ? (
                  <AlertTriangle size={18} color="#c2410c" />
                ) : (
                  <CheckCircle2 size={18} color="#15803d" />
                )}
                <strong style={{ fontSize: '14px', color: orderCount > 0 ? '#9a3412' : '#166534' }}>
                  {orderCount > 0
                    ? `Consequent Orders: ${orderCount} order${orderCount === 1 ? '' : 's'} found`
                    : 'No Consequent Orders (0 orders)'}
                </strong>
              </div>

              <div style={{ fontSize: '13px', color: orderCount > 0 ? '#7c2d12' : '#166534', lineHeight: 1.5 }}>
                {orderCount > 0 ? (
                  <>
                    <p style={{ margin: '0 0 6px' }}>
                      This customer currently has <strong>{orderCount} consequent order{orderCount === 1 ? '' : 's'}</strong> in the system.
                    </p>
                    {customer.orders?.length > 0 && (
                      <div
                        style={{
                          background: '#fff',
                          border: '1px solid #fed7aa',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          margin: '6px 0',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ color: '#6b7280', display: 'block', marginBottom: '3px' }}>
                          Associated orders to be removed:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {customer.orders.map((o) => (
                            <span
                              key={o.id}
                              style={{
                                background: '#fed7aa',
                                color: '#7c2d12',
                                padding: '1px 6px',
                                borderRadius: '3px',
                                fontWeight: 600,
                              }}
                            >
                              {o.orderNumber}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <span style={{ display: 'block', marginTop: '6px', fontWeight: 600, color: '#b91c1c' }}>
                      Warning: Permanently deleting this customer will cascade and delete all {orderCount} associated order records.
                    </span>
                  </>
                ) : (
                  <p style={{ margin: 0 }}>
                    There are 0 associated orders for this customer. Deletion is completely safe and will not impact other records.
                  </p>
                )}
              </div>
            </div>

            <p style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 16px', lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{customer.name}</strong> ({customer.code})?
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid #f3f4f6',
              }}
            >
              <Button
                variant="outline"
                type="button"
                onClick={() => setDeleteModal(false)}
                disabled={deleteMut.isPending}
              >
                Keep Customer
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? 'Deleting…' : 'Confirm Delete Customer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {statusModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !mutation.isPending) setStatusModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '440px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '17px', color: '#111827' }}>
              {customer.status === 'ACTIVE' ? 'Deactivate Customer' : 'Activate Customer'}
            </h3>
            <p style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 18px', lineHeight: 1.5 }}>
              Are you sure you want to {customer.status === 'ACTIVE' ? 'deactivate' : 'activate'}{' '}
              <strong>{customer.name}</strong> ({customer.code})?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button
                variant="outline"
                onClick={() => setStatusModal(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className={
                  customer.status === 'ACTIVE'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                }
                onClick={() =>
                  mutation.mutate(customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
                }
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? 'Saving…'
                  : customer.status === 'ACTIVE'
                  ? 'Deactivate'
                  : 'Activate'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function formatError(error) {
  if (error instanceof ApiError && error.details?.length) {
    return `${error.message}: ${error.details.map((detail) => (detail.field ? `${detail.field}: ${detail.message}` : detail.message)).join(' · ')}`;
  }
  return error?.message || 'Operation failed.';
}
