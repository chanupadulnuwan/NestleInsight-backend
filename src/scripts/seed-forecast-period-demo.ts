import 'reflect-metadata';

import { randomUUID } from 'crypto';

import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';

import { ActivityLog } from '../activity/entities/activity.entity';
import { AppModule } from '../app.module';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ApprovalStatus } from '../common/enums/approval-status.enum';
import { Platform } from '../common/enums/platform.enum';
import { Role } from '../common/enums/role.enum';
import { DailyReport, DailyReportStatus } from '../daily-reports/entities/daily-report.entity';
import { DeliveryAssignmentOrder } from '../delivery-assignments/entities/delivery-assignment-order.entity';
import { DeliveryAssignment } from '../delivery-assignments/entities/delivery-assignment.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { Outlet, OutletStatus } from '../outlets/entities/outlet.entity';
import { Product } from '../products/entities/product.entity';
import { ProductStatus } from '../common/enums/product-status.enum';
import { SalesRoute, SalesRouteStatus } from '../sales-routes/entities/sales-route.entity';
import { StoreVisit, StoreVisitStatus } from '../store-visits/entities/store-visit.entity';
import { Territory } from '../territories/entities/territory.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseInventoryItem } from '../warehouses/entities/warehouse-inventory-item.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';

// ─── Seed identity ────────────────────────────────────────────────────────────
const SEED_TAG = 'JUN26_FORECAST_PERIOD_DEMO';

// ─── 8 surge SKUs (same as existing demo) ─────────────────────────────────────
const SURGE_SKUS = [
  'NES-3IN1-CLASSIC-20',
  'NES-MILO-400',
  'MAG-NOODLES-CHICKEN-070',
  'NES-NSPRAY-180-VAN',
  'MAG-COCONUTMILK-080',
  'NES-NESTOMALT-400',
  'NES-MILO-RTD-180',
  'NES-MILKMAID-510',
];

// ─── Period 1: Apr 18 – May 18  (HIGH demand, LOW inventory) ──────────────────
//     Every 3 days  →  11 order dates
const PERIOD_1_DATES = [
  '2026-04-18', '2026-04-21', '2026-04-24', '2026-04-27', '2026-04-30',
  '2026-05-03', '2026-05-06', '2026-05-09', '2026-05-12', '2026-05-15', '2026-05-18',
];

// ─── Period 2: May 19 – Jun 01  (MODERATE demand, HIGH inventory) ─────────────
//     Every 2 days  →  7 order dates  (still looks busy)
const PERIOD_2_DATES = [
  '2026-05-20', '2026-05-22', '2026-05-24', '2026-05-26', '2026-05-28', '2026-05-30', '2026-06-01',
];

// ─── Inventory calibration ────────────────────────────────────────────────────
//
//  Period-1 weighted daily demand ≈ 96 cases/territory  →  ~8,600 forecast cases (3 ter.)
//  Period-2 weighted daily demand ≈ 35 cases/territory  →  ~3,150 forecast cases (3 ter.)
//
//  INVENTORY_PER_WAREHOUSE = 2 000  →  total per product = 6 000 cases
//
//  Period 1 check:  required ≈ 10 700 > 6 000  →  recommendedProduction = 4 700
//                   4 700 > 8 600 × 0.25 = 2 150  →  INCREASE (HIGH urgency) ✓
//
//  Period 2 check:  required ≈ 3 900 < 6 000  →  recommendedProduction = 0
//                   stockCoverDays ≈ 57 days >> 7  →  HOLD ✓
//
const INVENTORY_PER_WAREHOUSE = 2000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function atUtc(dateStr: string, hour: number, minute = 0): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sum(values: number[]): number {
  return roundNumber(values.reduce((acc, v) => acc + v, 0));
}

