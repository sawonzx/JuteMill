import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Package, Pencil, Plus, Search, X } from 'lucide-react'
import { ApiError, createProduct, getProduct, getProducts, setProductStatus, updateProduct, type Product, type ProductInput } from '../api'
import { BackLink, EmptyState, ErrorState, FormRow, LoadingState, Notice, PageTitle, Pagination, StatusLabel, TypeLabel, useDemoRole as useCurrentRole } from './shared'
import { Button } from '../components/ui/button'

const productsKey = ['products']
const blank: ProductInput = { sku: '', name: '', category: 'Raw Jute', type: 'RAW_MATERIAL', unit: 'kg', description: null, standardPrice: null, status: 'ACTIVE' }
const categories = ['Raw Jute', 'Jute Yarn', 'Other Raw Materials', 'Hessian Cloth', 'Jute Bags', 'Sacking Cloth', 'Other Finished Products']
const price = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 })

export default function ProductsPage() {
  const path = useLocation().pathname.replace(/\/$/, '')
  if (path === '/products/new') return <ProductFormPage />
  const edit = path.match(/^\/products\/([^/]+)\/edit$/)
  if (edit) return <ProductFormPage id={decodeURIComponent(edit[1]!)} />
  const detail = path.match(/^\/products\/([^/]+)$/)
  if (detail) return <ProductDetailPage id={decodeURIComponent(detail[1]!)} />
  return <ProductListPage />
}

function ProductListPage() {
  const { isManager } = useCurrentRole()
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: [...productsKey, { q, category, type, status, page }], queryFn: () => getProducts({ q, category, type, status, page, pageSize: 12 }) })
  const client = useQueryClient()
  const statusMutation = useMutation({ mutationFn: ({ id, status: value }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => setProductStatus(id, value), onSuccess: () => client.invalidateQueries({ queryKey: productsKey }) })
  function toggle(product: Product) { const next = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'; if (window.confirm(`${next === 'INACTIVE' ? 'Deactivate' : 'Activate'} ${product.name}?`)) statusMutation.mutate({ id: product.id, status: next }) }
  return <div className="p2-page"><PageTitle eyebrow="SHARED COMPANY CATALOG" title="Products" description="One catalog shared by both factories, with stock kept factory specific." action={isManager ? <Link className="p2-button primary" to="/products/new"><Plus size={15} /> Add product</Link> : undefined} />
    {statusMutation.error && <Notice>{statusMutation.error.message}</Notice>}
    <section className="p2-panel"><div className="p2-toolbar"><label className="p2-search"><Search size={16} /><input placeholder="Search product name or SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /></label><select className="p2-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}><option value="">All product types</option><option value="RAW_MATERIAL">Raw materials</option><option value="FINISHED_PRODUCT">Finished products</option></select><select className="p2-select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>{isManager && <select className="p2-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All statuses</option></select>}</div>
      {query.isLoading ? <LoadingState label="Loading product catalog…" /> : query.error ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : query.data?.items.length ? <><div className="p2-table-wrap"><table className="p2-table"><thead><tr><th>Product</th><th>Category</th><th>Type</th><th>Factory stock</th><th>Default selling price</th><th>Status</th><th /></tr></thead><tbody>{query.data.items.map((product) => <tr key={product.id}><td><Link className="p2-record-link" to={`/products/${product.id}`}>{product.name}<small>{product.sku}</small></Link></td><td>{product.category}</td><td><TypeLabel type={product.type} /></td><td><div className="p2-stock-summary">{product.stockByFactory.length ? product.stockByFactory.map((stock) => <span key={stock.factory.id}><b>{stock.factory.code}</b> {stock.quantity.toLocaleString()} {product.unit}</span>) : <span className="p2-subtext">No balances yet</span>}</div></td><td>{product.standardPrice == null ? '—' : price.format(product.standardPrice)}</td><td><StatusLabel status={product.status} /></td><td className="p2-actions"><Link title="View product" aria-label={`View ${product.name}`} to={`/products/${product.id}`}><ArrowRight size={15} /></Link>{isManager && <button title={product.status === 'ACTIVE' ? 'Deactivate product' : 'Activate product'} onClick={() => toggle(product)}>{product.status === 'ACTIVE' ? <X size={15} /> : <Plus size={15} />}</button>}</td></tr>)}</tbody></table></div><Pagination page={query.data.page} totalPages={query.data.totalPages} onPage={setPage} /></> : <EmptyState title="No products found" detail={q || category || type ? 'Adjust your search or filters.' : 'Add a product to start the shared catalog.'} />}
    </section>
  </div>
}

