import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { getDemoUsers } from '../api';
import { Button } from '../components/ui/button';
function getStoredUserId() {
  return typeof window === 'undefined' ? '' : (localStorage.getItem('jute-demo-user-id') ?? '');
}
export function useDemoRole() {
  const query = useQuery({
    queryKey: ['demo-users'],
    queryFn: getDemoUsers,
  });
  const [selectedId, setSelectedId] = useState(getStoredUserId);
  useEffect(() => {
    const handler = () => setSelectedId(getStoredUserId());
    window.addEventListener('demo-user-changed', handler);
    return () => window.removeEventListener('demo-user-changed', handler);
  }, []);

  const users = query.data ?? [];
  const matchedUser = users.find((candidate) => candidate.id === selectedId);
  const fallbackUser =
    users.find((u) => u.role === 'HEAD_OFFICE_ADMIN') ||
    users.find((u) => u.role === 'FACTORY_MANAGER') ||
    users[0];

  const user = matchedUser || fallbackUser;

  // Auto-heal missing or stale localStorage ID
  useEffect(() => {
    if (users.length && (!matchedUser || !selectedId) && fallbackUser) {
      setSelectedId(fallbackUser.id);
      localStorage.setItem('jute-demo-user-id', fallbackUser.id);
      window.dispatchEvent(new Event('demo-user-changed'));
    }
  }, [users, matchedUser, selectedId, fallbackUser]);

  return {
    user,
    loading: query.isLoading,
    isAdmin: user?.role === 'HEAD_OFFICE_ADMIN',
    isManager: user?.role === 'HEAD_OFFICE_ADMIN' || user?.role === 'FACTORY_MANAGER',
  };
}
export function PageTitle({ title, description, action }) {
  return (
    <div className="p2-title-row">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="p2-title-action">{action}</div>}
    </div>
  );
}
export function Notice({ kind = 'error', children }) {
  const Icon = kind === 'error' ? AlertTriangle : CheckCircle2;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`p2-notice notice-${kind}`}>
      <Icon size={16} />
      {children}
    </div>
  );
}
export function LoadingState({ label = 'Loading records…' }) {
  return (
    <div className="p2-loading">
      <LoaderCircle className="p2-spin" size={19} />
      {label}
    </div>
  );
}
export function ErrorState({ message, retry }) {
  return (
    <div className="p2-error">
      <AlertTriangle size={18} />
      <span>{message}</span>
      {retry && (
        <button className="p2-button secondary" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
export function EmptyState({ title, detail }) {
  return (
    <div className="p2-empty">
      <span className="p2-empty-symbol">—</span>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}
export function StatusLabel({ status }) {
  return (
    <span className={`p2-status ${status.toLowerCase()}`}>
      <i />
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </span>
  );
}
export function TypeLabel({ type }) {
  return (
    <span className={`p2-type ${type.toLowerCase()}`}>
      {type === 'RAW_MATERIAL'
        ? 'Raw material'
        : type === 'FINISHED_PRODUCT'
          ? 'Finished product'
          : type}
    </span>
  );
}
export function Pagination({ page, totalPages, onPage }) {
  return (
    <div className="p2-pagination">
      <span>
        Page {page} of {Math.max(1, totalPages)}
      </span>
      <div>
        <button
          className="p2-button secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={14} /> Previous
        </button>
        <button
          className="p2-button secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
export function BackLink({ to, children = 'Back to list' }) {
  return (
    <Link className="p2-backlink" to={to}>
      <ArrowLeft size={14} />
      {children}
    </Link>
  );
}
export function FormRow({ label, required, hint, children }) {
  return (
    <label className="p2-field">
      <span>
        {label}
        {required && <i> *</i>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function InvertedInfoIcon({ size = 18, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`p2-inverted-info ${className}`}
      style={{ verticalAlign: 'middle', display: 'inline-block' }}
    >
      <circle cx="12" cy="12" r="10" fill="#15803d" className="info-circle" />
      <line x1="12" y1="16" x2="12" y2="12" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.2" fill="#ffffff" />
    </svg>
  );
}
export function ConfirmModal({
  open,
  title,
  subtitle,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  icon: CustomIcon,
  isPending = false,
  error,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isPending, onClose]);

  if (!open) return null;

  const palette =
    tone === 'danger'
      ? {
          bg: '#fef2f2',
          color: '#b91c1c',
          buttonClass: 'bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700 text-white',
          Icon: CustomIcon || AlertTriangle,
        }
      : tone === 'warning'
        ? {
            bg: '#fffbeb',
            color: '#b45309',
            buttonClass:
              'bg-amber-600 hover:bg-amber-700 border-amber-600 hover:border-amber-700 text-white',
            Icon: CustomIcon || AlertTriangle,
          }
        : {
            bg: '#ecfdf5',
            color: '#15803d',
            buttonClass:
              'bg-emerald-700 hover:bg-emerald-800 border-emerald-700 hover:border-emerald-800 text-white',
            Icon: CustomIcon || CheckCircle2,
          };
  const { Icon } = palette;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="erp-confirm-modal-title"
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
              background: palette.bg,
              color: palette.color,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={18} />
          </div>
          <div>
            <h3
              id="erp-confirm-modal-title"
              style={{ margin: 0, fontSize: '17px', color: '#111827', fontWeight: 700 }}
            >
              {title}
            </h3>
            {subtitle && <span style={{ fontSize: '12px', color: '#6b7280' }}>{subtitle}</span>}
          </div>
        </div>
        {error && (
          <div style={{ marginBottom: '12px' }}>
            <Notice>{typeof error === 'string' ? error : error.message}</Notice>
          </div>
        )}
        <div style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 18px', lineHeight: 1.55 }}>
          {message}
        </div>
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
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={palette.buttonClass}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
export function SearchableProductSelect({
  products = [],
  value = '',
  onChange,
  selectedProductFallback = null,
  balances = [],
  placeholder = 'Select active product',
  allOptionLabel = '',
  isLoading = false,
  searchQuery,
  onSearchQueryChange,
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [internalQuery, setInternalQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  const query = searchQuery !== undefined ? searchQuery : internalQuery;
  const setQuery = onSearchQueryChange || setInternalQuery;

  const balanceByProduct = useMemo(() => {
    const map = new Map();
    for (const b of balances) {
      if (b?.product?.id) {
        map.set(b.product.id, Number(b.quantity ?? 0));
      }
    }
    return map;
  }, [balances]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === value) || (value ? selectedProductFallback : null),
    [products, value, selectedProductFallback]
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.sku, p.name, p.category, p.unit, p.type]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    );
  }, [products, query]);

  const options = useMemo(() => {
    const list = [];
    if (allOptionLabel && !query.trim()) {
      list.push({ isAllOption: true, id: '', label: allOptionLabel });
    }
    for (const p of filteredProducts) {
      list.push({ isAllOption: false, id: p.id, product: p });
    }
    return list;
  }, [allOptionLabel, filteredProducts, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlightedIndex(0);
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlightedIndex];
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, open]);

  const selectOption = (id) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((idx) => (options.length ? (idx + 1) % options.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((idx) =>
        options.length ? (idx - 1 + options.length) % options.length : 0
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = options[highlightedIndex];
      if (picked) selectOption(picked.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const triggerText = selectedProduct
    ? `${selectedProduct.sku} · ${selectedProduct.name} (${selectedProduct.unit})`
    : value === '' && allOptionLabel
      ? allOptionLabel
      : placeholder;

  const isPlaceholder = !selectedProduct && !allOptionLabel;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: compact ? 'auto' : '100%',
        minWidth: compact ? '230px' : undefined,
        maxWidth: compact ? '280px' : undefined,
      }}
      onClick={(e) => {
        if (e.target instanceof HTMLElement && e.target.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            setOpen((curr) => !curr);
          }}
          className={compact ? 'p2-select' : 'p2-input'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            textAlign: 'left',
            cursor: 'pointer',
            width: '100%',
            paddingRight: value ? '52px' : '30px',
            color: isPlaceholder ? '#86948a' : '#24352a',
            fontWeight: isPlaceholder ? 400 : 500,
            background: '#fff',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {triggerText}
          </span>
        </button>

        {value && (
          <button
            type="button"
            title="Clear product selection"
            aria-label="Clear product selection"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
            }}
            style={{
              position: 'absolute',
              right: '26px',
              background: 'transparent',
              border: 0,
              padding: '4px',
              color: '#86948a',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}

        <ChevronDown
          size={15}
          style={{
            position: 'absolute',
            right: '10px',
            color: '#6b7970',
            pointerEvents: 'none',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </div>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: compact ? undefined : 0,
            minWidth: compact ? '310px' : '100%',
            background: '#fff',
            border: '1px solid #d4ded7',
            borderRadius: '8px',
            boxShadow: '0 12px 28px -6px rgba(18, 38, 28, 0.16)',
            zIndex: 70,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px',
              borderBottom: '1px solid #edf2ee',
              background: '#f9fbf9',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Search size={15} style={{ color: '#6b7970', flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by product name, SKU, or category…"
              style={{
                flex: 1,
                border: 0,
                outline: 'none',
                background: 'transparent',
                fontSize: '13px',
                color: '#1f2d24',
                minWidth: 0,
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: '2px',
                  color: '#86948a',
                  cursor: 'pointer',
                  display: 'inline-flex',
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div
            ref={listRef}
            style={{
              maxHeight: '250px',
              overflowY: 'auto',
              padding: '4px',
            }}
          >
            {isLoading && options.length === 0 ? (
              <div
                style={{
                  padding: '14px 12px',
                  fontSize: '12.5px',
                  color: '#6b7970',
                  textAlign: 'center',
                }}
              >
                Searching products…
              </div>
            ) : options.length === 0 ? (
              <div
                style={{
                  padding: '14px 12px',
                  fontSize: '12.5px',
                  color: '#6b7970',
                  textAlign: 'center',
                }}
              >
                No products match &ldquo;{query}&rdquo;
              </div>
            ) : (
              options.map((opt, idx) => {
                const active = opt.id === value;
                const highlighted = idx === highlightedIndex;
                if (opt.isAllOption) {
                  return (
                    <button
                      key="__all__"
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={(e) => {
                        e.preventDefault();
                        selectOption('');
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 0,
                        borderRadius: '5px',
                        padding: '8px 10px',
                        background: active
                          ? '#e9f4ec'
                          : highlighted
                            ? '#f3f7f4'
                            : 'transparent',
                        color: active ? '#185038' : '#24352a',
                        fontWeight: active ? 700 : 500,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                }

                const p = opt.product;
                const bal = balanceByProduct.get(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={(e) => {
                      e.preventDefault();
                      selectOption(p.id);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      borderRadius: '5px',
                      padding: '8px 10px',
                      background: active
                        ? '#e9f4ec'
                        : highlighted
                          ? '#f3f7f4'
                          : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: active ? 700 : 600,
                          color: active ? '#185038' : '#1f2d24',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: '#466151',
                            background: '#edf3ef',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            marginRight: '7px',
                          }}
                        >
                          {p.sku}
                        </span>
                        {p.name}
                      </span>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color: bal !== undefined ? '#1e5b41' : '#738278',
                          flexShrink: 0,
                        }}
                      >
                        {bal !== undefined
                          ? `${bal.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${p.unit}`
                          : p.unit}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#76847b',
                      }}
                    >
                      {p.category} · {p.type === 'RAW_MATERIAL' ? 'Raw material' : 'Finished product'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
