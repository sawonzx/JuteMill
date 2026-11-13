export function getApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    let base = envUrl.trim().replace(/\/+$/, '');
    while (base.endsWith('/api')) {
      base = base.slice(0, -4).replace(/\/+$/, '');
    }
    return `${base}/api`;
  }

  if (typeof window !== 'undefined') {
    const port = window.location.port;
    if (port === '5174') return 'http://localhost:4001/api';
    if (port === '5175') return 'http://localhost:4002/api';
    if (port === '5173') return 'http://localhost:4000/api';
  }

  return 'http://localhost:4000/api';
}
export class ApiError extends Error {
  status;
  details;
  constructor(message, status, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
async function request(path, init = {}) {
  const identity = localStorage.getItem('jute-demo-user-id');
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.body
        ? {
            'Content-Type': 'application/json',
          }
        : {}),
      ...(identity
        ? {
            'X-Demo-User-Id': identity,
          }
        : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Request failed (${response.status})`,
      response.status,
      body.details ?? []
    );
  }
  return body;
}
function queryString(values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const result = query.toString();
  return result ? `?${result}` : '';
}
function json(method, data) {
  return {
    method,
    ...(data === undefined
      ? {}
      : {
          body: JSON.stringify(data),
        }),
  };
}
export const getDemoUsers = () => request('/demo-users');
export const getDashboard = (userId, factoryId, period, startDate, endDate) =>
  request(
    `/dashboard${queryString({
      factoryId,
      period,
      startDate,
      endDate,
    })}`,
    {
      headers: {
        'X-Demo-User-Id': userId,
      },
    }
  );
export const getFactories = () => request('/factories');
export const getCustomers = (filters) => request(`/customers${queryString(filters)}`);
export const getCustomer = (id) => request(`/customers/${encodeURIComponent(id)}`);
export const createCustomer = (data) => request('/customers', json('POST', data));
export const updateCustomer = (id, data) =>
  request(`/customers/${encodeURIComponent(id)}`, json('PUT', data));
export const setCustomerStatus = (id, status) =>
  request(
    `/customers/${encodeURIComponent(id)}/status`,
    json('PATCH', {
      status,
    })
  );
export const deleteCustomer = (id) =>
  request(`/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getProducts = (filters) => request(`/products${queryString(filters)}`);
export const getProduct = (id) => request(`/products/${encodeURIComponent(id)}`);
export const createProduct = (data) => request('/products', json('POST', data));
export const updateProduct = (id, data) =>
  request(`/products/${encodeURIComponent(id)}`, json('PUT', data));
export const setProductStatus = (id, status) =>
  request(
    `/products/${encodeURIComponent(id)}/status`,
    json('PATCH', {
      status,
    })
  );
export const getInventorySummary = () => request('/inventory/summary');
export const getInventoryBalances = (filters) =>
  request(`/inventory/balances${queryString(filters)}`);
export const getInventoryMovements = (filters) =>
  request(`/inventory/movements${queryString(filters)}`);
export const getWarehouses = (factoryId) =>
  request(
    `/inventory/warehouses${queryString({
      factoryId,
    })}`
  );
export const recordMovement = (data) => request('/inventory/movements', json('POST', data));
export const setInventoryThreshold = (data) => request('/inventory/thresholds', json('PUT', data));
export const getOrders = (filters) => request(`/orders${queryString(filters)}`);
export const getOrder = (id) => request(`/orders/${encodeURIComponent(id)}`);
export const createOrder = (data) => request('/orders', json('POST', data));
export const confirmOrder = (id) =>
  request(`/orders/${encodeURIComponent(id)}/confirm`, json('POST'));
export const fulfillOrder = (id) =>
  request(`/orders/${encodeURIComponent(id)}/fulfill`, json('POST'));
export const cancelOrder = (id, reason) =>
  request(
    `/orders/${encodeURIComponent(id)}/cancel`,
    json('POST', {
      reason,
    })
  );
export const deleteOrder = (id) =>
  request(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getInvoices = (filters) => request(`/invoices${queryString(filters)}`);
export const getInvoiceStats = (filters) => request(`/invoices/stats${queryString(filters)}`);
export const getInvoice = (id) => request(`/invoices/${encodeURIComponent(id)}`);
export const createInvoice = (data) => request('/invoices', json('POST', data));
export const updateInvoice = (id, data) =>
  request(`/invoices/${encodeURIComponent(id)}`, json('PUT', data));
export const voidInvoice = (id, reason) =>
  request(
    `/invoices/${encodeURIComponent(id)}/void`,
    json('POST', {
      reason,
    })
  );
export const getPayments = (filters) => request(`/payments${queryString(filters)}`);
export const getPaymentStats = (params) => request(`/payments/stats${queryString(params)}`);
export const recordPayment = (data) => request('/payments', json('POST', data));
export const getCustomerLedger = (customerId) =>
  request(`/customers/${encodeURIComponent(customerId)}/ledger`);
export const getGeneralLedger = (params) => request(`/payments/ledger${queryString(params)}`);
export const getProductionBatches = (filters) => request(`/production${queryString(filters)}`);
export const getProductionBatch = (id) => request(`/production/${encodeURIComponent(id)}`);
export const createProductionBatch = (data) => request('/production', json('POST', data));
export const completeProductionBatch = (id, data) =>
  request(`/production/${encodeURIComponent(id)}/complete`, json('POST', data));
export const getSalesReport = (params) => request(`/reports/sales${queryString(params)}`);
export const getOrdersReport = (params) => request(`/reports/orders${queryString(params)}`);
export const getReceivablesReport = (params) =>
  request(`/reports/receivables${queryString(params)}`);
export const getProductionReport = (params) => request(`/reports/production${queryString(params)}`);
export const getExportUrl = (type, params) => {
  const query = queryString(params);
  return `${getApiBaseUrl()}/reports/export/${type}${query}`;
};
export const getAdminUsers = () => request('/admin/users');
export const createAdminUser = (data) => request('/admin/users', json('POST', data));
export const updateAdminUser = (id, data) =>
  request(`/admin/users/${encodeURIComponent(id)}`, json('PUT', data));
export const updateAdminUserStatus = (id, active) =>
  request(
    `/admin/users/${encodeURIComponent(id)}/status`,
    json('PATCH', {
      active,
    })
  );
export const deleteAdminUser = (id) =>
  request(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
export const getAdminFactories = () => request('/admin/factories');
export const updateAdminFactory = (id, data) =>
  request(`/admin/factories/${encodeURIComponent(id)}`, json('PUT', data));
export const getCompanyProfile = () => request('/admin/company');
export const updateCompanyProfile = (data) => request('/admin/company', json('PUT', data));
export const getAuditLogs = (params) => request(`/admin/audit-logs${queryString(params)}`);

export const getTrashItems = (filters) => request(`/trash${queryString(filters)}`);
export const restoreTrashItem = (id) =>
  request(`/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' });
export const permanentDeleteTrashItem = (id) =>
  request(`/trash/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const emptyTrash = () =>
  request('/trash/empty', { method: 'POST' });
export const batchRestoreTrashItems = (ids) =>
  request('/trash/batch-restore', json('POST', { ids }));
export const batchDeleteTrashItems = (ids) =>
  request('/trash/batch-delete', json('POST', { ids }));
