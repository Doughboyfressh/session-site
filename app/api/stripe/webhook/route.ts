import { prepareNotification } from '@/lib/social-server';
import { database, run } from '@/lib/server';
import type { DB } from '@/lib/orders';
import {
  cancelStaleOrdersForSession,
  processCheckoutSession,
} from '@/lib/orders';
import { verifyWebhook } from '@/lib/stripe-server';

function db(): DB {
  return database() as unknown as DB;
}

async function notify(
  rows: Array<{
    user: string;
    actor: string | null;
    body: string;
    uniqueKey: string;
  }>,
): Promise<void> {
  for (const row of rows) {
    await prepareNotification({
      ...row,
      kind: 'collaboration_status',
      resourceType: 'order',
      resourceId: row.uniqueKey,
      created: Date.now(),
    }).run();
  }
}

/** Give the buyer and seller an accepted DM thread for delivery. */
async function attachThread(order: {
  id: string;
  kind: string;
  buyer: string;
  seller: string;
  serviceSnapshot: string;
}): Promise<void> {
  const buyerProfile = await database()
    .prepare('SELECT name, username, avatar FROM profiles WHERE id=?1')
    .bind(order.buyer)
    .first<{
      name: string;
      username: string;
      avatar: string | null;
    }>();
  const sellerProfile = await database()
    .prepare('SELECT name, username, avatar FROM profiles WHERE id=?1')
    .bind(order.seller)
    .first<{
      name: string;
      username: string;
      avatar: string | null;
    }>();
  const label = (() => {
    try {
      const parsed = JSON.parse(order.serviceSnapshot) as {
        name?: string;
        amountCents?: number;
      };
      return parsed?.name || 'paid booking';
    } catch {
      return 'paid booking';
    }
  })();
  const requestId = crypto.randomUUID();
  await run(
    `INSERT INTO collaboration_requests
       (id, sender, recipient, trackTitle, role, message, status, scopeKey,
        senderName, senderUsername, senderAvatar,
        recipientName, recipientUsername, recipientAvatar,
        created, updated, operationId)
     VALUES (?1,?2,?3,NULL,'Producer',?4,'accepted',?5,?6,?7,?8,?9,?10,?11,?12,?12,?13)`,
    requestId,
    order.buyer,
    order.seller,
    `Paid booking — ${label}. Deliver the work and next steps here.`,
    `order:${JSON.stringify([order.id])}`,
    buyerProfile?.name || 'SESSION member',
    buyerProfile?.username || 'member',
    buyerProfile?.avatar ?? null,
    sellerProfile?.name || 'SESSION member',
    sellerProfile?.username || 'member',
    sellerProfile?.avatar ?? null,
    Date.now(),
    requestId,
  );
  await run(
    `INSERT INTO direct_messages (id, request, sender, body, created, clientId)
     VALUES (?1,?2,?3,?4,?5,?6)`,
    crypto.randomUUID(),
    requestId,
    order.seller,
    `Thanks for your order — ${label}. I'll deliver it here. Reply any time with references or files.`,
    Date.now(),
    crypto.randomUUID(),
  );
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const event = await verifyWebhook(raw, req.headers.get('stripe-signature'));

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        payment_status?: string;
        payment_intent?: string | null;
      };
      await processCheckoutSession(
        db(),
        { id: event.id },
        session,
        notify,
        attachThread,
      );
      return Response.json({ received: true });
    }

    if (
      event.type === 'checkout.session.async_payment_succeeded' ||
      event.type === 'checkout.session.async_payment_failed'
    ) {
      const session = event.data.object as { id: string };
      if (event.type === 'checkout.session.async_payment_failed') {
        await cancelStaleOrdersForSession(db(), session.id);
      } else {
        await processCheckoutSession(
          db(),
          { id: event.id },
          { ...session, payment_status: 'paid' },
          notify,
          attachThread,
        );
      }
      return Response.json({ received: true });
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as { id: string };
      await cancelStaleOrdersForSession(db(), session.id);
      return Response.json({ received: true });
    }

    return Response.json({ received: true, ignored: event.type });
  } catch (e) {
    const error = e as { message?: unknown; status?: unknown };
    return Response.json(
      {
        error:
          typeof error?.message === 'string' ? error.message : 'Webhook failed.',
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
