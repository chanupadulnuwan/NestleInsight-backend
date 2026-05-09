import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

@Injectable()
export class ShopInsightsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  async getMyInsights(userId: string) {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const orders = await this.orderRepo.find({
      where: { userId, placedAt: MoreThanOrEqual(sixMonthsAgo) },
      relations: ['items'],
    });

    // --- Monthly sales buckets (last 6 months) ---
    const buckets: { month: string; actual: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const actual = orders
        .filter((o) => {
          const od = new Date(o.placedAt);
          return od.getFullYear() === y && od.getMonth() === m;
        })
        .reduce((sum, o) => sum + o.totalAmount, 0);
      buckets.push({ month: MONTH_NAMES[m], actual: Math.round(actual) });
    }

    // Estimated = flat average across all 6 months (clear above/below-average signal)
    const totalActual = buckets.reduce((sum, b) => sum + b.actual, 0);
    const estimated = Math.round(totalActual / 6);
    const monthlySales = buckets.map((b) => ({ ...b, estimated }));

    // --- Product breakdown ---
    type ProductEntry = {
      productName: string;
      totalCases: number;
      totalRevenue: number;
      lastOrderDate: Date;
      activeMonths: Set<string>;
    };

    const productMap = new Map<string, ProductEntry>();

    for (const order of orders) {
      for (const item of order.items) {
        const key = item.productNameSnapshot;
        const monthKey = `${new Date(order.placedAt).getFullYear()}-${new Date(order.placedAt).getMonth()}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.totalCases += item.quantity;
          existing.totalRevenue += item.lineTotal;
          existing.activeMonths.add(monthKey);
          if (new Date(order.placedAt) > existing.lastOrderDate) {
            existing.lastOrderDate = new Date(order.placedAt);
          }
        } else {
          productMap.set(key, {
            productName: item.productNameSnapshot,
            totalCases: item.quantity,
            totalRevenue: item.lineTotal,
            lastOrderDate: new Date(order.placedAt),
            activeMonths: new Set([monthKey]),
          });
        }
      }
    }

    const topProducts = [...productMap.values()]
      .sort((a, b) => b.totalCases - a.totalCases)
      .slice(0, 5)
      .map((p) => ({
        productName: p.productName,
        totalCases: p.totalCases,
        totalRevenue: Math.round(p.totalRevenue),
        sellOutCasesPerMonth: Math.round(
          p.totalCases / Math.max(p.activeMonths.size, 1),
        ),
        lastOrderDate: p.lastOrderDate.toISOString().split('T')[0],
      }));

    return { monthlySales, topProducts };
  }
}
