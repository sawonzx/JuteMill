import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { getDemoUsers } from '../api';
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
  const user = query.data?.find((candidate) => candidate.id === selectedId);
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
