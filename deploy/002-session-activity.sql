-- Forward migration for existing or freshly initialized SESSION PostgreSQL databases.
-- No account IDs, browser IDs, request metadata or content are stored.
CREATE TABLE IF NOT EXISTS activity_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  "subjectHash" TEXT NOT NULL,
  PRIMARY KEY(day,kind,"subjectHash"),
  CONSTRAINT activity_daily_day_length CHECK(length(day)=10),
  CONSTRAINT activity_daily_kind CHECK(kind IN ('visitor','user')),
  CONSTRAINT activity_daily_hash_length CHECK(length("subjectHash")=64)
);
