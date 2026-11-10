export const AVAILABLE_PERMISSIONS = [
  {
    category: 'Sales Orders',
    permissions: [
      {
        id: 'orders:view',
        label: 'View Sales Orders',
        desc: 'Browse and view order details and statuses',
      },
      { id: 'orders:create', label: 'Create Orders', desc: 'Create new sales orders' },
      {
        id: 'orders:manage',
        label: 'Confirm & Cancel Orders',
        desc: 'Confirm, fulfill, or cancel orders',
      },
    ],
  },
  {
    category: 'Invoices & Billing',
    permissions: [
      {
        id: 'invoices:view',
        label: 'View Invoices',
        desc: 'View customer invoices and receivable ledgers',
      },
      {
        id: 'invoices:create',
        label: 'Issue Invoices',
        desc: 'Create and issue customer invoices',
      },
      { id: 'invoices:void', label: 'Void Invoices', desc: 'Cancel or void issued invoices' },
    ],
  },
  {
    category: 'Finance & Payments',
    permissions: [
      {
        id: 'payments:view',
        label: 'View Payments',
        desc: 'View customer payment receipts and history',
      },
      {
        id: 'payments:create',
        label: 'Record Payments',
        desc: 'Record incoming customer payments',
      },
    ],
  },
  {
    category: 'Inventory & Godowns',
    permissions: [
      {
        id: 'inventory:view',
        label: 'View Inventory',
        desc: 'View warehouse stock balances and low-stock alerts',
      },
      {
        id: 'inventory:manage',
        label: 'Stock Movements & Adjustments',
        desc: 'Perform stock receipts, dispatches, and adjustments',
      },
    ],
  },
  {
    category: 'Catalog & Customers',
    permissions: [
      {
        id: 'products:view',
        label: 'View Products Catalog',
        desc: 'Browse product catalog and specifications',
      },
      {
        id: 'products:manage',
        label: 'Manage Products',
        desc: 'Add or modify product SKUs and standard prices',
      },
      {
        id: 'customers:view',
        label: 'View Customers',
        desc: 'View customer directory and contact information',
      },
      { id: 'customers:manage', label: 'Manage Customers', desc: 'Add or edit customer profiles' },
    ],
  },
  {
    category: 'Operational Reports',
    portScope: 'all',
    permissions: [
      {
        id: 'reports:view',
        label: 'View Reports & Analytics',
        desc: 'Access operational and financial reports for this branch',
      },
      { id: 'reports:export', label: 'Export Reports (CSV)', desc: 'Download CSV reports' },
    ],
  },
  {
    category: 'System Governance & Administration',
    portScope: 'main', // Dedicated to Main Admin (Port 5173 / Port 4000)
    isHigherFeature: true,
    permissions: [
      {
        id: 'admin:manage',
        label: 'System Administration',
        desc: 'Higher feature: manage factory units, master settings, and audit logs',
        isHigherFeature: true,
      },
    ],
  },
];

export const ROLE_DEFAULT_PERMISSIONS = {
  HEAD_OFFICE_ADMIN: [
    'orders:view',
    'orders:create',
    'orders:manage',
    'invoices:view',
    'invoices:create',
    'invoices:void',
    'payments:view',
    'payments:create',
    'inventory:view',
    'inventory:manage',
    'products:view',
    'products:manage',
    'customers:view',
    'customers:manage',
    'reports:view',
    'reports:export',
    'admin:manage',
  ],
  FACTORY_MANAGER: [
    'orders:view',
    'orders:create',
    'orders:manage',
    'invoices:view',
    'invoices:create',
    'payments:view',
    'payments:create',
    'inventory:view',
    'inventory:manage',
    'products:view',
    'products:manage',
    'customers:view',
    'customers:manage',
    'reports:view',
    'reports:export',
  ],
  ACCOUNTANT: [
    'orders:view',
    'invoices:view',
    'invoices:create',
    'invoices:void',
    'payments:view',
    'payments:create',
    'products:view',
    'customers:view',
    'customers:manage',
    'reports:view',
    'reports:export',
  ],
  STAFF: ['orders:view', 'orders:create', 'inventory:view', 'inventory:manage', 'products:view'],
};

export function getEffectivePermissions(role, customPermissions = []) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || [];
  return Array.from(new Set([...defaults, ...(customPermissions || [])]));
}
