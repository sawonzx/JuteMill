import { PrismaClient, UserRole, CustomerType, ProductType, RecordStatus, OrderStatus, InvoiceStatus, PaymentMethod, InventoryMovementType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const dbUrlMain = 'postgresql://postgres:12345@localhost:5432/jute_mill_main?schema=public';
const dbUrlA = 'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public';
const dbUrlB = 'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public';

const FACTORY_A_ID = 'factory-dhaka-fa';
const FACTORY_B_ID = 'factory-khulna-fb';

const standardProducts = [
  { sku: 'JUT-RAW-TOSSA-A', name: 'Raw Jute - Grade A (Tossa)', type: ProductType.RAW_MATERIAL, uom: 'BALE', costPrice: 4200, salesPrice: 4800 },
  { sku: 'JUT-RAW-WHITE-B', name: 'Raw Jute - Grade B (White)', type: ProductType.RAW_MATERIAL, uom: 'BALE', costPrice: 3600, salesPrice: 4100 },
  { sku: 'JUT-RAW-MESTA', name: 'Raw Jute - Mesta Fibre', type: ProductType.RAW_MATERIAL, uom: 'BALE', costPrice: 2900, salesPrice: 3400 },
  { sku: 'JUT-YRN-CRB-14', name: 'Jute Yarn 14lb Carpet Backing', type: ProductType.FINISHED_GOOD, uom: 'KG', costPrice: 180, salesPrice: 235 },
  { sku: 'JUT-YRN-HES-28', name: 'Jute Yarn 28lb Heavy Hessian', type: ProductType.FINISHED_GOOD, uom: 'KG', costPrice: 165, salesPrice: 215 },
  { sku: 'JUT-FAB-HES-45', name: 'Hessian Cloth 45in 11x12', type: ProductType.FINISHED_GOOD, uom: 'METRE', costPrice: 85, salesPrice: 115 },
  { sku: 'JUT-FAB-SCK-30', name: 'Sacking Twill 30in 6x8', type: ProductType.FINISHED_GOOD, uom: 'METRE', costPrice: 72, salesPrice: 98 },
  { sku: 'JUT-BAG-B-TWILL', name: 'B-Twill Standard Grain Bag (50kg)', type: ProductType.FINISHED_GOOD, uom: 'PIECE', costPrice: 95, salesPrice: 130 },
  { sku: 'JUT-BAG-HVY-CEE', name: 'Heavy Cee Coffee Bag (60kg)', type: ProductType.FINISHED_GOOD, uom: 'PIECE', costPrice: 110, salesPrice: 155 },
  { sku: 'JUT-BAG-SUGAR', name: 'Sugar Bag L-Twill (100kg)', type: ProductType.FINISHED_GOOD, uom: 'PIECE', costPrice: 140, salesPrice: 195 },
  { sku: 'JUT-GEO-SOIL-700', name: 'Soil-Saver Geotextile 700gsm', type: ProductType.FINISHED_GOOD, uom: 'SQ_M', costPrice: 130, salesPrice: 180 },
];

async function wipeDatabase(prisma) {
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesOrderLine.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.productionRecord.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.factoryProductThreshold.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.userFactoryAssignment.deleteMany();
  await prisma.user.deleteMany();
  await prisma.factory.deleteMany();
  await prisma.company.deleteMany();
}

async function seedBranch(prisma, config) {
  const passwordHash = await bcrypt.hash('password123', 10);
  
  await prisma.company.create({
    data: {
      name: 'Bengal Jute Industries Ltd.',
      code: 'BJIL',
      currency: 'BDT',
      email: 'info@bengaljute.demo',
      phone: '+880 2-9887766',
      address: 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
    },
  });

  const factory = await prisma.factory.create({
    data: {
      id: config.factoryId,
      code: config.code,
      name: config.name,
      location: config.location,
      address: config.address,
      phone: config.phone,
      email: config.email,
    },
  });

  for (const u of config.users) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        role: u.role,
        factoryId: factory.id,
        passwordHash,
        active: true,
      },
    });
    await prisma.userFactoryAssignment.create({
      data: {
        userId: user.id,
        factoryId: factory.id,
      },
    });
  }

  const createdProducts = [];
  for (const p of standardProducts) {
    const prod = await prisma.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        type: p.type,
        uom: p.uom,
        costPrice: p.costPrice,
        salesPrice: p.salesPrice,
        minOrderQty: 1,
        active: true,
      },
    });
    createdProducts.push(prod);
  }

  const whRaw = await prisma.warehouse.create({
    data: {
      factoryId: factory.id,
      name: config.rawWhName,
      code: config.rawWhCode,
      location: config.location,
      address: config.address,
      active: true,
    },
  });

  const whFin = await prisma.warehouse.create({
    data: {
      factoryId: factory.id,
      name: config.finWhName,
      code: config.finWhCode,
      location: config.location,
      address: config.address,
      active: true,
    },
  });

  for (let i = 0; i < createdProducts.length; i++) {
    const prod = createdProducts[i];
    const isRaw = prod.type === ProductType.RAW_MATERIAL;
    const targetWh = isRaw ? whRaw : whFin;
    const initialQty = isRaw ? (config.code === 'F-A' ? 2400 : 1800) : (config.code === 'F-A' ? 12000 : 8500);

    await prisma.inventoryBalance.create({
      data: {
        warehouseId: targetWh.id,
        productId: prod.id,
        quantity: initialQty,
        reservedQuantity: 0,
        reorderPoint: isRaw ? 500 : 2000,
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        warehouseId: targetWh.id,
        productId: prod.id,
        type: InventoryMovementType.RECEIPT,
        quantity: initialQty,
        referenceType: 'INITIAL_STOCK',
        referenceId: `INIT-${config.code}-${prod.sku}`,
        notes: `Opening inventory balance for ${config.name}`,
        createdAt: new Date(Date.now() - 30 * 86400000),
      },
    });
  }

  const createdCustomers = [];
  for (const c of config.customers) {
    const cust = await prisma.customer.create({
      data: {
        factoryId: factory.id,
        code: c.code,
        name: c.name,
        contactPerson: c.contactPerson,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        type: CustomerType.BUSINESS,
        status: RecordStatus.ACTIVE,
      },
    });
    createdCustomers.push(cust);
  }

  const sampleCust = createdCustomers[0];
  const finishedGoods = createdProducts.filter((p) => p.type === ProductType.FINISHED_GOOD);
  const sampleProduct = finishedGoods[0];

  const order = await prisma.salesOrder.create({
    data: {
      factoryId: factory.id,
      customerId: sampleCust.id,
      orderNumber: `SO-${config.code}-1001`,
      status: OrderStatus.CONFIRMED,
      orderDate: new Date(Date.now() - 10 * 86400000),
      dueDate: new Date(Date.now() + 15 * 86400000),
      totalAmount: 130000,
      deliveryAddress: sampleCust.address,
      lines: {
        create: [
          {
            productId: sampleProduct.id,
            quantity: 1000,
            unitPrice: Number(sampleProduct.salesPrice),
            lineTotal: 1000 * Number(sampleProduct.salesPrice),
          },
        ],
      },
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      factoryId: factory.id,
      customerId: sampleCust.id,
      orderId: order.id,
      invoiceNumber: `INV-${config.code}-1001`,
      status: InvoiceStatus.PART_PAID,
      issueDate: new Date(Date.now() - 8 * 86400000),
      dueDate: new Date(Date.now() + 20 * 86400000),
      subtotal: 130000,
      taxAmount: 0,
      totalAmount: 130000,
      paidAmount: 50000,
      outstandingAmount: 80000,
      items: {
        create: [
          {
            productId: sampleProduct.id,
            description: `${sampleProduct.name} - 1,000 units`,
            quantity: 1000,
            unitPrice: Number(sampleProduct.salesPrice),
            lineTotal: 130000,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      receiptNumber: `RCP-${config.code}-1001`,
      amount: 50000,
      method: PaymentMethod.BANK_TRANSFER,
      reference: `TXN-${config.code}-INIT`,
      paymentDate: new Date(Date.now() - 5 * 86400000),
      notes: 'Initial 50k payment received',
    },
  });
}

async function seedMainOffice(prisma) {
  const passwordHash = await bcrypt.hash('password123', 10);
  
  await prisma.company.create({
    data: {
      name: 'Bengal Jute Industries Ltd.',
      code: 'BJIL',
      currency: 'BDT',
      email: 'info@bengaljute.demo',
      phone: '+880 2-9887766',
      address: 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
    },
  });

  const facA = await prisma.factory.create({
    data: {
      id: FACTORY_A_ID,
      code: 'F-A',
      name: 'Dhaka Jute Mill',
      location: 'Dhaka',
      address: 'Tongi Industrial Area, Gazipur, Dhaka, Bangladesh',
      phone: '+880 2-9811223',
      email: 'dhaka.mill@bengaljute.demo',
    },
  });

  const facB = await prisma.factory.create({
    data: {
      id: FACTORY_B_ID,
      code: 'F-B',
      name: 'Khulna Jute Mill',
      location: 'Khulna',
      address: 'Khalishpur Industrial Zone, Khulna, Bangladesh',
      phone: '+880 41-762233',
      email: 'khulna.mill@bengaljute.demo',
    },
  });

  await prisma.user.create({
    data: {
      name: 'Anwar Hossain',
      email: 'admin@juteworks.demo',
      role: UserRole.HEAD_OFFICE_ADMIN,
      passwordHash,
      active: true,
    },
  });

  for (const p of standardProducts) {
    await prisma.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        type: p.type,
        uom: p.uom,
        costPrice: p.costPrice,
        salesPrice: p.salesPrice,
        minOrderQty: 1,
        active: true,
      },
    });
  }
}

