import { useState, useEffect } from 'react';
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
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AVAILABLE_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
} from '../constants/permissions';
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
  ConfirmModal,
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
  const { user, isAdmin, isManager } = useCurrentRole();
  const [activeTab, setActiveTab] = useState('users');
  if (!isAdmin && !isManager) {
    return (
      <div className="p2-page">
        <PageTitle
          title="Access Restricted"
          description="Administration controls are reserved for Administrators and Factory Managers."
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
          <h3>Management Permissions Required</h3>
          <p
            style={{
              color: '#68776f',
              maxWidth: '400px',
              margin: '8px auto 0',
            }}
          >
            Please switch to an Administrator or Factory Admin persona using the identity switcher
            to manage users and access permissions.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p2-page">
      <PageTitle
        title={
          isAdmin
            ? 'Administration & Governance'
            : `User Management · ${user?.factory?.name || 'Factory Branch'}`
        }
        description={
          isAdmin
            ? 'Head Office user management, branch factory configuration, company profile, and audit logs.'
            : `Manage factory staff accounts, assignments, and granular role permissions for ${user?.factory?.name || 'this factory'}.`
        }
      />

      <div className="p2-panel">
        <div className="p2-tab-nav">
          <button
            className={`p2-tab-button ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={15} /> User Management
          </button>
          {isAdmin && (
            <>
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
            </>
          )}
          <button
            className={`p2-tab-button ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <History size={15} /> {isAdmin ? 'Audit Logs' : 'Factory Audit Logs'}
          </button>
        </div>

        <div
          style={{
            padding: '20px',
          }}
        >
          {activeTab === 'users' && <UsersManagementView />}
          {isAdmin && activeTab === 'factories' && <FactoriesView />}
          {isAdmin && activeTab === 'company' && <CompanyProfileView />}
          {activeTab === 'audit' && <AuditLogsView />}
        </div>
      </div>
    </div>
  );
}
function UsersManagementView() {
  const { user: currentUser, isAdmin, isManager } = useCurrentRole();
  const client = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
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
      setDeletingUser(null);
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
    deleteUserMutation.reset();
    setDeletingUser(u);
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
          {isAdmin
            ? 'Registered ERP Accounts & Factory Assignments (Consolidated)'
            : `Factory Personnel & Role Assignments · ${currentUser?.factory?.name || 'Local Branch'}`}
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
                <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
                <th>User / Name</th>
                <th>Email</th>
                <th>Role & Permissions</th>
                <th>Factory Scope</th>
                <th>Status</th>
                <th
                  className="p2-right"
                  style={{
                    width: '180px',
                    minWidth: '180px',
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.data?.map((u, index) => {
                const effectivePerms = getEffectivePermissions(u.role, u.permissions || []);
                const isCustomized = (u.permissions || []).length > 0;
                const isSelf = u.id === currentUser?.id;
                const isHeadOfficeAdmin = u.role === 'HEAD_OFFICE_ADMIN';
                const canEdit =
                  !isHeadOfficeAdmin &&
                  (isAdmin ? true : !isSelf && u.role !== 'FACTORY_MANAGER');
                return (
                  <tr key={u.id}>
                    <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '5px',
                          alignItems: 'flex-start',
                        }}
                      >
                        <span className="p2-badge confirmed">{u.role.replace(/_/g, ' ')}</span>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditingUser(u)}
                            style={{
                              fontSize: '11px',
                              color: isCustomized ? '#1d4ed8' : '#15803d',
                              background: isCustomized ? '#eff6ff' : '#f0fdf4',
                              border: `1px solid ${isCustomized ? '#bfdbfe' : '#bbf7d0'}`,
                              borderRadius: '12px',
                              padding: '2px 8px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              transition: 'all 0.15s ease',
                            }}
                            title="Click to edit user profile and access"
                          >
                            <ShieldCheck size={12} />
                            <span>
                              {effectivePerms.length} Accesses{' '}
                              {isCustomized ? '· Custom' : '· Default'}
                            </span>
                          </button>
                        ) : (
                          <div
                            style={{
                              fontSize: '11px',
                              color: isCustomized ? '#1d4ed8' : '#15803d',
                              background: isCustomized ? '#eff6ff' : '#f0fdf4',
                              border: `1px solid ${isCustomized ? '#bfdbfe' : '#bbf7d0'}`,
                              borderRadius: '12px',
                              padding: '2px 8px',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'default',
                            }}
                          >
                            <ShieldCheck size={12} />
                            <span>
                              {effectivePerms.length} Accesses{' '}
                              {isCustomized ? '· Custom' : '· Default'}
                            </span>
                          </div>
                        )}
                      </div>
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
                        width: '180px',
                        minWidth: '180px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          justifyContent: 'flex-end',
                        }}
                      >
                        {canEdit && (
                          <Button
                            variant="outline"
                            className="py-1 px-2.5 text-xs"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: '#1f2937',
                            }}
                            onClick={() => setEditingUser(u)}
                            title="Edit user details and permissions"
                          >
                            <Edit size={13} />
                            <span>Edit</span>
                          </Button>
                        )}

                        {u.role !== 'HEAD_OFFICE_ADMIN' &&
                          !isSelf &&
                          (isAdmin || u.role !== 'FACTORY_MANAGER') ? (
                          u.active ? (
                            <Button
                              variant="outline"
                              className="py-1 px-2.5 text-xs"
                              style={{
                                minWidth: '82px',
                                justifyContent: 'center',
                              }}
                              disabled={
                                toggleUserActive.isPending &&
                                toggleUserActive.variables?.id === u.id
                              }
                              onClick={() =>
                                toggleUserActive.mutate({
                                  id: u.id,
                                  active: false,
                                })
                              }
                            >
                              {toggleUserActive.isPending &&
                                toggleUserActive.variables?.id === u.id
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
                                  minWidth: '82px',
                                  justifyContent: 'space-between',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                                disabled={
                                  toggleUserActive.isPending || deleteUserMutation.isPending
                                }
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
                        ) : u.id === currentUser?.id ? (
                          <span
                            className="p2-badge general"
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                            }}
                          >
                            You
                          </span>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && <CreateUserModal onClose={() => setIsModalOpen(false)} />}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
        />
      )}
      <ConfirmModal
        open={!!deletingUser}
        title="Delete User Account"
        subtitle={deletingUser ? `${deletingUser.name} · ${deletingUser.email}` : undefined}
        message={
          deletingUser ? (
            <>
              Are you sure you want to permanently delete user <strong>{deletingUser.name}</strong> (
              {deletingUser.email})? This action cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete User"
        tone="danger"
        icon={Trash2}
        isPending={deleteUserMutation.isPending}
        error={deleteUserMutation.error}
        onClose={() => {
          if (!deleteUserMutation.isPending) setDeletingUser(null);
        }}
        onConfirm={() => {
          if (deletingUser) deleteUserMutation.mutate(deletingUser.id);
        }}
      />
    </div>
  );
}
function PermissionsSelector({ role, permissions, onChange, isAdmin }) {
  // If not Main Admin, filter out higher features so factory admins only see features present on their dedicated port!
  const availableGroups = AVAILABLE_PERMISSIONS
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((p) => isAdmin || !p.isHigherFeature),
    }))
    .filter((group) => group.permissions.length > 0);

  const defaultPerms = (ROLE_DEFAULT_PERMISSIONS[role] || []).filter(
    (id) => isAdmin || id !== 'admin:manage'
  );
  const allIds = availableGroups.flatMap((c) => c.permissions.map((p) => p.id));

  const toggle = (id) => {
    if (permissions.includes(id)) {
      onChange(permissions.filter((p) => p !== id));
    } else {
      onChange([...permissions, id]);
    }
  };

  const resetToDefaults = () => {
    onChange([...defaultPerms]);
  };

  const selectAll = () => {
    onChange([...allIds]);
  };

  const clearAll = () => {
    onChange([]);
  };

  const roleLabels = {
    STAFF: 'Staff',
    ACCOUNTANT: 'Accountant',
    FACTORY_MANAGER: 'Factory Admin',
    HEAD_OFFICE_ADMIN: 'Head Office Admin',
  };

  return (
    <div
      style={{
        marginTop: '18px',
        borderTop: '1px solid #e5e7eb',
        paddingTop: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '10px',
          gap: '12px',
        }}
      >
        <div>
          <label
            style={{
              fontSize: '13.5px',
              fontWeight: '700',
              color: '#1a2e22',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ShieldCheck size={16} color="#15803d" />
            <span>Accessibility & Permissions Configuration</span>
          </label>
          <span
            style={{
              fontSize: '12px',
              color: '#4b5563',
              display: 'block',
              marginTop: '2px',
            }}
          >
            Role defaults for <strong>{roleLabels[role] || role}</strong> are pre-selected. Click
            any box to grant or revoke specific access.
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={resetToDefaults}
            title="Reset to default permissions for this role"
            style={{
              padding: '4px 9px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#374151',
            }}
          >
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={selectAll}
            title="Grant all permissions for this port"
            style={{
              padding: '4px 9px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#065f46',
            }}
          >
            Grant All
          </button>
          <button
            type="button"
            onClick={clearAll}
            title="Clear all permissions"
            style={{
              padding: '4px 9px',
              fontSize: '11px',
              fontWeight: 600,
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '4px',
              cursor: 'pointer',
              color: '#9f1239',
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div
          style={{
            fontSize: '11.5px',
            color: '#0369a1',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '6px',
            padding: '7px 11px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShieldAlert size={15} style={{ color: '#0284c7', flexShrink: 0 }} />
          <span>
            <strong>Dedicated Port Scope:</strong> Features shown below are limited to operational features present on your factory port. Higher features (such as System Administration) are reserved for Head Office Main Admin.
          </span>
        </div>
      )}

      <div
        style={{
          maxHeight: '280px',
          overflowY: 'auto',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '12px 14px',
          background: '#fcfdfc',
        }}
      >
        {availableGroups.map((group) => (
          <div key={group.category} style={{ marginBottom: '14px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                color: group.isHigherFeature ? '#92400e' : '#15803d',
                letterSpacing: '0.05em',
                marginBottom: '8px',
                paddingBottom: '3px',
                borderBottom: `1px solid ${group.isHigherFeature ? '#fde68a' : '#e5e7eb'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>{group.category}</span>
              {group.isHigherFeature && (
                <span
                  style={{
                    fontSize: '9.5px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: '#fef3c7',
                    color: '#b45309',
                    fontWeight: 700,
                    textTransform: 'none',
                    letterSpacing: 'normal',
                  }}
                >
                  ★ Head Office Exclusive
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '8px',
              }}
            >
              {group.permissions.map((perm) => {
                const isChecked = permissions.includes(perm.id);
                const isDefault = defaultPerms.includes(perm.id);
                const isCustomGranted = isChecked && !isDefault;
                const isRevoked = !isChecked && isDefault;

                return (
                  <label
                    key={perm.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '7px 9px',
                      background: isChecked ? '#ffffff' : '#f9fafb',
                      border: isCustomGranted
                        ? '1.5px solid #2563eb'
                        : isChecked
                          ? '1px solid #93c5fd'
                          : isRevoked
                            ? '1px dashed #f59e0b'
                            : '1px solid #e5e7eb',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      boxShadow: isChecked ? '0 1px 2px rgba(0,0,0,0.03)' : 'none',
                      transition: 'all 0.1s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(perm.id)}
                      style={{ marginTop: '2px', cursor: 'pointer', accentColor: '#15803d' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: isChecked ? '#111827' : '#6b7280' }}>
                          {perm.label}
                        </span>
                        {isCustomGranted && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#dbeafe',
                              color: '#1d4ed8',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            + Custom Granted
                          </span>
                        )}
                        {isChecked && isDefault && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#dcfce7',
                              color: '#15803d',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Role Default
                          </span>
                        )}
                        {isRevoked && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#fef3c7',
                              color: '#b45309',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Revoked
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#6b7280',
                          marginTop: '2px',
                          lineHeight: '1.3',
                        }}
                      >
                        {perm.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose }) {
  const { user: currentUser, isAdmin } = useCurrentRole();
  const client = useQueryClient();
  const factoriesQuery = useQuery({
    queryKey: ['admin-factories'],
    queryFn: getAdminFactories,
  });

  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [password, setPassword] = useState('');
  const [factoryId, setFactoryId] = useState(user.factoryId || user.factory?.id || '');
  const [role, setRole] = useState(user.role);
  const [permissions, setPermissions] = useState(() =>
    user.permissions?.length
      ? user.permissions
      : getEffectivePermissions(user.role, user.permissions || [])
  );
  const [active, setActive] = useState(user.active ?? true);
  const [errorMsg, setErrorMsg] = useState(null);

  const updateMut = useMutation({
    mutationFn: (data) => updateAdminUser(user.id, data),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['admin-users'],
      });
      void client.invalidateQueries({
        queryKey: ['demo-users'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setPermissions(ROLE_DEFAULT_PERMISSIONS[newRole] || []);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Full name is required.');
      return;
    }
    if (!email.trim()) {
      setErrorMsg('Email address is required.');
      return;
    }
    const effectiveFactoryId =
      role === 'HEAD_OFFICE_ADMIN'
        ? null
        : factoryId ||
          user.factoryId ||
          user.factory?.id ||
          currentUser?.factory?.id ||
          currentUser?.factoryId ||
          factoriesQuery.data?.[0]?.id ||
          null;

    if (role !== 'HEAD_OFFICE_ADMIN' && !effectiveFactoryId) {
      setErrorMsg('Please select a factory assignment for factory personnel.');
      return;
    }

    const payload = {
      name: name.trim(),
      email: email.trim(),
      role,
      permissions: isAdmin ? permissions : permissions.filter((p) => p !== 'admin:manage'),
      active,
      factoryId: effectiveFactoryId,
    };
    if (password) {
      payload.password = password;
    }

    updateMut.mutate(payload);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '10px',
          width: '740px',
          maxWidth: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Off-white Title Header */}
        <div
          style={{
            background: '#f8faf9',
            borderBottom: '1px solid #e5e7eb',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ textAlign: 'left' }}>
            <h3 style={{ margin: '0 0 2px', fontSize: '18px', fontWeight: 700, color: '#1a2e22', letterSpacing: '-0.2px', textAlign: 'left', lineHeight: 1.3 }}>
              {isAdmin && user.id === currentUser?.id
                ? `Edit My Account · ${user.name}`
                : `Edit User · ${user.name}`}
            </h3>
            <div style={{ fontSize: '12.5px', color: '#6b7280', textAlign: 'left' }}>
              {user.email} ·{' '}
              {user.role === 'HEAD_OFFICE_ADMIN'
                ? 'Head Office Administrator (Consolidated HQ)'
                : user.factory?.name || 'Assigned Factory'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#111827';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.color = '#6b7280';
            }}
            title="Cancel / Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
          }}
        >
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

            <FormRow
              label="New Password"
              hint="Leave blank to keep existing password unchanged"
            >
              <input
                type="password"
                className="p2-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••••••• (Leave blank to keep current)"
              />
            </FormRow>

            {/* Assigned Mill Factory on top of System Role */}
            <FormRow
              label="Assigned Mill Factory"
              required={role !== 'HEAD_OFFICE_ADMIN'}
              hint={role === 'HEAD_OFFICE_ADMIN' ? 'Consolidated across all mills (HQ)' : undefined}
            >
              {role === 'HEAD_OFFICE_ADMIN' ? (
                <div
                  className="p2-input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f9fafb',
                    color: '#15803d',
                    fontWeight: 600,
                  }}
                >
                  <Building2 size={15} style={{ marginRight: '8px', color: '#059669' }} />
                  <span>All Factories (Consolidated · Head Office)</span>
                </div>
              ) : isAdmin ? (
                <select
                  className="p2-select"
                  value={factoryId}
                  onChange={(e) => setFactoryId(e.target.value)}
                  required={role !== 'HEAD_OFFICE_ADMIN'}
                >
                  <option value="">Select factory…</option>
                  {factoriesQuery.data?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} · {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="p2-input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f9fafb',
                    color: '#374151',
                    fontWeight: 600,
                  }}
                >
                  <Building2 size={15} style={{ marginRight: '8px', color: '#059669' }} />
                  <span>
                    {user.factory?.name || currentUser?.factory?.name || 'Assigned Factory'} (
                    {user.factory?.code || currentUser?.factory?.code || 'Branch'})
                  </span>
                </div>
              )}
            </FormRow>

            {/* System Role */}
            <FormRow
              label="System Role"
              required
              hint={
                role === 'HEAD_OFFICE_ADMIN'
                  ? 'Primary Head Office Administrator role'
                  : undefined
              }
            >
              {role === 'HEAD_OFFICE_ADMIN' ? (
                <div
                  className="p2-input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f9fafb',
                    color: '#15803d',
                    fontWeight: 600,
                  }}
                >
                  <ShieldCheck size={15} style={{ marginRight: '8px', color: '#15803d' }} />
                  <span>Head Office Admin (Consolidated Control)</span>
                </div>
              ) : (
                <select
                  className="p2-select"
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  required
                >
                  <option value="STAFF">Staff (Basic Operations & Godown)</option>
                  <option value="ACCOUNTANT">Accountant (Invoices & Billing)</option>
                  {isAdmin && (
                    <>
                      <option value="FACTORY_MANAGER">
                        Factory Admin (Full Branch Control)
                      </option>
                      <option value="HEAD_OFFICE_ADMIN">
                        Head Office Admin (Consolidated Control)
                      </option>
                    </>
                  )}
                </select>
              )}
            </FormRow>

            {/* Account Status toggle */}
            {user.role !== 'HEAD_OFFICE_ADMIN' && user.id !== currentUser?.id && (
              <FormRow label="Account Status">
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#15803d' }}
                  />
                  <span style={{ fontWeight: 600, color: active ? '#15803d' : '#9ca3af' }}>
                    {active ? 'Active (User can sign in)' : 'Inactive (Access disabled)'}
                  </span>
                </label>
              </FormRow>
            )}

            {/* Permissions matrix */}
            <PermissionsSelector
              role={role}
              permissions={permissions}
              onChange={setPermissions}
              isAdmin={isAdmin}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '22px',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '16px',
              }}
            >
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-emerald-800 hover:bg-emerald-900 text-white"
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose }) {
  const { user: currentUser, isAdmin } = useCurrentRole();
  const client = useQueryClient();
  const factoriesQuery = useQuery({
    queryKey: ['admin-factories'],
    queryFn: getAdminFactories,
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const defaultFactoryId =
    currentUser?.factory?.id || currentUser?.factoryId || factoriesQuery.data?.[0]?.id || '';
  const [factoryId, setFactoryId] = useState(defaultFactoryId);

  useEffect(() => {
    if (!factoryId) {
      const autoId =
        currentUser?.factory?.id || currentUser?.factoryId || factoriesQuery.data?.[0]?.id || '';
      if (autoId) {
        setFactoryId(autoId);
      }
    }
  }, [currentUser, factoriesQuery.data, factoryId]);

  const [role, setRole] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const createMut = useMutation({
    mutationFn: (data) => createAdminUser(data),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['admin-users'],
      });
      void client.invalidateQueries({
        queryKey: ['demo-users'],
      });
      onClose();
    },
    onError: (err) => setErrorMsg(err.message),
  });
  const handleRoleChange = (newRole) => {
    setRole(newRole);
    if (newRole) {
      setPermissions(ROLE_DEFAULT_PERMISSIONS[newRole] || []);
    } else {
      setPermissions([]);
    }
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!role) {
      setErrorMsg('Please select a system role.');
      return;
    }
    const effectiveFactoryId =
      role === 'HEAD_OFFICE_ADMIN'
        ? null
        : factoryId ||
          currentUser?.factory?.id ||
          currentUser?.factoryId ||
          factoriesQuery.data?.[0]?.id ||
          null;

    if (role !== 'HEAD_OFFICE_ADMIN' && !effectiveFactoryId) {
      setErrorMsg('Please select a factory assignment for factory personnel.');
      return;
    }
    createMut.mutate({
      name,
      email,
      password,
      role,
      permissions: isAdmin ? permissions : permissions.filter((p) => p !== 'admin:manage'),
      factoryId: effectiveFactoryId,
    });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '10px',
          width: '740px',
          maxWidth: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Off-white Title Header */}
        <div
          style={{
            background: '#f8faf9',
            borderBottom: '1px solid #e5e7eb',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', minHeight: '32px' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 700,
                color: '#1a2e22',
                letterSpacing: '-0.2px',
                textAlign: 'left',
                lineHeight: 1.3,
              }}
            >
              {isAdmin
                ? 'Create ERP User'
                : `Add Factory User · ${currentUser?.factory?.name || 'Branch'}`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.color = '#111827';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.color = '#6b7280';
            }}
            title="Cancel / Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
          }}
        >
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

            <FormRow label="Password" required>
              <input
                type="text"
                className="p2-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter user password"
                required
              />
            </FormRow>

            {/* Assigned Mill Factory placed on TOP of System Role */}
            <FormRow
              label="Assigned Mill Factory"
              required={role !== 'HEAD_OFFICE_ADMIN'}
              hint={role === 'HEAD_OFFICE_ADMIN' ? 'Consolidated across all mills (HQ)' : undefined}
            >
              {isAdmin ? (
                <select
                  className="p2-select"
                  value={factoryId}
                  onChange={(e) => setFactoryId(e.target.value)}
                  disabled={role === 'HEAD_OFFICE_ADMIN'}
                  required={role !== 'HEAD_OFFICE_ADMIN'}
                >
                  <option value="">Select factory…</option>
                  {factoriesQuery.data?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} · {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="p2-input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f9fafb',
                    color: '#374151',
                    fontWeight: 600,
                  }}
                >
                  <Building2 size={15} style={{ marginRight: '8px', color: '#059669' }} />
                  <span>
                    {currentUser?.factory?.name || 'Assigned Factory'} (
                    {currentUser?.factory?.code || 'Branch'})
                  </span>
                </div>
              )}
            </FormRow>

            {/* System Role placed below Assigned Mill Factory */}
            <FormRow label="System Role" required>
              <select
                className="p2-select"
                value={role}
                onChange={(e) => handleRoleChange(e.target.value)}
                required
              >
                <option value="">Select a role…</option>
                <option value="STAFF">Staff (Basic Operations & Godown)</option>
                <option value="ACCOUNTANT">Accountant (Invoices & Billing)</option>
                {isAdmin && (
                  <>
                    <option value="FACTORY_MANAGER">
                      Factory Admin (Full Branch Control)
                    </option>
                    <option value="HEAD_OFFICE_ADMIN">
                      Head Office Admin (Consolidated Control)
                    </option>
                  </>
                )}
              </select>
            </FormRow>

            {/* Accessibility & Permissions Configuration only shown when a role is selected */}
            {role ? (
              <PermissionsSelector
                role={role}
                permissions={permissions}
                onChange={setPermissions}
                isAdmin={isAdmin}
              />
            ) : (
              <div
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '13px',
                  margin: '18px 0',
                }}
              >
                Please select a <strong>System Role</strong> above to configure module accessibility &
                permissions.
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '22px',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '16px',
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
          onClick={() => setEditingFactory(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '440px',
              maxWidth: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '14px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '18px',
                  color: '#1a2e22',
                }}
              >
                Edit {editingFactory.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingFactory(null)}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6b7280',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                  e.currentTarget.style.color = '#111827';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
                title="Cancel / Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
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
  } catch { }
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
                  <th style={{ width: '48px', minWidth: '48px', textAlign: 'center' }}>#</th>
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
                {logsQuery.data.items.map((log, index) => (
                  <tr key={log.id}>
                    <td style={{ textAlign: 'center', color: '#6b7280', fontWeight: 600, fontSize: '12px' }}>
                      {String((page - 1) * 12 + index + 1).padStart(2, '0')}
                    </td>
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
