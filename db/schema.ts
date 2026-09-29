import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const profiles = sqliteTable('profiles', {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  roles: text().notNull(),
  bio: text().notNull().default(''),
  location: text().notNull().default(''),
  visibility: text().notNull().default('private'),
  avatar: text(),
  rates: text().notNull().default('[]'),
  created: integer().notNull(),
});
export const takeBanks = sqliteTable(
  'take_banks',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    project: text().notNull(),
    title: text().notNull(),
    data: text().notNull(),
    revision: integer().notNull(),
    updated: integer().notNull(),
    lastSaveId: text().notNull(),
    deletedAt: integer(),
  },
  (t) => [index('idx_take_banks_owner').on(t.owner)],
);
export const takeBankFiles = sqliteTable(
  'take_bank_files',
  {
    bank: text().notNull(),
    take: text().notNull(),
    owner: text().notNull(),
    project: text().notNull(),
    file: text().notNull(),
    hash: text().notNull(),
    size: integer().notNull(),
    frames: integer().notNull(),
    sampleRate: integer().notNull(),
    depth: integer().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bank, t.take] }),
    uniqueIndex('idx_take_bank_files_file').on(t.file),
    index('idx_take_bank_files_owner').on(t.owner),
  ],
);
export const files = sqliteTable(
  'files',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    name: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    purpose: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [index('idx_files_owner').on(t.owner)],
);
export const tracks = sqliteTable(
  'tracks',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    title: text().notNull(),
    kind: text().notNull(),
    genre: text().notNull(),
    bpm: integer().notNull(),
    musicalKey: text().notNull(),
    visibility: text().notNull().default('private'),
    permission: text().notNull().default('listen'),
    fileId: text().notNull(),
    price: integer(),
    plays: integer().notNull().default(0),
    created: integer().notNull(),
  },
  (t) => [
    index('idx_tracks_visibility').on(t.visibility),
    index('idx_tracks_owner').on(t.owner),
    index('idx_tracks_file').on(t.fileId),
  ],
);
export const projects = sqliteTable(
  'projects',
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    title: text().notNull(),
    data: text().notNull(),
    updated: integer().notNull(),
    revision: integer().notNull().default(0),
    updatedBy: text(),
    lastSaveId: text(),
    forkedFrom: text(),
  },
  (t) => [index('idx_projects_owner').on(t.owner)],
);
export const projectFiles = sqliteTable(
  'project_files',
  { project: text().notNull(), file: text().notNull() },
  (t) => [
    primaryKey({ columns: [t.project, t.file] }),
    index('idx_project_files_file').on(t.file),
  ],
);
// Kept after project deletion to prevent an ambiguous first-save retry from recreating it.
export const projectCreations = sqliteTable(
  'project_creations',
  {
    owner: text().notNull(),
    creationKey: text().notNull(),
    project: text().notNull(),
    requestHash: text().notNull(),
    revision: integer().notNull(),
    created: integer().notNull(),
    deletedAt: integer(),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.creationKey] }),
    uniqueIndex('idx_project_creations_project').on(t.project),
  ],
);
export const rooms = sqliteTable('rooms', {
  id: text().primaryKey(),
  owner: text().notNull(),
  title: text().notNull(),
  project: text(),
  invite: text().notNull(),
  expires: integer().notNull(),
  created: integer().notNull(),
  visibility: text().notNull().default('invite'),
});
export const members = sqliteTable(
  'members',
  { room: text().notNull(), user: text().notNull(), seen: integer().notNull() },
  (t) => [
    primaryKey({ columns: [t.room, t.user] }),
    index('idx_members_user').on(t.user),
  ],
);
export const events = sqliteTable(
  'events',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    room: text().notNull(),
    sender: text().notNull(),
    recipient: text(),
    kind: text().notNull(),
    body: text().notNull(),
    created: integer().notNull(),
    clientId: text(),
  },
  (t) => [
    index('idx_events_room_id').on(t.room, t.id),
    uniqueIndex('idx_events_dedup').on(t.room, t.sender, t.clientId),
  ],
);
export const saved = sqliteTable(
  'saved',
  { user: text().notNull(), track: text().notNull() },
  (t) => [primaryKey({ columns: [t.user, t.track] })],
);
export const follows = sqliteTable(
  'follows',
  { user: text().notNull(), target: text().notNull() },
  (t) => [primaryKey({ columns: [t.user, t.target] })],
);
export const comments = sqliteTable(
  'comments',
  {
    id: text().primaryKey(),
    track: text().notNull(),
    user: text().notNull(),
    body: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [index('idx_comments_track').on(t.track)],
);
export const notifications = sqliteTable(
  'notifications',
  {
    id: text().primaryKey(),
    user: text().notNull(),
    actor: text(),
    kind: text().notNull(),
    resourceType: text().notNull(),
    resourceId: text().notNull(),
    body: text().notNull(),
    created: integer().notNull(),
    readAt: integer(),
    uniqueKey: text().notNull(),
  },
  (t) => [
    index('idx_notifications_user_created').on(t.user, t.created),
    index('idx_notifications_user_read').on(t.user, t.readAt, t.created),
    uniqueIndex('idx_notifications_unique').on(t.uniqueKey),
  ],
);
export const collaborationRequests = sqliteTable(
  'collaboration_requests',
  {
    id: text().primaryKey(),
    sender: text().notNull(),
    recipient: text().notNull(),
    track: text(),
    trackTitle: text(),
    role: text().notNull(),
    message: text().notNull(),
    status: text().notNull().default('pending'),
    scopeKey: text().notNull().default(''),
    senderName: text().notNull().default('SESSION member'),
    senderUsername: text().notNull().default('member'),
    senderAvatar: text(),
    recipientName: text().notNull().default('SESSION member'),
    recipientUsername: text().notNull().default('member'),
    recipientAvatar: text(),
    created: integer().notNull(),
    updated: integer().notNull(),
    operationId: text(),
  },
  (t) => [
    index('idx_collaboration_recipient').on(t.recipient, t.status, t.updated),
    index('idx_collaboration_sender').on(t.sender, t.updated),
    index('idx_collaboration_track').on(t.track),
    uniqueIndex('idx_collaboration_active_track_unique')
      .on(t.sender, t.recipient, t.track)
      .where(
        sql`${t.status} IN ('pending','accepted') AND ${t.track} IS NOT NULL`,
      ),
    uniqueIndex('idx_collaboration_active_profile_unique')
      .on(t.sender, t.recipient)
      .where(sql`${t.status} IN ('pending','accepted') AND ${t.track} IS NULL`),
    uniqueIndex('idx_collaboration_active_scope_unique')
      .on(t.scopeKey)
      .where(sql`${t.status} IN ('pending','accepted')`),
  ],
);
export const directMessages = sqliteTable(
  'direct_messages',
  {
    id: text().primaryKey(),
    request: text().notNull(),
    sender: text().notNull(),
    body: text().notNull(),
    created: integer().notNull(),
    clientId: text().notNull(),
  },
  (t) => [
    index('idx_direct_messages_request').on(t.request, t.created),
    uniqueIndex('idx_direct_messages_dedup').on(
      t.request,
      t.sender,
      t.clientId,
    ),
  ],
);
export const userBlocks = sqliteTable(
  'user_blocks',
  {
    user: text().notNull(),
    target: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.user, t.target] }),
    index('idx_user_blocks_target').on(t.target),
  ],
);
export const reports = sqliteTable('reports', {
  id: text().primaryKey(),
  user: text().notNull(),
  track: text().notNull(),
  body: text().notNull(),
  created: integer().notNull(),
});
export const projectVersions = sqliteTable(
  'project_versions',
  {
    id: text().primaryKey(),
    project: text().notNull(),
    owner: text().notNull(),
    title: text().notNull(),
    data: text().notNull(),
    created: integer().notNull(),
    author: text(),
  },
  (t) => [index('idx_versions_project').on(t.project)],
);
export const mediaSessions = sqliteTable(
  'media_sessions',
  {
    room: text().notNull(),
    user: text().notNull(),
    session: text().notNull(),
    seen: integer().notNull(),
    sharing: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.room, t.user] })],
);
export const rateLimits = sqliteTable('rate_limits', {
  id: text().primaryKey(),
  count: integer().notNull(),
  expires: integer().notNull(),
});
export const roomEditors = sqliteTable(
  'room_editors',
  {
    room: text().notNull(),
    project: text().notNull(),
    user: text().notNull(),
    grantedBy: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.room, t.project, t.user] }),
    index('idx_room_editors_project_user').on(t.project, t.user),
  ],
);

export const stripeAccounts = sqliteTable('stripe_accounts', {
  user: text().primaryKey(),
  accountId: text().notNull(),
  chargesEnabled: integer().notNull().default(0),
  payoutsEnabled: integer().notNull().default(0),
  details: text().notNull().default('{}'),
  created: integer().notNull(),
});

export const orders = sqliteTable(
  'orders',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    track: text(),
    seller: text().notNull(),
    buyer: text().notNull(),
    serviceSnapshot: text().notNull().default('{}'),
    amountCents: integer().notNull(),
    feeCents: integer().notNull().default(0),
    currency: text().notNull().default('usd'),
    status: text().notNull().default('pending'),
    stripeSessionId: text().notNull().default(''),
    paymentIntent: text(),
    created: integer().notNull(),
  },
  (t) => [
    index('idx_orders_seller_created').on(t.seller, t.created),
    index('idx_orders_buyer_created').on(t.buyer, t.created),
    index('idx_orders_session').on(t.stripeSessionId),
  ],
);

export const stripeEvents = sqliteTable('stripe_events', {
  eventId: text().primaryKey(),
  processedAt: integer().notNull(),
});
