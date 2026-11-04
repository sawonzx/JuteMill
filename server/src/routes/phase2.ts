import { Router, type Request, type Response, type NextFunction } from 'express'
import { CustomerType, InventoryMovementType, Prisma, PrismaClient, ProductType, RecordStatus, UserRole } from '@prisma/client'
import { z } from 'zod'
import { InventoryOperationError, recordInventoryMovement } from '../services/inventory.ts'

type Actor = {
  id: string
  role: UserRole
  factoryId: string | null
  factory: { id: string; code: string; name: string } | null
  factoryIds: string[] | null
  canManage: boolean
  canViewCustomers: boolean
}

class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next) }

const positiveQuantity = z.number().finite().positive().max(99_999_999_999.999).refine((value) => Number(value.toFixed(3)) === value, 'Use no more than three decimal places.')
const pageParams = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) })
const customerFields = z.object({
  name: z.string().trim().min(2).max(150), code: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/),
  contactPerson: z.string().trim().min(2).max(120), phone: z.string().trim().min(5).max(40),
  email: z.union([z.string().trim().email().max(180), z.literal('')]).optional().transform((value) => value || null),
  address: z.string().trim().min(3).max(250), city: z.string().trim().min(2).max(100),
  type: z.nativeEnum(CustomerType), status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
  notes: z.union([z.string().trim().max(2000), z.literal('')]).optional().transform((value) => value || null),
})
const productFields = z.object({
  name: z.string().trim().min(2).max(150), sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
  category: z.string().trim().min(2).max(80), type: z.nativeEnum(ProductType),
  unit: z.enum(['kg', 'MT', 'Bale', 'Piece', 'Meter']), description: z.union([z.string().trim().max(2000), z.literal('')]).optional().transform((value) => value || null),
  standardPrice: z.number().finite().min(0).max(9999999999.99).nullable().optional(), status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
})
const movementFields = z.object({
  factoryId: z.string().optional(), warehouseId: z.string().optional(), productId: z.string().min(1),
  type: z.nativeEnum(InventoryMovementType), quantity: z.number().finite().max(99_999_999_999.999).optional(),
  adjustmentMode: z.enum(['SET', 'DELTA']).optional(), reason: z.string().trim().max(300).optional(),
  reference: z.string().trim().max(120).optional(), remarks: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(100), transactionDate: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.type === InventoryMovementType.ADJUSTMENT) {
    if (!value.reason) context.addIssue({ code: 'custom', path: ['reason'], message: 'An adjustment reason is required.' })
    if (!value.adjustmentMode || value.quantity === undefined) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Choose an adjustment mode and enter a quantity.' })
    else if (value.adjustmentMode === 'SET' && (value.quantity < 0 || value.quantity > 99_999_999_999.999 || Number(value.quantity.toFixed(3)) !== value.quantity)) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Corrected quantity must be zero or greater, with at most three decimals.' })
    else if (value.adjustmentMode === 'DELTA' && (value.quantity === 0 || Math.abs(value.quantity) > 99_999_999_999.999 || Number(value.quantity.toFixed(3)) !== value.quantity)) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Adjustment amount must be non-zero and use at most three decimals.' })
  } else {
    if (value.quantity === undefined || !Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > 99_999_999_999.999 || Number(value.quantity.toFixed(3)) !== value.quantity) context.addIssue({ code: 'custom', path: ['quantity'], message: 'Enter a positive quantity with at most three decimals.' })
    if (value.type === InventoryMovementType.STOCK_OUT && !value.reason && !value.reference) context.addIssue({ code: 'custom', path: ['reason'], message: 'Stock out requires a reason or reference.' })
  }
})