function ensure<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function splitUnits(units: number) {
  const shelfUnits = Math.round(units * 0.6);
  return { shelfUnits, backroomUnits: Math.max(0, units - shelfUnits) };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanupSeedData(manager: EntityManager) {
  const seedOrders = await manager.query(
    `SELECT id FROM orders WHERE customer_note LIKE $1`,
    [`%${SEED_TAG}%`],
  );
  const ids = seedOrders.map((r: { id: string }) => r.id);

  if (ids.length > 0) {
    await manager.query(`DELETE FROM order_feedbacks WHERE order_id = ANY($1::uuid[])`, [ids]);
    await manager.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids]);
    await manager.query(`DELETE FROM delivery_assignment_orders WHERE order_id = ANY($1::uuid[])`, [ids]);
    await manager.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]);
  }

  await manager.query(`DELETE FROM store_visits WHERE outlet_feedback_answers_json::text LIKE $1`, [`%${SEED_TAG}%`]);
  await manager.query(`DELETE FROM daily_reports WHERE route_summary_json::text LIKE $1`, [`%${SEED_TAG}%`]);
  await manager.query(`DELETE FROM activity_logs WHERE metadata::text LIKE $1`, [`%${SEED_TAG}%`]);
  await manager.query(`DELETE FROM delivery_assignments WHERE notes LIKE $1`, [`%${SEED_TAG}%`]);
  await manager.query(`DELETE FROM sales_routes WHERE variance_json::text LIKE $1`, [`%${SEED_TAG}%`]);
}

