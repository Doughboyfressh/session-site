/**
 * Payments domain logic for SESSION: service rate validation, track prices,
 * order lifecycle, and Stripe webhook processing. Pure functions over D1
 * wrappers so routes, the webhook, and tests share one implementation.
 */

export const ROLES = ['Artist', 'Producer', 'Engineer'] as const;
export type Role = (typeof ROLES)[number];

export const MAX_SERVICES = 3;
export const MIN_AMOUNT_CENTS = 100;
export const MAX_AMOUNT_CENTS = 1_000_000;
export const ORDER_KINDS = ['service', 'track'] as const;
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'canceled',
  'refunded',
] as const;

export type ServiceRate = {
  role: Role;
  service: string;
  amountCents: number;
  note?: string;
};

export class OrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return (
    '$' +
    (Number.isInteger(dollars)
      ? dollars.toLocaleString('en-US')
      : dollars.toLocaleString('en-US', { minimumFractionDigits: 2 }))
  );
}

function fail(message: string): never {
  throw new OrderError(message);
}

/** Parse + validate the rates JSON stored on a profile. */
export function parseRates(value: unknown): ServiceRate[] {
  if (value === null || value === undefined || value === '') return [];
  let raw: unknown;
  try {
    raw = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    fail('Service rates are unreadable.');
  }
  if (!Array.isArray(raw)) fail('Service rates are unreadable.');
  if (raw.length > MAX_SERVICES)
    fail(`List up to ${MAX_SERVICES} paid services.`);
  return raw.map(parseServiceRate);
}

export function parseServiceRate(value: unknown): ServiceRate {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Every paid service needs a role, a name, and a price.');
  const rate = value as Record<string, unknown>;
  const role = rate.role;
  const service = typeof rate.service === 'string' ? rate.service.trim() : '';
  const amountCents = Number(rate.amountCents);
  const note =
    typeof rate.note === 'string' && rate.note.trim()
      ? rate.note.trim().slice(0, 140)
      : undefined;
  if (!(ROLES as readonly string[]).includes(role as string))
    fail('Choose a valid role for the service.');
  if (!service || service.length > 60)
    fail('Give each service a name of up to 60 characters.');
  if (
    !Number.isInteger(amountCents) ||
    amountCents < MIN_AMOUNT_CENTS ||
    amountCents > MAX_AMOUNT_CENTS
  )
    fail('Prices must be between $1 and $10,000.');
  const parsed: ServiceRate = { role: role as Role, service, amountCents };
  if (note) parsed.note = note;
  return parsed;
}

/**
 * Validate a whole rates list against the roles the profile claims.
 * Returns the JSON string to persist.
 */
export function normalizeRates(
  value: unknown,
  profileRoles: readonly string[],
): string {
  const rates = parseRates(value);
  const allowed = profileRoles.filter((role) =>
    (ROLES as readonly string[]).includes(role),
  );
  if (!allowed.length) fail('Pick at least one role before listing services.');
  for (const rate of rates)
    if (!allowed.includes(rate.role))
      fail(
        `"${rate.service}" uses the ${rate.role} role — add that role to your profile first.`,
      );
  return JSON.stringify(rates);
}

/** Validate a track price (integer cents or null to stop selling). */
export function normalizeTrackPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const cents = Number(value);
  if (
    !Number.isInteger(cents) ||
    cents < MIN_AMOUNT_CENTS ||
    cents > MAX_AMOUNT_CENTS
  )
    fail('Track prices must be between $1 and $10,000.');
  return cents;
}

export function platformFeeCents(amountCents: number, feeBps: number): number {
  if (!Number.isFinite(feeBps) || feeBps <= 0) return 0;
  const fee = Math.floor((amountCents * Math.floor(feeBps)) / 10_000);
  return Math.min(fee, Math.max(0, amountCents - 100));
}

export function orderId(): string {
  return (
    'ord_' +
    Array.from({ length: 20 }, () =>
      'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(
        Math.floor(Math.random() * 36),
      ),
    ).join('')
  );
}

