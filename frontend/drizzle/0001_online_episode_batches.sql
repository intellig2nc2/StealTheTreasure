CREATE TABLE online_paths (
  run_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (run_id, path)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE online_episode_batches (
  run_id TEXT NOT NULL,
  last_episode INTEGER NOT NULL,
  episodes TEXT NOT NULL,
  PRIMARY KEY (run_id, last_episode)
) WITHOUT ROWID;
