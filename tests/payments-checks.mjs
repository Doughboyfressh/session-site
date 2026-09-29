import assert from 'node:assert/strict';
import { loadTS } from './load-ts.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const {
  OrderError,
  ROLES,
  MAX_SERVICES,
  MIN_AMOUNT_CENTS,
  MAX_AMOUNT_CENTS,
  formatUSD,
  parseRates,
  parseServiceRate,
  normalizeRates,
  normalizeTrackPrice,
  platformFeeCents,
  insertPendingOrder,
  cancelStaleOrdersForSession,
  processCheckoutSession,
  orderLabel,
} = loadTS('lib/orders.ts');

let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const fails = (fn, pattern) => {
  assert.throws(fn, pattern);
  checks++;
};

/* ---------------- validation ---------------- */
equal(ROLES, ['Artist', 'Producer', 'Engineer', 'Videographer']);
ok(MAX_SERVICES === 3);
ok(MIN_AMOUNT_CENTS === 100 && MAX_AMOUNT_CENTS === 1000000);

equal(formatUSD(15000), '$150');
equal(formatUSD(505), '$5.05');
equal(formatUSD(12345678), '$123,456.78');

const valid = { role: 'Producer', service: 'Custom beat', amountCents: 15000 };
equal(parseServiceRate(valid), valid);
equal(parseServiceRate({ ...valid, note: '  3 stems included  ' }), {
  ...valid,
  note: '3 stems included',
});

fails(() => parseServiceRate({ ...valid, role: 'Manager' }), /valid role/);
fails(() => parseServiceRate({ ...valid, service: '' }), /name/);
fails(() => parseServiceRate({ ...valid, service: 'x'.repeat(61) }), /name/);
fails(() => parseServiceRate({ ...valid, amountCents: 99 }), /price/i);
fails(() => parseServiceRate({ ...valid, amountCents: 1000001 }), /price/i);
fails(() => parseServiceRate({ ...valid, amountCents: 12.5 }), /price/i);

equal(parseRates('[]'), []);
equal(parseRates(null), []);
equal(parseRates(undefined), []);
fails(() => parseRates('{"not":"an array"}'), /unreadable/);
fails(() => parseRates(JSON.stringify(Array(4).fill(valid))), /up to 3/);

const rates = normalizeRates(
  [valid, { role: 'Engineer', service: 'Mix per song', amountCents: 8000 }],
  ['Producer', 'Engineer'],
);
equal(JSON.parse(rates).length, 2);
fails(
  () => normalizeRates([valid], ['Artist']),
  /add that role to your profile first/i,
);
fails(() => normalizeRates([valid], []), /at least one role/i);

equal(normalizeTrackPrice(null), null);
equal(normalizeTrackPrice(undefined), null);
equal(normalizeTrackPrice(''), null);
equal(normalizeTrackPrice(5000), 5000);
fails(() => normalizeTrackPrice(50), /price/i);
fails(() => normalizeTrackPrice(1000001), /price/i);

equal(platformFeeCents(10000, 0), 0);
equal(platformFeeCents(10000, 1000), 1000); // 10%
equal(platformFeeCents(9999, 1000), 999);
equal(platformFeeCents(150, 1000), 15);
equal(platformFeeCents(10000, -5), 0);
ok(platformFeeCents(101, 5000) <= 1); // never drains below $1 remainder

