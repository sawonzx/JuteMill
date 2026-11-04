import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Building2, Pencil, Plus, Search, UserRound, X } from 'lucide-react'
import { ApiError, createCustomer, getCustomer, getCustomers, getFactories, setCustomerStatus, updateCustomer, type Customer, type CustomerInput } from '../api'
import { BackLink, EmptyState, ErrorState, FormRow, LoadingState, Notice, PageTitle, Pagination, StatusLabel, useDemoRole as useCurrentRole } from './shared'
import { Button } from '../components/ui/button'

const blank: CustomerInput = { name: '', code: '', contactPerson: '', phone: '', email: null, address: '', city: '', type: 'BUSINESS', status: 'ACTIVE', notes: null }
const listKey = ['customers']
const money = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 })

export default function CustomersPage() {
  const location = useLocation()
  const path = location.pathname.replace(/\/$/, '')
  if (path === '/customers/new') return <CustomerFormPage />
  const edit = path.match(/^\/customers\/([^/]+)\/edit$/)
  if (edit) return <CustomerFormPage id={decodeURIComponent(edit[1]!)} />
  const detail = path.match(/^\/customers\/([^/]+)$/)
  if (detail) return <CustomerDetailPage id={decodeURIComponent(detail[1]!)} />
  return <CustomerListPage />
}

function CustomerListPage() {
  const { isAdmin, isManager } = useCurrentRole()
  const factoriesQuery = useQuery({ queryKey: ['factories'], queryFn: getFactories, enabled: isAdmin })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [factoryId, setFactoryId] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: [...listKey, { q, status, factoryId, page }], queryFn: () => getCustomers({ q, status, factoryId: isAdmin ? factoryId : undefined, page, pageSize: 10 }) })
  const client = useQueryClient()
  const statusMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: 'ACTIVE' | 'INACTIVE' }) => setCustomerStatus(id, value), onSuccess: () => client.invalidateQueries({ queryKey: listKey }) })
  const toggleStatus = (customer: Customer) => {
    const next = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (window.confirm(`${next === 'INACTIVE' ? 'Deactivate' : 'Activate'} ${customer.name}?`)) statusMutation.mutate({ id: customer.id, value: next })
  }
  return <div className="p2-page">
    <PageTitle eyebrow="CUSTOMER RELATIONSHIPS" title="Customers" description="Factory scoped customer records and order history." action={isManager ? <Link className="p2-button primary" to="/customers/new"><Plus size={15} /> Add customer</Link> : undefined} />
    {statusMutation.error && <Notice>{statusMutation.error.message}</Notice>}
    <section className="p2-panel">
      <div className="p2-toolbar"><label className="p2-search"><Search size={16} /><input value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Search name, code or phone" /></label>
        <select className="p2-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="ACTIVE">Active customers</option><option value="INACTIVE">Inactive customers</option><option value="ALL">All statuses</option></select>
        {isAdmin && <select className="p2-select" value={factoryId} onChange={(event) => { setFactoryId(event.target.value); setPage(1) }}><option value="">Both factories</option>{(factoriesQuery.data ?? []).map((factory) => <option key={factory.id} value={factory.id}>{factory.code} · {factory.name}</option>)}</select>}
      </div>
      {query.isLoading ? <LoadingState label="Loading customers…" /> : query.error ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : query.data?.items.length ? <>
        <div className="p2-table-wrap"><table className="p2-table"><thead><tr><th>Customer</th><th>Contact</th><th>Factory</th><th>Type</th><th>Status</th><th className="p2-right">Created</th><th /></tr></thead><tbody>{query.data.items.map((customer) => <tr key={customer.id}>
          <td><Link className="p2-record-link" to={`/customers/${customer.id}`}>{customer.name}<small>{customer.code}</small></Link></td>
          <td>{customer.contactPerson}<small className="p2-subtext">{customer.phone}</small></td><td><span className="p2-factory"><Building2 size={13} />{customer.factory.code}</span></td><td>{customer.type === 'BUSINESS' ? 'Business' : 'Individual'}</td><td><StatusLabel status={customer.status} /></td><td className="p2-right">{new Date(customer.createdAt).toLocaleDateString('en-GB')}</td>
          <td className="p2-actions"><Link aria-label={`View ${customer.name}`} title="View details" to={`/customers/${customer.id}`}><ArrowRight size={15} /></Link>{isManager && <button title={customer.status === 'ACTIVE' ? 'Deactivate customer' : 'Activate customer'} onClick={() => toggleStatus(customer)}>{customer.status === 'ACTIVE' ? <X size={15} /> : <Plus size={15} />}</button>}</td>
        </tr>)}</tbody></table></div>
        <Pagination page={query.data.page} totalPages={query.data.totalPages} onPage={setPage} />
      </> : <EmptyState title="No customers found" detail={q ? 'Try a different search or filter.' : 'Add a customer to get started.'} />}
    </section>
  </div>
}

