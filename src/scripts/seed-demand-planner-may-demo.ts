import 'reflect-metadata';

import { randomUUID } from 'crypto';

import AdmZip from 'adm-zip';
import * as bcrypt from 'bcrypt';
import { parse as parseCsv } from 'csv-parse/sync';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { FeedbackSubmission } from '../activity/entities/feedback-submission.entity';
import { OrderFeedback } from '../activity/entities/order-feedback.entity';
import { AppModule } from '../app.module';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { DailyReport, DailyReportStatus } from '../daily-reports/entities/daily-report.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderReturn } from '../delivery-assignments/entities/order-return.entity';
import { ReturnItem } from '../delivery-assignments/entities/return-item.entity';
import { ExportsService } from '../exports/exports.service';
import { ForecastEngineService } from '../forecast-engine/forecast-engine.service';
import { InsightCenterService } from '../insight-center/insight-center.service';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Outlet, OutletStatus } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionProduct } from '../promotions/entities/promotion-product.entity';
import { PromotionTerritory } from '../promotions/entities/promotion-territory.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import {
  SalesIncident,
  SalesIncidentSeverity,
  SalesIncidentType,
} from '../sales-incidents/entities/sales-incident.entity';
import { SalesRoute, SalesRouteStatus } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit, StoreVisitStatus } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { buildWarehouseAnalytics } from '../warehouses/warehouse-analytics.util';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';

const SEED_TAG = 'MAY26_HIGH_DEMAND_DEMO';
const SEED_USERNAME_PREFIX = 'may26_demo_';
const SEED_EMAIL_DOMAIN = '@may26.seed.local';
const SEED_PROMOTION_CODE = 'MAY26SURGE';
const PROMOTION_START = '2026-05-03';
const PROMOTION_END = '2026-05-16';
const FORECAST_QUERY = {
  fromDate: '2026-05-01',
  toDate: '2026-05-18',
  forecastDays: '30',
  backtestDays: '14',
  planningWindow: 'next_month',
};
const COMPARISON_FORECAST_QUERY = {
  fromDate: '2026-04-12',
  toDate: '2026-04-30',
  forecastDays: '30',
  backtestDays: '14',
  planningWindow: 'next_month',
};
const INSIGHT_QUERY = {
  period: 'custom',
  fromDate: '2026-05-01',
  toDate: '2026-05-18',
  granularity: 'daily',
  demandType: 'all',
  viewMode: 'absolute',
  confidenceLevel: 'all',
  compareMode: 'previous_period',
};
const EXPORT_QUERY = {
  fromDate: '2026-05-01',
  toDate: '2026-05-18',
  forecastDays: '30',
};
const ORDER_DATES = [
  '2026-05-02',
  '2026-05-04',
  '2026-05-07',
  '2026-05-10',
  '2026-05-13',
  '2026-05-16',
] as const;
const VISIT_DATES = [
  '2026-05-01',
  '2026-05-06',
  '2026-05-12',
  '2026-05-18',
] as const;
const INTERVAL_ORDER_DAY_INDEXES = [
  [0, 1],
  [2, 3],
  [4, 5],
] as const;

type ProductKey =
  | 'coffee'
  | 'milo'
  | 'maggi'
  | 'milk'
  | 'coconut'
  | 'nestomalt';

type ShopKey = 'S1' | 'S2' | 'S3' | 'S4';

type ProductDefinition = {
  key: ProductKey;
  sku: string;
  baseCases: number;
  promoted: boolean;
};

type ShopDefinition = {
  key: ShopKey;
  shopName: string;
  ownerFirstName: string;
  ownerLastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  address: string;
  latitude: number;
  longitude: number;
  carry: ProductKey[];
  shopBias: number;
};

type ProductContext = ProductDefinition & {
  id: string;
  productName: string;
  sku: string;
  casePrice: number;
  unitPrice: number;
  unitsPerCase: number;
  packSize: string;
};

type ShopContext = ShopDefinition & {
  userId: string;
  outletId: string;
};

type OrderPlan = {
  id: string;
  orderCode: string;
  userId: string;
  shopKey: ShopKey;
  outletId: string;
  routeId: string;
  placedAt: Date;
  approvedAt: Date;
  completedAt: Date;
  source: string;
  paymentMethod: string;
  subtotalBeforeDiscount: number;
  promotionDiscountTotal: number;
  totalAfterDiscount: number;
  appliedPromotionId: string | null;
  appliedPromotionCode: string | null;
  items: OrderItemPlan[];
};

type OrderItemPlan = {
  id: string;
  orderId: string;
  productKey: ProductKey;
  productId: string;
  quantityCases: number;
  lineTotal: number;
};

type ReturnPlan = {
  id: string;
  assignmentId: string;
  orderId: string;
  shopKey: ShopKey;
  productKey: ProductKey;
  quantityCases: number;
  createdAt: Date;
  reason: string;
};

type LossPlan = {
  quantityUnits: number;
  notes: string;
};

type VisitInventorySnapshot = {
  currentUnits: number;
  soldUnits: number;
  deliveredUnits: number;
  returnedUnits: number;
  damagedUnits: number;
  expiredUnits: number;
  oosReason: string;
};

type ExpectedRetailRow = {
  id: string;
  expectedUnits: number;
  expectedCases: number;
};

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  { key: 'coffee', sku: 'NES-3IN1-CLASSIC-20', baseCases: 3, promoted: true },
  { key: 'milo', sku: 'NES-MILO-400', baseCases: 3, promoted: true },
  { key: 'maggi', sku: 'MAG-NOODLES-CHICKEN-070', baseCases: 4, promoted: false },
  { key: 'milk', sku: 'NES-NSPRAY-180-VAN', baseCases: 2, promoted: true },
  { key: 'coconut', sku: 'MAG-COCONUTMILK-080', baseCases: 2, promoted: false },
  { key: 'nestomalt', sku: 'NES-NESTOMALT-400', baseCases: 2, promoted: false },
] as const;

const SHOP_DEFINITIONS: ShopDefinition[] = [
  {
    key: 'S1',
    shopName: 'Karapitiya Day Fresh',
    ownerFirstName: 'Nadeesha',
    ownerLastName: 'Perera',
    username: `${SEED_USERNAME_PREFIX}nadeesha`,
    email: `nadeesha${SEED_EMAIL_DOMAIN}`,
    phoneNumber: '+94719026001',
    address: 'No. 88, Karapitiya Road, Galle 80000',
    latitude: 6.0553,
    longitude: 80.2143,
    carry: ['coffee', 'milo', 'maggi', 'milk'],
    shopBias: 1.1,
  },
  {
    key: 'S2',
    shopName: 'Ruhunu Mini Mart',
    ownerFirstName: 'Shamila',
    ownerLastName: 'De Silva',
    username: `${SEED_USERNAME_PREFIX}shamila`,
    email: `shamila${SEED_EMAIL_DOMAIN}`,
    phoneNumber: '+94719026002',
    address: 'No. 41, Wakwella Road, Galle 80000',
    latitude: 6.0429,
    longitude: 80.2078,
    carry: ['coffee', 'coconut', 'milk', 'nestomalt'],
    shopBias: 1.0,
  },
  {
    key: 'S3',
    shopName: 'Labuduwa Family Needs',
    ownerFirstName: 'Tharindu',
    ownerLastName: 'Madushanka',
    username: `${SEED_USERNAME_PREFIX}tharindu`,
    email: `tharindu${SEED_EMAIL_DOMAIN}`,
    phoneNumber: '+94719026003',
    address: 'No. 15, Labuduwa Junction, Galle 80000',
    latitude: 6.0471,
    longitude: 80.2364,
    carry: ['milo', 'maggi', 'nestomalt', 'coconut'],
    shopBias: 0.95,
  },
  {
    key: 'S4',
    shopName: 'Kalegana Super Choice',
    ownerFirstName: 'Dilrukshi',
    ownerLastName: 'Fernando',
    username: `${SEED_USERNAME_PREFIX}dilrukshi`,
    email: `dilrukshi${SEED_EMAIL_DOMAIN}`,
    phoneNumber: '+94719026004',
    address: 'No. 63, Kalegana Road, Galle 80000',
    latitude: 6.0617,
    longitude: 80.1984,
    carry: ['coffee', 'milo', 'maggi', 'coconut'],
    shopBias: 1.15,
  },
] as const;

const VISIT_FEEDBACK_NOTES = [
  'Weekend demand increased after school events and early office traffic.',
  'Competitor bundle discount changed customer questions but core Nestle lines still moved quickly.',
  'Customers asked for faster replenishment on fast-moving sachet and malt drink packs.',
  'Retail demand remained higher than normal because nearby small shops ran out of stock.',
] as const;

