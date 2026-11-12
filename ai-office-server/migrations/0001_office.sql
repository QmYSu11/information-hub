CREATE TABLE office_tasks (
  id TEXT PRIMARY KEY,
  context_json TEXT NOT NULL,
  plan_json TEXT,
  results_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next_step INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 1,
  max_calls INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX office_tasks_expiry ON office_tasks(expires_at);
CREATE TABLE office_budget (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