function ProductFormPage({ id }: { id?: string }) {
  const { isManager } = useCurrentRole(); const query = useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id!), enabled: !!id }); const client = useQueryClient(); const navigate = useNavigate()
  const [form, setForm] = useState<ProductInput>(blank); const [loaded, setLoaded] = useState(false)
  useEffect(() => { if (query.data && !loaded) { setForm({ sku: query.data.sku, name: query.data.name, category: query.data.category, type: query.data.type, unit: query.data.unit as ProductInput['unit'], description: query.data.description, standardPrice: query.data.standardPrice, status: query.data.status }); setLoaded(true) } }, [query.data, loaded])
  const mutation = useMutation({ mutationFn: (data: ProductInput) => id ? updateProduct(id, data) : createProduct(data), onSuccess: async (product) => { await client.invalidateQueries({ queryKey: productsKey }); await client.invalidateQueries({ queryKey: ['product', id] }); navigate(`/products/${product.id}`) } })
  const update = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate({ ...form, standardPrice: form.standardPrice == null || Number.isNaN(Number(form.standardPrice)) ? null : Number(form.standardPrice), description: form.description?.trim() || null }) }
  if (!isManager) return <div className="p2-page"><BackLink to="/products" /><Notice>This demo role has read only product catalog access.</Notice></div>
  if (id && (query.isLoading || !loaded)) return <div className="p2-page"><LoadingState label="Loading product…" /></div>
  if (id && query.error) return <div className="p2-page"><ErrorState message={query.error.message} retry={() => void query.refetch()} /></div>
  return <div className="p2-page narrow-page"><BackLink to={id ? `/products/${id}` : '/products'} /><PageTitle eyebrow="SHARED COMPANY CATALOG" title={id ? 'Edit product' : 'Add product'} description="Product definitions are shared by both factory locations." />
    <form className="p2-panel p2-form" onSubmit={submit}>{mutation.error && <Notice>{mutation.error instanceof ApiError && mutation.error.details.length ? `${mutation.error.message} ${mutation.error.details.map((e) => e.message).join(' · ')}` : mutation.error.message}</Notice>}
      <div className="p2-form-grid"><FormRow label="Product name" required><input className="p2-input" required value={form.name} onChange={(e) => update('name', e.target.value)} /></FormRow><FormRow label="SKU / Product code" required><input className="p2-input" required value={form.sku} onChange={(e) => update('sku', e.target.value)} /><small>SKU must be unique across the company.</small></FormRow>
        <FormRow label="Product type" required><select className="p2-input" value={form.type} onChange={(e) => update('type', e.target.value as ProductInput['type'])}><option value="RAW_MATERIAL">Raw material</option><option value="FINISHED_PRODUCT">Finished product</option></select></FormRow><FormRow label="Category" required><select className="p2-input" value={form.category} onChange={(e) => update('category', e.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></FormRow>
        <FormRow label="Unit of measurement" required><select className="p2-input" value={form.unit} onChange={(e) => update('unit', e.target.value as ProductInput['unit'])}>{['kg', 'MT', 'Bale', 'Piece', 'Meter'].map((value) => <option key={value}>{value}</option>)}</select></FormRow><FormRow label="Default selling price (BDT)"><input className="p2-input" type="number" min="0" step="0.01" value={form.standardPrice ?? ''} onChange={(e) => update('standardPrice', e.target.value === '' ? null : Number(e.target.value))} /><small>Optional; mainly used for finished products.</small></FormRow>
        <FormRow label="Status"><select className="p2-input" value={form.status} onChange={(e) => update('status', e.target.value as ProductInput['status'])}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></FormRow></div>
      <FormRow label="Description"><textarea className="p2-input p2-textarea" value={form.description ?? ''} onChange={(e) => update('description', e.target.value || null)} /></FormRow>
      <div className="p2-form-footer"><Button variant="outline" type="button" onClick={() => navigate(id ? `/products/${id}` : '/products')}>Cancel</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : id ? 'Save changes' : 'Create product'}</Button></div>
    </form>
  </div>
}