function CustomerFormPage({ id }: { id?: string }) {
  const { isAdmin, isManager, user } = useCurrentRole()
  const factories = useQuery({ queryKey: ['factories'], queryFn: getFactories, enabled: isAdmin })
  const existing = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id!), enabled: !!id })
  const client = useQueryClient(); const navigate = useNavigate()
  const [form, setForm] = useState<CustomerInput>(blank)
  const [factoryId, setFactoryId] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { if (user?.factory?.id && !factoryId) setFactoryId(user.factory.id) }, [user, factoryId])
  useEffect(() => {
    if (existing.data && !loaded) { const data = existing.data; setForm({ name: data.name, code: data.code, contactPerson: data.contactPerson, phone: data.phone, email: data.email, address: data.address, city: data.city, type: data.type, status: data.status, notes: data.notes }); setFactoryId(data.factory.id); setLoaded(true) }
  }, [existing.data, loaded])
  const mutation = useMutation({ mutationFn: (data: CustomerInput) => id ? updateCustomer(id, data) : createCustomer(data), onSuccess: async (customer) => { await client.invalidateQueries({ queryKey: listKey }); await client.invalidateQueries({ queryKey: ['customer', id] }); navigate(id ? `/customers/${customer.id}` : `/customers/${customer.id}`) } })
  const update = <K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate({ ...form, email: form.email?.trim() || null, notes: form.notes?.trim() || null, ...(isAdmin ? { factoryId } : {}) }) }
  if (!isManager) return <div className="p2-page"><BackLink to="/customers" /><Notice>This demo role has read only customer access.</Notice></div>
  if (id && (existing.isLoading || !loaded)) return <div className="p2-page"><LoadingState label="Loading customer…" /></div>
  if (id && existing.error) return <div className="p2-page"><ErrorState message={existing.error.message} retry={() => void existing.refetch()} /></div>
  return <div className="p2-page narrow-page"><BackLink to={id ? `/customers/${id}` : '/customers'} /><PageTitle eyebrow="CUSTOMER RELATIONSHIPS" title={id ? 'Edit customer' : 'Add customer'} description="Maintain the factory's customer contact record." />
    <form className="p2-panel p2-form" onSubmit={submit}>
      {mutation.error && <Notice>{formatError(mutation.error)}</Notice>}
      {isAdmin && !id && <FormRow label="Factory" required><select className="p2-input" required value={factoryId} onChange={(event) => setFactoryId(event.target.value)}><option value="">Select factory</option>{(factories.data ?? []).map((factory) => <option value={factory.id} key={factory.id}>{factory.code} · {factory.name}</option>)}</select></FormRow>}
      <div className="p2-form-grid"><FormRow label="Customer name" required><input className="p2-input" required maxLength={150} value={form.name} onChange={(e) => update('name', e.target.value)} /></FormRow><FormRow label="Customer code" required><input className="p2-input" required maxLength={32} value={form.code} onChange={(e) => update('code', e.target.value)} /><small>Unique within this factory.</small></FormRow>
        <FormRow label="Contact person" required><input className="p2-input" required value={form.contactPerson} onChange={(e) => update('contactPerson', e.target.value)} /></FormRow><FormRow label="Phone number" required><input className="p2-input" required value={form.phone} onChange={(e) => update('phone', e.target.value)} /></FormRow>
        <FormRow label="Email address"><input className="p2-input" type="email" value={form.email ?? ''} onChange={(e) => update('email', e.target.value || null)} /></FormRow><FormRow label="Customer type"><select className="p2-input" value={form.type} onChange={(e) => update('type', e.target.value as CustomerInput['type'])}><option value="BUSINESS">Business</option><option value="INDIVIDUAL">Individual</option></select></FormRow>
        <FormRow label="City" required><input className="p2-input" required value={form.city} onChange={(e) => update('city', e.target.value)} /></FormRow><FormRow label="Status"><select className="p2-input" value={form.status} onChange={(e) => update('status', e.target.value as CustomerInput['status'])}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></FormRow>
      </div><FormRow label="Business address" required><textarea className="p2-input p2-textarea" required value={form.address} onChange={(e) => update('address', e.target.value)} /></FormRow><FormRow label="Notes"><textarea className="p2-input p2-textarea" maxLength={2000} value={form.notes ?? ''} onChange={(e) => update('notes', e.target.value || null)} /></FormRow>
      <div className="p2-form-footer"><Button variant="outline" type="button" onClick={() => navigate(id ? `/customers/${id}` : '/customers')}>Cancel</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : id ? 'Save changes' : 'Create customer'}</Button></div>
    </form>
  </div>
}

