import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronDown,
  Edit,
  History,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  createAdminUser,
  deleteAdminUser,
  getAdminFactories,
  getAdminUsers,
  getAuditLogs,
  getCompanyProfile,
  updateAdminFactory,
  updateAdminUser,
  updateAdminUserStatus,
  updateCompanyProfile,
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
export default function AdminPage() {
  const { isAdmin } = useCurrentRole();
  const [activeTab, setActiveTab] = useState('users');
  if (!isAdmin) {
    return (
      <div className="p2-page">
        <PageTitle
          title="Access Restricted"
          description="Administration controls are reserved for Head Office Super Administrators."
        />
        <div
          className="p2-panel"
          style={{
            padding: '30px',
            textAlign: 'center',
          }}
        >
          <ShieldAlert
            size={40}
            style={{
              color: '#b2352c',
              margin: '0 auto 12px',
            }}
          />
          <h3>Super Admin Permissions Required</h3>
          <p
            style={{
              color: '#68776f',
              maxWidth: '400px',
              margin: '8px auto 0',
            }}
          >
            Please switch to the Head Office Admin persona using the top-right demo identity
            switcher to manage users, factory settings, and review system audit logs.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p2-page">
      <PageTitle
        title="Administration & Governance"
        description="Head Office user management, branch factory configuration, company profile, and audit logs."
      />

      <div className="p2-panel">
        <div className="p2-tab-nav">
          <button
            className={`p2-tab-button ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={15} /> User Management
          </button>
          <button
            className={`p2-tab-button ${activeTab === 'factories' ? 'active' : ''}`}
            onClick={() => setActiveTab('factories')}
          >
            <Building2 size={15} /> Mill Factories
          </button>
          <button
            className={`p2-tab-button ${activeTab === 'company' ? 'active' : ''}`}
            onClick={() => setActiveTab('company')}
          >
            <Settings size={15} /> Company Profile
          </button>
          <button
            className={`p2-tab-button ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <History size={15} /> Audit Logs
          </button>
        </div>

        <div
          style={{
            padding: '20px',
          }}
        >
          {activeTab === 'users' && <UsersManagementView />}
          {activeTab === 'factories' && <FactoriesView />}
          {activeTab === 'company' && <CompanyProfileView />}
          {activeTab === 'audit' && <AuditLogsView />}
        </div>
      </div>
    </div>
  );
}
function UsersManagementView() {
  const client = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
  });
  const toggleUserActive = useMutation({
    mutationFn: ({ id, active }) => updateAdminUserStatus(id, active),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['admin-users'],
      });
      void client.invalidateQueries({
        queryKey: ['demo-users'],
      });
      void client.invalidateQueries({
        queryKey: ['audit-logs'],
      });
    },
  });
  const deleteUserMutation = useMutation({
    mutationFn: (id) => deleteAdminUser(id),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['admin-users'],
      });
      void client.invalidateQueries({
        queryKey: ['demo-users'],
      });
      void client.invalidateQueries({
        queryKey: ['audit-logs'],
      });
    },
  });
  const handleDelete = (u) => {
    if (
      window.confirm(
        `Are you sure you want to permanently delete user "${u.name}" (${u.email})? This action cannot be undone.`
      )
    ) {
      deleteUserMutation.mutate(u.id);
    }
  };
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <strong
          style={{
            fontSize: '14px',
            color: '#27382f',
          }}
        >
          Registered ERP Accounts & Factory Assignments
        </strong>
        <Button
          className="bg-emerald-800 hover:bg-emerald-900 text-white"
          onClick={() => setIsModalOpen(true)}
        >
          <UserPlus size={15} /> Add New User
        </Button>
      </div>

      {toggleUserActive.error && <Notice kind="error">{toggleUserActive.error.message}</Notice>}
      {deleteUserMutation.error && <Notice kind="error">{deleteUserMutation.error.message}</Notice>}

      {usersQuery.isLoading ? (
        <LoadingState label="Loading users…" />
      ) : usersQuery.error ? (
        <ErrorState message={usersQuery.error.message} retry={() => void usersQuery.refetch()} />
      ) : (
        <div className="p2-table-wrap">
          <table className="p2-table">
            <thead>
              <tr>
                <th>User / Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Factory Scope</th>
                <th>Status</th>
                <th
                  className="p2-right"
                  style={{
                    width: '130px',
                    minWidth: '130px',
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <span className="p2-badge confirmed">{u.role.replace(/_/g, ' ')}</span>
                  </td>
                  <td>
                    {u.role === 'HEAD_OFFICE_ADMIN' ? (
                      <span
                        style={{
                          color: '#1f683e',
                          fontWeight: 600,
                        }}
                      >
                        All Factories (Consolidated)
                      </span>
                    ) : (
                      <span>{u.factory?.name ?? '—'}</span>
                    )}
                  </td>
                  <td>
                    <span className={`p2-badge ${u.active ? 'fulfilled' : 'cancelled'}`}>
                      <i />
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td
                    className="p2-right"
                    style={{
                      width: '130px',
                      minWidth: '130px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {u.role !== 'HEAD_OFFICE_ADMIN' ? (
                      u.active ? (
                        <Button
                          variant="outline"
                          className="py-1 px-2.5 text-xs"
                          style={{
                            minWidth: '92px',
                            justifyContent: 'center',
                          }}
                          disabled={
                            toggleUserActive.isPending && toggleUserActive.variables?.id === u.id
                          }
                          onClick={() =>
                            toggleUserActive.mutate({
                              id: u.id,
                              active: false,
                            })
                          }
                        >
                          {toggleUserActive.isPending && toggleUserActive.variables?.id === u.id
                            ? 'Updating…'
                            : 'Deactivate'}
                        </Button>
                      ) : (
                        <div
                          style={{
                            position: 'relative',
                            display: 'inline-block',
                          }}
                        >
                          <Button
                            variant="outline"
                            className="py-1 px-2.5 text-xs"
                            style={{
                              minWidth: '92px',
                              justifyContent: 'space-between',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            disabled={toggleUserActive.isPending || deleteUserMutation.isPending}
                            onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                          >
                            <span>Options</span>
                            <ChevronDown
                              size={13}
                              style={{
                                marginLeft: '4px',
                                opacity: 0.7,
                              }}
                            />
                          </Button>

                          {openMenuId === u.id && (
                            <>
                              <div
                                style={{
                                  position: 'fixed',
                                  inset: 0,
                                  zIndex: 100,
                                }}
                                onClick={() => setOpenMenuId(null)}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  right: 0,
                                  top: 'calc(100% + 4px)',
                                  background: '#ffffff',
                                  borderRadius: '6px',
                                  boxShadow:
                                    '0 4px 18px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08)',
                                  border: '1px solid #dce2de',
                                  zIndex: 101,
                                  minWidth: '155px',
                                  padding: '4px 0',
                                  textAlign: 'left',
                                }}
                              >
                                <button
                                  type="button"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '12.5px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    color: '#1f683e',
                                    textAlign: 'left',
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.backgroundColor = '#f2f6f3')
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.backgroundColor = 'transparent')
                                  }
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    toggleUserActive.mutate({
                                      id: u.id,
                                      active: true,
                                    });
                                  }}
                                >
                                  <Check size={14} />
                                  <span>Activate Account</span>
                                </button>
                                <div
                                  style={{
                                    height: '1px',
                                    background: '#edf1ee',
                                    margin: '3px 0',
                                  }}
                                />
                                <button
                                  type="button"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '12.5px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    color: '#b3261e',
                                    textAlign: 'left',
                                  }}
                                  onMouseEnter={(e) =>
                                    (e.currentTarget.style.backgroundColor = '#fdf2f2')
                                  }
                                  onMouseLeave={(e) =>
                                    (e.currentTarget.style.backgroundColor = 'transparent')
                                  }
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleDelete(u);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete User</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    ) : (
                      <span
                        className="p2-subtext"
                        style={{
                          fontSize: '12px',
                        }}
                      >
                        Protected
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && <CreateUserModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
function CreateUserModal({ onClose }) {
  const client = useQueryClient();
  const factoriesQuery = useQuery({
    queryKey: ['admin-factories'],
    queryFn: getAdminFactories,
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [role, setRole] = useState('STAFF');
  const [factoryId, setFactoryId] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const createMut = useMutation({
    mutationFn: (data) => createAdminUser(data),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['admin-users'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (role !== 'HEAD_OFFICE_ADMIN' && !factoryId) {
      setErrorMsg('Please select a factory assignment for factory personnel.');
      return;
    }
    createMut.mutate({
      name,
      email,
      password,
      role,
      factoryId: role === 'HEAD_OFFICE_ADMIN' ? null : factoryId,
    });
  };
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          padding: '24px',
          width: '480px',
          maxWidth: '90%',
        }}
      >
        <h3
          style={{
            margin: '0 0 14px',
            fontSize: '18px',
            color: '#1a2e22',
          }}
        >
          Create ERP User
        </h3>
        {errorMsg && <Notice kind="error">{errorMsg}</Notice>}

        <form onSubmit={handleSubmit}>
          <FormRow label="Full Name" required>
            <input
              type="text"
              className="p2-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tariqul Islam"
              required
            />
          </FormRow>

          <FormRow label="Email Address" required>
            <input
              type="email"
              className="p2-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. tariqul@juteworks.demo"
              required
            />
          </FormRow>

          <FormRow label="Password" required hint="Default password is password123">
            <input
              type="text"
              className="p2-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </FormRow>

          <FormRow label="System Role" required>
            <select className="p2-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="STAFF">Staff (Inventory & Basic Operations)</option>
              <option value="ACCOUNTANT">Accountant (Invoices & Payments)</option>
              <option value="FACTORY_MANAGER">Factory Manager (Full Branch Access)</option>
              <option value="HEAD_OFFICE_ADMIN">Head Office Admin (Consolidated Access)</option>
            </select>
          </FormRow>

          {role !== 'HEAD_OFFICE_ADMIN' && (
            <FormRow label="Assigned Mill Factory" required>
              <select
                className="p2-select"
                value={factoryId}
                onChange={(e) => setFactoryId(e.target.value)}
                required
              >
                <option value="">Select factory…</option>
                {factoriesQuery.data?.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </option>
                ))}
              </select>
            </FormRow>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '20px',
            }}
          >
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-emerald-800 hover:bg-emerald-900 text-white"
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Creating…' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function FactoriesView() {
  const client = useQueryClient();
  const factoriesQuery = useQuery({
    queryKey: ['admin-factories'],
    queryFn: getAdminFactories,
  });
  const [editingFactory, setEditingFactory] = useState(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const updateMut = useMutation({
    mutationFn: () =>
      updateAdminFactory(editingFactory.id, {
        phone: phone || null,
        email: email || null,
        address: address || null,
      }),
    onSuccess: () => {
      setEditingFactory(null);
      void client.invalidateQueries({
        queryKey: ['admin-factories'],
      });
    },
  });
  const startEdit = (f) => {
    setEditingFactory(f);
    setPhone(f.phone ?? '');
    setEmail(f.email ?? '');
    setAddress(f.address ?? '');
  };
  return (
    <div>
      <div
        style={{
          marginBottom: '16px',
        }}
      >
        <strong
          style={{
            fontSize: '14px',
            color: '#27382f',
          }}
        >
          Operating Jute Mills
        </strong>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '18px',
        }}
      >
        {factoriesQuery.data?.map((factory) => (
          <div
            key={factory.id}
            className="p2-card"
            style={{
              padding: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#1e683f',
                    fontWeight: 600,
                  }}
                >
                  {factory.code}
                </span>
                <strong
                  style={{
                    fontSize: '18px',
                    color: '#1d2f24',
                  }}
                >
                  {factory.name}
                </strong>
                <small>{factory.location}, Bangladesh</small>
              </div>
              <Button
                variant="outline"
                className="py-1 px-2.5 text-xs"
                onClick={() => startEdit(factory)}
              >
                <Edit size={14} /> Edit
              </Button>
            </div>

            <div
              style={{
                marginTop: '16px',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div>
                <span
                  style={{
                    color: '#738379',
                  }}
                >
                  Address:{' '}
                </span>
                {factory.address || '—'}
              </div>
              <div>
                <span
                  style={{
                    color: '#738379',
                  }}
                >
                  Phone:{' '}
                </span>
                {factory.phone || '—'}
              </div>
              <div>
                <span
                  style={{
                    color: '#738379',
                  }}
                >
                  Email:{' '}
                </span>
                {factory.email || '—'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingFactory && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '440px',
              maxWidth: '90%',
            }}
          >
            <h3
              style={{
                margin: '0 0 14px',
                fontSize: '18px',
                color: '#1a2e22',
              }}
            >
              Edit {editingFactory.name}
            </h3>
            <FormRow label="Phone Number">
              <input
                type="text"
                className="p2-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </FormRow>
            <FormRow label="Contact Email">
              <input
                type="email"
                className="p2-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormRow>
            <FormRow label="Physical Address">
              <input
                type="text"
                className="p2-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </FormRow>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '18px',
              }}
            >
              <Button variant="outline" onClick={() => setEditingFactory(null)}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                onClick={() => updateMut.mutate()}
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? 'Saving…' : 'Save Factory Details'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function CompanyProfileView() {
  const client = useQueryClient();
  const companyQuery = useQuery({
    queryKey: ['admin-company'],
    queryFn: getCompanyProfile,
  });
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);
  useState(() => {
    if (companyQuery.data) {
      setTaxId(companyQuery.data.taxId ?? '');
      setEmail(companyQuery.data.email ?? '');
      setPhone(companyQuery.data.phone ?? '');
      setAddress(companyQuery.data.address ?? '');
      setCity(companyQuery.data.city ?? '');
    }
  });
  const updateMut = useMutation({
    mutationFn: () =>
      updateCompanyProfile({
        taxId: taxId || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
      }),
    onSuccess: () => {
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
      void client.invalidateQueries({
        queryKey: ['admin-company'],
      });
    },
  });
  if (companyQuery.isLoading) return <LoadingState label="Loading company configuration…" />;
  if (!companyQuery.data) return <ErrorState message="Company details unavailable" />;
  return (
    <div
      style={{
        maxWidth: '600px',
      }}
    >
      <strong
        style={{
          fontSize: '15px',
          color: '#27382f',
          display: 'block',
          marginBottom: '8px',
        }}
      >
        Corporate Entity Details
      </strong>
      <p
        style={{
          fontSize: '13px',
          color: '#68776f',
          marginBottom: '18px',
        }}
      >
        Central details printed on standard tax invoices, dispatch delivery notes, and regulatory
        reports.
      </p>

      {savedMsg && <Notice kind="success">Company profile successfully updated!</Notice>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '14px',
        }}
      >
        <FormRow label="Company Name">
          <input type="text" className="p2-input" value={companyQuery.data.name} disabled />
        </FormRow>
        <FormRow label="Default Currency">
          <input
            type="text"
            className="p2-input"
            value={`${companyQuery.data.currency} (৳)`}
            disabled
          />
        </FormRow>
      </div>

      <FormRow label="Tax / BIN Identification Number">
        <input
          type="text"
          className="p2-input"
          defaultValue={companyQuery.data.taxId ?? ''}
          onChange={(e) => setTaxId(e.target.value)}
          placeholder="e.g. BIN-00129384920"
        />
      </FormRow>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '14px',
        }}
      >
        <FormRow label="Headquarters Email">
          <input
            type="email"
            className="p2-input"
            defaultValue={companyQuery.data.email ?? ''}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormRow>
        <FormRow label="Headquarters Phone">
          <input
            type="text"
            className="p2-input"
            defaultValue={companyQuery.data.phone ?? ''}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormRow>
      </div>

      <FormRow label="Registered Head Office Address">
        <input
          type="text"
          className="p2-input"
          defaultValue={companyQuery.data.address ?? ''}
          onChange={(e) => setAddress(e.target.value)}
        />
      </FormRow>

      <FormRow label="City">
        <input
          type="text"
          className="p2-input"
          defaultValue={companyQuery.data.city ?? ''}
          onChange={(e) => setCity(e.target.value)}
        />
      </FormRow>

      <div
        style={{
          marginTop: '20px',
        }}
      >
        <Button
          className="bg-emerald-800 hover:bg-emerald-900 text-white"
          onClick={() => updateMut.mutate()}
          disabled={updateMut.isPending}
        >
          {updateMut.isPending ? 'Updating…' : 'Update Company Profile'}
        </Button>
      </div>
    </div>
  );
}
function formatDetails(details) {
  if (!details) return '—';
  if (typeof details === 'object') {
    try {
      return Object.entries(details)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    } catch {
      return JSON.stringify(details);
    }
  }
  try {
    const parsed = JSON.parse(details);
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.entries(parsed)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    }
  } catch {}
  return String(details);
}
function AuditLogsView() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const logsQuery = useQuery({
    queryKey: [
      'audit-logs',
      {
        action,
        page,
      },
    ],
    queryFn: () =>
      getAuditLogs({
        action: action || undefined,
        page,
        pageSize: 12,
      }),
  });
  return (
    <div>
      <div
        className="p2-toolbar"
        style={{
          border: 0,
          padding: '0 0 16px',
        }}
      >
        <label className="p2-search">
          <Search size={16} />
          <input
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="Filter by action, entity, or keyword (e.g. CREATE, FULFILL, LOGIN)…"
          />
        </label>
      </div>

      {logsQuery.isLoading ? (
        <LoadingState label="Loading audit logs…" />
      ) : logsQuery.error ? (
        <ErrorState message={logsQuery.error.message} retry={() => void logsQuery.refetch()} />
      ) : logsQuery.data?.items.length ? (
        <>
          <div className="p2-table-wrap">
            <table
              className="p2-table"
              style={{
                fontSize: '13px',
              }}
            >
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Factory</th>
                  <th>Entity ID</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logsQuery.data.items.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString('en-GB')}</td>
                    <td>
                      {log.user ? (
                        <>
                          <strong>{log.user.name}</strong>
                          <small className="p2-subtext">
                            {log.user.role ? log.user.role.replace(/_/g, ' ') : 'User'}
                          </small>
                        </>
                      ) : (
                        <>
                          <strong>System</strong>
                          <small className="p2-subtext">Automated / Migration</small>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="p2-badge confirmed">{log.action}</span>
                    </td>
                    <td>{log.entity}</td>
                    <td>
                      {log.factory ? (
                        <b>{log.factory.code}</b>
                      ) : (
                        <small className="p2-subtext">Head Office</small>
                      )}
                    </td>
                    <td>
                      <code
                        style={{
                          fontSize: '11px',
                          background: '#f2f4f2',
                          padding: '2px 4px',
                          borderRadius: '3px',
                        }}
                      >
                        {log.entityId
                          ? log.entityId.length > 14
                            ? log.entityId.slice(0, 14) + '…'
                            : log.entityId
                          : '—'}
                      </code>
                    </td>
                    <td>
                      <small
                        style={{
                          color: '#57675e',
                          wordBreak: 'break-word',
                        }}
                      >
                        {formatDetails(log.details)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={logsQuery.data.page}
            totalPages={logsQuery.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No audit entries"
          detail="System operations will be logged here automatically."
        />
      )}
    </div>
  );
}
