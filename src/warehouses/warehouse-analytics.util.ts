import { Order } from '../orders/entities/order.entity';
import { WarehouseInventoryItem } from './entities/warehouse-inventory-item.entity';

export function buildWarehouseAnalytics(
  inventoryItems: WarehouseInventoryItem[],
  orders: Order[],
  productId: string | undefined,
  days: number,
  startDate: Date,
) {
  const trendMap = new Map<string, { orderCases: number; orderCount: number }>();

  for (const order of orders) {
    const dateStr = new Date(order.placedAt).toISOString().split('T')[0];
    const entry = trendMap.get(dateStr) ?? { orderCases: 0, orderCount: 0 };

    const relevantItems = productId
      ? order.items.filter((item) => item.productId === productId)
      : order.items;

    const cases = relevantItems.reduce((sum, item) => sum + item.quantity, 0);
    if (!productId || cases > 0) entry.orderCount += 1;
    entry.orderCases += cases;
    trendMap.set(dateStr, entry);
  }

  const selected = productId
    ? inventoryItems.find((item) => item.productId === productId)
    : null;
  const inventorySnapshot = selected?.quantityOnHand ?? null;

  const orderTrend: Array<{
    date: string;
    orderCases: number;
    orderCount: number;
    inventorySnapshot: number | null;
  }> = [];

  const today = new Date();
  for (let i = 0; i <= days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    if (d > today) break;
    const dateStr = d.toISOString().split('T')[0];
    orderTrend.push({
      date: dateStr,
      ...(trendMap.get(dateStr) ?? { orderCases: 0, orderCount: 0 }),
      inventorySnapshot,
    });
  }

  const productOrderMap = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.productId) {
        productOrderMap.set(
          item.productId,
          (productOrderMap.get(item.productId) ?? 0) + item.quantity,
        );
      }
    }
  }

  const productSummary = inventoryItems.map((item) => ({
    productId: item.productId,
    productName: item.product?.productName ?? '—',
    casesOnHand: item.quantityOnHand,
    totalOrderedCases: productOrderMap.get(item.productId) ?? 0,
  }));

  const inventoryValue = inventoryItems
    .filter((item) => item.quantityOnHand > 0)
    .map((item) => ({
      productId: item.productId,
      productName: item.product?.productName ?? '—',
      stockValue: Number(
        (item.quantityOnHand * (item.product?.casePrice ?? 0)).toFixed(2),
      ),
    }));

  const products = inventoryItems.map((item) => ({
    id: item.productId,
    name: item.product?.productName ?? '—',
  }));

  return { products, orderTrend, productSummary, inventoryValue };
}
