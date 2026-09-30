import { getChatGPTUser } from '@/app/chatgpt-auth';
import { str, fail, limit, readJSON, one, database } from '@/lib/server';
import {
  stripeConfigured,
  createOnboardingLink,
  refreshAccountStatus,
  createCheckoutSession,
  feeBps,
} from '@/lib/stripe-server';
import {
  OrderError,
  type DB,
  parseRates,
  orderId,
  insertPendingOrder,
  platformFeeCents,
} from '@/lib/orders';

function db(): DB {
  return database() as unknown as DB;
}

export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to continue.', 401);
    const uid = user.userId;
    if (req.headers.get('origin') !== new URL(req.url).origin)
      fail('Blocked cross-site request.');
    await limit(uid, 'stripe', 30);

    const b = await readJSON(req, 8000);
    const action = str(b.action, 40);

    if (action === 'onboard') {
      if (!stripeConfigured())
        fail('Card payments are not configured on this SESSION yet.', 503);
      const url = await createOnboardingLink(uid);
      return Response.json({ url });
    }

    if (action === 'status') {
      const status = stripeConfigured()
        ? await refreshAccountStatus(uid).catch(() => null)
        : null;
      return Response.json({ configured: stripeConfigured(), status });
    }
    if (action === 'checkout') {
      if (!stripeConfigured())
        fail('Card payments are not configured on this SESSION yet.', 503);
      const kind = str(b.kind, 12);
      if (kind !== 'service' && kind !== 'track')
        fail('Choose a service or a track to buy.');

      if (kind === 'service') {
        const seller = str(b.seller, 120);
        if (seller === uid) fail('You cannot book your own service.');
        const index = Number(b.serviceIndex);
        const profile = await one(
          "SELECT rates, name FROM profiles WHERE id=? AND visibility='public'",
          seller,
        );
        if (!profile) fail('That creator is not taking bookings.', 404);
        const rates = parseRates(profile.rates);
        if (!Number.isInteger(index) || index < 0 || index >= rates.length)
          fail('Choose one of the listed services.');
        const service = rates[index];
        const status = await refreshAccountStatus(seller);
        if (!status?.chargesEnabled)
          fail('That creator cannot accept card payments yet.', 409);

        const id = orderId();
        const session = await createCheckoutSession({
          name: `${service.service} · ${profile.name}`,
          description:
            service.note ||
            'Booked on SESSION — delivered through your message thread.',
          amountCents: service.amountCents,
          sellerAccountId: status.accountId,
          buyerId: uid,
          orderId: id,
        });
        await insertPendingOrder(db(), {
          id,
          kind: 'service',
          seller,
          buyer: uid,
          serviceSnapshot: {
            role: service.role,
            name: service.service,
            amountCents: service.amountCents,
          },
          amountCents: service.amountCents,
          feeCents: platformFeeCents(service.amountCents, feeBps()),
          stripeSessionId: session.sessionId,
        });
        return Response.json({ url: session.url });
      }

      // kind === 'track'
      const trackId = str(b.track, 120);
      const track = await one(
        'SELECT id, owner, title, price, visibility FROM tracks WHERE id=?',
        trackId,
      );
      if (!track || track.visibility !== 'public' || track.price == null)
        fail('That track is not for sale.', 404);
      if (track.owner === uid) fail('You cannot buy your own track.');
      const status = await refreshAccountStatus(track.owner);
      if (!status?.chargesEnabled)
        fail('That creator cannot accept card payments yet.', 409);

      const id = orderId();
      const sellerProfile = await one(
        'SELECT name FROM profiles WHERE id=?',
        track.owner,
      );
      const session = await createCheckoutSession({
        name: `${track.title} · license`,
        description: `Track purchase on SESSION from ${sellerProfile?.name || 'a creator'}.`,
        amountCents: track.price,
        sellerAccountId: status.accountId,
        buyerId: uid,
        orderId: id,
      });
      await insertPendingOrder(db(), {
        id,
        kind: 'track',
        track: trackId,
        seller: track.owner,
        buyer: uid,
        serviceSnapshot: { name: track.title, amountCents: track.price },
        amountCents: track.price,
        feeCents: platformFeeCents(track.price, feeBps()),
        stripeSessionId: session.sessionId,
      });
      return Response.json({ url: session.url });
    }

    fail('Unknown payments action.');
  } catch (e) {
    if (e instanceof OrderError)
      return Response.json({ error: e.message }, { status: e.status });
    const error = e as { message?: unknown; status?: unknown };
    return Response.json(
      {
        error:
          typeof error?.message === 'string'
            ? error.message
            : 'Payments request failed.',
      },
      {
        status:
          typeof error?.status === 'number' && error.status >= 400
            ? error.status
            : 500,
      },
    );
  }
}

export async function GET() {
  return Response.json({ configured: stripeConfigured() });
}
