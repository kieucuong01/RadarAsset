DELETE FROM "investment_theses"
WHERE lower("source") IN ('last30days', 'ai-berkshire', 'daily_stock_analysis');

DELETE FROM "research_runs"
WHERE lower("source") IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   OR EXISTS (
     SELECT 1
     FROM jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof("parameters"->'adapters') = 'array'
           THEN "parameters"->'adapters'
         ELSE '[]'::jsonb
       END
     ) AS adapter(value)
     WHERE lower(adapter.value) IN ('last30days', 'ai-berkshire', 'daily_stock_analysis')
   );
