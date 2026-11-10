import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  ChevronLeft,
  History,
  Package,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';
import {
  getFactories,
  getInventoryBalances,
  getInventoryMovements,
  getInventorySummary,
  getProduct,
  getProducts,
  getWarehouses,
  recordMovement,
  setInventoryThreshold,
} from '../api';
import {
  BackLink,
  ConfirmModal,
  EmptyState,
  ErrorState,
  FormRow,
  LoadingState,
  Notice,
  PageTitle,
  Pagination,
  SearchableProductSelect,
  TypeLabel,
  useDemoRole as useCurrentRole,
} from './shared';
import { Button } from '../components/ui/button';
import { cleanWarehouseName } from '../lib/utils';
const balanceKey = ['inventory-balances'];
const summaryKey = ['inventory-summary'];
const movementKey = ['inventory-movements'];
const INVENTORY_OVERVIEW_PAGE_SIZE = 15;
const qty = (value, unit) =>
  `${value.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  })} ${unit}`;
const titleForMove = (type) =>
  type === 'STOCK_IN' ? 'Stock in' : type === 'STOCK_OUT' ? 'Stock out' : 'Stock adjustment';
export default function InventoryPage() {
  const path = useLocation().pathname.replace(/\/$/, '');
  if (path === '/inventory/stock-in') return <StockMovementPage type="STOCK_IN" />;
  if (path === '/inventory/stock-out') return <StockMovementPage type="STOCK_OUT" />;
  if (path === '/inventory/adjustment') return <StockMovementPage type="ADJUSTMENT" />;
  if (path === '/inventory/movements') return <MovementHistoryPage />;
  return <InventoryOverview />;
}
function InventoryOverview() {
  const { isManager, isAdmin, user } = useCurrentRole();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
  });
  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: getInventorySummary,
  });
  const balances = useQuery({
    queryKey: [
      ...balanceKey,
      {
        q,
        type,
        stockStatus,
        factoryId,
        page,
      },
    ],
    queryFn: () =>
      getInventoryBalances({
        q,
        type,
        stockStatus,
        factoryId: isAdmin ? factoryId : undefined,
        page,
        pageSize: INVENTORY_OVERVIEW_PAGE_SIZE,
      }),
  });
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState(() => location.state?.notice ?? '');
  useEffect(() => {
    if (location.state?.notice) {
      setNotice(location.state.notice);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);
  return (
    <div className="p2-page">
      <PageTitle
        title="Inventory"
        description="Factory specific balances, movement history, and reorder points."
        action={
          <div className="p2-page-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link className="p2-button secondary" to="/inventory/movements">
              <History size={14} /> Movement history
            </Link>
            <TopStockOperations isManager={isManager} isStaff={user?.role === 'STAFF'} />
          </div>
        }
      />
      {notice && <Notice kind="success">{notice}</Notice>}
      {summary.isLoading ? (
        <LoadingState label="Loading inventory summary…" />
      ) : summary.error ? (
        <ErrorState message={summary.error.message} retry={() => void summary.refetch()} />
      ) : (
        summary.data && (
          <div className="p2-metric-grid">
            <Metric
              icon={<Package size={17} />}
              label="Active products"
              value={summary.data.productCount.toLocaleString()}
              detail="Shared catalog"
            />
            <Metric
              icon={<WarehouseIcon size={17} />}
              label="Inventory items"
              value={summary.data.inventoryItemCount.toLocaleString()}
              detail="Factory and warehouse balances"
            />
            <Metric
              icon={<TriangleAlert size={17} />}
              label="Low stock"
              value={summary.data.lowStockCount.toLocaleString()}
              detail="At or below factory minimum"
              warning={summary.data.lowStockCount > 0}
            />
            <Metric
              icon={<Boxes size={17} />}
              label="Raw materials"
              value={summaryText(summary.data.rawMaterialStock)}
              detail="Grouped by unit of measure"
            />
            {}
          </div>
        )
      )}
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
            <option value="">Raw materials & finished goods</option>
            <option value="RAW_MATERIAL">Raw materials</option>
            <option value="FINISHED_PRODUCT">Finished goods</option>
          </select>
          <select
            className="p2-select"
            value={stockStatus}
            onChange={(e) => {
              setStockStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All stock levels</option>
            <option value="LOW">Low stock</option>
            <option value="HEALTHY">Above minimum</option>
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
              {(factories.data ?? []).map((factory) => (
                <option value={factory.id} key={factory.id}>
                  {factory.code} · {factory.name}
                </option>
              ))}
            </select>
          )}
          <span className="p2-filter-label">
            <SlidersHorizontal size={14} /> {balances.data?.total ?? '—'} items
          </span>
        </div>
        {balances.isLoading ? (
          <LoadingState label="Loading factory stock…" />
        ) : balances.error ? (
          <ErrorState message={balances.error.message} retry={() => void balances.refetch()} />
        ) : balances.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                    <th>Product</th>
                    <th>{isAdmin ? 'Factory / warehouse' : 'Warehouse'}</th>
                    <th>Type</th>
                    <th className="p2-right">On hand</th>
                    <th className="p2-right">Minimum</th>
                    <th>Stock status</th>
                    {isManager && <th>Low stock threshold</th>}
                  </tr>
                </thead>
                <tbody>
                  {balances.data.items.map((balance, index) => (
                    <tr key={balance.id}>
                      <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                        {String((page - 1) * INVENTORY_OVERVIEW_PAGE_SIZE + index + 1).padStart(2, '0')}
                      </td>
                      <td>
                        <Link className="p2-record-link" to={`/products/${balance.product.id}`}>
                          {balance.product.name}
                          <small>
                            {balance.product.sku} · {balance.product.category}
                          </small>
                        </Link>
                      </td>
                      <td>
                        {isAdmin ? (
                          <>
                            <b>{balance.factory.code}</b>
                            <small>{cleanWarehouseName(balance.warehouse.name)}</small>
                          </>
                        ) : (
                          <b>{cleanWarehouseName(balance.warehouse.name)}</b>
                        )}
                      </td>
                      <td>
                        <TypeLabel type={balance.product.type} />
                      </td>
                      <td className="p2-right p2-quantity">
                        {qty(balance.quantity, balance.product.unit)}
                      </td>
                      <td className="p2-right">
                        {balance.minimumQuantity == null
                          ? '—'
                          : qty(balance.minimumQuantity, balance.product.unit)}
                      </td>
                      <td>
                        {balance.lowStock ? (
                          <span className="p2-low-stock">
                            <i /> Low stock
                          </span>
                        ) : (
                          <span className="p2-healthy">In range</span>
                        )}
                      </td>
                      {isManager && (
                        <td>
                          <ThresholdEditor
                            balance={balance}
                            onSaved={() => {
                              setNotice('Minimum stock threshold saved.');
                              void summary.refetch();
                              void balances.refetch();
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={balances.data.page}
              totalPages={balances.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No stock balances found"
            detail="Try different filters or add a product to the shared catalog."
          />
        )}
      </section>
      <section className="p2-panel">
        <div className="p2-panel-heading">
          <div className="p2-icon-box">
            <History size={17} />
          </div>
          <div>
            <h2>Recent movements</h2>
            <p>Latest stock ledger entries for your factory scope</p>
          </div>
          <Link className="p2-inline-link" to="/inventory/movements">
            View history <ArrowRight size={14} />
          </Link>
        </div>
        {summary.data?.recentMovements.length ? (
          <MovementTable rows={summary.data.recentMovements} />
        ) : (
          <EmptyState
            title="No movements recorded"
            detail="Stock receipts, issues and adjustments will appear here."
          />
        )}
      </section>
      <InventoryActions isManager={isManager} isStaff={user?.role === 'STAFF'} />
    </div>
  );
}
function ThresholdEditor({ balance, onSaved }) {
  const [value, setValue] = useState(
    balance.minimumQuantity == null ? '' : String(balance.minimumQuantity)
  );
  useEffect(
    () => setValue(balance.minimumQuantity == null ? '' : String(balance.minimumQuantity)),
    [balance.minimumQuantity]
  );
  const mutation = useMutation({
    mutationFn: () =>
      setInventoryThreshold({
        factoryId: balance.factory.id,
        productId: balance.product.id,
        minimumQuantity: value.trim() === '' ? null : Number(value),
      }),
    onSuccess: onSaved,
  });
  return (
    <div className="p2-threshold-cell">
      <div className="p2-threshold-edit">
        <input
          aria-label={`Minimum stock ${balance.product.name} ${balance.factory.code}`}
          type="number"
          min="0"
          step="0.001"
          className="p2-small-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Not set"
        />
        <button
          className="p2-mini-button"
          disabled={
            mutation.isPending ||
            (value !== '' && (Number.isNaN(Number(value)) || Number(value) < 0))
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '…' : 'Save'}
        </button>
      </div>
      {mutation.error && <small className="p2-inline-error">{mutation.error.message}</small>}
    </div>
  );
}
function TopStockOperations({ isManager, isStaff }) {
  const [open, setOpen] = useState(false);
  if (!isManager && !isStaff) return null;

  return (
    <div
      className="p2-top-stock-ops"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
    >
      {open && (
        <div className="p2-ops-slider">
          <Link className="p2-button btn-stock-in" to="/inventory/stock-in">
            <ArrowDownToLine size={14} /> Stock in
          </Link>
          <Link className="p2-button btn-stock-out" to="/inventory/stock-out">
            <ArrowUpFromLine size={14} /> Stock out
          </Link>
          {isManager && (
            <Link className="p2-button btn-adjustment" to="/inventory/adjustment">
              <SlidersHorizontal size={14} /> Adjustment
            </Link>
          )}
        </div>
      )}
      <button
        type="button"
        className={`p2-button ${open ? 'primary' : 'secondary'}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title={open ? 'Close stock operations' : 'Open stock operations'}
      >
        {open ? <X size={13} /> : <ChevronLeft size={13} />}
        Stock operations
      </button>
    </div>
  );
}
function InventoryActions({ isManager, isStaff }) {
  if (!isManager && !isStaff)
    return (
      <div className="p2-panel p2-readonly-card">
        <span className="eyebrow">READ ONLY</span>
        <h3>Inventory access</h3>
        <p>Your demo role can view scoped balances and movement history.</p>
      </div>
    );
  return (
    <section className="p2-panel p2-action-card">
      <div className="p2-panel-heading" style={{ padding: '0 0 12px' }}>
        <div className="p2-icon-box">
          <ArrowLeftRight size={17} />
        </div>
        <div>
          <h2>Stock operations</h2>
          <p>
            {isManager
              ? 'Record a receipt, issue or corrected balance.'
              : 'Record operational receipts and issues.'}
          </p>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          borderTop: '1px solid #edf0ed',
          paddingTop: '12px',
        }}
      >
        <Link className="p2-button btn-stock-in" to="/inventory/stock-in">
          <ArrowDownToLine size={15} /> Stock in
        </Link>
        <Link className="p2-button btn-stock-out" to="/inventory/stock-out">
          <ArrowUpFromLine size={15} /> Stock out
        </Link>
        {isManager && (
          <Link className="p2-button btn-adjustment" to="/inventory/adjustment">
            <SlidersHorizontal size={15} /> Adjustment
          </Link>
        )}
      </div>
    </section>
  );
}
function StockMovementPage({ type }) {
  const { user, isManager } = useCurrentRole();
  const canMove = isManager || user?.role === 'STAFF';
  const canAdjust = isManager;
  const location = useLocation();
  const initialProductId = new URLSearchParams(location.search).get('productId') ?? '';
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
  });
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState(initialProductId);
  useEffect(() => {
    const nextProductId = new URLSearchParams(location.search).get('productId') ?? '';
    if (nextProductId) setProductId(nextProductId);
  }, [location.search]);
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [adjustmentMode, setAdjustmentMode] = useState('SET');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [success, setSuccess] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const client = useQueryClient();
  const navigate = useNavigate();
  const resolvedFactory =
    factoryId || user?.factory?.id || (factories.data?.length === 1 ? factories.data[0].id : '');
  useEffect(() => {
    if (!factoryId && user?.factory?.id) setFactoryId(user.factory.id);
    else if (!factoryId && factories.data?.length === 1) setFactoryId(factories.data[0].id);
  }, [factoryId, user, factories.data]);
  const [productSearch, setProductSearch] = useState('');
  const products = useQuery({
    queryKey: ['products', 'stock-select'],
    queryFn: () =>
      getProducts({
        status: 'ACTIVE',
        page: 1,
        pageSize: 100,
      }),
  });
  const hasMoreCatalog = (products.data?.total ?? 0) > (products.data?.items?.length ?? 0);
  const searchedProducts = useQuery({
    queryKey: ['products', 'stock-search', productSearch],
    queryFn: () =>
      getProducts({
        status: 'ACTIVE',
        q: productSearch.trim(),
        page: 1,
        pageSize: 100,
      }),
    enabled: hasMoreCatalog && productSearch.trim().length > 0,
  });
  const preselectedProduct = useQuery({
    queryKey: ['product', productId],
    queryFn: () => getProduct(productId),
    enabled:
      !!productId &&
      !(products.data?.items ?? []).some((p) => p.id === productId) &&
      !(searchedProducts.data?.items ?? []).some((p) => p.id === productId),
  });
  const availableProducts = useMemo(() => {
    const base = products.data?.items ?? [];
    const extra = searchedProducts.data?.items ?? [];
    const pre =
      preselectedProduct.data && preselectedProduct.data.status === 'ACTIVE'
        ? [preselectedProduct.data]
        : [];
    const merged = [...base];
    const seen = new Set(base.map((p) => p.id));
    for (const p of [...pre, ...extra]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
      }
    }
    return merged;
  }, [products.data?.items, searchedProducts.data?.items, preselectedProduct.data]);
  const warehouses = useQuery({
    queryKey: ['warehouses', resolvedFactory],
    queryFn: () => getWarehouses(resolvedFactory),
    enabled: !!resolvedFactory,
  });
  const balances = useQuery({
    queryKey: [...balanceKey, 'available', resolvedFactory],
    queryFn: () =>
      getInventoryBalances({
        factoryId: resolvedFactory,
        page: 1,
        pageSize: 100,
      }),
    enabled: !!resolvedFactory,
  });
  const selectedBalance = balances.data?.items.find((item) => item.product.id === productId);
  const selectedProduct =
    selectedBalance?.product ||
    availableProducts.find((item) => item.id === productId) ||
    preselectedProduct.data;
  const mutation = useMutation({
    mutationFn: recordMovement,
    onSuccess: async (result) => {
      const successMessage = result.duplicate
        ? 'This movement was already processed; stock was not changed again.'
        : `${titleForMove(type)} saved successfully.`;
      setConfirmPayload(null);
      setSuccess(successMessage);
      setSubmissionError('');
      setQuantity('');
      setReason('');
      setReference('');
      setRemarks('');
      setTransactionDate('');
      setKey(crypto.randomUUID());
      await Promise.all([
        client.invalidateQueries({
          queryKey: summaryKey,
        }),
        client.invalidateQueries({
          queryKey: balanceKey,
        }),
        client.invalidateQueries({
          queryKey: movementKey,
        }),
        client.invalidateQueries({
          queryKey: ['products'],
        }),
        client.invalidateQueries({
          queryKey: ['dashboard'],
        }),
      ]);
      navigate('/inventory', {
        state: {
          notice: successMessage,
        },
      });
    },
    onError: (error) => {
      setConfirmPayload(null);
      setSubmissionError(error.message);
    },
  });
  const [confirmPayload, setConfirmPayload] = useState(null);
  const title = titleForMove(type);
  if ((type === 'ADJUSTMENT' && !canAdjust) || (type !== 'ADJUSTMENT' && !canMove))
    return (
      <div className="p2-page">
        <BackLink to="/inventory" />
        <Notice>This demo role has read only inventory access.</Notice>
      </div>
    );
  const submit = (event) => {
    event.preventDefault();
    setSubmissionError('');
    setSuccess('');
    const amount = Number(quantity);
    if (!factoryId && !resolvedFactory)
      return setSubmissionError('Select a factory before submitting.');
    if (!productId || !Number.isFinite(amount))
      return setSubmissionError('Choose a product and enter a valid quantity.');
    if (type === 'STOCK_OUT' && selectedBalance && amount > selectedBalance.quantity)
      return setSubmissionError(
        `Available stock is ${qty(selectedBalance.quantity, selectedBalance.product.unit)}. Enter a smaller quantity.`
      );
    const payload = {
      factoryId: resolvedFactory,
      ...(warehouseId
        ? {
            warehouseId,
          }
        : {}),
      productId,
      type,
      quantity: amount,
      idempotencyKey: key,
      ...(type === 'ADJUSTMENT'
        ? {
            adjustmentMode,
          }
        : {}),
      ...(reason.trim()
        ? {
            reason: reason.trim(),
          }
        : {}),
      ...(reference.trim()
        ? {
            reference: reference.trim(),
          }
        : {}),
      ...(remarks.trim()
        ? {
            remarks: remarks.trim(),
          }
        : {}),
      ...(transactionDate
        ? {
            transactionDate: new Date(`${transactionDate}T12:00:00`).toISOString(),
          }
        : {}),
    };
    setConfirmPayload(payload);
  };
  return (
    <div className="p2-page narrow-page">
      <BackLink to="/inventory" />
      <PageTitle
        title={title}
        description={
          type === 'ADJUSTMENT'
            ? 'Correct an on hand balance with a recorded reason.'
            : type === 'STOCK_IN'
              ? 'Receive stock into the selected factory warehouse.'
              : 'Issue stock from the selected factory warehouse.'
        }
      />
      <form className="p2-panel p2-form" onSubmit={submit}>
        {success && <Notice kind="success">{success}</Notice>}
        {submissionError && <Notice>{submissionError}</Notice>}
        {products.error && <Notice>{products.error.message}</Notice>}
        {warehouses.error && <Notice>{warehouses.error.message}</Notice>}
        {factories.isLoading ? (
          <LoadingState label="Loading factory access…" />
        ) : factories.error ? (
          <Notice>{factories.error.message}</Notice>
        ) : factories.data?.length === 1 ? (
          <div className="p2-fixed-scope">
            <WarehouseIcon size={16} />
            <span>
              <b>{factories.data[0].code}</b> · {factories.data[0].name}
            </span>
          </div>
        ) : (
          <FormRow label="Factory" required>
            <select
              className="p2-input"
              required
              value={factoryId}
              onChange={(e) => {
                setFactoryId(e.target.value);
                setWarehouseId('');
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
        <FormRow label="Product" required>
          <SearchableProductSelect
            products={availableProducts}
            value={productId}
            onChange={(nextId) => {
              setProductId(nextId);
              setSubmissionError('');
            }}
            selectedProductFallback={selectedProduct}
            balances={balances.data?.items ?? []}
            placeholder="Select or search product by name, SKU, or category…"
            isLoading={products.isLoading || searchedProducts.isLoading}
            searchQuery={productSearch}
            onSearchQueryChange={setProductSearch}
          />
        </FormRow>
        {warehouses.data && warehouses.data.length > 1 ? (
          <FormRow label="Warehouse">
            <select
              className="p2-input"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">Default warehouse</option>
              {warehouses.data.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {cleanWarehouseName(warehouse.name)}
                  {warehouse.isDefault ? ' · Default' : ''}
                </option>
              ))}
            </select>
          </FormRow>
        ) : (
          <div className="p2-fixed-scope">
            <WarehouseIcon size={16} />
            <span>
              Warehouse:{' '}
              <b>
                {cleanWarehouseName(
                  warehouses.data?.find((w) => w.isDefault)?.name ?? 'Warehouse 1'
                )}
              </b>
            </span>
          </div>
        )}
        {type === 'ADJUSTMENT' && (
          <FormRow label="Adjustment method" required>
            <select
              className="p2-input"
              value={adjustmentMode}
              onChange={(e) => setAdjustmentMode(e.target.value)}
            >
              <option value="SET">Set corrected on hand quantity</option>
              <option value="DELTA">Apply adjustment amount (+ / −)</option>
            </select>
          </FormRow>
        )}
        <FormRow
          label={
            type === 'ADJUSTMENT'
              ? adjustmentMode === 'SET'
                ? 'Corrected quantity'
                : 'Adjustment amount'
              : 'Quantity'
          }
          required
          hint={
            selectedBalance
              ? `Current on hand: ${qty(selectedBalance.quantity, selectedBalance.product.unit)}`
              : undefined
          }
        >
          <input
            className="p2-input"
            type="number"
            required
            min={
              type === 'ADJUSTMENT' && adjustmentMode === 'DELTA'
                ? undefined
                : type === 'ADJUSTMENT'
                  ? 0
                  : 0.001
            }
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormRow>
        {type === 'ADJUSTMENT' && (
          <FormRow label="Adjustment reason" required>
            <input
              className="p2-input"
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why the count is being corrected"
            />
          </FormRow>
        )}
        {type === 'STOCK_OUT' && (
          <FormRow label="Reason" required>
            <input
              className="p2-input"
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Production issue, transfer, damage…"
            />
          </FormRow>
        )}
        <div className="p2-form-grid">
          <FormRow label={type === 'STOCK_IN' ? 'Receipt reference' : 'Reference'}>
            <input
              className="p2-input"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="GRN, issue or count reference"
            />
          </FormRow>
          <FormRow label="Transaction date">
            <input
              className="p2-input"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
            />
          </FormRow>
        </div>
        <FormRow label="Remarks">
          <textarea
            className="p2-input p2-textarea"
            maxLength={1000}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </FormRow>
        <div className="p2-form-footer">
          <Button variant="outline" type="button" onClick={() => navigate('/inventory')}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              products.isLoading ||
              warehouses.isLoading ||
              !!products.error ||
              !!warehouses.error
            }
          >
            {mutation.isPending ? 'Recording…' : `Record ${title.toLowerCase()}`}
          </Button>
        </div>
      </form>
      <ConfirmModal
        open={!!confirmPayload}
        title={type === 'ADJUSTMENT' ? 'Confirm Stock Adjustment' : `Confirm ${title}`}
        subtitle={
          selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : undefined
        }
        message={
          confirmPayload ? (
            type === 'ADJUSTMENT' ? (
              <>
                Record stock adjustment (
                <strong>
                  {adjustmentMode === 'SET' ? 'Set balance to ' : 'Adjust by '}
                  {qty(confirmPayload.quantity, selectedProduct?.unit ?? '')}
                </strong>
                )?
                <br />
                Reason: <strong>{confirmPayload.reason}</strong>
              </>
            ) : (
              <>
                Are you sure you want to record <strong>{title.toLowerCase()}</strong> of{' '}
                <strong>{qty(confirmPayload.quantity, selectedProduct?.unit ?? '')}</strong> for
                the selected product?
              </>
            )
          ) : null
        }
        confirmLabel={`Confirm ${title}`}
        tone={type === 'ADJUSTMENT' || type === 'STOCK_OUT' ? 'warning' : 'primary'}
        icon={type === 'ADJUSTMENT' ? SlidersHorizontal : Package}
        isPending={mutation.isPending}
        error={mutation.error}
        onClose={() => {
          if (!mutation.isPending) setConfirmPayload(null);
        }}
        onConfirm={() => {
          if (confirmPayload) mutation.mutate(confirmPayload);
        }}
      />
    </div>
  );
}
function MovementHistoryPage() {
  const { isAdmin } = useCurrentRole();
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
  });
  const [factoryId, setFactoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const products = useQuery({
    queryKey: ['products', 'movement-filter'],
    queryFn: () =>
      getProducts({
        status: 'ACTIVE',
        page: 1,
        pageSize: 100,
      }),
  });
  const params = useMemo(
    () => ({
      factoryId: isAdmin ? factoryId : undefined,
      productId,
      type,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      page,
      pageSize: 15,
    }),
    [factoryId, from, isAdmin, page, productId, to, type]
  );
  const query = useQuery({
    queryKey: [...movementKey, params],
    queryFn: () => getInventoryMovements(params),
  });
  return (
    <div className="p2-page">
      <BackLink to="/inventory" />
      <PageTitle
        title="Movement history"
        description="Auditable receipts, issues and stock corrections."
        action={
          <Link className="p2-button secondary" to="/inventory">
            <Boxes size={14} /> Inventory overview
          </Link>
        }
      />
      <section className="p2-panel">
        <div className="p2-toolbar">
          <SearchableProductSelect
            compact
            products={products.data?.items ?? []}
            value={productId}
            onChange={(nextId) => {
              setProductId(nextId);
              setPage(1);
            }}
            allOptionLabel="All products"
            placeholder="All products"
            isLoading={products.isLoading}
          />
          <select
            className="p2-select"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All movement types</option>
            <option value="STOCK_IN">Stock in</option>
            <option value="STOCK_OUT">Stock out</option>
            <option value="ADJUSTMENT">Adjustment</option>
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
              {(factories.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          )}
          <label className="p2-date-filter">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="p2-date-filter">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        {query.isLoading ? (
          <LoadingState label="Loading movement history…" />
        ) : query.error ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <MovementTable rows={query.data.items} />
            <Pagination
              page={query.data.page}
              totalPages={query.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No movements found"
            detail="Choose a different filter or record a stock movement."
          />
        )}
      </section>
    </div>
  );
}
function MovementTable({ rows, compact = false }) {
  const { isAdmin } = useCurrentRole();
  return (
    <div className="p2-table-wrap">
      <table className="p2-table">
        <thead>
          <tr>
            <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
            <th>Date</th>
            <th>Movement</th>
            <th>Product</th>
            <th>{isAdmin ? 'Factory / warehouse' : 'Warehouse'}</th>
            <th className="p2-right">Previous</th>
            <th className="p2-right">Quantity</th>
            <th className="p2-right">Result</th>
            <th>Reason / reference</th>
            <th>Created by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={row.id}>
              <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                {String(rIdx + 1).padStart(2, '0')}
              </td>
              <td>{new Date(row.transactionDate).toLocaleDateString('en-GB')}</td>
              <td>
                <MovementType type={row.type} />
              </td>
              <td>
                <b>{row.product.name}</b>
                <small>{row.product.sku}</small>
              </td>
              <td>
                {isAdmin ? (
                  <>
                    <b>{row.factory.code}</b>
                    <small>{cleanWarehouseName(row.warehouse.name)}</small>
                  </>
                ) : (
                  <b>{cleanWarehouseName(row.warehouse.name)}</b>
                )}
              </td>
              <td className="p2-right">{qty(row.previousQuantity, row.product.unit)}</td>
              <td className={`p2-right movement-${row.type.toLowerCase()}`}>
                {row.type === 'STOCK_OUT' ? '−' : row.type === 'STOCK_IN' ? '+' : '±'}
                {qty(row.quantity, row.product.unit)}
              </td>
              <td className="p2-right p2-quantity">
                {qty(row.resultingQuantity, row.product.unit)}
              </td>
              <td>
                {row.reason || row.reference || '—'}
                {row.reference && row.reason && <small>{row.reference}</small>}
              </td>
              <td>{row.createdBy?.name ?? 'Head Office Admin'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compact && rows.length === 0 && (
        <EmptyState title="No movements" detail="No stock changes have been recorded yet." />
      )}
    </div>
  );
}
function MovementType({ type }) {
  const Icon =
    type === 'STOCK_IN'
      ? ArrowDownToLine
      : type === 'STOCK_OUT'
        ? ArrowUpFromLine
        : SlidersHorizontal;
  return (
    <span className={`p2-movement-type ${type.toLowerCase()}`}>
      <Icon size={13} />
      {type === 'STOCK_IN' ? 'Stock in' : type === 'STOCK_OUT' ? 'Stock out' : 'Adjustment'}
    </span>
  );
}
function Metric({ icon, label, value, detail, warning = false }) {
  return (
    <article className={`p2-metric ${warning ? 'warning' : ''}`}>
      <div className="p2-metric-label">
        <span>{label}</span>
        <span className="p2-icon-box">{icon}</span>
      </div>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}
function summaryText(values) {
  return values.length
    ? values
        .map(
          (value) =>
            `${value.quantity.toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })} ${value.unit}`
        )
        .join(' · ')
    : '0';
}