/* ---------------- DB-backed lifecycle ---------------- */
const db = new DatabaseSync(':memory:');
const migrations = fs
  .readdirSync(path.resolve('drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const file of migrations)
  for (const statement of fs
    .readFileSync(path.resolve('drizzle', file), 'utf-8')
    .split('--> statement-breakpoint'))
    db.exec(statement);
checks++;

// profiles + tracks gained their columns through the migration
const profileInfo = db
  .prepare('PRAGMA table_info(profiles)')
  .all()
  .map((c) => c.name);
ok(profileInfo.includes('rates'), 'profiles.rates exists');
const trackInfo = db
  .prepare('PRAGMA table_info(tracks)')
  .all()
  .map((c) => c.name);
ok(trackInfo.includes('price'), 'tracks.price exists');
ok(
  db.prepare('PRAGMA table_info(orders)').all().length > 0,
  'orders table exists',
);

/** tiny adapter matching the DB shape lib/orders expects */
const ordersDb = {
  prepare: (query) => ({
    bind: (...values) => ({
      run: async () => db.prepare(query).run(...values),
      all: async () => db.prepare(query).all(...values),
      first: async () => db.prepare(query).get(...values) ?? null,
    }),
  }),
};

const now = Date.now();
db.prepare(
  'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,rates,created) VALUES (?,?,?,?,?,?,?,?,?)',
).run(
  'seller_1',
  'beatsmith',
  'Beatsmith',
  '["Producer"]',
  '',
  '',
  'public',
  JSON.stringify([valid]),
  now,
);
db.prepare(
  'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,rates,created) VALUES (?,?,?,?,?,?,?,?,?)',
).run(
  'buyer_1',
  'vocalist',
  'Vocalist',
  '["Artist"]',
  '',
  '',
  'public',
  '[]',
  now,
);

await insertPendingOrder(ordersDb, {
  id: 'ord_test1',
  kind: 'service',
  seller: 'seller_1',
  buyer: 'buyer_1',
  serviceSnapshot: {
    role: 'Producer',
    name: 'Custom beat',
    amountCents: 15000,
  },
  amountCents: 15000,
  feeCents: 0,
  stripeSessionId: 'cs_test_1',
});
let row = db.prepare('SELECT * FROM orders WHERE id=?').get('ord_test1');
ok(!!row && row.status === 'pending', 'order starts pending');
equal(row.amountCents, 15000);

const notifications = [];
const notified = [];
await processCheckoutSession(
  ordersDb,
  { id: 'evt_1' },
  { id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_1' },
  async (rows) => {
    notified.push(...rows);
    notifications.push(...rows);
  },
);
row = db.prepare('SELECT * FROM orders WHERE id=?').get('ord_test1');
equal(row.status, 'paid');
equal(row.paymentIntent, 'pi_1');
equal(notified.length, 2);
equal(notified[0].user, 'buyer_1');
equal(notified[1].user, 'seller_1');
ok(notified[1].body.includes('made a sale'));

// idempotency: same event again must not duplicate notifications
notified.length = 0;
const second = await processCheckoutSession(
  ordersDb,
  { id: 'evt_1' },
  { id: 'cs_test_1', payment_status: 'paid' },
  async (rows) => {
    notified.push(...rows);
  },
);
ok(second === false, 'replayed event returns false');
equal(notified.length, 0);

// unpaid async status must not mark paid
await insertPendingOrder(ordersDb, {
  id: 'ord_test2',
  kind: 'track',
  track: 'trk_1',
  seller: 'seller_1',
  buyer: 'buyer_1',
  serviceSnapshot: { name: 'Night Drive', amountCents: 5000 },
  amountCents: 5000,
  feeCents: 0,
  stripeSessionId: 'cs_test_2',
});
await processCheckoutSession(
  ordersDb,
  { id: 'evt_2' },
  { id: 'cs_test_2', payment_status: 'unpaid' },
  async () => {},
);
row = db.prepare('SELECT status FROM orders WHERE id=?').get('ord_test2');
equal(row.status, 'pending');

// expired sessions cancel pending orders
await cancelStaleOrdersForSession(ordersDb, 'cs_test_2');
row = db.prepare('SELECT status FROM orders WHERE id=?').get('ord_test2');
equal(row.status, 'canceled');

/* ---------------- labels ---------------- */
equal(
  orderLabel(
    'service',
    JSON.stringify({ name: 'Mix per song', amountCents: 8000 }),
    null,
  ),
  'Mix per song ($80)',
);
equal(orderLabel('track', '{}', 'trk_9'), 'track trk_9');
equal(orderLabel('service', 'not json', null), 'creator service');

// OrderError carries a status
try {
  parseServiceRate({ role: 'Manager', service: 'x', amountCents: 100 });
  assert.fail('should throw');
} catch (e) {
  ok(e instanceof OrderError);
  equal(e.status, 400);
  checks++;
}

console.log(`PASS: ${checks} payments assertions.`);