// ─── Main seeder ──────────────────────────────────────────────────────────────
async function seedForecastPeriodDemo(manager: EntityManager) {
  await cleanupSeedData(manager);

  const territoryRepo  = manager.getRepository(Territory);
  const warehouseRepo  = manager.getRepository(Warehouse);
  const userRepo       = manager.getRepository(User);
  const outletRepo     = manager.getRepository(Outlet);
  const productRepo    = manager.getRepository(Product);
  const inventoryRepo  = manager.getRepository(WarehouseInventoryItem);

  // ── 1. Territories ──────────────────────────────────────────────────────────
  const galleTerritory    = ensure(await territoryRepo.findOneBy({ name: 'Galle A' }),    'Galle A territory missing.');
  const colomboATerritory = ensure(await territoryRepo.findOneBy({ name: 'Colombo A' }), 'Colombo A territory missing.');
  const colomboBTerritory = ensure(await territoryRepo.findOneBy({ name: 'Colombo B' }), 'Colombo B territory missing.');

  // ── 2. Warehouses ───────────────────────────────────────────────────────────
  let galleWarehouse    = await warehouseRepo.findOneBy({ name: 'kalegana store' })
                       || await warehouseRepo.findOneBy({ territoryId: galleTerritory.id });
  let colomboAWarehouse = await warehouseRepo.findOneBy({ name: 'Colombo A Main Warehouse' })
                       || await warehouseRepo.findOneBy({ territoryId: colomboATerritory.id });
  let colomboBWarehouse = await warehouseRepo.findOneBy({ name: 'Colombo B South Depot' })
                       || await warehouseRepo.findOneBy({ territoryId: colomboBTerritory.id });

  galleWarehouse    = ensure(galleWarehouse,    'Galle warehouse missing.');
  colomboAWarehouse = ensure(colomboAWarehouse, 'Colombo A warehouse missing.');
  colomboBWarehouse = ensure(colomboBWarehouse, 'Colombo B warehouse missing.');

  const warehouseMap = new Map([
    [galleTerritory.id,    galleWarehouse],
    [colomboATerritory.id, colomboAWarehouse],
    [colomboBTerritory.id, colomboBWarehouse],
  ]);

  // ── 3. Distributors / Managers / Sales Reps ─────────────────────────────────
  const findUser = async (username: string, role: Role, territoryId: string) =>
    await userRepo.findOneBy({ username })
    || await userRepo.findOneBy({ role, territoryId })
    || await userRepo.findOneBy({ role });

  const galleDist    = ensure(await findUser('rajivx',                 Role.TERRITORY_DISTRIBUTOR, galleTerritory.id),    'Galle distributor missing.');
  const colomboADist = ensure(await findUser('colombo_a_distributor',  Role.TERRITORY_DISTRIBUTOR, colomboATerritory.id), 'Colombo A distributor missing.');
  const colomboBDist = ensure(await findUser('colombo_b_distributor',  Role.TERRITORY_DISTRIBUTOR, colomboBTerritory.id), 'Colombo B distributor missing.');

  const galleMgr    = ensure(await findUser('TMgag',               Role.REGIONAL_MANAGER, galleTerritory.id),    'Galle manager missing.');
  const colomboAMgr = ensure(await findUser('colombo_a_manager',   Role.REGIONAL_MANAGER, colomboATerritory.id), 'Colombo A manager missing.');
  const colomboBMgr = ensure(await findUser('colombo_b_manager',   Role.REGIONAL_MANAGER, colomboBTerritory.id), 'Colombo B manager missing.');

  const salesReps = await userRepo.find({ where: { role: Role.SALES_REP } });
  const repPrimary   = ensure(salesReps[0], 'No sales reps found.');
  const repSecondary = salesReps[1] || salesReps[0];

  // ── 4. Ensure outlet records exist for all shop owners ──────────────────────
  const allShopOwners = await userRepo.find({ where: { role: Role.SHOP_OWNER } });
  const outlets: Outlet[] = [];

  for (const owner of allShopOwners) {
    let outlet = await outletRepo.findOneBy({ ownerEmail: owner.email });
    if (!outlet) {
      const tId = owner.territoryId || galleTerritory.id;
      const wh  = warehouseMap.get(tId) || galleWarehouse;
      outlet = outletRepo.create({
        id: randomUUID(),
        outletName: owner.shopName || `${owner.firstName} ${owner.lastName}'s Shop`,
        ownerName:  `${owner.firstName} ${owner.lastName}`.trim(),
        ownerPhone: owner.phoneNumber || '0770000000',
        ownerEmail: owner.email,
        address:    owner.address || 'Sri Lanka',
        territoryId: tId,
        warehouseId: wh.id,
        status: OutletStatus.APPROVED,
        latitude:  owner.latitude  || 6.9271,
        longitude: owner.longitude || 79.8612,
      });
      await outletRepo.save(outlet);
    }
    outlets.push(outlet);
  }

  // ── 5. Products ─────────────────────────────────────────────────────────────
  const activeProducts = await productRepo.find({ where: { status: ProductStatus.ACTIVE } });
  const products = activeProducts.map(p => ({
    id:          p.id,
    productName: p.productName,
    sku:         p.sku,
    packSize:    p.packSize,
    casePrice:   safeNumber(p.casePrice),
    unitsPerCase: Math.max(1, safeNumber(p.productsPerCase)),
    isSurge:     SURGE_SKUS.includes(p.sku),
  }));

  // ── 6. Per-territory configs ─────────────────────────────────────────────────
  const territoryConfigs = [
    { territory: galleTerritory,    warehouse: galleWarehouse,    distributor: galleDist,    manager: galleMgr },
    { territory: colomboATerritory, warehouse: colomboAWarehouse, distributor: colomboADist, manager: colomboAMgr },
    { territory: colomboBTerritory, warehouse: colomboBWarehouse, distributor: colomboBDist, manager: colomboBMgr },
  ];

  const allDates = [...PERIOD_1_DATES, ...PERIOD_2_DATES];
  let totalOrders = 0;
  let totalVisits = 0;

  for (const date of allDates) {
    const isPeriod1 = PERIOD_1_DATES.includes(date);

    for (const cfg of territoryConfigs) {
      const { territory, warehouse, distributor, manager } = cfg;

      // Delivery Assignment
      const assignment = manager.getRepository(DeliveryAssignment).create({
        id: randomUUID(),
        territoryManagerId: manager.id,
        distributorId:      distributor.id,
        vehicleId:          null,
        deliveryDate:       date,
        status:             'COMPLETED',
        notes:              `[${SEED_TAG}] ${isPeriod1 ? 'Period-1 high-demand' : 'Period-2 replenished'} delivery.`,
        expectedCashAmount:       0,
        cashReturnedAmount:       0,
        cashVarianceAmount:       0,
        settlementCompletedAt:    atUtc(date, 16, 0),
        createdAt:                atUtc(date, 7, 0),
        updatedAt:                atUtc(date, 16, 0),
      });
      await manager.getRepository(DeliveryAssignment).save(assignment);

      // Sales Route
      const rep   = isPeriod1 ? repPrimary : repSecondary;
      const route = manager.getRepository(SalesRoute).create({
        id: randomUUID(),
        salesRepId:   rep.id,
        warehouseId:  warehouse.id,
        vehicleId:    null,
        territoryId:  territory.id,
        status:       SalesRouteStatus.CLOSED,
        openingStockJson: products.map(p => ({
          productId: p.id, productName: p.productName,
          quantityCases: isPeriod1 ? 200 : 600,
          quantityUnits: (isPeriod1 ? 200 : 600) * p.unitsPerCase,
        })),
        closingStockJson: products.map(p => ({
          productId: p.id, productName: p.productName,
          quantityCases: isPeriod1 ? 10 : 180,
          quantityUnits: (isPeriod1 ? 10 : 180) * p.unitsPerCase,
        })),
        varianceJson:         [{ seedTag: SEED_TAG, date, period: isPeriod1 ? 'P1_HIGH_DEMAND' : 'P2_REPLENISHED' }],
        returnItemsJson:      [],
        deliveryOrderIdsJson: [],
        startedAt: atUtc(date, 8, 0),
        closedAt:  atUtc(date, 15, 30),
      });
      await manager.getRepository(SalesRoute).save(route);

      // Daily Report
      const report = manager.getRepository(DailyReport).create({
        id: randomUUID(),
        salesRepId:  rep.id,
        routeId:     route.id,
        reportDate:  date,
        status:      DailyReportStatus.SUBMITTED,
        routeSummaryJson: {
          seedTag: SEED_TAG,
          period: isPeriod1 ? 'P1_HIGH_DEMAND' : 'P2_REPLENISHED',
          demandSignal: isPeriod1
            ? 'Extremely high demand. Shelves depleted within hours of restocking.'
            : 'Healthy ordering rate. Inventory levels well above demand threshold.',
        },
        visitSummaryJson:    { visitsCompleted: 4, competitorMentions: 0 },
        osaSummaryJson:      { issueCount: isPeriod1 ? 3 : 0, topRiskProducts: isPeriod1 ? SURGE_SKUS.slice(0, 3) : [] },
        deliverySummaryJson: { completedOrders: 4, deliveredCases: isPeriod1 ? 480 : 160 },
        returnSummaryJson:   { returnCaseCount: 0 },
        incidentSummaryJson: { incidentCount: 0, majorTheme: 'None' },
        repComments: isPeriod1
          ? 'Outlets reporting near-zero safety stock for all surge products. Urgent replenishment required.'
          : 'All outlets well stocked. Orders placed at a steady rate with no stockout incidents.',
        submittedAt: atUtc(date, 15, 45),
      });
      await manager.getRepository(DailyReport).save(report);

      // Orders + Visits per outlet in this territory
      const territoryOutlets = outlets.filter(o => o.territoryId === territory.id);

      for (const [idx, outlet] of territoryOutlets.entries()) {
        const orderId = randomUUID();
        const items: OrderItem[] = [];

        for (const p of products) {
          // Period 1: surge products ×30 cases, others ×3
          // Period 2: all products ×12 cases  (still high, but below inventory)
          const qty = isPeriod1
            ? (p.isSurge ? 30 + (idx % 3) : 3)
            : 12 + (idx % 3);

          items.push(manager.getRepository(OrderItem).create({
            id: randomUUID(),
            orderId,
            productId:           p.id,
            skuSnapshot:         p.sku,
            productNameSnapshot: p.productName,
            packSizeSnapshot:    p.packSize,
            casePriceSnapshot:   p.casePrice,
            quantity:            qty,
            lineTotal:           roundNumber(qty * p.casePrice),
          }));
        }

        const orderTotal = sum(items.map(i => i.lineTotal));

        const ownerUser = outlet.ownerEmail
          ? await userRepo.findOneBy({ email: outlet.ownerEmail })
          : null;

        const order = manager.getRepository(Order).create({
          id:                orderId,
          orderCode:         `ORD-${territory.name.replace(/\s+/g, '')}-${date.replace(/-/g, '')}-${idx + 1}`,
          userId:            ownerUser?.id,
          shopNameSnapshot:  outlet.outletName,
          territoryId:       territory.id,
          warehouseId:       warehouse.id,
          status:            'COMPLETED',
          source:            'SHOP_OWNER',
          paymentMethod:     'STANDARD',
          currencyCode:      'LKR',
          totalAmount:       orderTotal,
          placedAt:          atUtc(date, 9, 30 + idx * 5),
          approvedBy:        manager.id,
          approvedAt:        atUtc(date, 10, 0),
          customerNote:      `[${SEED_TAG}] ${isPeriod1 ? 'Period-1 surge replenishment order.' : 'Period-2 standard replenishment order.'}`,
          assignmentId:      assignment.id,
          subtotalBeforeDiscount:   orderTotal,
          promotionDiscountTotal:   0,
          totalAfterDiscount:       orderTotal,
          createdAt:                atUtc(date, 9, 30),
          updatedAt:                atUtc(date, 14, 0),
        });

        await manager.getRepository(Order).save(order);
        for (const item of items) {
          await manager.getRepository(OrderItem).save(item);
        }

        await manager.getRepository(DeliveryAssignmentOrder).insert({
          id: randomUUID(),
          assignmentId: assignment.id,
          orderId:      order.id,
          sortOrder:    idx,
        });

        assignment.expectedCashAmount = roundNumber((assignment.expectedCashAmount || 0) + orderTotal);
        assignment.cashReturnedAmount = assignment.expectedCashAmount;
        await manager.getRepository(DeliveryAssignment).save(assignment);

        // Store Visit
        const shelfUnitsP1Surge = 2;   // nearly empty → reflects high demand, low stock
        const shelfUnitsOther   = isPeriod1 ? 30 : 500;

        const visit = manager.getRepository(StoreVisit).create({
          id: randomUUID(),
          routeId:          route.id,
          salesRepId:       rep.id,
          shopId:           outlet.id,
          shopNameSnapshot: outlet.outletName,
          territoryId:      territory.id,
          visitStartedAt:   atUtc(date, 11, idx * 15),
          visitEndedAt:     atUtc(date, 11, idx * 15 + 30),
          durationSeconds:  1800,
          durationMinutes:  30,
          shelfStockJson: products.map(p => {
            const units = isPeriod1 && p.isSurge ? shelfUnitsP1Surge : shelfUnitsOther;
            const sp    = splitUnits(units);
            return {
              productId:     p.id,
              productName:   p.productName,
              unitsPerCase:  p.unitsPerCase,
              shelfCount:    sp.shelfUnits,
              backroomCount: sp.backroomUnits,
              quantityUnits: units,
              quantityCases: units / p.unitsPerCase,
              inStock:       units > 0,
            };
          }),
          backroomStockJson: products.map(p => {
            const units = isPeriod1 && p.isSurge ? shelfUnitsP1Surge : shelfUnitsOther;
            const sp    = splitUnits(units);
            return {
              productId:    p.id,
              productName:  p.productName,
              quantityUnits: sp.backroomUnits,
              quantityCases: sp.backroomUnits / p.unitsPerCase,
            };
          }),
          osaIssuesJson:   isPeriod1 ? [{ issue: 'Low safety stock for surge products', severity: 'HIGH' }] : [],
          promotionsJson:  [],
          planogramOk:     true,
          posmOk:          true,
          outletFeedback:  isPeriod1
            ? `[${SEED_TAG}] Critical stock shortage. Surge product demand far exceeds replenishment rate.`
            : `[${SEED_TAG}] Stock levels healthy. Orders placed at normal rate.`,
          competitorNotes: 'No competitor issues reported.',
          planogramAnswersJson:       [],
          outletFeedbackAnswersJson:  [{ question: 'Stock level feedback', answer: isPeriod1 ? 'Very low — urgent restocking needed for surge SKUs' : 'Sufficient — well above safety threshold' }],
          estimatedSellThroughJson:   [],
          suggestedOrderJson:         {},
          lastOrderDateSnapshot:      atUtc(date, 9, 30),
          status:                     StoreVisitStatus.COMPLETED,
        });
        await manager.getRepository(StoreVisit).save(visit);

        // Activity Log
        await manager.getRepository(ActivityLog).save(
          manager.getRepository(ActivityLog).create({
            id:      randomUUID(),
            userId:  distributor.id,
            type:    'ORDER_COMPLETED',
            title:   isPeriod1 ? 'Surge Order Completed' : 'Standard Order Completed',
            message: `Order ${order.orderCode} delivered to ${outlet.outletName}. ${isPeriod1 ? 'High-demand period.' : 'Stock replenished.'}`,
            metadata: {
              seedTag:     SEED_TAG,
              orderId:     order.id,
              period:      isPeriod1 ? 'P1_HIGH_DEMAND' : 'P2_REPLENISHED',
              warehouseId: warehouse.id,
            },
            createdAt: atUtc(date, 14, 0),
          }),
        );

        totalOrders++;
        totalVisits++;
      }
    }
  }

  // ── 7. Warehouse inventory ───────────────────────────────────────────────────
  //
  //  Set to INVENTORY_PER_WAREHOUSE cases per warehouse.
  //  This is calibrated so that:
  //    • Period-1 forecast (Apr 18–May 18) >> total stock → INCREASE (HIGH urgency)
  //    • Period-2 forecast (May 19–Jun 01) << total stock → HOLD
  //
  const seedWarehouses = [galleWarehouse, colomboAWarehouse, colomboBWarehouse];

  for (const wh of seedWarehouses) {
    for (const p of products) {
      const existing = await inventoryRepo.findOne({
        where: { warehouseId: wh.id, productId: p.id },
      });

      if (existing) {
        await inventoryRepo.update(existing.id, {
          quantityOnHand:   INVENTORY_PER_WAREHOUSE,
          reorderLevel:     200,
          maxCapacityCases: 5000,
          updatedAt:        atUtc('2026-06-01', 12, 0),
        });
      } else {
        await inventoryRepo.save(inventoryRepo.create({
          id:               randomUUID(),
          warehouseId:      wh.id,
          productId:        p.id,
          quantityOnHand:   INVENTORY_PER_WAREHOUSE,
          reorderLevel:     200,
          maxCapacityCases: 5000,
          createdAt:        atUtc('2026-04-17', 6, 0),
          updatedAt:        atUtc('2026-06-01', 12, 0),
        }));
      }
    }
  }

  return { totalOrders, totalVisits, totalProducts: products.length };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const result = await dataSource.transaction(manager =>
      seedForecastPeriodDemo(manager),
    );

    console.log(`[Done] SEED_TAG: ${SEED_TAG}`);
    console.log(`[Done] Orders created : ${result.totalOrders}`);
    console.log(`[Done] Store visits   : ${result.totalVisits}`);
    console.log(`[Done] Products seeded: ${result.totalProducts}`);
    console.log(`[Done] Inventory set  : ${INVENTORY_PER_WAREHOUSE} cases/warehouse × 3 warehouses = ${INVENTORY_PER_WAREHOUSE * 3} total per product`);
    console.log('');
    console.log('[Forecast] Run with history Apr 18–May 18  → INCREASE (HIGH urgency) — demand >> stock');
    console.log('[Forecast] Run with history May 19–Jun 01  → HOLD                   — stock >> demand');
  } finally {
    await app.close();
  }
}

void main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
