-- A custom strategy owns its generated execution registry row. This must
-- cascade so archiving/deleting tenant data cannot be blocked by the 1:1 link.
ALTER TABLE "strategy_versions"
  DROP CONSTRAINT "strategy_versions_custom_strategy_version_id_fkey";

ALTER TABLE "strategy_versions"
  ADD CONSTRAINT "strategy_versions_custom_strategy_version_id_fkey"
  FOREIGN KEY ("custom_strategy_version_id") REFERENCES "custom_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