async function main() {
  console.log('--- Seeding Isolated Branch Databases ---');

  console.log('\nConfiguring jute_mill_fac_a (Factory A - Dhaka Mill)...');
  const prismaA = new PrismaClient({ datasources: { db: { url: dbUrlA } } });
  await wipeDatabase(prismaA);
  await seedBranch(prismaA, {
    factoryId: FACTORY_A_ID,
    code: 'F-A',
    name: 'Dhaka Jute Mill',
    location: 'Dhaka',
    address: 'Tongi Industrial Area, Gazipur, Dhaka, Bangladesh',
    phone: '+880 2-9811223',
    email: 'dhaka.mill@bengaljute.demo',
    rawWhName: 'Raw Jute Godown A',
    rawWhCode: 'WH-A-RAW',
    finWhName: 'Finished Goods Godown A',
    finWhCode: 'WH-A-FG',
    users: [
      { name: 'Kamal Uddin', email: 'manager.a@juteworks.demo', role: UserRole.FACTORY_MANAGER },
      { name: 'Salma Begum', email: 'accounts.a@juteworks.demo', role: UserRole.ACCOUNTANT },
      { name: 'Mizanur Rahman', email: 'staff.a@juteworks.demo', role: UserRole.STAFF },
    ],
    customers: [
      { code: 'C-001', name: 'Eastern Packaging Co.', contactPerson: 'Nusrat Jahan', phone: '+880 1712-345601', email: 'procurement@easternpkg.com.bd', address: '42 Agrabad C/A, Chattogram', city: 'Chattogram' },
      { code: 'C-002', name: 'Delta Agro Exports', contactPerson: 'Mahmud Rahman', phone: '+880 1819-456702', email: 'delta.agro@outlook.com', address: '15 Motijheel, Dhaka 1000', city: 'Dhaka' },
    ],
  });
  await prismaA.$disconnect();
  console.log('✅ jute_mill_fac_a configured.');

  console.log('\nConfiguring jute_mill_fac_b (Factory B - Khulna Mill)...');
  const prismaB = new PrismaClient({ datasources: { db: { url: dbUrlB } } });
  await wipeDatabase(prismaB);
  await seedBranch(prismaB, {
    factoryId: FACTORY_B_ID,
    code: 'F-B',
    name: 'Khulna Jute Mill',
    location: 'Khulna',
    address: 'Khalishpur Industrial Zone, Khulna, Bangladesh',
    phone: '+880 41-762233',
    email: 'khulna.mill@bengaljute.demo',
    rawWhName: 'Raw Jute Godown B',
    rawWhCode: 'WH-B-RAW',
    finWhName: 'Finished Goods Godown B',
    finWhCode: 'WH-B-FG',
    users: [
      { name: 'Nasreen Akter', email: 'manager.b@juteworks.demo', role: UserRole.FACTORY_MANAGER },
      { name: 'Rafiq Ahmed', email: 'accounts.b@juteworks.demo', role: UserRole.ACCOUNTANT },
      { name: 'Shamima Chowdhury', email: 'staff.b@juteworks.demo', role: UserRole.STAFF },
    ],
    customers: [
      { code: 'C-003', name: 'Bengal Home & Fibre', contactPerson: 'Tasnim Akter', phone: '+880 1677-567803', email: 'info@bengalhomefibre.com', address: '8 Shibbari More, Khulna', city: 'Khulna' },
      { code: 'C-004', name: 'Green Delta Trading', contactPerson: 'Faisal Karim', phone: '+880 1912-789004', email: 'trading@greendelta.bd', address: '12 Sonadanga Main Rd, Khulna', city: 'Khulna' },
    ],
  });
  await prismaB.$disconnect();
  console.log('✅ jute_mill_fac_b configured.');

  console.log('\nConfiguring jute_mill_main (Head Office)...');
  const prismaMain = new PrismaClient({ datasources: { db: { url: dbUrlMain } } });
  await wipeDatabase(prismaMain);
  await seedMainOffice(prismaMain);
  await prismaMain.$disconnect();
  console.log('✅ jute_mill_main configured.');

  console.log('\n🎉 All 3 isolated branch databases successfully seeded!');
}

main().catch((err) => {
  console.error('Failed seeding isolated databases:', err);
  process.exit(1);
});