function CustomerDetailPage({ id }: { id: string }) {
  const { isManager } = useCurrentRole()
  const query = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id) })
  const client = useQueryClient()
  const mutation = useMutation({ mutationFn: (status: 'ACTIVE' | 'INACTIVE') => setCustomerStatus(id, status), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['customer', id] }); await client.invalidateQueries({ queryKey: listKey }) } })
  if (query.isLoading) return <div className="p2-page"><LoadingState label="Loading customer details…" /></div>
  if (query.error || !query.data) return <div className="p2-page"><ErrorState message={query.error?.message ?? 'Customer not found.'} retry={() => void query.refetch()} /></div>
  const customer = query.data
  return <div className="p2-page"><BackLink to="/customers" /><PageTitle eyebrow={`CUSTOMER · ${customer.code}`} title={customer.name} description={`${customer.factory.code} · ${customer.factory.name}`} action={<div className="p2-page-actions">{isManager && <Link className="p2-button secondary" to={`/customers/${id}/edit`}><Pencil size={14} /> Edit</Link>}{isManager && <Button variant="outline" onClick={() => { const status = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'; if (window.confirm(`${status === 'ACTIVE' ? 'Activate' : 'Deactivate'} ${customer.name}?`)) mutation.mutate(status) }}>{customer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>}</div>} />
    {mutation.error && <Notice>{mutation.error.message}</Notice>}
    <div className="p2-detail-grid"><section className="p2-panel"><div className="p2-panel-heading"><div className="p2-icon-box"><UserRound size={17} /></div><div><h2>Contact information</h2><p>Customer profile and factory assignment</p></div><StatusLabel status={customer.status} /></div><dl className="p2-details"><div><dt>Contact person</dt><dd>{customer.contactPerson}</dd></div><div><dt>Phone</dt><dd>{customer.phone}</dd></div><div><dt>Email</dt><dd>{customer.email || '—'}</dd></div><div><dt>Type</dt><dd>{customer.type === 'BUSINESS' ? 'Business' : 'Individual'}</dd></div><div className="full"><dt>Business address</dt><dd>{customer.address}</dd></div><div><dt>City</dt><dd>{customer.city}</dd></div><div><dt>Created</dt><dd>{new Date(customer.createdAt).toLocaleDateString('en-GB')}</dd></div><div className="full"><dt>Notes</dt><dd>{customer.notes || 'No notes recorded.'}</dd></div></dl></section>
      <section className="p2-panel"><div className="p2-panel-heading"><div className="p2-icon-box"><Building2 size={17} /></div><div><h2>Transaction history</h2><p>Read only sales order history</p></div></div>{customer.orders.length ? <div className="p2-table-wrap"><table className="p2-table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="p2-right">Order value</th></tr></thead><tbody>{customer.orders.map((order) => <tr key={order.id}><td>{order.orderNumber}</td><td>{new Date(order.orderDate).toLocaleDateString('en-GB')}</td><td><span className="p2-order-status">{order.status.toLowerCase().replace(/_/g, ' ')}</span></td><td className="p2-right">{money.format(order.total)}</td></tr>)}</tbody></table></div> : <EmptyState title="No transactions yet" detail="Sales order history will appear here when available." />}<p className="p2-muted-footnote">Invoice totals and customer balances are reserved for a later accounting phase.</p></section></div>
  </div>
}

function formatError(error: Error) { return error instanceof ApiError && error.details.length ? `${error.message} ${error.details.map((detail) => `${detail.field}: ${detail.message}`).join(' · ')}` : error.message }