function atUtc(date: string, hour: number, minute = 0) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00.000Z`);
}

function roundNumber(value: number, fractionDigits = 2) {
  return Number(value.toFixed(fractionDigits));
}

function safeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sum(numbers: number[]) {
  return roundNumber(numbers.reduce((total, value) => total + value, 0));
}

function ensure<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function csvRows<T extends Record<string, unknown>>(zip: AdmZip, name: string) {
  const entry = zip.getEntry(name);
  if (!entry) {
    throw new Error(`Missing ${name} in generated export bundle.`);
  }
  return parseCsv(entry.getData().toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as T[];
}

function hasPromo(day: string) {
  return day >= PROMOTION_START && day <= PROMOTION_END;
}

function productIndex(key: ProductKey) {
  return PRODUCT_DEFINITIONS.findIndex((product) => product.key === key);
}

function splitUnits(units: number, shopIndex: number, productOrdinal: number) {
  if (units <= 0) {
    return { shelfUnits: 0, backroomUnits: 0 };
  }

  const shelfRatio = 0.58 + ((shopIndex + productOrdinal) % 3) * 0.08;
  const shelfUnits = Math.max(0, Math.min(units, Math.round(units * shelfRatio)));
  return {
    shelfUnits,
    backroomUnits: Math.max(0, units - shelfUnits),
  };
}

async function cleanupSeedData(manager: EntityManager) {
  const seedUsers = await manager.query(
    `
      SELECT id
      FROM users
      WHERE username LIKE $1
    `,
    [`${SEED_USERNAME_PREFIX}%`],
  );
  const seedUserIds = seedUsers.map((row: { id: string }) => row.id);

  const seedOutlets = await manager.query(
    `
      SELECT id
      FROM outlets
      WHERE owner_email LIKE $1
    `,
    [`%${SEED_EMAIL_DOMAIN}`],
  );
  const seedOutletIds = seedOutlets.map((row: { id: string }) => row.id);

  const seedRoutes = await manager.query(
    `
      SELECT id
      FROM sales_routes
      WHERE variance_json::text ILIKE $1
    `,
    [`%${SEED_TAG}%`],
  );
  const seedRouteIds = seedRoutes.map((row: { id: string }) => row.id);

  const seedAssignments = await manager.query(
    `
      SELECT id
      FROM delivery_assignments
      WHERE notes ILIKE $1
    `,
    [`%${SEED_TAG}%`],
  );
  const seedAssignmentIds = seedAssignments.map((row: { id: string }) => row.id);

  const seedOrders = await manager.query(
    `
      SELECT id
      FROM orders
      WHERE customer_note ILIKE $1
    `,
    [`%${SEED_TAG}%`],
  );
  const seedOrderIds = seedOrders.map((row: { id: string }) => row.id);

  const seedReturns = seedAssignmentIds.length || seedOrderIds.length
    ? await manager.query(
        `
          SELECT id
          FROM order_returns
          WHERE
            ($1::uuid[] <> '{}'::uuid[] AND assignment_id = ANY($1::uuid[]))
            OR ($2::uuid[] <> '{}'::uuid[] AND order_id = ANY($2::uuid[]))
        `,
        [seedAssignmentIds, seedOrderIds],
      )
    : [];
  const seedReturnIds = seedReturns.map((row: { id: string }) => row.id);

  const seedReports = await manager.query(
    `
      SELECT id
      FROM daily_reports
      WHERE route_summary_json::text ILIKE $1
    `,
    [`%${SEED_TAG}%`],
  );
  const seedReportIds = seedReports.map((row: { id: string }) => row.id);

  const seedPromotions = await manager.query(
    `
      SELECT id
      FROM promotions
      WHERE code = $1
    `,
    [SEED_PROMOTION_CODE],
  );
  const seedPromotionIds = seedPromotions.map((row: { id: string }) => row.id);

  if (seedReportIds.length > 0) {
    await manager.query(
      `DELETE FROM admin_report_reviews WHERE daily_report_id = ANY($1::uuid[])`,
      [seedReportIds],
    );
  }
  if (seedOrderIds.length > 0 || seedUserIds.length > 0) {
    await manager.query(
      `
        DELETE FROM order_feedbacks
        WHERE
          ($1::uuid[] <> '{}'::uuid[] AND order_id = ANY($1::uuid[]))
          OR ($2::uuid[] <> '{}'::uuid[] AND shop_owner_id = ANY($2::uuid[]))
      `,
      [seedOrderIds, seedUserIds],
    );
  }
  if (seedUserIds.length > 0) {
    await manager.query(
      `DELETE FROM feedback_submissions WHERE user_id = ANY($1::uuid[])`,
      [seedUserIds],
    );
  }
  await manager.query(
    `DELETE FROM activity_logs WHERE metadata::text ILIKE $1`,
    [`%${SEED_TAG}%`],
  );
  if (seedReturnIds.length > 0) {
    await manager.query(
      `DELETE FROM return_items WHERE return_id = ANY($1::uuid[])`,
      [seedReturnIds],
    );
    await manager.query(`DELETE FROM order_returns WHERE id = ANY($1::uuid[])`, [
      seedReturnIds,
    ]);
  }
  if (seedAssignmentIds.length > 0 || seedOrderIds.length > 0) {
    await manager.query(
      `
        DELETE FROM delivery_assignment_orders
        WHERE
          ($1::uuid[] <> '{}'::uuid[] AND assignment_id = ANY($1::uuid[]))
          OR ($2::uuid[] <> '{}'::uuid[] AND order_id = ANY($2::uuid[]))
      `,
      [seedAssignmentIds, seedOrderIds],
    );
    await manager.query(
      `DELETE FROM incident_reports WHERE assignment_id = ANY($1::uuid[])`,
      [seedAssignmentIds],
    );
    await manager.query(
      `DELETE FROM delivery_assignments WHERE id = ANY($1::uuid[])`,
      [seedAssignmentIds],
    );
  }
  if (seedRouteIds.length > 0 || seedOutletIds.length > 0) {
    await manager.query(
      `
        DELETE FROM sales_incidents
        WHERE
          ($1::uuid[] <> '{}'::uuid[] AND route_id = ANY($1::uuid[]))
          OR ($2::uuid[] <> '{}'::uuid[] AND shop_id = ANY($2::uuid[]))
      `,
      [seedRouteIds, seedOutletIds],
    );
    await manager.query(
      `
        DELETE FROM store_visits
        WHERE
          ($1::uuid[] <> '{}'::uuid[] AND route_id = ANY($1::uuid[]))
          OR ($2::uuid[] <> '{}'::uuid[] AND shop_id = ANY($2::uuid[]))
      `,
      [seedRouteIds, seedOutletIds],
    );
    await manager.query(
      `DELETE FROM route_approval_requests WHERE route_id = ANY($1::uuid[])`,
      [seedRouteIds],
    );
    await manager.query(
      `DELETE FROM route_beat_plan_items WHERE route_id = ANY($1::uuid[])`,
      [seedRouteIds],
    );
    await manager.query(
      `DELETE FROM van_load_requests WHERE route_id = ANY($1::uuid[])`,
      [seedRouteIds],
    );
    await manager.query(`DELETE FROM sales_routes WHERE id = ANY($1::uuid[])`, [
      seedRouteIds,
    ]);
  }
  if (seedReportIds.length > 0) {
    await manager.query(`DELETE FROM daily_reports WHERE id = ANY($1::uuid[])`, [
      seedReportIds,
    ]);
  }
  if (seedOrderIds.length > 0) {
    await manager.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [
      seedOrderIds,
    ]);
    await manager.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [seedOrderIds]);
  }
  if (seedPromotionIds.length > 0) {
    await manager.query(
      `DELETE FROM promotion_redemptions WHERE promotion_id = ANY($1::uuid[])`,
      [seedPromotionIds],
    );
    await manager.query(
      `DELETE FROM promotion_products WHERE promotion_id = ANY($1::uuid[])`,
      [seedPromotionIds],
    );
    await manager.query(
      `DELETE FROM promotion_territories WHERE promotion_id = ANY($1::uuid[])`,
      [seedPromotionIds],
    );
    await manager.query(`DELETE FROM promotions WHERE id = ANY($1::uuid[])`, [
      seedPromotionIds,
    ]);
  }
  if (seedOutletIds.length > 0) {
    await manager.query(`DELETE FROM outlets WHERE id = ANY($1::uuid[])`, [seedOutletIds]);
  }
  if (seedUserIds.length > 0) {
    await manager.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [seedUserIds]);
  }
}

function buildOrderQuantityCases(
  product: ProductContext,
  shop: ShopDefinition,
  dayIndex: number,
  shopIndex: number,
) {
  const parityLift = (productIndex(product.key) + dayIndex + shopIndex) % 2;
  const dayLift = [0, 0, 1, 1, 2, 3][dayIndex];
  const shopLift = shop.shopBias >= 1.1 ? 1 : 0;
  return Math.max(1, Math.round(product.baseCases + dayLift + shopLift + parityLift));
}

function buildFeedbackAnswers(
  shop: ShopDefinition,
  visitDate: string,
  primaryProduct: string,
  secondaryProduct: string,
) {
  return [
    {
      question: 'Customer demand change',
      answer: `Demand rose for ${primaryProduct} during the ${visitDate} cycle.`,
      notes:
        'Customers are buying faster before lunch and asking for extra weekend stock.',
    },
    {
      question: 'Market issue',
      answer: `Competitor shelf pressure was visible around ${shop.shopName}.`,
      notes: `Need quicker replenishment on ${secondaryProduct} because nearby shops are also short.`,
    },
  ];
}

function buildPromotionNotes(productName: string) {
  return [
    {
      name: 'May 2026 Fast Mover Boost',
      status: 'active',
      notes: `${productName} moved faster while the territory promotion was visible near the cashier.`,
    },
  ];
}

async function seedMayDemandScenario(
  manager: EntityManager,
  dataSource: DataSource,
) {
  await cleanupSeedData(manager);

  const territory = ensure(
    await manager.getRepository(Territory).findOne({
      where: { name: 'Galle A' },
    }),
    'Galle A territory is missing.',
  );
  const warehouse = ensure(
    await manager.getRepository(Warehouse).findOne({
      where: { id: '32cf3b49-aa38-4f68-ab06-24dd05407744' },
      relations: { territory: true },
    }),
    'Galle warehouse is missing.',
  );
  const distributor = ensure(
    await manager.getRepository(User).findOne({ where: { username: 'rajivx' } }),
    'Distributor rajivx is missing.',
  );
  const territoryManager = ensure(
    await manager.getRepository(User).findOne({ where: { username: 'TMgag' } }),
    'Territory manager TMgag is missing.',
  );
  const salesRepPrimary = ensure(
    await manager.getRepository(User).findOne({ where: { username: 'dulanjana' } }),
    'Sales rep dulanjana is missing.',
  );
  const salesRepSecondary = ensure(
    await manager.getRepository(User).findOne({ where: { username: 'mahi' } }),
    'Sales rep mahi is missing.',
  );
  const vehicle = ensure(
    await manager.getRepository(Vehicle).findOne({ where: { vehicleCode: 'LOV-5678' } }),
    'Galle distributor vehicle LOV-5678 is missing.',
  );

  const products = await manager.getRepository(Product).find({
    where: PRODUCT_DEFINITIONS.map((definition) => ({ sku: definition.sku })),
  });
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const selectedProducts: Record<ProductKey, ProductContext> = {} as Record<
    ProductKey,
    ProductContext
  >;
  for (const definition of PRODUCT_DEFINITIONS) {
    const product = ensure(
      productBySku.get(definition.sku),
      `Missing product for SKU ${definition.sku}.`,
    );
    selectedProducts[definition.key] = {
      ...definition,
      id: product.id,
      productName: product.productName,
      sku: product.sku,
      casePrice: safeNumber(product.casePrice),
      unitPrice: safeNumber(product.unitPrice),
      unitsPerCase: Math.max(1, safeNumber(product.productsPerCase)),
      packSize: product.packSize,
    };
  }

  const passwordHash = await bcrypt.hash('Insight@123', 10);
  const approvedAt = atUtc('2026-04-28', 6, 0);
  const shopContexts: ShopContext[] = SHOP_DEFINITIONS.map((shop, index) => ({
    ...shop,
    userId: randomUUID(),
    outletId: randomUUID(),
  }));

  await manager.insert(
    User,
    shopContexts.map((shop, index) => ({
      id: shop.userId,
      publicUserCode: `SHOP-MAY26-${String(index + 1).padStart(3, '0')}`,
      firstName: shop.ownerFirstName,
      lastName: shop.ownerLastName,
      username: shop.username,
      email: shop.email,
      phoneNumber: shop.phoneNumber,
      passwordHash,
      employeeId: null,
      nic: null,
      shopName: shop.shopName,
      address: shop.address,
      warehouseName: warehouse.name,
      territoryId: territory.id,
      warehouseId: warehouse.id,
      latitude: shop.latitude,
      longitude: shop.longitude,
      role: Role.SHOP_OWNER,
      platformAccess: Platform.MOBILE,
      accountStatus: AccountStatus.ACTIVE,
      approvalStatus: ApprovalStatus.APPROVED,
      approvedBy: territoryManager.username,
      approvedAt,
      rejectionReason: null,
      isEmailVerified: true,
      otpCodeHash: null,
      otpExpiresAt: null,
      otpLastSentAt: null,
      otpVerifiedAt: approvedAt,
      createdAt: atUtc('2026-04-25', 7 + index, 15),
      updatedAt: approvedAt,
    })),
  );

  await manager.insert(
    Outlet,
    shopContexts.map((shop, index) => ({
      id: shop.outletId,
      outletName: shop.shopName,
      ownerName: `${shop.ownerFirstName} ${shop.ownerLastName}`,
      ownerPhone: shop.phoneNumber,
      ownerEmail: shop.email,
      address: shop.address,
      territoryId: territory.id,
      warehouseId: warehouse.id,
      latitude: shop.latitude,
      longitude: shop.longitude,
      registeredBySalesRepId:
        index % 2 === 0 ? salesRepPrimary.id : salesRepSecondary.id,
      status: OutletStatus.APPROVED,
      rejectionReason: null,
      reviewedBy: territoryManager.id,
      reviewedAt: approvedAt,
      createdAt: atUtc('2026-04-26', 8 + index, 30),
      updatedAt: approvedAt,
    })),
  );

  const promotionId = randomUUID();
  await manager.insert(Promotion, {
    id: promotionId,
    name: 'May 2026 Fast Mover Boost',
    code: SEED_PROMOTION_CODE,
    description:
      'Regional fast-mover push on coffee, Milo, and milk drinks to support the May high-demand season.',
    startDate: atUtc(PROMOTION_START, 1, 0),
    endDate: atUtc(PROMOTION_END, 18, 0),
    status: 'active',
    promotionType: 'AUTO_APPLIED',
    discountType: 'PERCENTAGE',
    discountValue: 8,
    minQuantity: 2,
    minOrderValue: 3000,
    usageLimit: 500,
    perShopLimit: 25,
    createdBy: territoryManager.id,
    createdAt: atUtc('2026-04-29', 4, 30),
    updatedAt: atUtc('2026-04-29', 4, 30),
  });
  await manager.insert(PromotionTerritory, {
    id: randomUUID(),
    promotionId,
    territoryId: territory.id,
  });
  await manager.insert(
    PromotionProduct,
    PRODUCT_DEFINITIONS.filter((product) => product.promoted).map((product) => ({
      id: randomUUID(),
      promotionId,
      productId: selectedProducts[product.key].id,
    })),
  );

  const routePlans = VISIT_DATES.map((visitDate, index) => {
    const salesRep = index % 2 === 0 ? salesRepPrimary : salesRepSecondary;
    const routeId = randomUUID();
    return {
      id: routeId,
      date: visitDate,
      salesRepId: salesRep.id,
      salesRepName: salesRep.username,
      varianceJson: [
        {
          seedTag: SEED_TAG,
          note: 'May 2026 demand planner validation route',
          routeDate: visitDate,
        },
      ],
      startedAt: atUtc(visitDate, 3, 30),
      closedAt: atUtc(visitDate, 11, 15),
    };
  });

  await manager.insert(
    SalesRoute,
    routePlans.map((route) => ({
      id: route.id,
      salesRepId: route.salesRepId,
      warehouseId: warehouse.id,
      vehicleId: vehicle.id,
      territoryId: territory.id,
      status: SalesRouteStatus.CLOSED,
      openingStockJson: PRODUCT_DEFINITIONS.map((product) => ({
        productId: selectedProducts[product.key].id,
        productName: selectedProducts[product.key].productName,
        quantityCases: 24 + product.baseCases,
        quantityUnits: (24 + product.baseCases) * selectedProducts[product.key].unitsPerCase,
      })),
      closingStockJson: PRODUCT_DEFINITIONS.map((product) => ({
        productId: selectedProducts[product.key].id,
        productName: selectedProducts[product.key].productName,
        quantityCases: 8 + product.baseCases,
        quantityUnits: (8 + product.baseCases) * selectedProducts[product.key].unitsPerCase,
      })),
      varianceJson: route.varianceJson,
      returnItemsJson: [],
      deliveryOrderIdsJson: [],
      startedAt: route.startedAt,
      closedAt: route.closedAt,
      warehouseManagerPinHash: null,
      pinExpiresAt: null,
      createdAt: route.startedAt,
      updatedAt: route.closedAt,
    })),
  );

  const orderPlans: OrderPlan[] = [];
  const assignmentByDate = new Map<
    string,
    {
      id: string;
      deliveryDate: string;
      orderIds: string[];
    }
  >();

  ORDER_DATES.forEach((orderDate, dayIndex) => {
    const intervalIndex = dayIndex < 2 ? 0 : dayIndex < 4 ? 1 : 2;
    const linkedRouteId = routePlans[Math.min(intervalIndex + 1, routePlans.length - 1)].id;
    const assignmentId = randomUUID();
    assignmentByDate.set(orderDate, {
      id: assignmentId,
      deliveryDate: orderDate,
      orderIds: [],
    });

    shopContexts.forEach((shop, shopIndex) => {
      const orderId = randomUUID();
      const items: OrderItemPlan[] = [];
      const itemProducts = shop.carry.map((key) => selectedProducts[key]);

      for (const product of itemProducts) {
        const quantityCases = buildOrderQuantityCases(product, shop, dayIndex, shopIndex);
        items.push({
          id: randomUUID(),
          orderId,
          productKey: product.key,
          productId: product.id,
          quantityCases,
          lineTotal: roundNumber(quantityCases * product.casePrice),
        });
      }

      const subtotalBeforeDiscount = sum(items.map((item) => item.lineTotal));
      const promoEligibleSubtotal = hasPromo(orderDate)
        ? sum(
            items
              .filter((item) => selectedProducts[item.productKey].promoted)
              .map((item) => item.lineTotal),
          )
        : 0;
      const promotionDiscountTotal = promoEligibleSubtotal
        ? roundNumber(promoEligibleSubtotal * 0.08)
        : 0;
      const totalAfterDiscount = roundNumber(
        subtotalBeforeDiscount - promotionDiscountTotal,
      );
      const orderCode = `ORD-202605${String(dayIndex + 2).padStart(2, '0')}-${shopIndex + 1}8${dayIndex + 1}01`;
      const placedAt = atUtc(orderDate, 4 + shopIndex, 10);
      const approvedAtDate = atUtc(orderDate, 5 + shopIndex, 0);
      const completedAt = atUtc(orderDate, 10, 25 + shopIndex);
      const source = (dayIndex + shopIndex) % 4 === 0 ? 'SALES_REP_ASSISTED' : 'SHOP_OWNER';
      const paymentMethod = (dayIndex + shopIndex) % 2 === 0 ? 'CASH_ON_DELIVERY' : 'STANDARD';

      assignmentByDate.get(orderDate)?.orderIds.push(orderId);

      orderPlans.push({
        id: orderId,
        orderCode,
        userId: shop.userId,
        shopKey: shop.key,
        outletId: shop.outletId,
        routeId: linkedRouteId,
        placedAt,
        approvedAt: approvedAtDate,
        completedAt,
        source,
        paymentMethod,
        subtotalBeforeDiscount,
        promotionDiscountTotal,
        totalAfterDiscount,
        appliedPromotionId: promotionDiscountTotal > 0 ? promotionId : null,
        appliedPromotionCode: promotionDiscountTotal > 0 ? SEED_PROMOTION_CODE : null,
        items,
      });
    });
  });

  await manager.insert(
    DeliveryAssignment,
    [...assignmentByDate.values()].map((assignment, index) => {
      const linkedOrders = orderPlans.filter((order) => order.id && assignment.orderIds.includes(order.id));
      const expectedCash = sum(linkedOrders.map((order) => order.totalAfterDiscount));
      return {
        id: assignment.id,
        territoryManagerId: territoryManager.id,
        distributorId: distributor.id,
        vehicleId: vehicle.id,
        deliveryDate: assignment.deliveryDate,
        status: 'COMPLETED',
        tmReturnPinHash: null,
        tmReturnPinExpiresAt: null,
        notes: `${SEED_TAG}: completed high-demand Galle delivery window for ${assignment.deliveryDate}.`,
        expectedCashAmount: expectedCash,
        cashReturnedAmount: expectedCash,
        cashVarianceAmount: 0,
        cashVarianceType: null,
        cashVarianceReason: null,
        settlementCompletedAt: atUtc(assignment.deliveryDate, 11, 45),
        createdAt: atUtc(assignment.deliveryDate, 2, 45),
        updatedAt: atUtc(assignment.deliveryDate, 11, 45),
      };
    }),
  );

  await manager.insert(
    Order,
    orderPlans.map((order) => {
      const shop = ensure(
        shopContexts.find((row) => row.key === order.shopKey),
        `Missing shop ${order.shopKey}.`,
      );
      const assignment = ensure(
        assignmentByDate.get(dateKey(order.placedAt)),
        `Missing assignment for ${dateKey(order.placedAt)}.`,
      );
      return {
        id: order.id,
        orderCode: order.orderCode,
        userId: order.userId,
        shopNameSnapshot: shop.shopName,
        territoryId: territory.id,
        warehouseId: warehouse.id,
        status: 'COMPLETED',
        source: order.source,
        paymentMethod: order.paymentMethod,
        assistedReason:
          order.source === 'SALES_REP_ASSISTED'
            ? 'Sales rep captured the order during a high-demand outlet visit.'
            : null,
        confirmationPin: null,
        currencyCode: 'LKR',
        totalAmount: order.totalAfterDiscount,
        placedAt: order.placedAt,
        approvedBy: territoryManager.id,
        approvedAt: order.approvedAt,
        delayReason: null,
        customerNote: `[${SEED_TAG}] Shop:${shop.outletId} Route:${order.routeId} High-demand replenishment order aligned to May planner validation.`,
        delayedAt: null,
        delayedBy: null,
        assignmentId: assignment.id,
        appliedPromotionId: order.appliedPromotionId,
        appliedPromotionCode: order.appliedPromotionCode,
        subtotalBeforeDiscount: order.subtotalBeforeDiscount,
        promotionDiscountTotal: order.promotionDiscountTotal,
        totalAfterDiscount: order.totalAfterDiscount,
        createdAt: order.placedAt,
        updatedAt: order.completedAt,
      };
    }),
  );

  await manager.insert(
    OrderItem,
    orderPlans.flatMap((order) =>
      order.items.map((item) => {
        const product = selectedProducts[item.productKey];
        return {
          id: item.id,
          orderId: order.id,
          productId: item.productId,
          skuSnapshot: product.sku,
          productNameSnapshot: product.productName,
          packSizeSnapshot: product.packSize,
          imageUrlSnapshot: null,
          casePriceSnapshot: product.casePrice,
          quantity: item.quantityCases,
          lineTotal: item.lineTotal,
        };
      }),
    ),
  );

  await manager.insert(
    DeliveryAssignmentOrder,
    [...assignmentByDate.values()].flatMap((assignment) =>
      assignment.orderIds.map((orderId, index) => ({
        id: randomUUID(),
        assignmentId: assignment.id,
        orderId,
        sortOrder: index,
        shopPinHash: null,
        shopPinExpiresAt: null,
        shopReturnPinHash: null,
        shopReturnPinExpiresAt: null,
      })),
    ),
  );

  const returnPlans: ReturnPlan[] = [
    {
      id: randomUUID(),
      assignmentId: ensure(assignmentByDate.get('2026-05-10'), 'Missing assignment 2026-05-10').id,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S2' && dateKey(order.placedAt) === '2026-05-10'),
        'Missing return source order for S2.',
      ).id,
      shopKey: 'S2',
      productKey: 'nestomalt',
      quantityCases: 1,
      createdAt: atUtc('2026-05-10', 9, 40),
      reason: '1 case returned after damaged cartons were found during shelf refill.',
    },
    {
      id: randomUUID(),
      assignmentId: ensure(assignmentByDate.get('2026-05-13'), 'Missing assignment 2026-05-13').id,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S1' && dateKey(order.placedAt) === '2026-05-13'),
        'Missing return source order for S1.',
      ).id,
      shopKey: 'S1',
      productKey: 'milk',
      quantityCases: 1,
      createdAt: atUtc('2026-05-15', 8, 15),
      reason: '1 case returned because several UHT packs leaked during transport from the previous delivery.',
    },
  ];

  await manager.insert(
    OrderReturn,
    returnPlans.map((plan) => {
      const product = selectedProducts[plan.productKey];
      return {
        id: plan.id,
        assignmentId: plan.assignmentId,
        distributorId: distributor.id,
        returnType: 'SHOP_RETURN',
        orderId: plan.orderId,
        tmVerified: true,
        verificationNote:
          'Verified by TM after matching the shop-return claim against the completed route.',
        estimatedValue: roundNumber(plan.quantityCases * product.casePrice),
        createdAt: plan.createdAt,
      };
    }),
  );

  await manager.insert(
    ReturnItem,
    returnPlans.map((plan) => {
      const product = selectedProducts[plan.productKey];
      return {
        id: randomUUID(),
        returnId: plan.id,
        productId: product.id,
        productNameSnapshot: product.productName,
        quantity: plan.quantityCases,
        reason: plan.reason,
      };
    }),
  );

  const deliveryCasesByShopProductInterval = new Map<string, number>();
  for (const order of orderPlans) {
    const day = dateKey(order.placedAt);
    const dayIndex = ORDER_DATES.findIndex((value) => value === day);
    const intervalIndex =
      dayIndex <= 1 ? 0 : dayIndex <= 3 ? 1 : 2;
    for (const item of order.items) {
      const key = `${order.shopKey}|${item.productKey}|${intervalIndex}`;
      deliveryCasesByShopProductInterval.set(
        key,
        (deliveryCasesByShopProductInterval.get(key) ?? 0) + item.quantityCases,
      );
    }
  }

  const returnCasesByShopProductInterval = new Map<string, number>();
  for (const plan of returnPlans) {
    const day = dateKey(plan.createdAt);
    const intervalIndex = day <= '2026-05-06' ? 0 : day <= '2026-05-12' ? 1 : 2;
    const key = `${plan.shopKey}|${plan.productKey}|${intervalIndex}`;
    returnCasesByShopProductInterval.set(
      key,
      (returnCasesByShopProductInterval.get(key) ?? 0) + plan.quantityCases,
    );
  }

  const expiryLosses = new Map<string, LossPlan>([
    ['S3|milo|1', { quantityUnits: 6, notes: '6 Milo packs expired after a weekend heat exposure near the cashier.' }],
    ['S2|coconut|2', { quantityUnits: 4, notes: '4 coconut milk packs expired after slow secondary shelf rotation.' }],
  ]);
  const damageLosses = new Map<string, LossPlan>([
    ['S4|maggi|2', { quantityUnits: 12, notes: '12 noodle packs were damaged after a shelf leak near the fast-moving snacks bay.' }],
    ['S1|milk|1', { quantityUnits: 8, notes: '8 UHT milk packs were damaged while unloading into the backroom chiller.' }],
  ]);

  const expectedRetailRows = new Map<string, ExpectedRetailRow>();
  const visitRows: Array<Record<string, unknown>> = [];

  for (const [shopIndex, shop] of shopContexts.entries()) {
    const stockState = new Map<ProductKey, number>();
    const initialVisitId = randomUUID();
    const initialVisitDate = VISIT_DATES[0];
    const initialRoute = routePlans[0];
    const initialShelfStock: Array<Record<string, unknown>> = [];
    const initialBackroomStock: Array<Record<string, unknown>> = [];

    for (const productKey of shop.carry) {
      const product = selectedProducts[productKey];
      const initialUnits =
        Math.round(
          product.unitsPerCase * (1.8 + ((shopIndex + productIndex(productKey)) % 2) * 0.55),
        ) + Math.round(product.unitsPerCase * 0.18);
      stockState.set(productKey, initialUnits);
      const split = splitUnits(initialUnits, shopIndex, productIndex(productKey));
      initialShelfStock.push({
        productId: product.id,
        productName: product.productName,
        unitsPerCase: product.unitsPerCase,
        shelfCount: split.shelfUnits,
        backroomCount: split.backroomUnits,
        quantityUnits: initialUnits,
        quantityCases: roundNumber(initialUnits / product.unitsPerCase),
        estimatedSales: 0,
        inStock: initialUnits > 0,
        oosReason: '',
      });
      initialBackroomStock.push({
        productId: product.id,
        productName: product.productName,
        quantityUnits: split.backroomUnits,
        quantityCases: roundNumber(split.backroomUnits / product.unitsPerCase),
      });
    }

    visitRows.push({
      id: initialVisitId,
      routeId: initialRoute.id,
      routeSessionId: null,
      stopId: null,
      salesRepId: initialRoute.salesRepId,
      shopId: shop.outletId,
      shopNameSnapshot: shop.shopName,
      territoryId: territory.id,
      visitStartedAt: atUtc(initialVisitDate, 4, 20 + shopIndex * 5),
      visitEndedAt: atUtc(initialVisitDate, 5, 10 + shopIndex * 5),
      visitStartTime: atUtc(initialVisitDate, 4, 20 + shopIndex * 5),
      visitEndTime: atUtc(initialVisitDate, 5, 10 + shopIndex * 5),
      durationSeconds: 3000,
      durationMinutes: 50,
      shelfStockJson: initialShelfStock,
      backroomStockJson: initialBackroomStock,
      osaIssuesJson: [],
      promotionsJson: [],
      planogramOk: true,
      posmOk: true,
      outletFeedback:
        'Opening baseline visit for May high-demand planning. Shelf demand looked stable before the promotion push.',
      expiryItemsJson: [],
      competitorNotes:
        'Baseline check before the May push. Nearby competitors were present but not yet discounting heavily.',
      planogramAnswersJson: [
        { question: 'Planogram placement', answer: 'Baseline compliant' },
      ],
      outletFeedbackAnswersJson: buildFeedbackAnswers(
        shop,
        initialVisitDate,
        selectedProducts[shop.carry[0]].productName,
        selectedProducts[shop.carry[1]].productName,
      ),
      estimatedSellThroughJson: [],
      suggestedOrderJson: {
        seedTag: SEED_TAG,
        suggestedReorderWindow: '2-3 days',
      },
      lastOrderDateSnapshot: null,
      hasPendingDelivery: false,
      photoUrls: [],
      status: StoreVisitStatus.COMPLETED,
      createdAt: atUtc(initialVisitDate, 4, 20 + shopIndex * 5),
      updatedAt: atUtc(initialVisitDate, 5, 10 + shopIndex * 5),
    });

    for (let intervalIndex = 0; intervalIndex < 3; intervalIndex += 1) {
      const currentVisitId = randomUUID();
      const currentVisitDate = VISIT_DATES[intervalIndex + 1];
      const currentRoute = routePlans[intervalIndex + 1];
      const shelfStockJson: Array<Record<string, unknown>> = [];
      const backroomStockJson: Array<Record<string, unknown>> = [];
      const estimatedSellThroughJson: Array<Record<string, unknown>> = [];
      const expiryItemsJson: Array<Record<string, unknown>> = [];
      const osaIssuesJson: Array<Record<string, unknown>> = [];
      let planogramOk = true;
      let posmOk = true;
      const topPrimaryProduct = selectedProducts[shop.carry[0]].productName;
      const topSecondaryProduct = selectedProducts[shop.carry[1]].productName;

      for (const productKey of shop.carry) {
        const product = selectedProducts[productKey];
        const previousUnits = stockState.get(productKey) ?? 0;
        const deliveredCases =
          deliveryCasesByShopProductInterval.get(
            `${shop.key}|${productKey}|${intervalIndex}`,
          ) ?? 0;
        const deliveredUnits = deliveredCases * product.unitsPerCase;
        const returnedCases =
          returnCasesByShopProductInterval.get(
            `${shop.key}|${productKey}|${intervalIndex}`,
          ) ?? 0;
        const returnedUnits = returnedCases * product.unitsPerCase;
        const expiredUnits =
          expiryLosses.get(`${shop.key}|${productKey}|${intervalIndex}`)?.quantityUnits ??
          0;
        const damagedUnits =
          damageLosses.get(`${shop.key}|${productKey}|${intervalIndex}`)?.quantityUnits ??
          0;
        const availableUnits =
          previousUnits + deliveredUnits - returnedUnits - expiredUnits - damagedUnits;
        const productOrdinal = productIndex(productKey);
        const floorUnits = Math.round(
          product.unitsPerCase * (0.32 + ((shopIndex + productOrdinal + intervalIndex) % 3) * 0.12),
        );
        const demandRatio = [0.68, 0.76, 0.84][intervalIndex];
        const carryRatio = [0.46, 0.55, 0.7][intervalIndex];
        let soldUnits = Math.round(deliveredUnits * demandRatio + previousUnits * carryRatio);
        soldUnits = Math.max(
          Math.round(product.unitsPerCase * 0.65),
          Math.min(soldUnits, Math.max(0, availableUnits - floorUnits)),
        );
        let currentUnits = Math.max(0, availableUnits - soldUnits);
        let oosReason = '';
        if (
          intervalIndex === 2 &&
          ((shop.key === 'S1' && productKey === 'coffee') ||
            (shop.key === 'S3' && productKey === 'milo'))
        ) {
          soldUnits = availableUnits;
          currentUnits = 0;
          oosReason =
            productKey === 'coffee'
              ? 'Evening rush emptied sachet coffee before the second replenishment call.'
              : 'Milo demand stayed above plan after school hours and stock ran out before route close.';
        }

        stockState.set(productKey, currentUnits);
        const split = splitUnits(currentUnits, shopIndex, productOrdinal);
        expectedRetailRows.set(`${currentVisitId}:${product.id}`, {
          id: `${currentVisitId}:${product.id}`,
          expectedUnits: soldUnits,
          expectedCases: roundNumber(soldUnits / product.unitsPerCase),
        });

        shelfStockJson.push({
          productId: product.id,
          productName: product.productName,
          unitsPerCase: product.unitsPerCase,
          shelfCount: split.shelfUnits,
          backroomCount: split.backroomUnits,
          quantityUnits: currentUnits,
          quantityCases: roundNumber(currentUnits / product.unitsPerCase),
          estimatedSales: soldUnits,
          inStock: currentUnits > 0,
          oosReason,
        });
        backroomStockJson.push({
          productId: product.id,
          productName: product.productName,
          quantityUnits: split.backroomUnits,
          quantityCases: roundNumber(split.backroomUnits / product.unitsPerCase),
        });
        estimatedSellThroughJson.push({
          productId: product.id,
          productName: product.productName,
          estimatedSales: soldUnits,
        });

        const expiryLoss = expiryLosses.get(`${shop.key}|${productKey}|${intervalIndex}`);
        if (expiryLoss) {
          expiryItemsJson.push({
            productId: product.id,
            productName: product.productName,
            hasExpiredItems: true,
            quantityUnits: expiryLoss.quantityUnits,
            notes: expiryLoss.notes,
          });
        }

        const damageLoss = damageLosses.get(`${shop.key}|${productKey}|${intervalIndex}`);
        if (damageLoss) {
          osaIssuesJson.push({
            tag: 'damage_stock_issue',
            productIds: [product.id],
            productNames: [product.productName],
            quantityUnits: damageLoss.quantityUnits,
            quantityCases: roundNumber(damageLoss.quantityUnits / product.unitsPerCase),
            notes: damageLoss.notes,
          });
          planogramOk = false;
        }

        if (oosReason) {
          osaIssuesJson.push({
            tag: 'oos_hidden_demand',
            productIds: [product.id],
            productNames: [product.productName],
            notes: `${oosReason} Customers switched to nearby competitor offers when the shelf went empty.`,
          });
          posmOk = false;
        }
      }

      if (intervalIndex === 1 && shop.key === 'S2') {
        planogramOk = false;
      }
      if (intervalIndex === 2 && shop.key === 'S4') {
        posmOk = false;
      }

      const hasPromoSignal =
        currentVisitDate >= PROMOTION_START && currentVisitDate <= PROMOTION_END;
      const latestOrderBeforeVisit = orderPlans
        .filter((order) => order.shopKey === shop.key && order.placedAt < atUtc(currentVisitDate, 23, 0))
        .sort((left, right) => right.placedAt.getTime() - left.placedAt.getTime())[0];

      visitRows.push({
        id: currentVisitId,
        routeId: currentRoute.id,
        routeSessionId: null,
        stopId: null,
        salesRepId: currentRoute.salesRepId,
        shopId: shop.outletId,
        shopNameSnapshot: shop.shopName,
        territoryId: territory.id,
        visitStartedAt: atUtc(currentVisitDate, 4, 10 + shopIndex * 7),
        visitEndedAt: atUtc(currentVisitDate, 5, 5 + shopIndex * 7),
        visitStartTime: atUtc(currentVisitDate, 4, 10 + shopIndex * 7),
        visitEndTime: atUtc(currentVisitDate, 5, 5 + shopIndex * 7),
        durationSeconds: 3300,
        durationMinutes: 55,
        shelfStockJson,
        backroomStockJson,
        osaIssuesJson,
        promotionsJson: hasPromoSignal ? buildPromotionNotes(topPrimaryProduct) : [],
        planogramOk,
        posmOk,
        outletFeedback:
          VISIT_FEEDBACK_NOTES[(shopIndex + intervalIndex) % VISIT_FEEDBACK_NOTES.length] +
          ` ${shop.shopName} requested deeper backup stock on ${topPrimaryProduct}.`,
        expiryItemsJson,
        competitorNotes:
          intervalIndex === 0
            ? `Competitor sachet deal pressured ${topPrimaryProduct}, but our demand stayed stronger near ${shop.shopName}.`
            : intervalIndex === 1
              ? `Customers compared prices on ${topSecondaryProduct}, and competitor stockouts pushed extra demand back to Nestle lines.`
              : `Fast repeat demand on ${topPrimaryProduct} and ${topSecondaryProduct} stayed high across the territory; nearby stores also reported shortages.`,
        planogramAnswersJson: [
          {
            question: 'Shelf visibility',
            answer: planogramOk ? 'Compliant' : 'Needs correction',
            notes: planogramOk
              ? 'The main facings stayed visible through the visit window.'
              : 'Fast-moving products were shifted after rush-hour refill and need correction.',
          },
        ],
        outletFeedbackAnswersJson: buildFeedbackAnswers(
          shop,
          currentVisitDate,
          topPrimaryProduct,
          topSecondaryProduct,
        ),
        estimatedSellThroughJson,
        suggestedOrderJson: {
          seedTag: SEED_TAG,
          nextSuggestedDrop: '2 days',
          topDemandProducts: [topPrimaryProduct, topSecondaryProduct],
        },
        lastOrderDateSnapshot: latestOrderBeforeVisit?.placedAt ?? null,
        hasPendingDelivery: false,
        photoUrls: [],
        status: StoreVisitStatus.COMPLETED,
        createdAt: atUtc(currentVisitDate, 4, 10 + shopIndex * 7),
        updatedAt: atUtc(currentVisitDate, 5, 5 + shopIndex * 7),
      });
    }
  }

  await manager.insert(StoreVisit, visitRows);

  const dailyReports = routePlans.map((route, index) => {
    const visitDate = route.date;
    const deliveredOrders = orderPlans.filter((order) => {
      const orderDay = dateKey(order.placedAt);
      return (
        (visitDate === '2026-05-06' && ['2026-05-02', '2026-05-04'].includes(orderDay)) ||
        (visitDate === '2026-05-12' && ['2026-05-07', '2026-05-10'].includes(orderDay)) ||
        (visitDate === '2026-05-18' && ['2026-05-13', '2026-05-16'].includes(orderDay)) ||
        (visitDate === '2026-05-01' && orderDay === '2026-05-02')
      );
    });

    return {
      id: randomUUID(),
      salesRepId: route.salesRepId,
      routeId: route.id,
      reportDate: visitDate,
      status: DailyReportStatus.SUBMITTED,
      routeSummaryJson: {
        seedTag: SEED_TAG,
        visitedShops: 4,
        territoryHeat: 'HIGH',
        demandSignal: 'Fast-moving beverages and instant noodles are above baseline.',
      },
      visitSummaryJson: {
        visitsCompleted: 4,
        competitorMentions: 2 + index,
        outletFeedbackCount: 4,
      },
      osaSummaryJson: {
        issueCount: 3 + index,
        topRiskProducts: [
          selectedProducts.coffee.productName,
          selectedProducts.milo.productName,
        ],
      },
      deliverySummaryJson: {
        completedOrders: deliveredOrders.length,
        deliveredCases: sum(
          deliveredOrders.flatMap((order) => order.items.map((item) => item.quantityCases)),
        ),
      },
      returnSummaryJson: {
        returnCaseCount:
          returnPlans
            .filter((plan) => dateKey(plan.createdAt) <= visitDate)
            .reduce((total, plan) => total + plan.quantityCases, 0),
      },
      incidentSummaryJson: {
        incidentCount: 1 + (index % 2),
        majorTheme:
          index % 2 === 0
            ? 'Competitor coffee price pressure and evening stockouts.'
            : 'Warehouse and route delays affecting fast-moving milk and Milo packs.',
      },
      repComments:
        index % 2 === 0
          ? 'Competitor discount pressure, stockout risk, and stronger coffee demand were visible in multiple shops. Weekend stock planning must stay higher than the April baseline.'
          : 'Warehouse issue and vehicle delay notes were raised while Milo 400g and Nespray 180ml demand stayed above normal. Additional buffer stock is needed before the next route.',
      submittedAt: route.closedAt,
      createdAt: route.startedAt,
      updatedAt: route.closedAt,
    };
  });

  await manager.insert(DailyReport, dailyReports);

  const salesIncidents = [
    {
      id: randomUUID(),
      salesRepId: salesRepPrimary.id,
      routeId: routePlans[1].id,
      shopId: shopContexts[0].outletId,
      orderId: orderPlans.find((order) => order.shopKey === 'S1' && dateKey(order.placedAt) === '2026-05-07')?.id ?? null,
      incidentType: SalesIncidentType.ROUTE_ISSUE,
      severity: SalesIncidentSeverity.MEDIUM,
      description:
        'Vehicle delay at Wakwella junction pushed one delivery window later and created a temporary coffee stockout risk in Karapitiya Day Fresh.',
      includedInReport: true,
      createdAt: atUtc('2026-05-07', 7, 10),
      updatedAt: atUtc('2026-05-07', 7, 10),
    },
    {
      id: randomUUID(),
      salesRepId: salesRepSecondary.id,
      routeId: routePlans[2].id,
      shopId: shopContexts[2].outletId,
      orderId: orderPlans.find((order) => order.shopKey === 'S3' && dateKey(order.placedAt) === '2026-05-10')?.id ?? null,
      incidentType: SalesIncidentType.WAREHOUSE_ISSUE,
      severity: SalesIncidentSeverity.HIGH,
      description:
        'Warehouse issue on Milo 400g buffer stock forced a tighter allocation than planned while customer demand stayed high.',
      includedInReport: true,
      createdAt: atUtc('2026-05-11', 6, 40),
      updatedAt: atUtc('2026-05-11', 6, 40),
    },
    {
      id: randomUUID(),
      salesRepId: salesRepPrimary.id,
      routeId: routePlans[3].id,
      shopId: shopContexts[3].outletId,
      orderId: orderPlans.find((order) => order.shopKey === 'S4' && dateKey(order.placedAt) === '2026-05-16')?.id ?? null,
      incidentType: SalesIncidentType.STOCK_ISSUE,
      severity: SalesIncidentSeverity.CRITICAL,
      description:
        'Critical stockout on Nescafe 3 in 1 and high competitor substitution pressure were reported in Kalegana Super Choice before route close.',
      includedInReport: true,
      createdAt: atUtc('2026-05-18', 9, 5),
      updatedAt: atUtc('2026-05-18', 9, 5),
    },
  ];
  await manager.insert(SalesIncident, salesIncidents);

  const shopFeedbackSubmissions = [
    {
      id: randomUUID(),
      userId: shopContexts[0].userId,
      message:
        'Demand for Nescafe 3 in 1 jumped after the school-week restart. Please keep extra cases ready for the weekend.',
      status: 'SUBMITTED',
      createdAt: atUtc('2026-05-08', 7, 45),
    },
    {
      id: randomUUID(),
      userId: shopContexts[1].userId,
      message:
        'Customers asked for more Nespray 180ml and Milo 400g after nearby shops ran out of stock last week.',
      status: 'SUBMITTED',
      createdAt: atUtc('2026-05-12', 8, 20),
    },
    {
      id: randomUUID(),
      userId: shopContexts[2].userId,
      message:
        'Competitor offer pulled questions, but Nestomalt and Maggi kept moving. Coconut milk demand also increased before the weekend.',
      status: 'SUBMITTED',
      createdAt: atUtc('2026-05-15', 9, 35),
    },
    {
      id: randomUUID(),
      userId: shopContexts[3].userId,
      message:
        'Fast demand on coffee sachets caused evening stockouts. A second replenishment drop would help.',
      status: 'SUBMITTED',
      createdAt: atUtc('2026-05-17', 10, 10),
    },
  ];
  await manager.insert(FeedbackSubmission, shopFeedbackSubmissions);

  const orderFeedbacks = [
    {
      id: randomUUID(),
      shopOwnerId: shopContexts[0].userId,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S1' && dateKey(order.placedAt) === '2026-05-16'),
        'Missing S1 order feedback source.',
      ).id,
      rating: 5,
      comment:
        'Delivery was complete and the promotion discount matched the order. Coffee and Milo sold quickly again.',
      territoryId: territory.id,
      createdAt: atUtc('2026-05-16', 11, 45),
    },
    {
      id: randomUUID(),
      shopOwnerId: shopContexts[1].userId,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S2' && dateKey(order.placedAt) === '2026-05-13'),
        'Missing S2 order feedback source.',
      ).id,
      rating: 3,
      comment:
        'Milk and Nestomalt demand stayed high, but one case had to be returned because of damaged cartons.',
      territoryId: territory.id,
      createdAt: atUtc('2026-05-14', 8, 50),
    },
    {
      id: randomUUID(),
      shopOwnerId: shopContexts[2].userId,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S3' && dateKey(order.placedAt) === '2026-05-10'),
        'Missing S3 order feedback source.',
      ).id,
      rating: 4,
      comment:
        'Milo and Maggi moved well. Weekend reorder demand is still above the usual rate.',
      territoryId: territory.id,
      createdAt: atUtc('2026-05-11', 9, 10),
    },
    {
      id: randomUUID(),
      shopOwnerId: shopContexts[3].userId,
      orderId: ensure(
        orderPlans.find((order) => order.shopKey === 'S4' && dateKey(order.placedAt) === '2026-05-16'),
        'Missing S4 order feedback source.',
      ).id,
      rating: 2,
      comment:
        'Evening coffee demand stayed high and stock finished before close. Another fast refill is needed when the next offer runs.',
      territoryId: territory.id,
      createdAt: atUtc('2026-05-17', 7, 30),
    },
  ];
  await manager.insert(OrderFeedback, orderFeedbacks);

  const activityLogs: Array<Record<string, unknown>> = orderPlans.map((order) => {
    const shop = ensure(
      shopContexts.find((row) => row.key === order.shopKey),
      `Missing shop ${order.shopKey}.`,
    );
    return {
      id: randomUUID(),
      userId: distributor.id,
      type: 'ORDER_COMPLETED',
      title: 'Order completed',
      message: `Completed delivery ${order.orderCode} for ${shop.shopName}. High-demand May window kept replenishment above the normal baseline.`,
      metadata: {
        seedTag: SEED_TAG,
        orderId: order.id,
        completedBy: distributor.username,
        warehouseId: warehouse.id,
      },
      createdAt: order.completedAt,
    };
  });

  activityLogs.push(
    {
      id: randomUUID(),
      userId: salesRepPrimary.id,
      type: 'MARKET_ALERT',
      title: 'Competitor discount pressure in Galle A',
      message:
        'Competitor sachet coffee discount created substitution pressure, but fast demand returned to Nestle 3 in 1 once rival shelves ran short.',
      metadata: { seedTag: SEED_TAG, focus: 'coffee_competitor' },
      createdAt: atUtc('2026-05-09', 8, 5),
    },
    {
      id: randomUUID(),
      userId: territoryManager.id,
      type: 'STOCK_ALERT',
      title: 'Fast mover stock risk on Milo 400g',
      message:
        'Milo 400g and Nespray 180ml are trending above baseline. Warehouse safety stock should be lifted before the next cycle.',
      metadata: { seedTag: SEED_TAG, focus: 'warehouse_buffer' },
      createdAt: atUtc('2026-05-14', 6, 20),
    },
    {
      id: randomUUID(),
      userId: salesRepSecondary.id,
      type: 'FIELD_NOTE',
      title: 'Market issue: evening stockout and customer demand change',
      message:
        'Evening stockouts on coffee sachets and malt drinks pushed customers to ask for larger backup quantities during the final week.',
      metadata: { seedTag: SEED_TAG, focus: 'high_demand_end_week' },
      createdAt: atUtc('2026-05-18', 8, 0),
    },
  );
  await manager.insert(ActivityLog, activityLogs);

  const inventoryUpserts = PRODUCT_DEFINITIONS.map((definition, index) => ({
    id: randomUUID(),
    warehouseId: warehouse.id,
    productId: selectedProducts[definition.key].id,
    quantityOnHand: [18, 22, 31, 16, 24, 19][index],
    reorderLevel: [14, 16, 18, 12, 12, 11][index],
    maxCapacityCases: [60, 58, 70, 52, 50, 48][index],
    createdAt: atUtc('2026-04-20', 5, 0),
    updatedAt: atUtc('2026-05-18', 12, 0),
  }));

  const inventoryRepo = manager.getRepository(WarehouseInventoryItem);
  for (const item of inventoryUpserts) {
    const existing = await inventoryRepo.findOne({
      where: { warehouseId: item.warehouseId, productId: item.productId },
    });
    if (existing) {
      await inventoryRepo.update(existing.id, {
        quantityOnHand: item.quantityOnHand,
        reorderLevel: item.reorderLevel,
        maxCapacityCases: item.maxCapacityCases,
        updatedAt: item.updatedAt,
      });
    } else {
      await inventoryRepo.insert(item);
    }
  }

  return {
    territory,
    warehouse,
    distributor,
    territoryManager,
    selectedProducts,
    shopContexts,
    routePlans,
    orderPlans,
    returnPlans,
    dailyReports,
    salesIncidents,
    expectedRetailRows,
  };
}

function dateKey(value: Date | string) {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

async function verifyScenario(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  dataSource: DataSource,
  context: Awaited<ReturnType<typeof seedMayDemandScenario>>,
) {
  const exportService = app.get(ExportsService);
  const forecastService = app.get(ForecastEngineService);
  const insightCenterService = app.get(InsightCenterService);

  const exportBundle = await exportService.generateArsDemandForecastExport(EXPORT_QUERY);
  const zip = new AdmZip(exportBundle.buffer);
  const manifestEntry = ensure(zip.getEntry('manifest.json'), 'Export manifest is missing.');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as {
    files: Record<string, number>;
  };
  const ordersCsv = csvRows<Record<string, string>>(zip, 'orders.csv');
  const orderItemsCsv = csvRows<Record<string, string>>(zip, 'order_items.csv');
  const visitsCsv = csvRows<Record<string, string>>(zip, 'sales_rep_visits.csv');
  const retailCsv = csvRows<Record<string, string>>(zip, 'estimated_retail_offtake.csv');
  const fieldObservationsCsv = csvRows<Record<string, string>>(zip, 'field_observations.csv');

  const mayForecast = await forecastService.generateForecastPreview(FORECAST_QUERY);
  const baselineForecast = await forecastService.generateForecastPreview(
    COMPARISON_FORECAST_QUERY,
  );
  const insightDashboard = await insightCenterService.generateDashboard(INSIGHT_QUERY);
  const insightCsv = await insightCenterService.generateCsvReport(INSIGHT_QUERY);

  const seededOrders = context.orderPlans.length;
  const seededItems = context.orderPlans.reduce(
    (total, order) => total + order.items.length,
    0,
  );
  const seededVisits = context.shopContexts.length * VISIT_DATES.length;
  const seededRetailRows = context.expectedRetailRows.size;

  const exportRetailMismatches = retailCsv.filter((row) => {
    const expected = context.expectedRetailRows.get(row.estimated_retail_offtake_id);
    if (!expected) {
      return false;
    }
    const actualUnits = safeNumber(row.estimated_sold_units);
    const actualCases = safeNumber(row.estimated_sold_cases);
    return (
      Math.abs(actualUnits - expected.expectedUnits) > 0.01 ||
      Math.abs(actualCases - expected.expectedCases) > 0.01
    );
  });

  const mayForecastTotal = sum(
    mayForecast.forecastOutput.map((row) => safeNumber(row.forecast_cases)),
  );
  const baselineForecastTotal = sum(
    baselineForecast.forecastOutput.map((row) => safeNumber(row.forecast_cases)),
  );
  const forecastDifference = roundNumber(mayForecastTotal - baselineForecastTotal);

  const seededOrdersInDb = await dataSource.getRepository(Order).count({
    where: {
      status: 'COMPLETED',
    },
  });

  const galleOrders = await dataSource.getRepository(Order).find({
    where: {
      warehouseId: context.warehouse.id,
    },
    relations: {
      items: true,
    },
    order: {
      placedAt: 'ASC',
    },
  });
  const galleInventory = await dataSource.getRepository(WarehouseInventoryItem).find({
    where: {
      warehouseId: context.warehouse.id,
    },
    relations: {
      product: true,
    },
  });
  const warehouseAnalytics = buildWarehouseAnalytics(
    galleInventory,
    galleOrders.filter((order) => dateKey(order.placedAt) >= '2026-05-01' && dateKey(order.placedAt) <= '2026-05-18'),
    undefined,
    30,
    atUtc('2026-05-01', 0, 0),
  );
  const peakOrderCases = Math.max(
    0,
    ...warehouseAnalytics.orderTrend.map((point) => safeNumber(point.orderCases)),
  );

  if (ordersCsv.length < seededOrders) {
    throw new Error(
      `Export orders.csv is incomplete. Expected at least ${seededOrders} seeded orders, got ${ordersCsv.length}.`,
    );
  }
  if (orderItemsCsv.length < seededItems) {
    throw new Error(
      `Export order_items.csv is incomplete. Expected at least ${seededItems} seeded items, got ${orderItemsCsv.length}.`,
    );
  }
  if (visitsCsv.length < seededVisits) {
    throw new Error(
      `Export sales_rep_visits.csv is incomplete. Expected at least ${seededVisits} visits, got ${visitsCsv.length}.`,
    );
  }
  if (retailCsv.length < seededRetailRows) {
    throw new Error(
      `Export estimated_retail_offtake.csv is incomplete. Expected at least ${seededRetailRows} intervals, got ${retailCsv.length}.`,
    );
  }
  if (exportRetailMismatches.length > 0) {
    throw new Error(
      `Estimated retail offtake mismatches found in ${exportRetailMismatches.length} exported rows: ${JSON.stringify(
        exportRetailMismatches.slice(0, 8).map((row) => {
          const expected = context.expectedRetailRows.get(row.estimated_retail_offtake_id);
          return {
            id: row.estimated_retail_offtake_id,
            actualUnits: safeNumber(row.estimated_sold_units),
            expectedUnits: expected?.expectedUnits ?? null,
            actualCases: safeNumber(row.estimated_sold_cases),
            expectedCases: expected?.expectedCases ?? null,
          };
        }),
      )}`,
    );
  }
  if (mayForecastTotal <= baselineForecastTotal) {
    throw new Error(
      `Forecast did not lift for the May demand window. May total ${mayForecastTotal}, baseline ${baselineForecastTotal}.`,
    );
  }
  if (forecastDifference < 40) {
    throw new Error(
      `Forecast difference is too small for the intended high-demand story: ${forecastDifference} cases.`,
    );
  }
  if (!Array.isArray(insightDashboard.charts?.trend) || insightDashboard.charts.trend.length === 0) {
    throw new Error('Insight Center trend chart is empty for the seeded window.');
  }
  if (peakOrderCases <= 0) {
    throw new Error('Warehouse stock analytics did not register any May order demand.');
  }
  if (!manifest.files['orders.csv'] || manifest.files['orders.csv'] < seededOrders) {
    throw new Error('Export manifest does not reflect the seeded order count.');
  }
  if (fieldObservationsCsv.length < 20) {
    throw new Error(
      `Field observations are too thin for the scenario. Expected rich field evidence, got ${fieldObservationsCsv.length} rows.`,
    );
  }

  const totalOrderValue = sum(context.orderPlans.map((order) => order.totalAfterDiscount));
  const totalDiscount = sum(
    context.orderPlans.map((order) => order.promotionDiscountTotal),
  );
  const totalEstimatedRetailCases = sum(
    [...context.expectedRetailRows.values()].map((row) => row.expectedCases),
  );
  const insightKpis = insightDashboard.kpis
    .filter((kpi: { key: string }) =>
      [
        'total_ordered_cases',
        'total_delivered_cases',
        'estimated_retail_offtake',
        'forecast_next_period',
        'competitor_pressure_score',
        'damage_units_flagged',
      ].includes(kpi.key),
    )
    .map((kpi: { key: string; value: number; unit: string }) => ({
      key: kpi.key,
      value: kpi.value,
      unit: kpi.unit,
    }));

  console.log(
    JSON.stringify(
      {
        seedTag: SEED_TAG,
        window: {
          fromDate: FORECAST_QUERY.fromDate,
          toDate: FORECAST_QUERY.toDate,
        },
        seeded: {
          shops: context.shopContexts.length,
          products: PRODUCT_DEFINITIONS.length,
          completedOrders: context.orderPlans.length,
          orderItems: seededItems,
          visits: seededVisits,
          returns: context.returnPlans.length,
          dailyReports: context.dailyReports.length,
          incidents: context.salesIncidents.length,
          totalOrderValueLkr: totalOrderValue,
          totalPromotionDiscountLkr: totalDiscount,
          totalEstimatedRetailCases,
        },
        verification: {
          exportFileCounts: {
            ordersCsv: manifest.files['orders.csv'],
            orderItemsCsv: manifest.files['order_items.csv'],
            visitsCsv: manifest.files['sales_rep_visits.csv'],
            estimatedRetailOfftakeCsv: manifest.files['estimated_retail_offtake.csv'],
            fieldObservationsCsv: manifest.files['field_observations.csv'],
          },
          ordersVisibleInHistory: ordersCsv.filter((row) => row.status === 'COMPLETED').length,
          seededCompletedOrdersPersisted: seededOrdersInDb,
          retailConversionMismatches: exportRetailMismatches.length,
          mayForecastTotalCases: mayForecastTotal,
          baselineForecastTotalCases: baselineForecastTotal,
          forecastDifferenceCases: forecastDifference,
          warehousePeakOrderCases: peakOrderCases,
          insightKpis,
          insightTrendBuckets: insightDashboard.charts.trend.length,
          insightCsvBytes: insightCsv.csv.length,
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const context = await dataSource.transaction((manager) =>
      seedMayDemandScenario(manager, dataSource),
    );
    await verifyScenario(app, dataSource, context);
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
