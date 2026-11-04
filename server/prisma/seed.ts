import { createHash } from 'node:crypto'
import { PrismaClient, UserRole, OrderStatus, InvoiceStatus, PaymentMethod, ProductionStatus, InventoryMovementType, CustomerType, ProductType, RecordStatus } from '@prisma/client'

const prisma = new PrismaClient()
const now = new Date()

async function main() {
  const factories = await Promise.all([
    prisma.factory.upsert({ where: { code: 'F-A' }, update: {}, create: { code: 'F-A', name: 'Karnaphuli Jute Works', location: 'Chattogram', address: 'Port Access Road, Chattogram, Bangladesh' } }),
    prisma.factory.upsert({ where: { code: 'F-B' }, update: {}, create: { code: 'F-B', name: 'Meghna Fibre Mills', location: 'Narayanganj', address: 'Siddhirganj Industrial Area, Narayanganj, Bangladesh' } }),
  ])
  const [factoryA, factoryB] = factories
  const users = [
    ['Head Office Admin', 'admin@juteworks.demo', UserRole.HEAD_OFFICE_ADMIN, null],
    ['Factory A Manager', 'manager.a@juteworks.demo', UserRole.FACTORY_MANAGER, factoryA.id],
    ['Factory B Manager', 'manager.b@juteworks.demo', UserRole.FACTORY_MANAGER, factoryB.id],
    ['Factory A Accountant', 'accounts.a@juteworks.demo', UserRole.ACCOUNTANT, factoryA.id],
    ['Factory B Accountant', 'accounts.b@juteworks.demo', UserRole.ACCOUNTANT, factoryB.id],
    ['Factory A Staff', 'staff.a@juteworks.demo', UserRole.STAFF, factoryA.id],
    ['Factory B Staff', 'staff.b@juteworks.demo', UserRole.STAFF, factoryB.id],
  ] as const
  const demoUsers = new Map<string, { id: string }>()
  for (const [name, email, role, factoryId] of users) {
    const user = await prisma.user.upsert({ where: { email }, update: { name, role, factoryId, active: true }, create: { name, email, role, factoryId } })
    demoUsers.set(email, user)
  }
  const admin = demoUsers.get('admin@juteworks.demo')!
  const managerA = demoUsers.get('manager.a@juteworks.demo')!
  const managerB = demoUsers.get('manager.b@juteworks.demo')!

  const customerSpecs = [
    [factoryA, 'C-001', 'Eastern Packaging Co.', 'Nusrat Jahan', 'Chattogram'],
    [factoryA, 'C-002', 'Delta Agro Exports', 'Mahmud Rahman', 'Dhaka'],
    [factoryA, 'C-003', 'Bengal Home & Fibre', 'Tasnim Akter', 'Khulna'],
    [factoryA, 'C-010', 'Dhaka Jute Traders', 'Sajid Karim', 'Dhaka'],
    [factoryA, 'C-011', 'North Star Commodities', 'Farhana Islam', 'Rajshahi'],
    [factoryA, 'C-012', 'Green Loom Industries', 'Rafiq Hasan', 'Chattogram'],
    [factoryB, 'C-001', 'Southern Coast Exports', 'Sharmeen Chowdhury', 'Narayanganj'],
    [factoryB, 'C-004', 'Riverine Commodities Ltd.', 'Imran Hossain', 'Narayanganj'],
    [factoryB, 'C-005', 'Harbour Trading House', 'Rezaul Karim', 'Chattogram'],
    [factoryB, 'C-007', 'Ganges Mills & Supply', 'Sadia Noor', 'Dhaka'],
    [factoryB, 'C-008', 'Fibrecraft Bangladesh', 'Arif Mahmood', 'Narayanganj'],
    [factoryB, 'C-009', 'Eastern Bay Trading', 'Maliha Sultana', 'Cumilla'],
  ] as const
  const customerMap = new Map<string, { id: string }>()
  for (const [factory, code, name, contactPerson, city] of customerSpecs) {
    const customer = await prisma.customer.upsert({
      where: { factoryId_code: { factoryId: factory.id, code } },
      update: { name, contactPerson, phone: '+880 1700 000000', email: `procurement@${code.toLowerCase().replace('-', '')}.${factory.code.toLowerCase()}.demo`, address: `${city}, Bangladesh`, city, type: CustomerType.BUSINESS, status: RecordStatus.ACTIVE },
      create: { factoryId: factory.id, code, name, contactPerson, phone: '+880 1700 000000', email: `procurement@${code.toLowerCase().replace('-', '')}.${factory.code.toLowerCase()}.demo`, address: `${city}, Bangladesh`, city, type: CustomerType.BUSINESS },
    })
    customerMap.set(`${factory.code}:${code}`, customer)
  }

  const productSpecs = [
    { sku: 'YRN-100', name: 'Jute yarn · 8 lb', category: 'Jute Yarn', type: ProductType.FINISHED_PRODUCT, unit: 'MT', price: 148000, description: 'Export grade, 8 lb jute yarn.' },
    { sku: 'FAB-210', name: 'Hessian cloth · 40 in', category: 'Hessian Cloth', type: ProductType.FINISHED_PRODUCT, unit: 'Meter', price: 186, description: 'Plain weave hessian cloth, 40 inch width.' },
    { sku: 'SAC-330', name: 'Sacking bag · 50 kg', category: 'Jute Bags', type: ProductType.FINISHED_PRODUCT, unit: 'Piece', price: 92, description: 'Standard 50 kg jute sacking bag.' },
    { sku: 'TW-115', name: 'Jute twine · 3 ply', category: 'Other Finished Products', type: ProductType.FINISHED_PRODUCT, unit: 'kg', price: 172, description: 'Three ply twisted jute twine.' },
    { sku: 'RJ-001', name: 'Raw jute · grade A', category: 'Raw Jute', type: ProductType.RAW_MATERIAL, unit: 'kg', price: null, description: 'Clean, long fibre raw jute for spinning.' },
    { sku: 'RJ-002', name: 'Raw jute · grade B', category: 'Raw Jute', type: ProductType.RAW_MATERIAL, unit: 'kg', price: null, description: 'Standard raw jute fibre for mill production.' },
    { sku: 'YRN-R01', name: 'Mill spun jute yarn · input', category: 'Jute Yarn', type: ProductType.RAW_MATERIAL, unit: 'MT', price: null, description: 'Intermediate yarn used in weaving.' },
    { sku: 'CHEM-01', name: 'Jute batching oil', category: 'Other Raw Materials', type: ProductType.RAW_MATERIAL, unit: 'kg', price: null, description: 'Batching oil used during fibre preparation.' },
    { sku: 'BIND-01', name: 'Baling twine', category: 'Other Raw Materials', type: ProductType.RAW_MATERIAL, unit: 'kg', price: null, description: 'Consumable twine for finished bale packing.' },
    { sku: 'HES-048', name: 'Hessian cloth · 48 in', category: 'Hessian Cloth', type: ProductType.FINISHED_PRODUCT, unit: 'Meter', price: 218, description: 'Wide hessian cloth for industrial packaging.' },
    { sku: 'SACK-040', name: 'Sacking cloth · 40 in', category: 'Sacking Cloth', type: ProductType.FINISHED_PRODUCT, unit: 'Meter', price: 164, description: 'Heavy weave sacking cloth.' },
    { sku: 'SACK-050', name: 'Sacking cloth · 50 in', category: 'Sacking Cloth', type: ProductType.FINISHED_PRODUCT, unit: 'Meter', price: 202, description: 'Wide heavy weave sacking cloth.' },
    { sku: 'JB-025', name: 'Jute bag · 25 kg', category: 'Jute Bags', type: ProductType.FINISHED_PRODUCT, unit: 'Piece', price: 58, description: '25 kg agricultural produce bag.' },
    { sku: 'GEO-200', name: 'Jute geotextile · 200 gsm', category: 'Other Finished Products', type: ProductType.FINISHED_PRODUCT, unit: 'Meter', price: 285, description: 'Woven jute geotextile for soil control.' },
    { sku: 'MAT-001', name: 'Jute floor mat', category: 'Other Finished Products', type: ProductType.FINISHED_PRODUCT, unit: 'Piece', price: 420, description: 'Natural fibre woven utility mat.' },
  ] as const
  const products = new Map<string, { id: string }>()
  for (const item of productSpecs) {
    const product = await prisma.product.upsert({ where: { sku: item.sku }, update: { name: item.name, category: item.category, type: item.type, unit: item.unit, description: item.description, standardPrice: item.price, status: RecordStatus.ACTIVE }, create: { sku: item.sku, name: item.name, category: item.category, type: item.type, unit: item.unit, description: item.description, standardPrice: item.price } })
    products.set(item.sku, product)
  }

  const warehouses = new Map<string, { id: string }>()
  for (const factory of factories) {
    const warehouse = await prisma.warehouse.upsert({ where: { factoryId_code: { factoryId: factory.id, code: 'MAIN' } }, update: { name: `${factory.name} Main Warehouse`, isDefault: true }, create: { factoryId: factory.id, code: 'MAIN', name: `${factory.name} Main Warehouse`, isDefault: true } })
    warehouses.set(factory.code, warehouse)
  }

  const stockPlan: Record<string, { a: number; b: number; minA: number; minB: number }> = {
    'YRN-100': { a: 82, b: 147.42, minA: 100, minB: 150 }, 'FAB-210': { a: 126, b: 39.78, minA: 120, minB: 40 },
    'SAC-330': { a: 34, b: 71.37, minA: 40, minB: 65 }, 'TW-115': { a: 61, b: 95.94, minA: 40, minB: 90 },
    'RJ-001': { a: 400, b: 720, minA: 500, minB: 800 }, 'RJ-002': { a: 900, b: 1150, minA: 600, minB: 700 },
    'YRN-R01': { a: 45, b: 90, minA: 60, minB: 80 }, 'CHEM-01': { a: 70, b: 55, minA: 50, minB: 40 },
    'BIND-01': { a: 80, b: 160, minA: 90, minB: 120 }, 'HES-048': { a: 1250, b: 1600, minA: 500, minB: 500 },
    'SACK-040': { a: 1800, b: 2000, minA: 600, minB: 600 }, 'SACK-050': { a: 1100, b: 800, minA: 700, minB: 700 },
    'JB-025': { a: 8500, b: 5600, minA: 3000, minB: 3000 }, 'GEO-200': { a: 740, b: 390, minA: 400, minB: 400 },
    'MAT-001': { a: 2200, b: 1980, minA: 800, minB: 800 },
  }
  for (const factory of factories) {
    const side = factory.code === 'F-A' ? 'a' : 'b'
    for (const item of productSpecs) {
      const product = products.get(item.sku)!
      const warehouse = warehouses.get(factory.code)!
      const stock = stockPlan[item.sku]!
      await prisma.factoryProductThreshold.upsert({ where: { factoryId_productId: { factoryId: factory.id, productId: product.id } }, update: { minimumQuantity: stock[side === 'a' ? 'minA' : 'minB'] }, create: { factoryId: factory.id, productId: product.id, minimumQuantity: stock[side === 'a' ? 'minA' : 'minB'] } })
      await prisma.inventoryBalance.upsert({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } }, update: {}, create: { factoryId: factory.id, warehouseId: warehouse.id, productId: product.id, quantity: 0 } })
      const openingKey = `SEED-OPENING-${factory.code}-${item.sku}`
      const hasOpeningHistory = await prisma.inventoryMovement.findFirst({ where: { warehouseId: warehouse.id, productId: product.id } })
      if (!hasOpeningHistory) {
        await prisma.$transaction(async (tx) => {
          const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })
          const previous = Number(balance.quantity)
          const quantity = stock[side]
          const resulting = previous + quantity
          await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: resulting } })
          await tx.inventoryMovement.create({ data: { idempotencyKey: openingKey, requestHash: createHash('sha256').update(openingKey).digest('hex'), factoryId: factory.id, warehouseId: warehouse.id, productId: product.id, type: InventoryMovementType.STOCK_IN, quantity, previousQuantity: previous, resultingQuantity: resulting, reason: 'Opening demo stock', reference: `OPEN-${factory.code}`, createdById: admin.id, transactionDate: new Date(now.getTime() - 30 * 86400000) } })
        })
      }
    }
  }

  const seededMoves = [
    { factory: factoryA, user: managerA, sku: 'RJ-002', type: InventoryMovementType.STOCK_IN, quantity: 180, reason: 'Received raw jute from local growers', reference: 'GRN-A-26011' },
    { factory: factoryA, user: managerA, sku: 'RJ-001', type: InventoryMovementType.STOCK_OUT, quantity: 40, reason: 'Issued to fibre preparation line', reference: 'ISS-A-26008' },
    { factory: factoryA, user: managerA, sku: 'BIND-01', type: InventoryMovementType.STOCK_OUT, quantity: 8, reason: 'Packing floor issue', reference: 'ISS-A-26009' },
    { factory: factoryB, user: managerB, sku: 'RJ-002', type: InventoryMovementType.STOCK_IN, quantity: 220, reason: 'Raw jute delivery received', reference: 'GRN-B-26014' },
    { factory: factoryB, user: managerB, sku: 'RJ-001', type: InventoryMovementType.STOCK_OUT, quantity: 50, reason: 'Issued to spinning line', reference: 'ISS-B-26006' },
    { factory: factoryB, user: managerB, sku: 'CHEM-01', type: InventoryMovementType.ADJUSTMENT, quantity: 2, reason: 'Recount corrected two kilogram variance', reference: 'COUNT-B-26002' },
  ] as const
  for (const [index, move] of seededMoves.entries()) {
    const key = `SEED-MOVE-${move.factory.code}-${String(index + 1).padStart(2, '0')}`
    if (await prisma.inventoryMovement.findUnique({ where: { idempotencyKey: key } })) continue
    const warehouse = warehouses.get(move.factory.code)!
    const product = products.get(move.sku)!
    await prisma.$transaction(async (tx) => {
      const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })
      const previous = Number(balance.quantity)
      const delta = move.type === InventoryMovementType.STOCK_IN ? move.quantity : move.type === InventoryMovementType.STOCK_OUT ? -move.quantity : move.quantity
      const resulting = previous + delta
      if (resulting < 0) throw new Error(`Seed stock would become negative for ${move.sku} at ${move.factory.code}.`)
      await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: resulting } })
      await tx.inventoryMovement.create({ data: { idempotencyKey: key, requestHash: createHash('sha256').update(key).digest('hex'), factoryId: move.factory.id, warehouseId: warehouse.id, productId: product.id, type: move.type, quantity: Math.abs(delta), previousQuantity: previous, resultingQuantity: resulting, reason: move.reason, reference: move.reference, remarks: null, createdById: move.user.id, transactionDate: new Date(now.getTime() - (10 - index) * 86400000) } })
    })
  }

  // Preserve the Phase 1 dashboard's fictional order, invoice and production snapshots.
  const orderSpecs = [
    ['SO-26041', factoryA, 'C-001', 'YRN-100', OrderStatus.IN_PRODUCTION, 3200000, -3],
    ['SO-26042', factoryA, 'C-002', 'FAB-210', OrderStatus.CONFIRMED, 2280000, 5],
    ['SO-26043', factoryA, 'C-003', 'SAC-330', OrderStatus.READY, 1840000, -1],
    ['SO-26044', factoryB, 'C-004', 'TW-115', OrderStatus.IN_PRODUCTION, 2750000, 7],
    ['SO-26045', factoryB, 'C-005', 'YRN-100', OrderStatus.CONFIRMED, 1420000, 12],
    ['SO-26046', factoryB, 'C-001', 'FAB-210', OrderStatus.DISPATCHED, 3260000, -4],
  ] as const
  for (const [orderNumber, factory, customerCode, sku, status, total, dueOffset] of orderSpecs) {
    const customer = customerMap.get(`${factory.code}:${customerCode}`)!
    const product = products.get(sku)!
    const order = await prisma.salesOrder.upsert({ where: { orderNumber }, update: {}, create: { orderNumber, factoryId: factory.id, customerId: customer.id, status, orderDate: new Date(now.getTime() - 12 * 86400000), dueDate: new Date(now.getTime() + dueOffset * 86400000), total, lines: { create: [{ productId: product.id, quantity: 24, unitPrice: Number(productSpecs.find((item) => item.sku === sku)?.price ?? 0) }] } } })
    await prisma.invoice.upsert({ where: { invoiceNumber: `INV-${orderNumber.slice(3)}` }, update: {}, create: { invoiceNumber: `INV-${orderNumber.slice(3)}`, factoryId: factory.id, customerId: customer.id, orderId: order.id, status: status === OrderStatus.READY || status === OrderStatus.DISPATCHED ? InvoiceStatus.PAID : status === OrderStatus.IN_PRODUCTION ? InvoiceStatus.PART_PAID : InvoiceStatus.ISSUED, issueDate: new Date(now.getTime() - 8 * 86400000), dueDate: new Date(now.getTime() + dueOffset * 86400000), total, payments: status === OrderStatus.READY || status === OrderStatus.DISPATCHED ? { create: { amount: total, method: PaymentMethod.BANK_TRANSFER, reference: `TRX-${orderNumber.slice(-3)}` } } : status === OrderStatus.IN_PRODUCTION ? { create: { amount: Math.round(total * 0.4), method: PaymentMethod.BANK_TRANSFER, reference: `ADV-${orderNumber.slice(-3)}` } } : undefined } })
  }
  for (const [factoryIndex, factory] of factories.entries()) for (const [productIndex, item] of productSpecs.slice(0, 3).entries()) {
    const batchNumber = `PR-${factoryIndex ? 'B' : 'A'}-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(productIndex + 1).padStart(2, '0')}`
    await prisma.productionRecord.upsert({ where: { batchNumber }, update: {}, create: { batchNumber, factoryId: factory.id, productId: products.get(item.sku)!.id, status: productIndex === 0 ? ProductionStatus.IN_PROGRESS : productIndex === 1 ? ProductionStatus.PLANNED : ProductionStatus.COMPLETED, plannedQuantity: 24 + factoryIndex * 9 + productIndex * 8, actualQuantity: productIndex === 2 ? 29 + factoryIndex * 7 : undefined, startDate: new Date(now.getTime() - (productIndex + 1) * 86400000), endDate: productIndex === 2 ? new Date(now.getTime() - 86400000) : undefined } })
  }
  console.log(`Seeded ${factories.length} factories, ${users.length} demo users, ${customerSpecs.length} factory customers, ${productSpecs.length} shared products, balances, thresholds, and movement history.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => prisma.$disconnect())
