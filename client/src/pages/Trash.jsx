import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import {
  batchDeleteTrashItems,
  batchRestoreTrashItems,
  emptyTrash,
  getFactories,
  getTrashItems,
  permanentDeleteTrashItem,
  restoreTrashItem,
} from '../api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  PageTitle,
  Pagination,
  useDemoRole as useCurrentRole,
} from './shared';
import { Button } from '../components/ui/button';

export default function TrashPage() {
  const { isAdmin, isManager } = useCurrentRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState(searchParams.get('type') || 'ALL');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);

  // Selection state
  const [selectedIds, setSelectedIds] = useState([]);

  // Modals
  const [restoreModalItem, setRestoreModalItem] = useState(null);
  const [permanentDeleteModalItem, setPermanentDeleteModalItem] = useState(null);
  const [emptyTrashModal, setEmptyTrashModal] = useState(false);
  const [batchRestoreModal, setBatchRestoreModal] = useState(false);
  const [batchDeleteModal, setBatchDeleteModal] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(null);

  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });

  const trashQuery = useQuery({
    queryKey: ['trash-items', { q, entityType, factoryId, page }],
    queryFn: () =>
      getTrashItems({
        q,
        type: entityType === 'ALL' ? undefined : entityType,
        factoryId: isAdmin ? factoryId || undefined : undefined,
        page,
        pageSize: 15,
      }),
  });

  const restoreMut = useMutation({
    mutationFn: (id) => restoreTrashItem(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setRestoreModalItem(null);
      setSelectedIds((prev) => prev.filter((id) => id !== restoreModalItem?.id));
      setActionSuccess(data.message || 'Item recovered successfully.');
    },
  });

  const permDeleteMut = useMutation({
    mutationFn: (id) => permanentDeleteTrashItem(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setPermanentDeleteModalItem(null);
      setSelectedIds((prev) => prev.filter((id) => id !== permanentDeleteModalItem?.id));
      setActionSuccess(data.message || 'Item permanently deleted.');
    },
  });

  const emptyMut = useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedIds([]);
      setEmptyTrashModal(false);
      setActionSuccess(data.message || 'Trash emptied successfully.');
    },
  });

  const batchRestoreMut = useMutation({
    mutationFn: () => batchRestoreTrashItems(selectedIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedIds([]);
      setBatchRestoreModal(false);
      setActionSuccess(data.message || 'Selected items recovered successfully.');
    },
  });

  const batchDeleteMut = useMutation({
    mutationFn: () => batchDeleteTrashItems(selectedIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trash-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelectedIds([]);
      setBatchDeleteModal(false);
      setActionSuccess(data.message || 'Selected items permanently deleted.');
    },
  });

  const items = trashQuery.data?.items ?? [];
  const total = trashQuery.data?.total ?? 0;

  // Selection handlers
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const pageIds = items.map((i) => i.id);
  const isAllOnPageSelected =
    items.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const isSomeOnPageSelected =
    items.some((i) => selectedIds.includes(i.id)) && !isAllOnPageSelected;

  const toggleSelectAll = () => {
    if (items.length === 0) return;
    if (isAllOnPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  return (
    <div className="p2-page">
      <PageTitle
        title="Trash Can"
        description="Review deleted items. Select specific items to recover them or permanently delete them."
        action={
          isManager && total > 0 ? (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              onClick={() => setEmptyTrashModal(true)}
            >
              <Trash2 size={14} /> Empty All Trash ({total})
            </Button>
          ) : undefined
        }
      />

      {actionSuccess && (
        <div
          style={{
            padding: '12px 16px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            borderRadius: '6px',
            fontSize: '13.5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={18} />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            style={{ border: 0, background: 'none', cursor: 'pointer', color: '#15803d' }}
          >
            ✕
          </button>
        </div>
      )}

      {restoreMut.error && <Notice kind="error">{restoreMut.error.message}</Notice>}
      {permDeleteMut.error && <Notice kind="error">{permDeleteMut.error.message}</Notice>}
      {emptyMut.error && <Notice kind="error">{emptyMut.error.message}</Notice>}
      {batchRestoreMut.error && <Notice kind="error">{batchRestoreMut.error.message}</Notice>}
      {batchDeleteMut.error && <Notice kind="error">{batchDeleteMut.error.message}</Notice>}

      {/* Floating / Sticky Batch Actions Bar */}
      {selectedIds.length > 0 && (
        <div
          style={{
            background: '#ffffff',
            border: '1.5px solid #10b981',
            borderRadius: '8px',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                background: '#15803d',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '12px',
              }}
            >
              {selectedIds.length}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
              item{selectedIds.length === 1 ? '' : 's'} selected
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {isManager && (
              <>
                <Button
                  size="sm"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white"
                  onClick={() => setBatchRestoreModal(true)}
                >
                  <RotateCcw size={14} /> Recover Selected ({selectedIds.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                  onClick={() => setBatchDeleteModal(true)}
                >
                  <Trash2 size={14} /> Delete Selected Permanently ({selectedIds.length})
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedIds([])}
            >
              Clear Selection
            </Button>
          </div>
        </div>
      )}

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
              placeholder="Search deleted records…"
            />
          </label>

          <select
            className="p2-select"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Deleted Types</option>
            <option value="CUSTOMER">Customers</option>
            <option value="SALES_ORDER">Sales Orders</option>
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

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              <strong>{total}</strong> deleted item{total === 1 ? '' : 's'} in trash
            </span>
          </div>
        </div>

        {trashQuery.isLoading ? (
          <LoadingState label="Loading trash items…" />
        ) : trashQuery.error ? (
          <ErrorState message={trashQuery.error.message} retry={() => void trashQuery.refetch()} />
        ) : items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px', minWidth: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        style={{
                          cursor: 'pointer',
                          width: '16px',
                          height: '16px',
                          accentColor: '#15803d',
                        }}
                        checked={isAllOnPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeOnPageSelected;
                        }}
                        onChange={toggleSelectAll}
                        title={
                          isAllOnPageSelected
                            ? 'Deselect all on this page'
                            : 'Select all on this page'
                        }
                      />
                    </th>
                    <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                    <th>Deleted Item</th>
                    <th style={{ width: '130px' }}>Type</th>
                    {isAdmin && <th style={{ width: '120px' }}>Factory</th>}
                    <th style={{ width: '160px' }}>Deleted On</th>
                    <th className="p2-right" style={{ width: '220px', minWidth: '220px' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const isCust = item.entityType === 'CUSTOMER';
                    const isOrder = item.entityType === 'SALES_ORDER';
                    const serialNumber = String((page - 1) * 15 + index + 1).padStart(2, '0');
                    const isSelected = selectedIds.includes(item.id);

                    return (
                      <tr
                        key={item.id}
                        style={{
                          background: isSelected ? '#f0fdf4' : undefined,
                          transition: 'background 0.15s ease',
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            style={{
                              cursor: 'pointer',
                              width: '16px',
                              height: '16px',
                              accentColor: '#15803d',
                            }}
                            checked={isSelected}
                            onChange={() => toggleSelect(item.id)}
                            title={`Select ${item.title}`}
                          />
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
                            color: '#6b7280',
                            fontWeight: 600,
                            fontSize: '12px',
                          }}
                        >
                          {serialNumber}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: isCust ? '#ecfdf5' : isOrder ? '#eff6ff' : '#f3f4f6',
                                color: isCust ? '#047857' : isOrder ? '#1d4ed8' : '#4b5563',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {isCust ? (
                                <Users size={16} />
                              ) : isOrder ? (
                                <ShoppingCart size={16} />
                              ) : (
                                <Trash2 size={16} />
                              )}
                            </div>
                            <div>
                              <strong style={{ display: 'block', fontSize: '13.5px', color: '#111827' }}>
                                {item.title}
                              </strong>
                              {item.subTitle && (
                                <small style={{ color: '#6b7280', fontSize: '11px' }}>
                                  {item.subTitle}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: isCust ? '#ecfdf5' : isOrder ? '#eff6ff' : '#f3f4f6',
                              color: isCust ? '#047857' : isOrder ? '#1d4ed8' : '#4b5563',
                              border: `1px solid ${isCust ? '#a7f3d0' : isOrder ? '#bfdbfe' : '#e5e7eb'}`,
                            }}
                          >
                            {isCust ? 'Customer' : isOrder ? 'Sales Order' : item.entityType}
                          </span>
                        </td>
                        {isAdmin && (
                          <td>
                            <span className="p2-factory">
                              <Building2 size={13} />
                              {item.factoryId?.slice(-4) || 'HQ'}
                            </span>
                          </td>
                        )}
                        <td style={{ fontSize: '12px', color: '#4b5563' }}>
                          {new Date(item.deletedAt).toLocaleString('en-GB', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="p2-right">
                          {isManager && (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200"
                                onClick={() => setRestoreModalItem(item)}
                                title="Recover item back to active records"
                              >
                                <RotateCcw size={13} /> Recover
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                onClick={() => setPermanentDeleteModalItem(item)}
                                title="Permanently delete forever"
                              >
                                <Trash2 size={13} /> Delete Permanently
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={trashQuery.data.page}
              totalPages={trashQuery.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
              }}
            >
              <Trash2 size={26} />
            </div>
            <strong style={{ fontSize: '16px', color: '#111827' }}>Trash Can is empty</strong>
            <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', maxWidth: '380px' }}>
              {q
                ? 'No deleted items matching your search.'
                : 'Items deleted from Customers or Sales Orders will appear here where you can recover or permanently purge them.'}
            </p>
          </div>
        )}
      </section>

      {/* Recover Single Modal */}
      {restoreModalItem && (
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
            if (e.target === e.currentTarget && !restoreMut.isPending) setRestoreModalItem(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '460px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: '#ecfdf5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#059669',
                  flexShrink: 0,
                }}
              >
                <RotateCcw size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#111827' }}>
                  Recover / Restore Item
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  {restoreModalItem.title}
                </small>
              </div>
            </div>

            <p style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 16px', lineHeight: 1.5 }}>
              Are you sure you want to recover <strong>{restoreModalItem.title}</strong>? It will be restored back to the active records with its associated lines/orders.
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
                onClick={() => setRestoreModalItem(null)}
                disabled={restoreMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
                onClick={() => restoreMut.mutate(restoreModalItem.id)}
                disabled={restoreMut.isPending}
              >
                {restoreMut.isPending ? 'Recovering…' : 'Confirm Recovery'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Permanently Delete Single Item Modal */}
      {permanentDeleteModalItem && (
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
            if (e.target === e.currentTarget && !permDeleteMut.isPending) setPermanentDeleteModalItem(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '460px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#111827' }}>
                  Permanently Delete from Database
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  {permanentDeleteModalItem.title}
                </small>
              </div>
            </div>

            <p
              style={{
                fontSize: '13px',
                color: '#b91c1c',
                margin: '0 0 16px',
                lineHeight: 1.5,
                background: '#fef2f2',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
              }}
            >
              <strong>Critical Warning:</strong> This will completely remove <strong>{permanentDeleteModalItem.title}</strong> from the database. It cannot be recovered again!
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
                onClick={() => setPermanentDeleteModalItem(null)}
                disabled={permDeleteMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => permDeleteMut.mutate(permanentDeleteModalItem.id)}
                disabled={permDeleteMut.isPending}
              >
                {permDeleteMut.isPending ? 'Deleting…' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Recover Selected Modal */}
      {batchRestoreModal && (
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
            if (e.target === e.currentTarget && !batchRestoreMut.isPending) setBatchRestoreModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '480px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: '#ecfdf5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#059669',
                  flexShrink: 0,
                }}
              >
                <RotateCcw size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#111827' }}>
                  Recover Selected Items ({selectedIds.length})
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  Batch recovery operation
                </small>
              </div>
            </div>

            <p style={{ fontSize: '13.5px', color: '#4b5563', margin: '0 0 16px', lineHeight: 1.5 }}>
              Are you sure you want to recover <strong>{selectedIds.length}</strong> selected item{selectedIds.length === 1 ? '' : 's'}? They will be restored back into active records.
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
                onClick={() => setBatchRestoreModal(false)}
                disabled={batchRestoreMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
                onClick={() => batchRestoreMut.mutate()}
                disabled={batchRestoreMut.isPending}
              >
                {batchRestoreMut.isPending ? 'Recovering…' : `Confirm Recover (${selectedIds.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Permanently Delete Selected Modal */}
      {batchDeleteModal && (
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
            if (e.target === e.currentTarget && !batchDeleteMut.isPending) setBatchDeleteModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '480px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#111827' }}>
                  Permanently Delete Selected ({selectedIds.length})
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  Irreversible permanent purge
                </small>
              </div>
            </div>

            <p
              style={{
                fontSize: '13px',
                color: '#b91c1c',
                margin: '0 0 16px',
                lineHeight: 1.5,
                background: '#fef2f2',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
              }}
            >
              <strong>Critical Warning:</strong> You are about to permanently delete <strong>{selectedIds.length}</strong> selected item{selectedIds.length === 1 ? '' : 's'} from the database. This action CANNOT be recovered or undone.
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
                onClick={() => setBatchDeleteModal(false)}
                disabled={batchDeleteMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => batchDeleteMut.mutate()}
                disabled={batchDeleteMut.isPending}
              >
                {batchDeleteMut.isPending ? 'Deleting…' : `Permanently Delete (${selectedIds.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Empty Trash Modal */}
      {emptyTrashModal && (
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
            if (e.target === e.currentTarget && !emptyMut.isPending) setEmptyTrashModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '10px',
              padding: '24px',
              width: '460px',
              maxWidth: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: '#fef2f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#dc2626',
                  flexShrink: 0,
                }}
              >
                <XCircle size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', color: '#111827' }}>
                  Empty Entire Trash Can
                </h3>
                <small style={{ color: '#6b7280', fontSize: '12px' }}>
                  {total} item(s) will be permanently deleted
                </small>
              </div>
            </div>

            <p
              style={{
                fontSize: '13px',
                color: '#b91c1c',
                margin: '0 0 16px',
                lineHeight: 1.5,
                background: '#fef2f2',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid #fecaca',
              }}
            >
              Warning: This will permanently wipe all {total} item(s) from the trash. None of these items can ever be restored.
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
                onClick={() => setEmptyTrashModal(false)}
                disabled={emptyMut.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => emptyMut.mutate()}
                disabled={emptyMut.isPending}
              >
                {emptyMut.isPending ? 'Emptying…' : 'Confirm Empty Trash'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
