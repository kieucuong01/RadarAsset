-- Tenant-owned research artifacts must not become public orphans when a
-- research run (or its organization) is deleted.
ALTER TABLE "ai_insights"
DROP CONSTRAINT "ai_insights_research_run_id_fkey",
ADD CONSTRAINT "ai_insights_research_run_id_fkey"
FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_items"
DROP CONSTRAINT "evidence_items_research_run_id_fkey",
ADD CONSTRAINT "evidence_items_research_run_id_fkey"
FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "investment_theses"
DROP CONSTRAINT "investment_theses_research_run_id_fkey",
ADD CONSTRAINT "investment_theses_research_run_id_fkey"
FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forecast_points"
DROP CONSTRAINT "forecast_points_research_run_id_fkey",
ADD CONSTRAINT "forecast_points_research_run_id_fkey"
FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_runs"
DROP CONSTRAINT "provider_runs_research_run_id_fkey",
ADD CONSTRAINT "provider_runs_research_run_id_fkey"
FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
