import { run } from '@/lib/server';

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

export async function notifyUser(input: NotificationInput) {
  if (!input.user || input.user === input.actor) return;
  await run(
    `INSERT INTO notifications
      (id,user,actor,kind,resourceType,resourceId,body,created,readAt,uniqueKey)
     VALUES (?,?,?,?,?,?,?,?,NULL,?)
     ON CONFLICT(uniqueKey) DO UPDATE SET
      actor=excluded.actor,
      kind=excluded.kind,
      resourceType=excluded.resourceType,
      resourceId=excluded.resourceId,
      body=excluded.body,
      created=excluded.created,
      readAt=NULL`,
    crypto.randomUUID(),
    input.user,
    input.actor || null,
    input.kind,
    input.resourceType,
    input.resourceId,
    input.body.slice(0, 240),
    input.created || Date.now(),
    input.uniqueKey,
  );
}
