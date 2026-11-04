import type { DashboardData, DemoUser } from './types'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details: { field: string; message: string }[] = []) { super(message) }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const identity = localStorage.getItem('jute-demo-user-id')
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(identity ? { 'X-Demo-User-Id': identity } : {}), ...init.headers },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status, body.details ?? [])
  return body as T
}
function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') query.set(key, String(value))
  const result = query.toString()
  return result ? `?${result}` : ''
}
function json(method: string, data?: unknown): RequestInit { return { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) } }

export const getDemoUsers = () => request<DemoUser[]>('/demo-users')
export const getDashboard = (userId: string) => request<DashboardData>('/dashboard', { headers: { 'X-Demo-User-Id': userId } })
export const getFactories = () => request<FactorySummary[]>('/factories')

export const getCustomers = (filters: Record<string, string | number | undefined>) => request<Page<Customer>>(`/customers${queryString(filters)}`)
export const getCustomer = (id: string) => request<CustomerDetail>(`/customers/${encodeURIComponent(id)}`)
export const createCustomer = (data: CustomerInput) => request<Customer>('/customers', json('POST', data))
export const updateCustomer = (id: string, data: CustomerInput) => request<Customer>(`/customers/${encodeURIComponent(id)}`, json('PUT', data))
export const setCustomerStatus = (id: string, status: 'ACTIVE' | 'INACTIVE') => request<Customer>(`/customers/${encodeURIComponent(id)}/status`, json('PATCH', { status }))

export const getProducts = (filters: Record<string, string | number | undefined>) => request<Page<Product>>(`/products${queryString(filters)}`)
export const getProduct = (id: string) => request<Product>(`/products/${encodeURIComponent(id)}`)
export const createProduct = (data: ProductInput) => request<Product>('/products', json('POST', data))
export const updateProduct = (id: string, data: ProductInput) => request<Product>(`/products/${encodeURIComponent(id)}`, json('PUT', data))
export const setProductStatus = (id: string, status: 'ACTIVE' | 'INACTIVE') => request<Product>(`/products/${encodeURIComponent(id)}/status`, json('PATCH', { status }))

export const getInventorySummary = () => request<InventorySummary>('/inventory/summary')
export const getInventoryBalances = (filters: Record<string, string | number | undefined>) => request<Page<InventoryBalance>>(`/inventory/balances${queryString(filters)}`)
export const getInventoryMovements = (filters: Record<string, string | number | undefined>) => request<Page<InventoryMovement>>(`/inventory/movements${queryString(filters)}`)
export const getWarehouses = (factoryId?: string) => request<Warehouse[]>(`/inventory/warehouses${queryString({ factoryId })}`)
export const recordMovement = (data: StockMovementInput) => request<InventoryMovement & { duplicate: boolean }>('/inventory/movements', json('POST', data))
export const setInventoryThreshold = (data: { factoryId?: string; productId: string; minimumQuantity: number | null }) => request('/inventory/thresholds', json('PUT', data))

export type FactorySummary = { id: string; code: string; name: string; location: string }
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
export type CustomerInput = { factoryId?: string; name: string; code: string; contactPerson: string; phone: string; email: string | null; address: string; city: string; type: 'BUSINESS' | 'INDIVIDUAL'; status: 'ACTIVE' | 'INACTIVE'; notes: string | null }
export type Customer = CustomerInput & { id: string; createdAt: string; updatedAt?: string; factory: FactorySummary }
export type CustomerDetail = Customer & { orders: { id: string; orderNumber: string; status: string; orderDate: string; dueDate: string; total: number }[] }
export type ProductInput = { sku: string; name: string; category: string; type: 'RAW_MATERIAL' | 'FINISHED_PRODUCT'; unit: 'kg' | 'MT' | 'Bale' | 'Piece' | 'Meter'; description: string | null; standardPrice: number | null; status: 'ACTIVE' | 'INACTIVE' }
export type Product = ProductInput & { id: string; createdAt: string; stockByFactory: { factory: FactorySummary; warehouse: { id: string; name: string; isDefault: boolean }; quantity: number }[]; thresholds: { factory: FactorySummary; minimumQuantity: number }[] }
export type Warehouse = { id: string; code: string; name: string; isDefault: boolean; factory: FactorySummary }
export type InventoryBalance = { id: string; factory: FactorySummary; warehouse: { id: string; name: string; isDefault: boolean }; product: { id: string; sku: string; name: string; category: string; type: 'RAW_MATERIAL' | 'FINISHED_PRODUCT'; unit: string; status: string }; quantity: number; minimumQuantity: number | null; lowStock: boolean; updatedAt: string }
export type InventoryMovement = { id: string; type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT'; product: { id: string; sku: string; name: string; unit: string }; factory: FactorySummary; warehouse: { id: string; code: string; name: string }; quantity: number; previousQuantity: number; resultingQuantity: number; reason: string | null; reference: string | null; remarks: string | null; createdBy: { id: string; name: string }; transactionDate: string; createdAt: string; duplicate?: boolean }
export type StockMovementInput = { factoryId?: string; warehouseId?: string; productId: string; type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT'; quantity: number; adjustmentMode?: 'SET' | 'DELTA'; reason?: string; reference?: string; remarks?: string; idempotencyKey: string; transactionDate?: string }
export type InventorySummary = { productCount: number; inventoryItemCount: number; rawMaterialStock: { unit: string; quantity: number }[]; finishedGoodsStock: { unit: string; quantity: number }[]; lowStockCount: number; lowStock: InventoryBalance[]; recentMovements: InventoryMovement[] }
