CREATE TABLE online_runs (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER DEFAULT 0 NOT NULL,
  state TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX online_runs_recent ON online_runs (created_at DESC);
--> statement-breakpoint
CREATE INDEX online_runs_owner ON online_runs (owner, created_at DESC);
