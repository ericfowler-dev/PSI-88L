CREATE TABLE file_deletions (
  storage_key text PRIMARY KEY,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
