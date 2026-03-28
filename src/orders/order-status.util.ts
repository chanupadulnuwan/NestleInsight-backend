const NON_DELAYABLE_ORDER_STATUSES = new Set([
  'COMPLETED',
  'CANCELLED',
  'DELAYED',
]);

const PROCEED_ORDER_STATUSES = new Set(['PROCEED', 'APPROVED']);

type DelayAwareOrder = {
  placedAt: Date | string;
  status: string;
};

export function getOrderDueAt(placedAt: Date | string) {
  const normalizedPlacedAt =
    placedAt instanceof Date ? placedAt : new Date(placedAt);

  return addBusinessDays(normalizedPlacedAt, 2);
}

export function isOrderOverdue(order: DelayAwareOrder) {
  if (NON_DELAYABLE_ORDER_STATUSES.has(order.status)) {
    return false;
  }

  return Date.now() > getOrderDueAt(order.placedAt).getTime();
}

export function isProceedOrderStatus(status: string) {
  return PROCEED_ORDER_STATUSES.has(status);
}

export function createAutomaticDelayPatch(placedAt: Date | string) {
  return {
    status: 'DELAYED',
    delayReason:
      'Automatically delayed because it was not delivered within 2 business days of being placed.',
    delayedAt: getOrderDueAt(placedAt),
    delayedBy: null,
  };
}

function addBusinessDays(date: Date, days: number) {
  const result = new Date(date);
  let remaining = days;

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);

    if (!isWeekend(result)) {
      remaining -= 1;
    }
  }

  return result;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}
