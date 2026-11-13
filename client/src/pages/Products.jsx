import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Info,
  Package,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ApiError,
  createProduct,
  getProduct,
  getProducts,
  setProductStatus,
  updateProduct,
} from '../api';
import {
  BackLink,
  EmptyState,
  ErrorState,
  FormRow,
  InvertedInfoIcon,
  LoadingState,
  Notice,
  PageTitle,
  Pagination,
  StatusLabel,
  TypeLabel,
  useDemoRole as useCurrentRole,
} from './shared';
import { Button } from '../components/ui/button';
import { cleanWarehouseName } from '../lib/utils';
const productsKey = ['products'];
const blank = {
  sku: '',
  name: '',
  category: 'Raw Jute',
  type: 'RAW_MATERIAL',
  unit: 'kg',
  description: null,
  standardPrice: null,
  status: 'ACTIVE',
};
const categories = [
  'Raw Jute',
  'Jute Yarn',
  'Other Raw Materials',
  'Hessian Cloth',
  'Jute Bags',
  'Sacking Cloth',
  'Other Finished Products',
];
const price = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 2,
});
export default function ProductsPage() {
  const path = useLocation().pathname.replace(/\/$/, '');
  if (path === '/products/new') return <ProductFormPage />;
  const edit = path.match(/^\/products\/([^/]+)\/edit$/);
  if (edit) return <ProductFormPage id={decodeURIComponent(edit[1])} />;
  const detail = path.match(/^\/products\/([^/]+)$/);
  if (detail) return <ProductDetailPage id={decodeURIComponent(detail[1])} />;
  return <ProductListPage />;
}
function ProductListPage() {
  const { isManager, isAdmin, user } = useCurrentRole();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [sortOrder, setSortOrder] = useState(''); // '' | 'desc' | 'asc'

  const handleTogglePriceSort = () => {
    setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    setPage(1);
  };

  const query = useQuery({
    queryKey: [
      ...productsKey,
      {
        q,
        category,
        type,
        status,
        page,
        sortBy: sortOrder ? 'standardPrice' : undefined,
        sortOrder: sortOrder || undefined,
      },
    ],
    queryFn: () =>
      getProducts({
        q,
        category,
        type,
        status,
        page,
        pageSize: 12,
        sortBy: sortOrder ? 'standardPrice' : undefined,
        sortOrder: sortOrder || undefined,
      }),
  });
  return (
    <div className="p2-page products-page">
      <PageTitle
        title="Products"
        description="One catalog shared by both factories, with stock kept factory specific."
        action={
          isManager ? (
            <Link className="p2-button primary" to="/products/new">
              <Plus size={15} /> Add product
            </Link>
          ) : undefined
        }
      />
      <section className="p2-panel">
        <div className="p2-toolbar">
          <label className="p2-search">
            <Search size={16} />
            <input
              placeholder="Search product name or SKU"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className="p2-select"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All product types</option>
            <option value="RAW_MATERIAL">Raw materials</option>
            <option value="FINISHED_PRODUCT">Finished products</option>
          </select>
          <select
            className="p2-select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {isManager && (
            <select
              className="p2-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All statuses</option>
            </select>
          )}
          <div className="p2-toolbar-right">
            <span className="p2-toolbar-count">
              {query.data?.total ?? query.data?.items?.length ?? 0} products
            </span>
          </div>
        </div>
        {query.isLoading ? (
          <LoadingState label="Loading product catalog…" />
        ) : query.error ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table product-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th className="product-category-header">Category</th>
                    <th>Type</th>
                    <th className="product-stock-header">{isAdmin ? 'Factory stock' : 'On hand'}</th>
                    <th className="amount-header" style={{ textAlign: 'left' }}>
                      <button
                        type="button"
                        onClick={handleTogglePriceSort}
                        className="p2-sort-header-btn"
                        title={
                          sortOrder === 'desc'
                            ? 'Sorted: High to Low. Click to sort Low to High'
                            : sortOrder === 'asc'
                              ? 'Sorted: Low to High. Click to sort High to Low'
                              : 'Click to sort Selling Price High to Low'
                        }
                      >
                        <span>Selling Price (<span className="p2-taka-sign">৳</span>)</span>
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
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((product, index) => (
                    <tr key={product.id}>
                      <td>
                        {String((page - 1) * 10 + index + 1).padStart(2, '0')}
                      </td>
                      <td>
                        <Link className="p2-record-link" to={`/products/${product.id}`}>
                          {product.name}
                          <small>{product.sku}</small>
                        </Link>
                      </td>
                      <td className="product-category-cell">{product.category}</td>
                      <td>
                        <TypeLabel type={product.type} />
                      </td>
                      <td className="product-stock-cell">
                        <div className="p2-stock-summary">
                          {isAdmin ? (
                            product.stockByFactory?.length ? (
                              product.stockByFactory.map((stock) => (
                                <span key={stock.factory.id}>
                                  <b>{stock.factory.code}</b> {stock.quantity.toLocaleString()}{' '}
                                  {product.unit}
                                </span>
                              ))
                            ) : (
                              <span className="p2-subtext">No balances yet</span>
                            )
                          ) : (
                            (() => {
                              const myStock = product.stockByFactory?.find(
                                (s) => !user?.factory?.id || s.factory.id === user.factory.id
                              );
                              return myStock ? (
                                <span>
                                  <b>{myStock.quantity.toLocaleString()}</b> {product.unit}
                                </span>
                              ) : (
                                <span className="p2-subtext">0 {product.unit}</span>
                              );
                            })()
                          )}
                        </div>
                      </td>
                      <td className="amount-cell">
                        {product.standardPrice == null ? (
                          '—'
                        ) : (
                          <strong>
                            {Number(product.standardPrice).toLocaleString('en-BD')} /-
                          </strong>
                        )}
                      </td>
                      <td>
                        <StatusLabel status={product.status} />
                      </td>
                      <td className="p2-actions-cell">
                        <div className="p2-actions">
                          <Link
                            title="View product"
                            aria-label={`View ${product.name}`}
                            to={`/products/${product.id}`}
                          >
                            <InvertedInfoIcon size={20} />
                          </Link>
                        </div>
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
            title="No products found"
            detail={
              q || category || type
                ? 'Adjust your search or filters.'
                : 'Add a product to start the shared catalog.'
            }
          />
        )}
      </section>
    </div>
  );
}
function ProductFormPage({ id }) {
  const { isManager } = useCurrentRole();
  const query = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id),
    enabled: !!id,
  });
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(blank);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (query.data && !loaded) {
      setForm({
        sku: query.data.sku,
        name: query.data.name,
        category: query.data.category,
        type: query.data.type,
        unit: query.data.unit,
        description: query.data.description,
        standardPrice: query.data.standardPrice,
        status: query.data.status,
      });
      setLoaded(true);
    }
  }, [query.data, loaded]);
  const mutation = useMutation({
    mutationFn: (data) => (id ? updateProduct(id, data) : createProduct(data)),
    onSuccess: async (product) => {
      await client.invalidateQueries({
        queryKey: productsKey,
      });
      await client.invalidateQueries({
        queryKey: ['product', id],
      });
      navigate(`/products/${product.id}`);
    },
  });
  const update = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  const submit = (event) => {
    event.preventDefault();
    const rawPrice = form.standardPrice;
    const standardPrice =
      rawPrice === '' || rawPrice == null || Number.isNaN(Number(rawPrice))
        ? null
        : Number(rawPrice);
    mutation.mutate({
      ...form,
      standardPrice,
      description: form.description?.trim() || '',
    });
  };
  if (!isManager)
    return (
      <div className="p2-page">
        <BackLink to="/products" />
        <Notice>This demo role has read only product catalog access.</Notice>
      </div>
    );
  if (id && (query.isLoading || !loaded))
    return (
      <div className="p2-page">
        <LoadingState label="Loading product…" />
      </div>
    );
  if (id && query.error)
    return (
      <div className="p2-page">
        <ErrorState message={query.error.message} retry={() => void query.refetch()} />
      </div>
    );
  return (
    <div className="p2-page narrow-page">
      <BackLink to={id ? `/products/${id}` : '/products'} />
      <PageTitle
        title={id ? 'Edit product' : 'Add product'}
        description="Product definitions are shared by both factory locations."
      />
      <form className="p2-panel p2-form" onSubmit={submit}>
        {mutation.error && (
          <Notice>
            {mutation.error instanceof ApiError && mutation.error.details?.length
              ? `${mutation.error.message}: ${mutation.error.details.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' · ')}`
              : mutation.error.message}
          </Notice>
        )}
        <div className="p2-form-grid">
          <FormRow label="Product name" required>
            <input
              className="p2-input"
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </FormRow>
          <FormRow label="SKU / Product code" required>
            <input
              className="p2-input"
              required
              value={form.sku}
              onChange={(e) => update('sku', e.target.value)}
            />
            <small>SKU must be unique across the company.</small>
          </FormRow>
          <FormRow label="Product type" required>
            <select
              className="p2-input"
              value={form.type}
              onChange={(e) => update('type', e.target.value)}
            >
              <option value="RAW_MATERIAL">Raw material</option>
              <option value="FINISHED_PRODUCT">Finished product</option>
            </select>
          </FormRow>
          <FormRow label="Category" required>
            <select
              className="p2-input"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
            >
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Unit of measurement" required>
            <select
              className="p2-input"
              value={form.unit}
              onChange={(e) => update('unit', e.target.value)}
            >
              {['kg', 'MT', 'Bale', 'Piece', 'Meter'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Default selling price (BDT)">
            <input
              className="p2-input"
              type="number"
              min="0"
              step="0.01"
              value={form.standardPrice ?? ''}
              onChange={(e) =>
                update('standardPrice', e.target.value === '' ? null : Number(e.target.value))
              }
            />
            <small>Optional; mainly used for finished products.</small>
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
        <FormRow label="Description">
          <textarea
            className="p2-input p2-textarea"
            value={form.description ?? ''}
            onChange={(e) => update('description', e.target.value || null)}
          />
        </FormRow>
        <div className="p2-form-footer">
          <Button
            variant="outline"
            type="button"
            onClick={() => navigate(id ? `/products/${id}` : '/products')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : id ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </div>
  );
}
function ProductDetailPage({ id }) {
  const { isManager, isAdmin, user } = useCurrentRole();
  const query = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id),
  });
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status) => setProductStatus(id, status),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ['product', id],
      });
      await client.invalidateQueries({
        queryKey: productsKey,
      });
      setStatusModalOpen(false);
    },
  });
  if (query.isLoading)
    return (
      <div className="p2-page">
        <LoadingState label="Loading product details…" />
      </div>
    );
  if (query.error || !query.data)
    return (
      <div className="p2-page">
        <ErrorState
          message={query.error?.message ?? 'Product not found.'}
          retry={() => void query.refetch()}
        />
      </div>
    );
  const product = query.data;
  const stockList = product.stockByWarehouse || product.stockByFactory || [];
  const displayedStock = isAdmin
    ? stockList
    : stockList.filter((s) => !user?.factory?.id || s.factory.id === user.factory.id);
  return (
    <div className="p2-page">
      <BackLink to="/products" />
      <PageTitle
        title={product.name}
        description="Shared product catalog record"
        action={
          isManager ? (
            <div className="p2-page-actions">
              <Link className="p2-button secondary" to={`/products/${id}/edit`}>
                <Pencil size={14} /> Edit
              </Link>
              <Button
                variant="outline"
                onClick={() => {
                  mutation.reset();
                  setStatusModalOpen(true);
                }}
              >
                {product.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          ) : undefined
        }
      />
      {mutation.error && <Notice>{mutation.error.message}</Notice>}
      <div className="p2-detail-grid">
        <section className="p2-panel">
          <div className="p2-panel-heading">
            <div className="p2-icon-box">
              <Package size={17} />
            </div>
            <div>
              <h2>{isAdmin ? 'Factory stock' : 'Warehouse stock'}</h2>
              <p>
                {isAdmin
                  ? 'Factory specific on-hand quantities'
                  : 'On-hand quantities in your factory'}
              </p>
            </div>
            <StatusLabel status={product.status} />
          </div>
          <dl className="p2-details">
            <div>
              <dt>SKU</dt>
              <dd>{product.sku}</dd>
            </div>
            <div>
              <dt>Product type</dt>
              <dd>
                <TypeLabel type={product.type} />
              </dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{product.category}</dd>
            </div>
            <div>
              <dt>Unit</dt>
              <dd>{product.unit}</dd>
            </div>
            <div>
              <dt>Default selling price</dt>
              <dd>
                {product.standardPrice == null ? 'Not set' : price.format(product.standardPrice)}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(product.createdAt).toLocaleDateString('en-GB')}</dd>
            </div>
            <div className="full">
              <dt>Description</dt>
              <dd>{product.description || 'No description provided.'}</dd>
            </div>
          </dl>
        </section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          <section className="p2-panel" style={{ overflow: 'hidden' }}>
            <div className="p2-panel-heading">
              <div className="p2-icon-box">
                <Package size={17} />
              </div>
              <div>
                <h2>{isAdmin ? 'Factory stock' : 'Warehouse stock'}</h2>
                <p>
                  {isAdmin
                    ? 'Factory specific on-hand quantities'
                    : 'On-hand quantities in your factory'}
                </p>
              </div>
            </div>
            {displayedStock.length ? (
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                      {isAdmin && <th>Factory</th>}
                      <th>Warehouse</th>
                      <th className="p2-right">On hand</th>
                      <th className="p2-right">Minimum stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedStock.map((stock, sIdx) => {
                      const threshold = product.thresholds?.find(
                        (item) => item.factory.id === stock.factory.id
                      );
                      const whName = cleanWarehouseName(stock.warehouse?.name);
                      return (
                        <tr key={stock.warehouse?.id || stock.factory.id}>
                          <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                            {String(sIdx + 1).padStart(2, '0')}
                          </td>
                          {isAdmin && (
                            <td>
                              <b>{stock.factory.code}</b>
                              <small>{stock.factory.name}</small>
                            </td>
                          )}
                          <td>{whName}</td>
                          <td className="p2-right">
                            {stock.quantity.toLocaleString()} {product.unit}
                          </td>
                          <td className="p2-right">
                            {threshold
                              ? `${threshold.minimumQuantity.toLocaleString()} ${product.unit}`
                              : 'Not set'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No stock balances"
                detail="Stock will appear when a movement is recorded."
              />
            )}
          </section>
          {(isManager || user?.role === 'STAFF') && (
            <section className="p2-panel p2-action-card">
              <div className="p2-panel-heading" style={{ padding: '0 0 12px' }}>
                <div className="p2-icon-box">
                  <ArrowLeftRight size={17} />
                </div>
                <div>
                  <h2>Stock operations</h2>
                  <p>
                    {isManager
                      ? 'Record a receipt, issue or corrected balance for this product.'
                      : 'Record operational receipts and issues for this product.'}
                  </p>
                </div>
              </div>
              {product.status === 'ACTIVE' ? (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    borderTop: '1px solid #edf0ed',
                    paddingTop: '12px',
                  }}
                >
                  <Link
                    className="p2-button btn-stock-in"
                    to={`/inventory/stock-in?productId=${encodeURIComponent(product.id)}`}
                  >
                    <ArrowDownToLine size={15} /> Stock in
                  </Link>
                  <Link
                    className="p2-button btn-stock-out"
                    to={`/inventory/stock-out?productId=${encodeURIComponent(product.id)}`}
                  >
                    <ArrowUpFromLine size={15} /> Stock out
                  </Link>
                  {isManager && (
                    <Link
                      className="p2-button btn-adjustment"
                      to={`/inventory/adjustment?productId=${encodeURIComponent(product.id)}`}
                    >
                      <SlidersHorizontal size={15} /> Adjustment
                    </Link>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    borderTop: '1px solid #edf0ed',
                    paddingTop: '10px',
                    fontSize: '12.5px',
                    color: '#6b7280',
                  }}
                >
                  Activate this product to record new stock operations.
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      <ProductStatusModal
        product={statusModalOpen ? product : null}
        isPending={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          if (!mutation.isPending) setStatusModalOpen(false);
        }}
        onConfirm={() =>
          mutation.mutate(product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')
        }
      />
    </div>
  );
}
function ProductStatusModal({ product, isPending, error, onClose, onConfirm }) {
  useEffect(() => {
    if (!product) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, isPending, onClose]);

  if (!product) return null;
  const isActivating = product.status !== 'ACTIVE';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-status-modal-title"
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
        if (e.target === e.currentTarget && !isPending) onClose();
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
          border: '1px solid #e5ebe7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '8px',
              background: isActivating ? '#ecfdf5' : '#fffbeb',
              color: isActivating ? '#15803d' : '#b45309',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Package size={18} />
          </div>
          <div>
            <h3
              id="product-status-modal-title"
              style={{ margin: 0, fontSize: '17px', color: '#111827', fontWeight: 700 }}
            >
              {isActivating ? 'Activate Product' : 'Deactivate Product'}
            </h3>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              SKU: {product.sku}
              {product.category ? ` · ${product.category}` : ''}
            </span>
          </div>
        </div>
        {error && (
          <div style={{ marginBottom: '12px' }}>
            <Notice>{error.message}</Notice>
          </div>
        )}
        <p style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 18px', lineHeight: 1.55 }}>
          Are you sure you want to {isActivating ? 'activate' : 'deactivate'}{' '}
          <strong>{product.name}</strong>?
          {!isActivating &&
            ' Inactive products remain in historical records but cannot be used in new orders or stock entries.'}
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            paddingTop: '14px',
            borderTop: '1px solid #f3f4f6',
          }}
        >
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            className={
              isActivating
                ? 'bg-emerald-700 hover:bg-emerald-800 border-emerald-700 hover:border-emerald-800 text-white'
                : 'bg-amber-600 hover:bg-amber-700 border-amber-600 hover:border-amber-700 text-white'
            }
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : isActivating ? 'Activate' : 'Deactivate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
