import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { PrismaClient, UserRole } from '@prisma/client'
import { createPhaseTwoRouter, phaseTwoErrorHandler } from './routes/phase2.ts'

const prisma = new PrismaClient()
const app = express()
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json())

const demoEnabled = process.env.DEMO_IMPERSONATION_ENABLED === 'true'
app.use('/api', (req, res, next) => {
  if (!demoEnabled) return res.status(503).json({ error: 'Demo impersonation is disabled.' })
  res.setHeader('X-Demo-Mode', 'INSECURE_DEMO_IMPERSONATION')
  next()
})
app.use('/api', createPhaseTwoRouter(prisma))
app.get('/api/demo-users', async (_req, res, next) => {
  try { res.json(await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true, factory: { select: { id: true, code: true, name: true, location: true } } }, orderBy: { createdAt: 'asc' } })) } catch (e) { next(e) }
})
app.get('/api/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const identity = req.header('x-demo-user-id')
    if (!identity) return res.status(401).json({ error: 'Choose a demo identity to continue.' })
    const user = await prisma.user.findFirst({ where: { id: identity, active: true }, include: { factory: { select: { id: true, code: true, name: true, location: true } } } })
    if (!user) return res.status(401).json({ error: 'Unknown or inactive demo identity.' })
    const canSeeFinance = user.role === UserRole.HEAD_OFFICE_ADMIN || user.role === UserRole.ACCOUNTANT
    const canSeeSales = user.role !== UserRole.STAFF
    const canSeeOperations = user.role !== UserRole.ACCOUNTANT
    const factoryIds = user.role === UserRole.HEAD_OFFICE_ADMIN ? undefined : user.factoryId ? [user.factoryId] : []
    const whereFactory = factoryIds ? { factoryId: { in: factoryIds } } : {}
    const [factories, orderSummary, production, inventory, invoices, recentOrders, factoryOrders] = await Promise.all([
      prisma.factory.findMany({ where: factoryIds ? { id: { in: factoryIds } } : {}, include: { _count: { select: { users: true } } }, orderBy: { code: 'asc' } }),
      canSeeSales ? prisma.salesOrder.groupBy({ by: ['status'], where: whereFactory, _count: { _all: true }, _sum: { total: true } }) : Promise.resolve([]),
      canSeeOperations ? prisma.productionRecord.findMany({ where: whereFactory, include: { factory: { select: { name: true } }, product: { select: { name: true } } }, orderBy: { startDate: 'desc' } }) : Promise.resolve([]),
      canSeeOperations ? prisma.inventoryBalance.findMany({ where: whereFactory, include: { factory: { select: { name: true } }, product: { include: { thresholds: true } } } }) : Promise.resolve([]),
      canSeeFinance ? prisma.invoice.findMany({ where: whereFactory, include: { factory: { select: { code: true } }, payments: true } }) : Promise.resolve([]),
      canSeeSales ? prisma.salesOrder.findMany({ where: whereFactory, include: { customer: { select: { name: true } }, factory: { select: { name: true, code: true } } }, orderBy: { orderDate: 'desc' }, take: 6 }) : Promise.resolve([]),
      canSeeSales ? prisma.salesOrder.groupBy({ by: ['factoryId'], where: whereFactory, _count: { _all: true }, _sum: { total: true } }) : Promise.resolve([]),
    ])
    const revenue = invoices.reduce((sum, invoice) => sum + invoice.payments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0), 0)
    const receivables = invoices.reduce((sum, invoice) => sum + Number(invoice.total) - invoice.payments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0), 0)
    const monthBuckets = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(1); date.setUTCHours(0, 0, 0, 0); date.setUTCMonth(date.getUTCMonth() - (6 - index)); return { month: date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }), factoryA: 0, factoryB: 0 } })
    for (const invoice of invoices) for (const payment of invoice.payments) {
      const date = new Date(payment.paidAt)
      const index = (date.getUTCFullYear() - (new Date().getUTCFullYear())) * 12 + date.getUTCMonth() - (new Date().getUTCMonth() - 6)
      if (index >= 0 && index < monthBuckets.length) monthBuckets[index]![invoice.factory.code === 'F-B' ? 'factoryB' : 'factoryA'] += Number(payment.amount) / 1_000_000
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, factory: user.factory }, permissions: { finance: canSeeFinance, sales: canSeeSales, operations: canSeeOperations }, cashTrend: monthBuckets, perspective: user.role === UserRole.HEAD_OFFICE_ADMIN ? 'head-office' : 'factory', factories: factories.map((f) => ({ id: f.id, code: f.code, name: f.name, location: f.location })), metrics: { revenue: canSeeFinance ? revenue : 0, receivables: canSeeFinance ? receivables : 0, orderCount: canSeeSales ? orderSummary.reduce((n, item) => n + item._count._all, 0) : 0, productionBatches: canSeeOperations ? production.length : 0, activeFactories: factories.length }, ordersByStatus: orderSummary.map((item) => ({ status: item.status, count: item._count._all, value: Number(item._sum.total ?? 0) })), factoryPerformance: factoryOrders.map((item) => ({ factoryId: item.factoryId, name: factories.find((f) => f.id === item.factoryId)?.name ?? 'Factory', orderCount: item._count._all, orderValue: Number(item._sum.total ?? 0) })), production: production.slice(0, 5).map((p) => ({ batchNumber: p.batchNumber, factory: p.factory.name, product: p.product.name, status: p.status, plannedQuantity: Number(p.plannedQuantity), actualQuantity: p.actualQuantity ? Number(p.actualQuantity) : null })), lowStock: inventory.filter((item) => { const threshold = item.product.thresholds.find((entry) => entry.factoryId === item.factoryId); return threshold && Number(item.quantity) <= Number(threshold.minimumQuantity) }).map((item) => ({ factory: item.factory.name, product: item.product.name, quantity: Number(item.quantity), reorderLevel: Number(item.product.thresholds.find((entry) => entry.factoryId === item.factoryId)?.minimumQuantity ?? 0), unit: item.product.unit })), recentOrders: recentOrders.map((order) => ({ orderNumber: order.orderNumber, customer: order.customer.name, factory: order.factory.name, factoryCode: order.factory.code, status: order.status, dueDate: order.dueDate, total: Number(order.total) })) })
  } catch (e) { next(e) }
})
app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'configured', demoImpersonation: demoEnabled }))
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api/factories') || req.path.startsWith('/api/customers') || req.path.startsWith('/api/products') || req.path.startsWith('/api/inventory')) return phaseTwoErrorHandler(error, req, res, next)
  console.error(error); res.status(500).json({ error: 'The server could not load dashboard data.' })
})
const port = Number(process.env.API_PORT ?? 4000)
app.listen(port, () => console.log(`JuteWorks API listening on http://localhost:${port} (demo impersonation ${demoEnabled ? 'enabled' : 'disabled'})`))
