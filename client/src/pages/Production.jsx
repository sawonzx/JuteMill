import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Factory,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  completeProductionBatch,
  createProductionBatch,
  getFactories,
  getProductionBatches,
  getProducts,
} from '../api';
import {
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
export default function ProductionPage() {
  const { isAdmin, isManager } = useCurrentRole();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [completeBatchTarget, setCompleteBatchTarget] = useState(null);
  const factoriesQuery = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const batchesQuery = useQuery({
    queryKey: [
      'production-batches',
      {
        q,
        status,
        factoryId,
        page,
      },
    ],
    queryFn: () =>
      getProductionBatches({
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
        title="Production Management"
        description="Jute spinning, weaving, batch processing, and atomic material conversion."
        action={
          isManager ? (
            <Button
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus size={15} /> New Production Batch
            </Button>
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
              placeholder="Search batch # or product…"
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
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
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

        {batchesQuery.isLoading ? (
          <LoadingState label="Loading production batches…" />
        ) : batchesQuery.error ? (
          <ErrorState
            message={batchesQuery.error.message}
            retry={() => void batchesQuery.refetch()}
          />
        ) : batchesQuery.data?.items.length ? (
          <>
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th>Batch #</th>
                    {isAdmin && <th>Factory</th>}
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th>Raw Consumed</th>
                    <th>Finished Yield</th>
                    <th>Supervisor</th>
                    <th className="p2-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batchesQuery.data.items.map((batch) => {
                    const factoryCode = batch.factory?.code ?? batch.factoryCode ?? 'F';
                    const rawUnit = batch.rawMaterial?.unit ?? 'kg';
                    const rawName = batch.rawMaterial?.name ?? 'Raw Jute';
                    const finUnit = batch.finishedProduct?.unit ?? 'MT';
                    const finName = batch.finishedProduct?.name ?? 'Finished Product';
                    const supervisorName =
                      batch.supervisor?.name ?? batch.createdBy?.name ?? 'Supervisor';
                    const batchNotes = batch.notes || batch.remarks;
                    const dateStr = (() => {
                      const d = batch.scheduledDate || batch.productionDate || batch.createdAt;
                      if (!d) return '—';
                      const parsed = new Date(d);
                      return isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-GB');
                    })();
                    const yieldQty =
                      batch.status === 'COMPLETED'
                        ? (batch.actualQuantity ??
                          batch.plannedQuantity ??
                          batch.finishedQuantity ??
                          '—')
                        : (batch.plannedQuantity ?? batch.finishedQuantity ?? '—');
                    const yieldSuffix = batch.status === 'COMPLETED' ? '' : ' (est)';
                    return (
                      <tr key={batch.id}>
                        <td>
                          <strong>{batch.batchNumber}</strong>
                          {batchNotes && <small className="p2-subtext">{batchNotes}</small>}
                        </td>
                        {isAdmin && (
                          <td>
                            <span className="p2-factory">
                              <Building2 size={13} />
                              {factoryCode}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={`p2-badge ${(batch.status || '').toLowerCase()}`}>
                            <i />
                            {(batch.status || '').replace('_', ' ')}
                          </span>
                        </td>
                        <td>{dateStr}</td>
                        <td>
                          <strong>
                            {batch.rawMaterialQuantity} {rawUnit}
                          </strong>
                          <small className="p2-subtext">{rawName}</small>
                        </td>
                        <td>
                          <strong>
                            {yieldQty} {finUnit}
                            {yieldSuffix}
                          </strong>
                          <small className="p2-subtext">{finName}</small>
                        </td>
                        <td>{supervisorName}</td>
                        <td className="p2-right">
                          {isManager &&
                          (batch.status === 'DRAFT' || batch.status === 'IN_PROGRESS') ? (
                            <Button
                              variant="outline"
                              className="bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 py-1 px-2.5 text-xs"
                              onClick={() => setCompleteBatchTarget(batch)}
                            >
                              <CheckCircle2 size={14} /> Complete & Convert Stock
                            </Button>
                          ) : batch.status === 'COMPLETED' ? (
                            <span
                              style={{
                                fontSize: '12px',
                                color: '#2a7c49',
                                fontWeight: 600,
                              }}
                            >
                              Stock Converted ✓
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '12px',
                                color: '#88948c',
                              }}
                            >
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={batchesQuery.data.page}
              totalPages={batchesQuery.data.totalPages}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="No production batches found"
            detail="Schedule manufacturing batches to process raw jute into finished jute goods."
          />
        )}
      </section>

      {isCreateOpen && <CreateBatchModal onClose={() => setIsCreateOpen(false)} />}
      {completeBatchTarget && (
        <CompleteBatchModal
          batch={completeBatchTarget}
          onClose={() => setCompleteBatchTarget(null)}
        />
      )}
    </div>
  );
}
function CreateBatchModal({ onClose }) {
  const { isAdmin, user } = useCurrentRole();
  const client = useQueryClient();
  const factories = useQuery({
    queryKey: ['factories'],
    queryFn: getFactories,
    enabled: isAdmin,
  });
  const [factoryId, setFactoryId] = useState(user?.factory?.id ?? '');
  const effectiveFactoryId = isAdmin ? factoryId || factories.data?.[0]?.id : user?.factory?.id;
  const productsQuery = useQuery({
    queryKey: ['products-all'],
    queryFn: () =>
      getProducts({
        status: 'ACTIVE',
        pageSize: 100,
      }),
  });
  const rawProducts = (productsQuery.data?.items ?? []).filter((p) => p.type === 'RAW_MATERIAL');
  const finishedProducts = (productsQuery.data?.items ?? []).filter(
    (p) => p.type === 'FINISHED_PRODUCT'
  );
  const [rawMaterialId, setRawMaterialId] = useState('');
  const [rawMaterialQty, setRawMaterialQty] = useState('1000');
  const [finishedProductId, setFinishedProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState('0.85');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const selectedRaw = rawProducts.find((p) => p.id === rawMaterialId);
  const selectedFinished = finishedProducts.find((p) => p.id === finishedProductId);
  const createMut = useMutation({
    mutationFn: (data) => createProductionBatch(data),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['production-batches'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!rawMaterialId || !finishedProductId) {
      setErrorMsg('Please select both raw input material and finished product output.');
      return;
    }
    createMut.mutate({
      factoryId: effectiveFactoryId,
      rawMaterialId,
      rawMaterialQuantity: Number(rawMaterialQty),
      finishedProductId,
      plannedQuantity: Number(plannedQty),
      notes: notes || undefined,
    });
  };
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 28, 20, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '28px 32px',
          width: '740px',
          maxWidth: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 24px 48px -12px rgba(16, 42, 28, 0.25)',
          border: '1px solid #dfe6e2',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '20px',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '11px',
                color: '#277047',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              MANUFACTURING WORKFLOW
            </span>
            <h2
              style={{
                margin: '4px 0 4px',
                fontSize: '20px',
                fontWeight: 700,
                color: '#1a2e22',
              }}
            >
              New Production Batch
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: '#5a6b61',
              }}
            >
              Define raw material consumption and target output yield for mill processing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#68786f',
              padding: '6px',
              borderRadius: '6px',
            }}
            title="Close"
          >
            <X size={19} />
          </button>
        </div>

        {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

        <form onSubmit={handleSubmit}>
          {isAdmin && (
            <div
              style={{
                marginBottom: '16px',
              }}
            >
              <FormRow label="Factory Assignment" required>
                <select
                  className="p2-select"
                  style={{
                    height: '38px',
                    fontWeight: 600,
                  }}
                  value={factoryId}
                  onChange={(e) => setFactoryId(e.target.value)}
                >
                  {(factories.data ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} · {f.name} ({f.location})
                    </option>
                  ))}
                </select>
              </FormRow>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginTop: '6px',
            }}
          >
            <div
              style={{
                background: '#f8faf9',
                padding: '18px',
                borderRadius: '8px',
                border: '1px solid #e1e7e3',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#277047',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  1
                </span>
                <strong
                  style={{
                    fontSize: '13.5px',
                    color: '#1f3427',
                  }}
                >
                  Raw Material Input
                </strong>
              </div>
              <FormRow label="Raw Material" required>
                <select
                  className="p2-select"
                  style={{
                    height: '38px',
                  }}
                  value={rawMaterialId}
                  onChange={(e) => setRawMaterialId(e.target.value)}
                  required
                >
                  <option value="">Select raw jute or yarn input…</option>
                  {rawProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label={`Input Quantity (${selectedRaw?.unit ?? 'units'})`} required>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="p2-input"
                  style={{
                    height: '38px',
                    fontSize: '14px',
                  }}
                  value={rawMaterialQty}
                  onChange={(e) => setRawMaterialQty(e.target.value)}
                  required
                  placeholder="e.g. 1000"
                />
              </FormRow>
            </div>

            <div
              style={{
                background: '#f8faf9',
                padding: '18px',
                borderRadius: '8px',
                border: '1px solid #e1e7e3',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: '#277047',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  2
                </span>
                <strong
                  style={{
                    fontSize: '13.5px',
                    color: '#1f3427',
                  }}
                >
                  Target Finished Output
                </strong>
              </div>
              <FormRow label="Finished Product" required>
                <select
                  className="p2-select"
                  style={{
                    height: '38px',
                  }}
                  value={finishedProductId}
                  onChange={(e) => setFinishedProductId(e.target.value)}
                  required
                >
                  <option value="">Select finished manufactured good…</option>
                  {finishedProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unit})
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow
                label={`Target Yield Quantity (${selectedFinished?.unit ?? 'units'})`}
                required
              >
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="p2-input"
                  style={{
                    height: '38px',
                    fontSize: '14px',
                  }}
                  value={plannedQty}
                  onChange={(e) => setPlannedQty(e.target.value)}
                  required
                  placeholder="e.g. 0.85"
                />
              </FormRow>
            </div>
          </div>

          {selectedRaw && selectedFinished && (
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                background: '#eef6f1',
                border: '1px solid #cce3d4',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '13px',
                color: '#1a442a',
              }}
            >
              <div>
                <span
                  style={{
                    color: '#4d6957',
                    fontSize: '12px',
                  }}
                >
                  Input Consumption:
                </span>{' '}
                <strong>
                  {rawMaterialQty || 0} {selectedRaw.unit}
                </strong>{' '}
                of {selectedRaw.name}
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: '#277047',
                  fontWeight: 700,
                  padding: '0 10px',
                }}
              >
                ➔
              </div>
              <div>
                <span
                  style={{
                    color: '#4d6957',
                    fontSize: '12px',
                  }}
                >
                  Manufactured Yield:
                </span>{' '}
                <strong>
                  {plannedQty || 0} {selectedFinished.unit}
                </strong>{' '}
                of {selectedFinished.name}
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: '16px',
            }}
          >
            <FormRow label="Shift & Production Line Details">
              <input
                type="text"
                className="p2-input"
                style={{
                  height: '38px',
                }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Day Shift Line 2 · Weaving Loom Section · Supervisor: Kamal"
              />
            </FormRow>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid #e7ede9',
            }}
          >
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              style={{
                padding: '8px 22px',
                fontWeight: 600,
              }}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Scheduling Batch…' : 'Schedule Production Batch'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function CompleteBatchModal({ batch, onClose }) {
  const client = useQueryClient();
  const initialQty = batch.actualQuantity ?? batch.plannedQuantity ?? batch.finishedQuantity ?? 1;
  const [actualQty, setActualQty] = useState(String(initialQty));
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const rawUnit = batch.rawMaterial?.unit ?? 'kg';
  const rawName = batch.rawMaterial?.name ?? 'Raw Jute';
  const finUnit = batch.finishedProduct?.unit ?? 'MT';
  const completeMut = useMutation({
    mutationFn: () =>
      completeProductionBatch(batch.id, {
        actualQuantity: Number(actualQty),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['production-batches'],
      });
      void client.invalidateQueries({
        queryKey: ['inventory'],
      });
      void client.invalidateQueries({
        queryKey: ['dashboard'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 28, 20, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '28px 32px',
          width: '580px',
          maxWidth: '100%',
          boxShadow: '0 24px 48px -12px rgba(16, 42, 28, 0.25)',
          border: '1px solid #dfe6e2',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '14px',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '11px',
                color: '#277047',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              BATCH FINALIZATION
            </span>
            <h3
              style={{
                margin: '4px 0 4px',
                fontSize: '19px',
                color: '#1a2e22',
                fontWeight: 700,
              }}
            >
              Complete Batch {batch.batchNumber}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#68786f',
              padding: '6px',
              borderRadius: '6px',
            }}
            title="Close"
          >
            <X size={19} />
          </button>
        </div>

        <p
          style={{
            fontSize: '13px',
            color: '#56665d',
            marginBottom: '16px',
            lineHeight: '1.5',
          }}
        >
          Completing this batch will deduct{' '}
          <strong>
            {batch.rawMaterialQuantity} {rawUnit} of {rawName}
          </strong>{' '}
          from raw warehouse and deposit manufactured output into warehouse stock.
        </p>

        {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

        <FormRow label={`Actual Finished Yield Produced (${finUnit})`} required>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="p2-input"
            style={{
              height: '38px',
              fontSize: '14px',
            }}
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            required
          />
        </FormRow>

        <FormRow label="Completion Remarks / Quality Inspection">
          <input
            type="text"
            className="p2-input"
            style={{
              height: '38px',
            }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Quality verified · Export grade standard"
          />
        </FormRow>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '22px',
            paddingTop: '16px',
            borderTop: '1px solid #e7ede9',
          }}
        >
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-emerald-800 hover:bg-emerald-900 text-white"
            style={{
              padding: '8px 20px',
              fontWeight: 600,
            }}
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
          >
            {completeMut.isPending ? 'Converting Stock…' : 'Confirm & Convert Stock'}
          </Button>
        </div>
      </div>
    </div>
  );
}
