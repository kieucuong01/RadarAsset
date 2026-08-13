WITH duplicate_running AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY command ORDER BY started_at DESC, id DESC) AS position
  FROM market_ingestion_scheduler_runs
  WHERE status = 'running'
)
UPDATE market_ingestion_scheduler_runs AS run
SET status = 'failed', finished_at = NOW(), error_code = 'duplicate_scheduler_recovered'
FROM duplicate_running AS duplicate
WHERE run.id = duplicate.id AND duplicate.position > 1;

CREATE UNIQUE INDEX market_ingestion_scheduler_runs_one_active_command_idx
  ON market_ingestion_scheduler_runs(command)
  WHERE status = 'running';