function ProductDetailPage({ id }: { id: string }) {
  const { isManager } = useCurrentRole(); const query = useQuery({ queryKey: ['product', id], queryFn: () => getProduct(id) }); const client = useQueryClient()
  const mutation = useMutation({ mutationFn: (status: 'ACTIVE' | 'INACTIVE') => setProductStatus(id, status), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['product', id] }); await client.invalidateQueries({ queryKey: productsKey }) } })
  if (query.isLoading) return <div className="p2-page"><LoadingState label="Loading product details…" /></div>
  if (query.error || !query.data) return <div className="p2-page"><ErrorState message={query.error?.message ?? 'Product not found.'} retry={() => void query.refetch()} /></div>
  const product = query.data
  return <div className="p2-page"><BackLink to="/products" /><PageTitle eyebrow={`PRODUCT · ${product.sku}`} title={product.name} description="Shared product catalog record" action={isManager ? <div className="p2-page-actions"><Link className="p2-button secondary" to={`/products/${id}/edit`}><Pencil size={14} /> Edit</Link><Button variant="outline" onClick={() => { const status = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'; if (window.confirm(`${status === 'ACTIVE' ? 'Activate' : 'Deactivate'} ${product.name}?`)) mutation.mutate(status) }}>{product.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button></div> : undefined} />
    {mutation.error && <Notice>{mutation.error.message}</Notice>}
    <div className="p2-detail-grid"><section className="p2-panel"><div className="p2-panel-heading"><div className="p2-icon-box"><Package size={17} /></div><div><h2>Product information</h2><p>Catalog details</p></div><StatusLabel status={product.status} /></div><dl className="p2-details"><div><dt>SKU</dt><dd>{product.sku}</dd></div><div><dt>Product type</dt><dd><TypeLabel type={product.type} /></dd></div><div><dt>Category</dt><dd>{product.category}</dd></div><div><dt>Unit</dt><dd>{product.unit}</dd></div><div><dt>Default selling price</dt><dd>{product.standardPrice == null ? 'Not set' : price.format(product.standardPrice)}</dd></div><div><dt>Created</dt><dd>{new Date(product.createdAt).toLocaleDateString('en-GB')}</dd></div><div className="full"><dt>Description</dt><dd>{product.description || 'No description provided.'}</dd></div></dl></section>
      <section className="p2-panel"><div className="p2-panel-heading"><div className="p2-icon-box"><Package size={17} /></div><div><h2>Factory stock</h2><p>Factory specific on-hand quantities</p></div></div>{product.stockByFactory.length ? <div className="p2-table-wrap"><table className="p2-table"><thead><tr><th>Factory</th><th>Warehouse</th><th className="p2-right">On hand</th><th className="p2-right">Minimum stock</th></tr></thead><tbody>{product.stockByFactory.map((stock) => { const threshold = product.thresholds.find((item) => item.factory.id === stock.factory.id); return <tr key={stock.factory.id}><td><b>{stock.factory.code}</b><small>{stock.factory.name}</small></td><td>{stock.warehouse.name}</td><td className="p2-right">{stock.quantity.toLocaleString()} {product.unit}</td><td className="p2-right">{threshold ? `${threshold.minimumQuantity.toLocaleString()} ${product.unit}` : 'Not set'}</td></tr> })}</tbody></table></div> : <EmptyState title="No stock balances" detail="Stock will appear when a movement is recorded." />}</section></div>
  </div>
}
