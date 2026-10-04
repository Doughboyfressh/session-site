CREATE TABLE `activity_daily` (
  `day` text NOT NULL,
  `kind` text NOT NULL,
  `subjectHash` text NOT NULL,
  PRIMARY KEY(`day`,`kind`,`subjectHash`),
  CONSTRAINT `activity_daily_day_length` CHECK(length(`day`)=10),
  CONSTRAINT `activity_daily_kind` CHECK(`kind` IN ('visitor','user')),
  CONSTRAINT `activity_daily_hash_length` CHECK(length(`subjectHash`)=64)
);
