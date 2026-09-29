/**
 * Stripe access for SESSION (Cloudflare Workers friendly).
 * All functions degrade gracefully when keys are not configured so the
 * whole app keeps working in "payments coming soon" mode.
 */
import { env } from 'cloudflare:workers';
import Stripe from 'stripe';

type EnvVars = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_FEE_BPS?: string;
  APP_URL?: string;
};

function vars(): EnvVars {
  return env as unknown as EnvVars;
}

export function stripeConfigured(): boolean {
  return !!vars().STRIPE_SECRET_KEY;
}

export function webhookSecret(): string {
  return vars().STRIPE_WEBHOOK_SECRET || '';
}

export function feeBps(): number {
  const raw = Number(vars().STRIPE_FEE_BPS);
  return Number.isFinite(raw) && raw >= 0 && raw <= 3000 ? raw : 0;
}

export function appUrl(): string {
  return vars().APP_URL || 'https://session.studio';
}

let cached: Stripe | null = null;

export function stripe(): Stripe {
  const key = vars().STRIPE_SECRET_KEY;
  if (!key)
    throw Object.assign(new Error('Card payments are not configured yet.'), {
      status: 503,
    });
  if (!cached)
    cached = new Stripe(key, {
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 1,
      telemetry: false,
    });
  return cached;
}

/** Create (or reuse) an Express connected account for a seller. */
export async function sellerAccountId(userId: string): Promise<string> {
  const existing = await (
    await import('./server')
  ).one('SELECT accountId FROM stripe_accounts WHERE user=?1', userId);
  if (existing?.accountId) return existing.accountId;
  const account = await stripe().accounts.create({
    type: 'express',
    metadata: { sessionUser: userId },
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
  });
  const { run } = await import('./server');
  await run(
    `INSERT INTO stripe_accounts (user, accountId, chargesEnabled, payoutsEnabled, details, created)
     VALUES (?1,?2,0,0,'{}',?3)`,
    userId,
    account.id,
    Date.now(),
  );
  return account.id;
}

/** Refresh the local snapshot of a connected account's capabilities. */
export async function refreshAccountStatus(userId: string): Promise<{
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
} | null> {
  const { one, run } = await import('./server');
  const row = await one(
    'SELECT accountId FROM stripe_accounts WHERE user=?1',
    userId,
  );
  if (!row?.accountId) return null;
  const account = await stripe().accounts.retrieve(row.accountId);
  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  await run(
    `UPDATE stripe_accounts SET chargesEnabled=?2, payoutsEnabled=?3, details=?4
     WHERE user=?1`,
    userId,
    chargesEnabled ? 1 : 0,
    payoutsEnabled ? 1 : 0,
    JSON.stringify({
      requirements: account.requirements?.currently_due ?? [],
      displayName: account.settings?.dashboard?.display_name ?? '',
    }),
  );
  return { accountId: row.accountId, chargesEnabled, payoutsEnabled };
}

export async function createOnboardingLink(userId: string): Promise<string> {
  const accountId = await sellerAccountId(userId);
  const link = await stripe().accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${appUrl()}/?view=My%20profile`,
    return_url: `${appUrl()}/?view=My%20profile&stripe=return`,
  });
  return link.url;
}

export type CheckoutItem = {
  name: string;
  description?: string;
  amountCents: number;
  sellerAccountId: string;
  buyerId: string;
  orderId: string;
};

export async function createCheckoutSession(
  item: CheckoutItem,
): Promise<{ sessionId: string; url: string }> {
  const fee = (await import('./orders')).platformFeeCents(
    item.amountCents,
    feeBps(),
  );
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: item.amountCents,
          product_data: {
            name: item.name.slice(0, 120),
            ...(item.description
              ? { description: item.description.slice(0, 240) }
              : {}),
          },
        },
      },
    ],
    client_reference_id: item.orderId,
    metadata: { orderId: item.orderId, buyerId: item.buyerId },
    payment_intent_data: {
      metadata: { orderId: item.orderId, buyerId: item.buyerId },
      ...(fee > 0
        ? {
            application_fee_amount: fee,
            transfer_data: { destination: item.sellerAccountId },
          }
        : {
            transfer_data: { destination: item.sellerAccountId },
          }),
    },
    success_url: `${appUrl()}/?view=My%20profile&order=success`,
    cancel_url: `${appUrl()}/?view=My%20profile&order=canceled`,
  });
  if (!session.url)
    throw Object.assign(new Error('Stripe did not return a checkout URL.'), {
      status: 502,
    });
  return { sessionId: session.id, url: session.url };
}

/** Verify a webhook signature using Workers' SubtleCrypto provider. */
export async function verifyWebhook(
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event> {
  const secret = webhookSecret();
  if (!secret)
    throw Object.assign(new Error('Webhook secret is not configured.'), {
      status: 503,
    });
  if (!signature)
    throw Object.assign(new Error('Missing Stripe signature.'), {
      status: 400,
    });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  try {
    return await stripe().webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
      undefined,
      cryptoProvider,
    );
  } catch {
    throw Object.assign(new Error('Webhook signature check failed.'), {
      status: 400,
    });
  }
}
