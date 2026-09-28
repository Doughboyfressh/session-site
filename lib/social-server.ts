import { database } from '@/lib/server';

export type NotificationInput = {
  user: string;
  actor?: string | null;
  kind: string;
  resourceType: string;
  resourceId: string;
  body: string;
  uniqueKey: string;
  created?: number;
};

export function prepareNotification(
  input: NotificationInput,
  guard = '1',
  ...guardValues: unknown[]
) {
  const actor = input.actor || null;
  return database()
    .prepare(
      `INSERT INTO notifications
       (id,user,actor,kind,resourceType,resourceId,body,created,readAt,uniqueKey)
       SELECT ?,?,?,?,?,?,?,?,NULL,?
       WHERE (? IS NULL OR ? <> ?) AND (${guard})
       ON CONFLICT(uniqueKey) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.user,
      actor,
      input.kind,
      input.resourceType,
      input.resourceId,
      input.body.slice(0, 240),
      input.created || Date.now(),
      input.uniqueKey,
      actor,
      input.user,
      actor,
      ...guardValues,
    );
}

export async function notifyUser(input: NotificationInput) {
  if (!input.user || input.user === input.actor) return;
  await prepareNotification(input).run();
}