/* ------------------------------------------------------------------ *
 * D1-backed operations. `db` is the raw D1 binding (run/one/all).
 * ------------------------------------------------------------------ */

export type DB = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<unknown>;
      all: <T>() => Promise<{ results: T[] }>;
      first: <T>() => Promise<T | null>;
    };
  };
};

export async function insertPendingOrder(
  db: DB,
  order: {
    id: string;
    kind: 'service' | 'track';
    track?: string | null;
    seller: string;
    buyer: string;
    serviceSnapshot: object;
    amountCents: number;
    feeCents: number;
    stripeSessionId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (id, kind, track, seller, buyer, serviceSnapshot,
        amountCents, feeCents, currency, status, stripeSessionId, created)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'usd','pending',?9,?10)`,
    )
    .bind(
      order.id,
      order.kind,
      order.track ?? null,
      order.seller,
      order.buyer,
      JSON.stringify(order.serviceSnapshot),
      order.amountCents,
      order.feeCents,
      order.stripeSessionId,
      Date.now(),
    )
    .run();
}

export async function cancelStaleOrdersForSession(
  db: DB,
  sessionId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE orders SET status='canceled'
       WHERE stripeSessionId=?1 AND status='pending'`,
    )
    .bind(sessionId)
    .run();
}

/**
 * Webhook processing for checkout.session.completed / async payment events.
 * Idempotent via the stripe_events table. Returns true when this call is the
 * one that processed the event.
 */
export async function processCheckoutSession(
  db: DB,
  event: { id: string },
  session: {
    id: string;
    payment_status?: string;
    payment_intent?: string | null;
  },
  notify: (
    rows: Array<{
      user: string;
      actor: string | null;
      body: string;
      uniqueKey: string;
    }>,
  ) => Promise<void>,
  attachThread?: (order: {
    id: string;
    kind: string;
    buyer: string;
    seller: string;
    serviceSnapshot: string;
  }) => Promise<void>,
): Promise<boolean> {
  const now = Date.now();
  try {
    await db
      .prepare(
        'INSERT INTO stripe_events (eventId, processedAt) VALUES (?1,?2)',
      )
      .bind(event.id, now)
      .run();
  } catch {
    return false; // already processed
  }
  if (session.payment_status && session.payment_status !== 'paid') return true;

  const order = await db
    .prepare(
      `SELECT id, kind, track, seller, buyer, serviceSnapshot, amountCents,
              status FROM orders WHERE stripeSessionId=?1`,
    )
    .bind(session.id)
    .first<{
      id: string;
      kind: string;
      track: string | null;
      seller: string;
      buyer: string;
      serviceSnapshot: string;
      amountCents: number;
      status: string;
    }>();
  if (!order || order.status === 'paid') return true;

  await db
    .prepare(`UPDATE orders SET status='paid', paymentIntent=?2 WHERE id=?1`)
    .bind(order.id, session.payment_intent ?? null)
    .run();

  const label = orderLabel(order.kind, order.serviceSnapshot, order.track);
  await notify([
    {
      user: order.buyer,
      actor: order.seller,
      body: `Payment complete — ${label}. Your receipt is in Payments.`,
      uniqueKey: `order:${order.id}:buyer`,
    },
    {
      user: order.seller,
      actor: order.buyer,
      body: `You made a sale — ${label}. Deliver it in your message thread.`,
      uniqueKey: `order:${order.id}:seller`,
    },
  ]);

  if (attachThread) {
    try {
      await attachThread(order);
    } catch {
      // thread creation is best-effort; notifications already delivered
    }
  }
  return true;
}

export function orderLabel(
  kind: string,
  serviceSnapshot: string,
  track: string | null,
): string {
  if (kind === 'service') {
    try {
      const service = JSON.parse(serviceSnapshot) as {
        name?: string;
        amountCents?: number;
      };
      const name = service?.name || 'creator service';
      const amount = service?.amountCents
        ? ` (${formatUSD(service.amountCents)})`
        : '';
      return `${name}${amount}`;
    } catch {
      return 'creator service';
    }
  }
  return track ? `track ${track}` : 'track';
}
