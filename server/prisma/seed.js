import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  PrismaClient,
  UserRole,
  OrderStatus,
  InvoiceStatus,
  PaymentMethod,
  ProductionStatus,
  InventoryMovementType,
  CustomerType,
  ProductType,
  RecordStatus,
} from '@prisma/client';
const prisma = new PrismaClient();
const now = new Date();
function daysAgo(days) {
  return new Date(now.getTime() - days * 86_400_000);
}
function daysFromNow(days) {
  return new Date(now.getTime() + days * 86_400_000);
}
async function main() {
  console.log('\n🌱 Seeding Bengal Jute Industries Ltd. ERP demo data…\n');
  let company = await prisma.company.findFirst();
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'Bengal Jute Industries Ltd.',
        code: 'BJIL',
        currency: 'BDT',
        email: 'info@bengaljute.demo',
        phone: '+880 2-9887766',
        address: 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
      },
    });
  }
  const factoryA = await prisma.factory.upsert({
    where: {
      code: 'F-A',
    },
    update: {
      name: 'Dhaka Jute Mill',
      location: 'Dhaka',
      address: 'Tongi Industrial Area, Gazipur, Dhaka, Bangladesh',
    },
    create: {
      code: 'F-A',
      name: 'Dhaka Jute Mill',
      location: 'Dhaka',
      address: 'Tongi Industrial Area, Gazipur, Dhaka, Bangladesh',
      phone: '+880 2-9811223',
      email: 'dhaka.mill@bengaljute.demo',
    },
  });
  const factoryB = await prisma.factory.upsert({
    where: {
      code: 'F-B',
    },
    update: {
      name: 'Khulna Jute Mill',
      location: 'Khulna',
      address: 'Khalishpur Industrial Zone, Khulna, Bangladesh',
    },
    create: {
      code: 'F-B',
      name: 'Khulna Jute Mill',
      location: 'Khulna',
      address: 'Khalishpur Industrial Zone, Khulna, Bangladesh',
      phone: '+880 41-762233',
      email: 'khulna.mill@bengaljute.demo',
    },
  });
  const defaultPasswordHash = await bcrypt.hash('password123', 10);
  const userSpecs = [
    {
      name: 'Anwar Hossain',
      email: 'admin@juteworks.demo',
      role: UserRole.HEAD_OFFICE_ADMIN,
      factoryId: null,
    },
    {
      name: 'Kamal Uddin',
      email: 'manager.a@juteworks.demo',
      role: UserRole.FACTORY_MANAGER,
      factoryId: factoryA.id,
    },
    {
      name: 'Nasreen Akter',
      email: 'manager.b@juteworks.demo',
      role: UserRole.FACTORY_MANAGER,
      factoryId: factoryB.id,
    },
    {
      name: 'Salma Begum',
      email: 'accounts.a@juteworks.demo',
      role: UserRole.ACCOUNTANT,
      factoryId: factoryA.id,
    },
    {
      name: 'Rafiq Ahmed',
      email: 'accounts.b@juteworks.demo',
      role: UserRole.ACCOUNTANT,
      factoryId: factoryB.id,
    },
    {
      name: 'Mizanur Rahman',
      email: 'staff.a@juteworks.demo',
      role: UserRole.STAFF,
      factoryId: factoryA.id,
    },
    {
      name: 'Shamima Chowdhury',
      email: 'staff.b@juteworks.demo',
      role: UserRole.STAFF,
      factoryId: factoryB.id,
    },
  ];
  const userMap = new Map();
  for (const s of userSpecs) {
    const user = await prisma.user.upsert({
      where: {
        email: s.email,
      },
      update: {
        name: s.name,
        role: s.role,
        factoryId: s.factoryId,
        passwordHash: defaultPasswordHash,
        active: true,
      },
      create: {
        name: s.name,
        email: s.email,
        role: s.role,
        factoryId: s.factoryId,
        passwordHash: defaultPasswordHash,
      },
    });
    userMap.set(s.email, user);
    if (s.factoryId) {
      await prisma.userFactoryAssignment.upsert({
        where: {
          userId_factoryId: {
            userId: user.id,
            factoryId: s.factoryId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          factoryId: s.factoryId,
        },
      });
    }
  }
  const admin = userMap.get('admin@juteworks.demo');
  const managerA = userMap.get('manager.a@juteworks.demo');
  const managerB = userMap.get('manager.b@juteworks.demo');
  const staffA = userMap.get('staff.a@juteworks.demo');
  const staffB = userMap.get('staff.b@juteworks.demo');
  const customerSpecs = [
    {
      factory: factoryA,
      code: 'C-001',
      name: 'Eastern Packaging Co.',
      contactPerson: 'Nusrat Jahan',
      phone: '+880 1712-345601',
      email: 'procurement@easternpkg.com.bd',
      address: '42 Agrabad C/A, Chattogram',
      city: 'Chattogram',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Major sacking buyer, monthly standing order.',
    },
    {
      factory: factoryA,
      code: 'C-002',
      name: 'Delta Agro Exports',
      contactPerson: 'Mahmud Rahman',
      phone: '+880 1819-456702',
      email: 'delta.agro@outlook.com',
      address: '15 Motijheel, Dhaka 1000',
      city: 'Dhaka',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Agricultural commodity exporter. Regular jute bag buyer.',
    },
    {
      factory: factoryA,
      code: 'C-003',
      name: 'Bengal Home & Fibre',
      contactPerson: 'Tasnim Akter',
      phone: '+880 1677-567803',
      email: 'info@bengalhomefibre.com',
      address: '8 Shibbari More, Khulna',
      city: 'Khulna',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Home furnishings and jute fabric buyer.',
    },
    {
      factory: factoryA,
      code: 'C-004',
      name: 'Rahim Jute Wholesalers',
      contactPerson: 'Abdur Rahim',
      phone: '+880 1534-678904',
      email: null,
      address: '23 Nawabpur Road, Dhaka',
      city: 'Dhaka',
      type: CustomerType.INDIVIDUAL,
      status: RecordStatus.ACTIVE,
      notes: 'Cash on delivery trade customer.',
    },
    {
      factory: factoryA,
      code: 'C-005',
      name: 'North Star Commodities',
      contactPerson: 'Farhana Islam',
      phone: '+880 1912-789005',
      email: 'farhana@northstarcommodities.bd',
      address: '56 Station Road, Rajshahi',
      city: 'Rajshahi',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Geotextile and sacking bags for agricultural grain storage.',
    },
    {
      factory: factoryA,
      code: 'C-006',
      name: 'Green Loom Industries',
      contactPerson: 'Rafiq Hasan',
      phone: '+880 1855-890106',
      email: 'orders@greenloom.com.bd',
      address: '77 Halishahar, Chattogram',
      city: 'Chattogram',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Textile weaver buying jute yarn.',
    },
    {
      factory: factoryA,
      code: 'C-007',
      name: 'Padma Textile Trading',
      contactPerson: 'Humayun Kabir',
      phone: '+880 1745-901207',
      email: 'padmatextile@gmail.com',
      address: '12 Mohakhali, Dhaka 1212',
      city: 'Dhaka',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Yarn and hessian cloth distributor.',
    },
    {
      factory: factoryA,
      code: 'C-008',
      name: 'Mitra & Sons Distributors',
      contactPerson: 'Sumon Mitra',
      phone: '+880 1688-012308',
      email: null,
      address: '90 Banani DOHS, Dhaka',
      city: 'Dhaka',
      type: CustomerType.BUSINESS,
      status: RecordStatus.INACTIVE,
      notes: 'Account currently on hold.',
    },
    {
      factory: factoryB,
      code: 'C-001',
      name: 'Southern Coast Exports',
      contactPerson: 'Sharmeen Chowdhury',
      phone: '+880 1711-234501',
      email: 'export@southerncoast.com.bd',
      address: '19 Mongla Port Road, Bagerhat',
      city: 'Bagerhat',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Primary export customer shipping via Mongla port.',
    },
    {
      factory: factoryB,
      code: 'C-002',
      name: 'Riverine Commodities Ltd.',
      contactPerson: 'Imran Hossain',
      phone: '+880 1822-345602',
      email: 'info@riverinecommodities.com',
      address: '33 Siddhirganj, Narayanganj',
      city: 'Narayanganj',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Grain trader and commercial bag buyer.',
    },
    {
      factory: factoryB,
      code: 'C-003',
      name: 'Harbour Trading House',
      contactPerson: 'Rezaul Karim',
      phone: '+880 1655-456703',
      email: 'harbour.trading@yahoo.com',
      address: '67 Strand Road, Chattogram',
      city: 'Chattogram',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Wholesale yarn and twine dealer.',
    },
    {
      factory: factoryB,
      code: 'C-004',
      name: 'Ganges Mills & Supply',
      contactPerson: 'Sadia Noor',
      phone: '+880 1944-567804',
      email: 'sadia@gangesmills.com.bd',
      address: '104 Dhanmondi, Dhaka 1205',
      city: 'Dhaka',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Industrial packaging buyer.',
    },
    {
      factory: factoryB,
      code: 'C-005',
      name: 'Fibrecraft Bangladesh',
      contactPerson: 'Arif Mahmood',
      phone: '+880 1533-678905',
      email: 'arif.m@fibrecraft.com.bd',
      address: '8 Adamjee EPZ, Narayanganj',
      city: 'Narayanganj',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Diversified jute handicrafts and shopping bags.',
    },
    {
      factory: factoryB,
      code: 'C-006',
      name: 'Eastern Bay Trading',
      contactPerson: 'Maliha Sultana',
      phone: '+880 1766-789006',
      email: 'maliha@easternbay.com.bd',
      address: '22 Comilla Cantonment Road, Cumilla',
      city: 'Cumilla',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Regional wholesale distributor.',
    },
    {
      factory: factoryB,
      code: 'C-007',
      name: 'Sundarban Eco Products',
      contactPerson: 'Jamal Uddin',
      phone: '+880 1877-890107',
      email: 'eco@sundarbanproducts.com',
      address: '5 Satkhira Sadar, Satkhira',
      city: 'Satkhira',
      type: CustomerType.BUSINESS,
      status: RecordStatus.ACTIVE,
      notes: 'Eco-friendly packaging manufacturer.',
    },
    {
      factory: factoryB,
      code: 'C-008',
      name: 'Kazi Jute Suppliers',
      contactPerson: 'Liton Kazi',
      phone: '+880 1611-901208',
      email: null,
      address: '45 Jessore Road, Khulna',
      city: 'Khulna',
      type: CustomerType.INDIVIDUAL,
      status: RecordStatus.INACTIVE,
      notes: 'Inactive seasonal purchaser.',
    },
  ];
  const customerMap = new Map();
  for (const s of customerSpecs) {
    const customer = await prisma.customer.upsert({
      where: {
        factoryId_code: {
          factoryId: s.factory.id,
          code: s.code,
        },
      },
      update: {
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        city: s.city,
        type: s.type,
        status: s.status,
        notes: s.notes,
      },
      create: {
        factoryId: s.factory.id,
        code: s.code,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        city: s.city,
        type: s.type,
        status: s.status,
        notes: s.notes,
      },
    });
    customerMap.set(`${s.factory.code}:${s.code}`, customer);
  }
  const productSpecs = [
    {
      sku: 'RJ-001',
      name: 'Raw Jute — Grade A',
      category: 'Raw Jute',
      type: ProductType.RAW_MATERIAL,
      unit: 'kg',
      price: null,
      description: 'Long-staple raw jute fibre for high-count yarn spinning.',
    },
    {
      sku: 'RJ-002',
      name: 'Raw Jute — Grade B',
      category: 'Raw Jute',
      type: ProductType.RAW_MATERIAL,
      unit: 'kg',
      price: null,
      description: 'Standard grade raw jute fibre for sacking and general weaving.',
    },
    {
      sku: 'RJ-003',
      name: 'Raw Jute — Cuttings',
      category: 'Raw Jute',
      type: ProductType.RAW_MATERIAL,
      unit: 'kg',
      price: null,
      description: 'Jute cuttings and coarse fibre for heavy packaging fabric.',
    },
    {
      sku: 'YRN-R01',
      name: 'Mill Spun Jute Yarn (Input)',
      category: 'Jute Yarn',
      type: ProductType.RAW_MATERIAL,
      unit: 'MT',
      price: null,
      description: 'Intermediate single-ply yarn input for loom weaving.',
    },
    {
      sku: 'CHEM-01',
      name: 'Jute Batching Oil',
      category: 'Other Raw Materials',
      type: ProductType.RAW_MATERIAL,
      unit: 'kg',
      price: null,
      description: 'Softening emulsion oil applied during jute fibre preparation.',
    },
    {
      sku: 'BIND-01',
      name: 'Baling Wire & Twine',
      category: 'Other Raw Materials',
      type: ProductType.RAW_MATERIAL,
      unit: 'kg',
      price: null,
      description: 'Industrial packaging wire and tying twine for finished bales.',
    },
    {
      sku: 'YRN-100',
      name: 'Jute Yarn — 8 lb CB',
      category: 'Jute Yarn',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'MT',
      price: 148000,
      description: 'Export grade 8 lb CB carpet backing jute yarn.',
    },
    {
      sku: 'YRN-101',
      name: 'Jute Yarn — 10 lb CRX',
      category: 'Jute Yarn',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'MT',
      price: 135000,
      description: 'Standard 10 lb CRX jute yarn for general weaving.',
    },
    {
      sku: 'FAB-210',
      name: 'Hessian Cloth — 40 in',
      category: 'Hessian Cloth',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 186,
      description: 'Plain weave hessian cloth, 40 inch width, 7.5 oz/sq.yd.',
    },
    {
      sku: 'HES-048',
      name: 'Hessian Cloth — 48 in',
      category: 'Hessian Cloth',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 218,
      description: 'Wide industrial packaging hessian fabric, 48 inch width.',
    },
    {
      sku: 'SACK-040',
      name: 'Sacking Cloth — 40 in',
      category: 'Sacking Cloth',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 164,
      description: 'Heavy twill weave sacking cloth for burlap bag production.',
    },
    {
      sku: 'SACK-050',
      name: 'Sacking Cloth — 50 in',
      category: 'Sacking Cloth',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 202,
      description: 'Extra-wide heavy weave sacking cloth.',
    },
    {
      sku: 'SAC-330',
      name: 'Jute Sacking Bag — 50 kg',
      category: 'Jute Bags',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Piece',
      price: 92,
      description: 'Standard 50 kg B-Twill agricultural commodity bag (100x60cm).',
    },
    {
      sku: 'JB-025',
      name: 'Jute Bag — 25 kg',
      category: 'Jute Bags',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Piece',
      price: 58,
      description: 'Medium 25 kg jute sack for grain, sugar, and flour packaging.',
    },
    {
      sku: 'JSB-001',
      name: 'Jute Shopping Bag — Standard',
      category: 'Jute Bags',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Piece',
      price: 45,
      description: 'Reusable eco-friendly laminated jute tote shopping bag.',
    },
    {
      sku: 'JSB-002',
      name: 'Jute Shopping Bag — Premium',
      category: 'Jute Bags',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Piece',
      price: 78,
      description: 'Printed premium promotional jute bag with padded cotton handles.',
    },
    {
      sku: 'TW-115',
      name: 'Jute Twine — 3 Ply',
      category: 'Other Finished Products',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'kg',
      price: 172,
      description: 'High tensile 3-ply twisted jute twine for tying and crafts.',
    },
    {
      sku: 'GEO-200',
      name: 'Jute Geotextile — 200 GSM',
      category: 'Other Finished Products',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 285,
      description: 'Soil erosion control biodegradable woven jute geotextile matting.',
    },
    {
      sku: 'MAT-001',
      name: 'Jute Floor Mat — Natural',
      category: 'Other Finished Products',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Piece',
      price: 420,
      description: 'Hand-woven natural golden jute utility floor rug (3x5 ft).',
    },
    {
      sku: 'GEO-300',
      name: 'Jute Geotextile — 300 GSM',
      category: 'Other Finished Products',
      type: ProductType.FINISHED_PRODUCT,
      unit: 'Meter',
      price: 380,
      description: 'Heavy-duty geotextile fabric for river embankment and slope protection.',
    },
  ];
  const productMap = new Map();
  for (const s of productSpecs) {
    const p = await prisma.product.upsert({
      where: {
        sku: s.sku,
      },
      update: {
        name: s.name,
        category: s.category,
        type: s.type,
        unit: s.unit,
        description: s.description,
        standardPrice: s.price,
        status: RecordStatus.ACTIVE,
      },
      create: {
        sku: s.sku,
        name: s.name,
        category: s.category,
        type: s.type,
        unit: s.unit,
        description: s.description,
        standardPrice: s.price,
      },
    });
    productMap.set(s.sku, {
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: s.price,
    });
  }
  const whA1 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryA.id,
        code: 'WH-1',
      },
    },
    update: {
      name: 'Warehouse 1',
      isDefault: true,
    },
    create: {
      factoryId: factoryA.id,
      code: 'WH-1',
      name: 'Warehouse 1',
      isDefault: true,
    },
  });
  const whA2 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryA.id,
        code: 'WH-2',
      },
    },
    update: {
      name: 'Warehouse 2',
      isDefault: false,
    },
    create: {
      factoryId: factoryA.id,
      code: 'WH-2',
      name: 'Warehouse 2',
      isDefault: false,
    },
  });
  const whA3 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryA.id,
        code: 'WH-3',
      },
    },
    update: {
      name: 'Warehouse 3',
      isDefault: false,
    },
    create: {
      factoryId: factoryA.id,
      code: 'WH-3',
      name: 'Warehouse 3',
      isDefault: false,
    },
  });
  const whB1 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryB.id,
        code: 'WH-1',
      },
    },
    update: {
      name: 'Warehouse 1',
      isDefault: true,
    },
    create: {
      factoryId: factoryB.id,
      code: 'WH-1',
      name: 'Warehouse 1',
      isDefault: true,
    },
  });
  const whB2 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryB.id,
        code: 'WH-2',
      },
    },
    update: {
      name: 'Warehouse 2',
      isDefault: false,
    },
    create: {
      factoryId: factoryB.id,
      code: 'WH-2',
      name: 'Warehouse 2',
      isDefault: false,
    },
  });
  const whB3 = await prisma.warehouse.upsert({
    where: {
      factoryId_code: {
        factoryId: factoryB.id,
        code: 'WH-3',
      },
    },
    update: {
      name: 'Warehouse 3',
      isDefault: false,
    },
    create: {
      factoryId: factoryB.id,
      code: 'WH-3',
      name: 'Warehouse 3',
      isDefault: false,
    },
  });
  const whMap = {
    'F-A': {
      'WH-1': whA1,
      'WH-2': whA2,
      'WH-3': whA3,
    },
    'F-B': {
      'WH-1': whB1,
      'WH-2': whB2,
      'WH-3': whB3,
    },
  };
  function getWarehouseCodeForSku(sku) {
    if (['RJ-001', 'RJ-002', 'RJ-003', 'YRN-R01', 'CHEM-01', 'BIND-01'].includes(sku)) {
      return 'WH-1';
    }
    if (['YRN-100', 'YRN-101', 'FAB-210', 'HES-048', 'SACK-040', 'SACK-050'].includes(sku)) {
      return 'WH-2';
    }
    return 'WH-3';
  }
  const stockPlan = {
    'RJ-001': {
      a: {
        opening: 450,
        min: 500,
      },
      b: {
        opening: 750,
        min: 600,
      },
    },
    'RJ-002': {
      a: {
        opening: 1000,
        min: 600,
      },
      b: {
        opening: 1200,
        min: 700,
      },
    },
    'RJ-003': {
      a: {
        opening: 190,
        min: 200,
      },
      b: {
        opening: 0,
        min: 150,
      },
    },
    'YRN-R01': {
      a: {
        opening: 55,
        min: 60,
      },
      b: {
        opening: 90,
        min: 80,
      },
    },
    'CHEM-01': {
      a: {
        opening: 75,
        min: 50,
      },
      b: {
        opening: 58,
        min: 40,
      },
    },
    'BIND-01': {
      a: {
        opening: 85,
        min: 90,
      },
      b: {
        opening: 150,
        min: 120,
      },
    },
    'YRN-100': {
      a: {
        opening: 80,
        min: 100,
      },
      b: {
        opening: 150,
        min: 120,
      },
    },
    'YRN-101': {
      a: {
        opening: 120,
        min: 80,
      },
      b: {
        opening: 65,
        min: 80,
      },
    },
    'FAB-210': {
      a: {
        opening: 1400,
        min: 500,
      },
      b: {
        opening: 490,
        min: 500,
      },
    },
    'HES-048': {
      a: {
        opening: 1300,
        min: 500,
      },
      b: {
        opening: 1650,
        min: 500,
      },
    },
    'SACK-040': {
      a: {
        opening: 1850,
        min: 600,
      },
      b: {
        opening: 2000,
        min: 600,
      },
    },
    'SACK-050': {
      a: {
        opening: 1150,
        min: 700,
      },
      b: {
        opening: 780,
        min: 700,
      },
    },
    'SAC-330': {
      a: {
        opening: 3500,
        min: 2000,
      },
      b: {
        opening: 5000,
        min: 3000,
      },
    },
    'JB-025': {
      a: {
        opening: 8800,
        min: 3000,
      },
      b: {
        opening: 5500,
        min: 3000,
      },
    },
    'JSB-001': {
      a: {
        opening: 4300,
        min: 2000,
      },
      b: {
        opening: 3900,
        min: 2000,
      },
    },
    'JSB-002': {
      a: {
        opening: 1600,
        min: 800,
      },
      b: {
        opening: 0,
        min: 600,
      },
    },
    'TW-115': {
      a: {
        opening: 65,
        min: 40,
      },
      b: {
        opening: 98,
        min: 90,
      },
    },
    'GEO-200': {
      a: {
        opening: 800,
        min: 400,
      },
      b: {
        opening: 390,
        min: 400,
      },
    },
    'MAT-001': {
      a: {
        opening: 2250,
        min: 800,
      },
      b: {
        opening: 2000,
        min: 800,
      },
    },
    'GEO-300': {
      a: {
        opening: 0,
        min: 300,
      },
      b: {
        opening: 550,
        min: 300,
      },
    },
  };
  for (const [sku, plan] of Object.entries(stockPlan)) {
    const prod = productMap.get(sku);
    for (const [facCode, facObj, spec] of [
      ['F-A', factoryA, plan.a],
      ['F-B', factoryB, plan.b],
    ]) {
      const wh = whMap[facCode][getWarehouseCodeForSku(sku)];
      await prisma.factoryProductThreshold.upsert({
        where: {
          factoryId_productId: {
            factoryId: facObj.id,
            productId: prod.id,
          },
        },
        update: {
          minimumQuantity: spec.min,
        },
        create: {
          factoryId: facObj.id,
          productId: prod.id,
          minimumQuantity: spec.min,
        },
      });
      await prisma.inventoryBalance.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: wh.id,
            productId: prod.id,
          },
        },
        update: {},
        create: {
          factoryId: facObj.id,
          warehouseId: wh.id,
          productId: prod.id,
          quantity: 0,
        },
      });
      if (spec.opening > 0) {
        const openKey = `SEED-OPEN-${facCode}-${sku}`;
        const exists = await prisma.inventoryMovement.findUnique({
          where: {
            idempotencyKey: openKey,
          },
        });
        if (!exists) {
          await prisma.$transaction(async (tx) => {
            const bal = await tx.inventoryBalance.findUniqueOrThrow({
              where: {
                warehouseId_productId: {
                  warehouseId: wh.id,
                  productId: prod.id,
                },
              },
            });
            const prev = Number(bal.quantity);
            const res = prev + spec.opening;
            await tx.inventoryBalance.update({
              where: {
                id: bal.id,
              },
              data: {
                quantity: res,
              },
            });
            await tx.inventoryMovement.create({
              data: {
                idempotencyKey: openKey,
                requestHash: createHash('sha256').update(openKey).digest('hex'),
                factoryId: facObj.id,
                warehouseId: wh.id,
                productId: prod.id,
                type: InventoryMovementType.STOCK_IN,
                quantity: spec.opening,
                previousQuantity: prev,
                resultingQuantity: res,
                reason: 'Opening stock balance',
                reference: `INIT-${facCode}`,
                createdById: admin.id,
                transactionDate: daysAgo(35),
              },
            });
          });
        }
      }
    }
  }
  const sampleMoves = [
    {
      factory: factoryA,
      sku: 'RJ-001',
      type: InventoryMovementType.STOCK_IN,
      qty: 150,
      user: managerA,
      reason: 'Raw jute delivered from Faridpur suppliers',
      ref: 'GRN-A-2601',
    },
    {
      factory: factoryA,
      sku: 'RJ-001',
      type: InventoryMovementType.STOCK_OUT,
      qty: 80,
      user: staffA,
      reason: 'Issued to spinning line 1',
      ref: 'ISS-A-2601',
    },
    {
      factory: factoryA,
      sku: 'SAC-330',
      type: InventoryMovementType.STOCK_IN,
      qty: 1200,
      user: managerA,
      reason: 'Finished sacking bags received from production',
      ref: 'PRD-A-2601',
    },
    {
      factory: factoryA,
      sku: 'SAC-330',
      type: InventoryMovementType.STOCK_OUT,
      qty: 500,
      user: staffA,
      reason: 'Dispatched for Sales Order SO-F-A-01',
      ref: 'DIS-A-2601',
    },
    {
      factory: factoryA,
      sku: 'CHEM-01',
      type: InventoryMovementType.ADJUSTMENT,
      qty: 3,
      user: managerA,
      reason: 'Physical inventory audit adjustment (+3 kg)',
      ref: 'ADJ-A-2601',
    },
    {
      factory: factoryB,
      sku: 'RJ-001',
      type: InventoryMovementType.STOCK_IN,
      qty: 200,
      user: managerB,
      reason: 'Raw jute delivery received at Khulna depot',
      ref: 'GRN-B-2601',
    },
    {
      factory: factoryB,
      sku: 'RJ-001',
      type: InventoryMovementType.STOCK_OUT,
      qty: 100,
      user: staffB,
      reason: 'Issued to carding section',
      ref: 'ISS-B-2601',
    },
    {
      factory: factoryB,
      sku: 'YRN-100',
      type: InventoryMovementType.STOCK_IN,
      qty: 25,
      user: managerB,
      reason: 'Finished 8lb yarn received from spinning',
      ref: 'PRD-B-2601',
    },
    {
      factory: factoryB,
      sku: 'YRN-100',
      type: InventoryMovementType.STOCK_OUT,
      qty: 15,
      user: staffB,
      reason: 'Dispatched to Harbour Trading House',
      ref: 'DIS-B-2601',
    },
  ];
  for (const [idx, m] of sampleMoves.entries()) {
    const key = `SEED-MOVE-${m.factory.code}-${idx + 1}`;
    const exists = await prisma.inventoryMovement.findUnique({
      where: {
        idempotencyKey: key,
      },
    });
    if (!exists) {
      const prod = productMap.get(m.sku);
      const wh = whMap[m.factory.code][getWarehouseCodeForSku(m.sku)];
      await prisma.$transaction(async (tx) => {
        const bal = await tx.inventoryBalance.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: wh.id,
              productId: prod.id,
            },
          },
        });
        const prev = Number(bal.quantity);
        const delta =
          m.type === InventoryMovementType.STOCK_IN
            ? m.qty
            : m.type === InventoryMovementType.STOCK_OUT
              ? -m.qty
              : m.qty;
        const res = prev + delta;
        await tx.inventoryBalance.update({
          where: {
            id: bal.id,
          },
          data: {
            quantity: res,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            idempotencyKey: key,
            requestHash: createHash('sha256').update(key).digest('hex'),
            factoryId: m.factory.id,
            warehouseId: wh.id,
            productId: prod.id,
            type: m.type,
            quantity: Math.abs(delta),
            previousQuantity: prev,
            resultingQuantity: res,
            reason: m.reason,
            reference: m.ref,
            createdById: m.user.id,
            transactionDate: daysAgo(15 - idx),
          },
        });
      });
    }
  }
  const orderData = [
    {
      orderNumber: 'SO-F-A-2601',
      factory: factoryA,
      customerKey: 'F-A:C-001',
      status: OrderStatus.FULFILLED,
      orderDays: 20,
      dueDays: -5,
      lines: [
        {
          sku: 'SAC-330',
          qty: 500,
          price: 92,
        },
        {
          sku: 'JB-025',
          qty: 1000,
          price: 58,
        },
      ],
      invoiceNumber: 'INV-F-A-2601',
      invoiceStatus: InvoiceStatus.PAID,
      paymentAmount: 104000,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      orderNumber: 'SO-F-A-2602',
      factory: factoryA,
      customerKey: 'F-A:C-002',
      status: OrderStatus.CONFIRMED,
      orderDays: 14,
      dueDays: 10,
      lines: [
        {
          sku: 'FAB-210',
          qty: 800,
          price: 186,
        },
      ],
      invoiceNumber: 'INV-F-A-2602',
      invoiceStatus: InvoiceStatus.PART_PAID,
      paymentAmount: 60000,
      paymentMethod: PaymentMethod.CHEQUE,
    },
    {
      orderNumber: 'SO-F-A-2603',
      factory: factoryA,
      customerKey: 'F-A:C-003',
      status: OrderStatus.DRAFT,
      orderDays: 2,
      dueDays: 20,
      lines: [
        {
          sku: 'YRN-100',
          qty: 10,
          price: 148000,
        },
      ],
      invoiceNumber: null,
      invoiceStatus: null,
      paymentAmount: 0,
      paymentMethod: null,
    },
    {
      orderNumber: 'SO-F-B-2601',
      factory: factoryB,
      customerKey: 'F-B:C-001',
      status: OrderStatus.FULFILLED,
      orderDays: 18,
      dueDays: -2,
      lines: [
        {
          sku: 'SAC-330',
          qty: 1000,
          price: 92,
        },
      ],
      invoiceNumber: 'INV-F-B-2601',
      invoiceStatus: InvoiceStatus.PAID,
      paymentAmount: 92000,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
    },
    {
      orderNumber: 'SO-F-B-2602',
      factory: factoryB,
      customerKey: 'F-B:C-003',
      status: OrderStatus.CONFIRMED,
      orderDays: 10,
      dueDays: 15,
      lines: [
        {
          sku: 'YRN-100',
          qty: 15,
          price: 148000,
        },
        {
          sku: 'TW-115',
          qty: 200,
          price: 172,
        },
      ],
      invoiceNumber: 'INV-F-B-2602',
      invoiceStatus: InvoiceStatus.ISSUED,
      paymentAmount: 0,
      paymentMethod: null,
    },
  ];
  for (const o of orderData) {
    const cust = customerMap.get(o.customerKey);
    let subtotal = 0;
    const lines = o.lines.map((l) => {
      const prod = productMap.get(l.sku);
      const lineTotal = l.qty * l.price;
      subtotal += lineTotal;
      return {
        productId: prod.id,
        quantity: l.qty,
        unitPrice: l.price,
        subtotal: lineTotal,
      };
    });
    const order = await prisma.salesOrder.upsert({
      where: {
        orderNumber: o.orderNumber,
      },
      update: {},
      create: {
        orderNumber: o.orderNumber,
        factoryId: o.factory.id,
        customerId: cust.id,
        status: o.status,
        orderDate: daysAgo(o.orderDays),
        dueDate: daysFromNow(o.dueDays),
        subtotal,
        total: subtotal,
        createdById: o.factory.code === 'F-A' ? managerA.id : managerB.id,
        fulfilledAt: o.status === OrderStatus.FULFILLED ? daysAgo(o.orderDays - 2) : null,
        lines: {
          create: lines,
        },
      },
    });
    if (o.invoiceNumber) {
      const paid = o.paymentAmount;
      const balDue = subtotal - paid;
      const invoice = await prisma.invoice.upsert({
        where: {
          invoiceNumber: o.invoiceNumber,
        },
        update: {},
        create: {
          invoiceNumber: o.invoiceNumber,
          factoryId: o.factory.id,
          customerId: cust.id,
          orderId: order.id,
          status: o.invoiceStatus,
          issueDate: daysAgo(o.orderDays - 1),
          dueDate: daysFromNow(o.dueDays),
          subtotal,
          total: subtotal,
          paidAmount: paid,
          balanceDue: balDue,
          items: {
            create: o.lines.map((l) => {
              const prod = productMap.get(l.sku);
              return {
                productId: prod.id,
                description: `${prod.name} (${prod.sku})`,
                quantity: l.qty,
                unitPrice: l.price,
                total: l.qty * l.price,
              };
            }),
          },
        },
      });
      if (paid > 0 && o.paymentMethod) {
        const receiptNo = `RCT-${o.invoiceNumber.slice(4)}`;
        await prisma.payment.upsert({
          where: {
            receiptNo,
          },
          update: {},
          create: {
            receiptNo,
            factoryId: o.factory.id,
            customerId: cust.id,
            invoiceId: invoice.id,
            amount: paid,
            method: o.paymentMethod,
            reference: `BANK-${receiptNo}`,
            paidAt: daysAgo(o.orderDays - 3),
            createdById: o.factory.code === 'F-A' ? managerA.id : managerB.id,
          },
        });
      }
    }
  }
  const batchData = [
    {
      batchNumber: 'PR-F-A-2601',
      factory: factoryA,
      rawSku: 'RJ-001',
      rawQty: 250,
      finSku: 'YRN-100',
      finQty: 0.22,
      wastage: 12,
      status: ProductionStatus.COMPLETED,
      days: 12,
    },
    {
      batchNumber: 'PR-F-A-2602',
      factory: factoryA,
      rawSku: 'RJ-002',
      rawQty: 800,
      finSku: 'SAC-330',
      finQty: 1200,
      wastage: 25,
      status: ProductionStatus.COMPLETED,
      days: 8,
    },
    {
      batchNumber: 'PR-F-A-2603',
      factory: factoryA,
      rawSku: 'RJ-002',
      rawQty: 500,
      finSku: 'JB-025',
      finQty: 1000,
      wastage: 15,
      status: ProductionStatus.DRAFT,
      days: 2,
    },
    {
      batchNumber: 'PR-F-B-2601',
      factory: factoryB,
      rawSku: 'RJ-001',
      rawQty: 300,
      finSku: 'YRN-100',
      finQty: 0.27,
      wastage: 10,
      status: ProductionStatus.COMPLETED,
      days: 14,
    },
    {
      batchNumber: 'PR-F-B-2602',
      factory: factoryB,
      rawSku: 'RJ-002',
      rawQty: 600,
      finSku: 'SAC-330',
      finQty: 900,
      wastage: 20,
      status: ProductionStatus.DRAFT,
      days: 1,
    },
  ];
  for (const b of batchData) {
    const raw = productMap.get(b.rawSku);
    const fin = productMap.get(b.finSku);
    await prisma.productionRecord.upsert({
      where: {
        batchNumber: b.batchNumber,
      },
      update: {},
      create: {
        batchNumber: b.batchNumber,
        factoryId: b.factory.id,
        rawMaterialId: raw.id,
        rawMaterialQuantity: b.rawQty,
        finishedProductId: fin.id,
        finishedQuantity: b.finQty,
        wastageQuantity: b.wastage,
        status: b.status,
        productionDate: daysAgo(b.days),
        completedAt: b.status === ProductionStatus.COMPLETED ? daysAgo(b.days - 1) : null,
        createdById: b.factory.code === 'F-A' ? managerA.id : managerB.id,
      },
    });
  }
  await prisma.auditLog.createMany({
    data: [
      {
        action: 'SYSTEM_INIT',
        entity: 'System',
        entityId: 'BJIL',
        details: 'Initialized ERP database and company configuration',
      },
      {
        action: 'SEED_DATA',
        entity: 'Database',
        entityId: 'SEED',
        details: 'Completed baseline multi-branch demonstration seeding',
      },
    ],
  });
  console.log('  Verifying inventory ledger reconciliation…');
  let reconcileErrors = 0;
  for (const [facCode, facObj] of [
    ['F-A', factoryA],
    ['F-B', factoryB],
  ]) {
    for (const [sku, prod] of productMap) {
      const wh = whMap[facCode][getWarehouseCodeForSku(sku)];
      const bal = await prisma.inventoryBalance.findUnique({
        where: {
          warehouseId_productId: {
            warehouseId: wh.id,
            productId: prod.id,
          },
        },
      });
      const stored = bal ? Number(bal.quantity) : 0;
      const moves = await prisma.inventoryMovement.findMany({
        where: {
          warehouseId: wh.id,
          productId: prod.id,
        },
        orderBy: {
          transactionDate: 'asc',
        },
      });
      let computed = 0;
      for (const m of moves) {
        if (m.type === InventoryMovementType.STOCK_IN) computed += Number(m.quantity);
        else if (m.type === InventoryMovementType.STOCK_OUT) computed -= Number(m.quantity);
        else computed = Number(m.resultingQuantity);
      }
      if (Math.abs(stored - computed) > 0.001) {
        console.error(`  ✗ MISMATCH: ${facCode} / ${sku}: stored=${stored}, computed=${computed}`);
        reconcileErrors++;
      }
    }
  }
  if (reconcileErrors === 0) {
    console.log('  ✓ 100% of inventory balances reconcile with movement history');
  }
  const [custCount, prodCount, orderCount, invCount, payCount, batchCount] = await Promise.all([
    prisma.customer.count(),
    prisma.product.count(),
    prisma.salesOrder.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.productionRecord.count(),
  ]);
  console.log(`\n  Seeding Summary:`);
  console.log(`    Company:             Bengal Jute Industries Ltd.`);
  console.log(`    Factories:           2 (Dhaka Jute Mill & Khulna Jute Mill)`);
  console.log(`    Demo Users:          7 personas configured with password 'password123'`);
  console.log(`    Customers:           ${custCount}`);
  console.log(`    Products:            ${prodCount}`);
  console.log(`    Sales Orders:        ${orderCount}`);
  console.log(`    Invoices:            ${invCount}`);
  console.log(`    Payments:            ${payCount}`);
  console.log(`    Production Batches:  ${batchCount}`);
  console.log('\n✅ Demo seed completed successfully.\n');
}
main()
  .catch((e) => {
    console.error('\n❌ Seed failed:\n', e);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
