export type DemoUser = { id: string; name: string; email: string; role: 'HEAD_OFFICE_ADMIN' | 'FACTORY_MANAGER' | 'ACCOUNTANT' | 'STAFF'; factory: { id: string; code: string; name: string; location: string } | null }
export type DashboardData = {
  user: DemoUser
  permissions: { finance: boolean; sales: boolean; operations: boolean }
  cashTrend: { month: string; factoryA: number; factoryB: number }[]
  perspective: 'head-office' | 'factory'
  factories: { id: string; code: string; name: string; location: string }[]
  metrics: { revenue: number; receivables: number; orderCount: number; productionBatches: number; activeFactories: number }
  ordersByStatus: { status: string; count: number; value: number }[]
  factoryPerformance: { factoryId: string; name: string; orderCount: number; orderValue: number }[]
  production: { batchNumber: string; factory: string; product: string; status: string; plannedQuantity: number; actualQuantity: number | null }[]
  lowStock: { factory: string; product: string; quantity: number; reorderLevel: number; unit: string }[]
  recentOrders: { orderNumber: string; customer: string; factory: string; factoryCode: string; status: string; dueDate: string; total: number }[]
}