function actorFor(res: Response): Actor { return res.locals.demoActor as Actor }
function pathId(req: Request) { return z.string().min(1).parse(req.params.id) }
function requireManager(actor: Actor) { if (!actor.canManage) throw new ApiError(403, 'Only factory managers and Head Office Admin can make this change.') }
function accessibleFactoryFilter(actor: Actor, requested?: string) {
  if (actor.factoryIds && requested && !actor.factoryIds.includes(requested)) throw new ApiError(403, 'This demo identity cannot access that factory.')
  return requested ? [requested] : actor.factoryIds
}
async function targetFactory(prisma: PrismaClient, actor: Actor, requested?: string) {
  const id = actor.role === UserRole.HEAD_OFFICE_ADMIN ? requested : actor.factoryId
  if (actor.role !== UserRole.HEAD_OFFICE_ADMIN && requested && requested !== actor.factoryId) throw new ApiError(403, 'This demo identity cannot access that factory.')
  if (!id) throw new ApiError(400, 'Select a factory for this record.')
  const factory = await prisma.factory.findUnique({ where: { id }, select: { id: true } })
  if (!factory) throw new ApiError(404, 'Factory not found.')
  return factory.id
}
function actorScope(actor: Actor) { return actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {} }
function paged<T>(items: T[], page: number, pageSize: number, total: number) { return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
function decimal(value: Prisma.Decimal | null | undefined) { return value == null ? null : Number(value) }

export function createPhaseTwoRouter(prisma: PrismaClient) {
  const router = Router()
  router.use(['/factories', '/customers', '/products', '/inventory'], asyncRoute(async (req, res, next) => {
    const identity = req.header('x-demo-user-id')
    if (!identity) throw new ApiError(401, 'Choose a demo identity to continue.')
    const user = await prisma.user.findFirst({ where: { id: identity, active: true }, include: { factory: { select: { id: true, code: true, name: true } } } })
    if (!user) throw new ApiError(401, 'Unknown or inactive demo identity.')
    const admin = user.role === UserRole.HEAD_OFFICE_ADMIN
    res.locals.demoActor = {
      id: user.id, role: user.role, factoryId: user.factoryId, factory: user.factory,
      factoryIds: admin ? null : user.factoryId ? [user.factoryId] : [],
      canManage: admin || user.role === UserRole.FACTORY_MANAGER,
      canViewCustomers: admin || user.role === UserRole.FACTORY_MANAGER || user.role === UserRole.ACCOUNTANT,
    } satisfies Actor
    next()
  }))

  router.get('/factories', asyncRoute(async (_req, res) => {
    const actor = actorFor(res)
    const factories = await prisma.factory.findMany({ where: actor.factoryIds ? { id: { in: actor.factoryIds } } : {}, select: { id: true, code: true, name: true, location: true }, orderBy: { code: 'asc' } })
    res.json(factories)
  }))

  // Customers are factory-owned and codes are unique only within their factory.
  router.get('/customers', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    if (!actor.canViewCustomers) throw new ApiError(403, 'Customer records are not available to this role.')
    const params = pageParams.extend({ q: z.string().optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'), factoryId: z.string().optional() }).parse(req.query)
    const factoryIds = accessibleFactoryFilter(actor, params.factoryId)
    const where: Prisma.CustomerWhereInput = {
      ...(factoryIds ? { factoryId: { in: factoryIds } } : {}),
      ...(params.status !== 'ALL' ? { status: params.status } : {}),
      ...(params.q?.trim() ? { OR: [{ name: { contains: params.q.trim(), mode: 'insensitive' } }, { code: { contains: params.q.trim(), mode: 'insensitive' } }, { phone: { contains: params.q.trim(), mode: 'insensitive' } }] } : {}),
    }
    const [rows, total] = await Promise.all([prisma.customer.findMany({ where, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ name: 'asc' }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }), prisma.customer.count({ where })])
    res.json(paged(rows, params.page, params.pageSize, total))
  }))
  router.post('/customers', asyncRoute(async (req, res) => {
    const actor = actorFor(res); requireManager(actor)
    const body = customerFields.extend({ factoryId: z.string().optional() }).parse(req.body)
    const factoryId = await targetFactory(prisma, actor, body.factoryId)
    const customer = await prisma.customer.create({ data: { ...body, factoryId } })
    res.status(201).json(customer)
  }))
  router.get('/customers/:id', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    if (!actor.canViewCustomers) throw new ApiError(403, 'Customer records are not available to this role.')
    const where = { id: pathId(req), ...(actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}) }
    const customer = await prisma.customer.findFirst({ where, include: { factory: { select: { id: true, code: true, name: true } }, orders: { where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, orderBy: { orderDate: 'desc' }, take: 20, select: { id: true, orderNumber: true, status: true, orderDate: true, dueDate: true, total: true } } } })
    if (!customer) throw new ApiError(404, 'Customer not found.')
    res.json({ ...customer, orders: customer.orders.map((order) => ({ ...order, total: decimal(order.total) })) })
  }))
  router.put('/customers/:id', asyncRoute(async (req, res) => {
    const actor = actorFor(res); requireManager(actor)
    const body = customerFields.parse(req.body)
    const where = { id: pathId(req), ...(actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}) }
    const existing = await prisma.customer.findFirst({ where })
    if (!existing) throw new ApiError(404, 'Customer not found.')
    const customer = await prisma.customer.update({ where: { id: existing.id }, data: body })
    res.json(customer)
  }))
  router.patch('/customers/:id/status', asyncRoute(async (req, res) => {
    const actor = actorFor(res); requireManager(actor)
    const { status } = z.object({ status: z.nativeEnum(RecordStatus) }).parse(req.body)
    const existing = await prisma.customer.findFirst({ where: { id: pathId(req), ...(actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}) } })
    if (!existing) throw new ApiError(404, 'Customer not found.')
    res.json(await prisma.customer.update({ where: { id: existing.id }, data: { status } }))
  }))

  // Product records are shared company-wide; only the stock breakdown is scoped.
  router.get('/products', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    const params = pageParams.extend({ q: z.string().optional(), category: z.string().optional(), type: z.nativeEnum(ProductType).optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE') }).parse(req.query)
    if (params.status !== 'ACTIVE' && !actor.canManage) throw new ApiError(403, 'Only managers may view inactive products.')
    const where: Prisma.ProductWhereInput = {
      status: params.status === 'ALL' ? undefined : params.status,
      category: params.category || undefined, type: params.type,
      ...(params.q?.trim() ? { OR: [{ name: { contains: params.q.trim(), mode: 'insensitive' } }, { sku: { contains: params.q.trim(), mode: 'insensitive' } }] } : {}),
    }
    const [rows, total, warehouses] = await Promise.all([prisma.product.findMany({ where, include: { inventory: { where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true, isDefault: true } } } }, thresholds: { where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } } } }, orderBy: [{ name: 'asc' }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }), prisma.product.count({ where }), prisma.warehouse.findMany({ where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] })])
    res.json(paged(rows.map((product) => mapProduct(product, warehouses)), params.page, params.pageSize, total))
  }))
  router.post('/products', asyncRoute(async (req, res) => {
    requireManager(actorFor(res))
    const body = productFields.parse(req.body)
    const product = await prisma.product.create({ data: { ...body, standardPrice: body.standardPrice ?? null } })
    const warehouses = await prisma.warehouse.findMany({ where: actorFor(res).factoryIds ? { factoryId: { in: actorFor(res).factoryIds! } } : {}, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] })
    res.status(201).json(mapProduct({ ...product, inventory: [], thresholds: [] }, warehouses))
  }))
  router.get('/products/:id', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    const [product, warehouses] = await Promise.all([prisma.product.findFirst({ where: { id: pathId(req), ...(!actor.canManage ? { status: RecordStatus.ACTIVE } : {}) }, include: { inventory: { where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true, isDefault: true } } } }, thresholds: { where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } } } } }), prisma.warehouse.findMany({ where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] })])
    if (!product) throw new ApiError(404, 'Product not found.')
    res.json(mapProduct(product, warehouses))
  }))
  router.put('/products/:id', asyncRoute(async (req, res) => {
    requireManager(actorFor(res))
    const body = productFields.parse(req.body)
    const existing = await prisma.product.findUnique({ where: { id: pathId(req) } })
    if (!existing) throw new ApiError(404, 'Product not found.')
    const product = await prisma.product.update({ where: { id: existing.id }, data: { ...body, standardPrice: body.standardPrice ?? null } })
    const actor = actorFor(res)
    const warehouses = await prisma.warehouse.findMany({ where: actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] })
    res.json(mapProduct({ ...product, inventory: [], thresholds: [] }, warehouses))
  }))
  router.patch('/products/:id/status', asyncRoute(async (req, res) => {
    requireManager(actorFor(res))
    const { status } = z.object({ status: z.nativeEnum(RecordStatus) }).parse(req.body)
    const product = await prisma.product.update({ where: { id: pathId(req) }, data: { status } })
    res.json(product)
  }))

  // Warehouses, balances, thresholds and all stock writes stay in server scope.
  router.get('/inventory/warehouses', asyncRoute(async (req, res) => {
    const actor = actorFor(res); const factoryIds = accessibleFactoryFilter(actor, typeof req.query.factoryId === 'string' ? req.query.factoryId : undefined)
    const warehouses = await prisma.warehouse.findMany({ where: factoryIds ? { factoryId: { in: factoryIds } } : {}, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] })
    res.json(warehouses)
  }))
  router.get('/inventory/summary', asyncRoute(async (_req, res) => {
    const actor = actorFor(res); const scope = actorScope(actor)
    const [productCount, balances, movements] = await Promise.all([
      prisma.product.count({ where: { status: RecordStatus.ACTIVE } }),
      loadInventoryRows(prisma, actor),
      prisma.inventoryMovement.findMany({ where: scope, include: movementInclude, orderBy: { transactionDate: 'desc' }, take: 8 }),
    ])
    const lowStock = balances.filter((balance) => balance.lowStock)
    res.json({ productCount, inventoryItemCount: balances.length, rawMaterialStock: sumByUnit(balances.filter((balance) => balance.product.type === ProductType.RAW_MATERIAL)), finishedGoodsStock: sumByUnit(balances.filter((balance) => balance.product.type === ProductType.FINISHED_PRODUCT)), lowStockCount: lowStock.length, lowStock: lowStock.slice(0, 8), recentMovements: movements.map(mapMovement) })
  }))
  router.get('/inventory/balances', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    const params = pageParams.extend({ q: z.string().optional(), category: z.string().optional(), type: z.nativeEnum(ProductType).optional(), stockStatus: z.enum(['LOW', 'HEALTHY']).optional(), factoryId: z.string().optional() }).parse(req.query)
    const factoryIds = accessibleFactoryFilter(actor, params.factoryId)
    const productWhere: Prisma.ProductWhereInput = { ...(params.category ? { category: params.category } : {}), ...(params.type ? { type: params.type } : {}), ...(params.q?.trim() ? { OR: [{ name: { contains: params.q.trim(), mode: 'insensitive' } }, { sku: { contains: params.q.trim(), mode: 'insensitive' } }] } : {}) }
    const filtered = (await loadInventoryRows(prisma, actor, productWhere))
      .filter((balance) => !factoryIds || factoryIds.includes(balance.factory.id))
      .filter((balance) => params.stockStatus !== 'LOW' || balance.lowStock)
      .filter((balance) => params.stockStatus !== 'HEALTHY' || !balance.lowStock)
      .sort((a, b) => a.product.name.localeCompare(b.product.name) || a.factory.code.localeCompare(b.factory.code))
    res.json(paged(filtered.slice((params.page - 1) * params.pageSize, params.page * params.pageSize), params.page, params.pageSize, filtered.length))
  }))
  router.get('/inventory/movements', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    const query = z.object({ ...pageParams.shape, factoryId: z.string().optional(), productId: z.string().optional(), type: z.nativeEnum(InventoryMovementType).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(req.query)
    const factoryIds = accessibleFactoryFilter(actor, query.factoryId)
    const where: Prisma.InventoryMovementWhereInput = {
      ...(factoryIds ? { factoryId: { in: factoryIds } } : {}), productId: query.productId, type: query.type,
      transactionDate: query.from || query.to ? { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } : undefined,
    }
    const [rows, total] = await Promise.all([prisma.inventoryMovement.findMany({ where, include: movementInclude, orderBy: { transactionDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.inventoryMovement.count({ where })])
    res.json(paged(rows.map(mapMovement), query.page, query.pageSize, total))
  }))
  router.post('/inventory/movements', asyncRoute(async (req, res) => {
    const actor = actorFor(res)
    const body = movementFields.parse(req.body)
    if (body.type === InventoryMovementType.ADJUSTMENT) requireManager(actor)
    if (!actor.canManage && actor.role !== UserRole.STAFF) throw new ApiError(403, 'This role has read-only inventory access.')
    const factoryId = await targetFactory(prisma, actor, body.factoryId)
    const product = await prisma.product.findUnique({ where: { id: body.productId }, select: { id: true } })
    if (!product) throw new ApiError(404, 'Product not found.')
    const result = await recordInventoryMovement(prisma, actor.id, { ...body, factoryId, transactionDate: body.transactionDate ? new Date(body.transactionDate) : undefined })
    const movement = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: result.movement.id }, include: movementInclude })
    res.status(result.duplicate ? 200 : 201).json({ ...mapMovement(movement), duplicate: result.duplicate })
  }))
  router.put('/inventory/thresholds', asyncRoute(async (req, res) => {
    const actor = actorFor(res); requireManager(actor)
    const body = z.object({ factoryId: z.string().optional(), productId: z.string().min(1), minimumQuantity: z.number().finite().min(0).max(99_999_999_999.999).refine((v) => Number(v.toFixed(3)) === v).nullable() }).parse(req.body)
    const factoryId = await targetFactory(prisma, actor, body.factoryId)
    if (!await prisma.product.findUnique({ where: { id: body.productId } })) throw new ApiError(404, 'Product not found.')
    if (body.minimumQuantity === null) {
      await prisma.factoryProductThreshold.deleteMany({ where: { factoryId, productId: body.productId } })
      return res.json({ factoryId, productId: body.productId, minimumQuantity: null })
    }
    const threshold = await prisma.factoryProductThreshold.upsert({ where: { factoryId_productId: { factoryId, productId: body.productId } }, update: { minimumQuantity: body.minimumQuantity }, create: { factoryId, productId: body.productId, minimumQuantity: body.minimumQuantity } })
    res.json({ ...threshold, minimumQuantity: Number(threshold.minimumQuantity) })
  }))

  return router
}

const movementInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
  factory: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.InventoryMovementInclude

function mapProduct(product: any, warehouses: any[] = []) {
  const balances = new Map<string, { quantity: Prisma.Decimal }>(product.inventory.map((balance: any) => [balance.warehouseId, balance] as [string, { quantity: Prisma.Decimal }]))
  const minimumByFactory = new Map<string, number>(product.thresholds.map((threshold: any) => [threshold.factoryId, Number(threshold.minimumQuantity)] as [string, number]))
  return {
    ...product,
    standardPrice: decimal(product.standardPrice),
    stockByFactory: warehouses.map((warehouse: any) => ({ factory: warehouse.factory, warehouse: { id: warehouse.id, name: warehouse.name, isDefault: warehouse.isDefault }, quantity: Number(balances.get(warehouse.id)?.quantity ?? 0), minimumQuantity: minimumByFactory.get(warehouse.factoryId) ?? null })),
    thresholds: product.thresholds.map((threshold: any) => ({ factory: threshold.factory, minimumQuantity: Number(threshold.minimumQuantity) })),
  }
}

async function loadInventoryRows(prisma: PrismaClient, actor: Actor, productFilter: Prisma.ProductWhereInput = {}) {
  const factoryScope = actor.factoryIds ? { factoryId: { in: actor.factoryIds } } : {}
  const [products, warehouses, balances, thresholds] = await Promise.all([
    prisma.product.findMany({ where: productFilter, orderBy: { name: 'asc' } }),
    prisma.warehouse.findMany({ where: factoryScope, include: { factory: { select: { id: true, code: true, name: true } } }, orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }] }),
    prisma.inventoryBalance.findMany({ where: factoryScope, include: { factory: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true, isDefault: true } } } }),
    prisma.factoryProductThreshold.findMany({ where: factoryScope }),
  ])
  const balanceByPair = new Map(balances.map((balance) => [`${balance.warehouseId}:${balance.productId}`, balance]))
  const thresholdByPair = new Map(thresholds.map((threshold) => [`${threshold.factoryId}:${threshold.productId}`, Number(threshold.minimumQuantity)]))
  return warehouses.flatMap((warehouse) => products.map((product) => {
    const balance = balanceByPair.get(`${warehouse.id}:${product.id}`)
    const quantity = Number(balance?.quantity ?? 0)
    const minimumQuantity = thresholdByPair.get(`${warehouse.factoryId}:${product.id}`) ?? null
    return {
      id: balance?.id ?? `zero-${warehouse.id}-${product.id}`,
      factory: warehouse.factory,
      warehouse: { id: warehouse.id, name: warehouse.name, isDefault: warehouse.isDefault },
      product: { id: product.id, sku: product.sku, name: product.name, category: product.category, type: product.type, unit: product.unit, status: product.status },
      quantity,
      minimumQuantity,
      lowStock: minimumQuantity != null && minimumQuantity > 0 && quantity <= minimumQuantity,
      updatedAt: balance?.updatedAt ?? warehouse.createdAt,
    }
  }))
}
function mapMovement(movement: any) {
  return { id: movement.id, type: movement.type, product: movement.product, factory: movement.factory, warehouse: movement.warehouse, quantity: Number(movement.quantity), previousQuantity: Number(movement.previousQuantity), resultingQuantity: Number(movement.resultingQuantity), reason: movement.reason, reference: movement.reference, remarks: movement.remarks, createdBy: movement.createdBy, transactionDate: movement.transactionDate, createdAt: movement.createdAt }
}
function sumByUnit(balances: { quantity: number; product: { unit: string } }[]) {
  const byUnit = new Map<string, number>()
  for (const balance of balances) byUnit.set(balance.product.unit, (byUnit.get(balance.product.unit) ?? 0) + balance.quantity)
  return [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity }))
}

export function phaseTwoErrorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError || error instanceof InventoryOperationError) return res.status(error.status).json({ error: error.message })
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Please check the submitted fields.', details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) })
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A record with that code or submission key already exists.' })
    if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found.' })
    if (error.code === 'P2003') return res.status(409).json({ error: 'This record is referenced by existing data and cannot be removed.' })
  }
  console.error(error)
  return res.status(500).json({ error: 'The server could not complete this request.' })
}
