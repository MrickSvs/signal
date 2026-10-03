-- PLAN 3.3. One row per feedback for the « Retours » screen (SPEC §12.3): server-side pagination
-- and filters through PostgREST, without joining four tables on every page.
-- - analysis: the latest one (a feedback is re-triaged by --retry-failed or a later run);
-- - insights: open ones only (propose / actif). Merged and dissolved-rejected insights keep frozen
--   items as matching memory (ADR-010) and are not where a feedback lives;
-- - search_text: subject, verbatim, item summaries and the id, for a simple ilike search.
-- security_invoker: the view runs with the caller's rights, so RLS (no policy) still hides it
-- from anon and authenticated; only the service role reads it.
create view public.feedback_inbox
with (security_invoker = true) as
select
  f.id,
  f.channel,
  f.received_at,
  f.subject,
  f.truncated,
  f.language,
  f.customer_id,
  c.name as customer_name,
  c.status as customer_status,
  c.plan as customer_plan,
  c.segment as customer_segment,
  a.status as analysis_status,
  a.churn_signal,
  a.injection_suspected,
  coalesce(i.item_types, '{}') as item_types,
  coalesce(i.product_areas, '{}') as product_areas,
  coalesce(i.existing_feature, false) as existing_feature,
  i.summary,
  coalesce(l.insight_ids, '{}') as insight_ids,
  concat_ws(' ', f.id, f.subject, f.raw_text, i.summaries) as search_text
from public.feedbacks f
left join public.customers c on c.id = f.customer_id
left join lateral (
  select fa.status, fa.churn_signal, fa.injection_suspected
  from public.feedback_analyses fa
  where fa.feedback_id = f.id
  order by fa.created_at desc
  limit 1
) a on true
left join lateral (
  select
    array_agg(distinct fi.type) as item_types,
    array_agg(distinct fi.product_area) as product_areas,
    bool_or(fi.existing_feature) as existing_feature,
    (array_agg(fi.summary order by fi.item_index))[1] as summary,
    string_agg(fi.summary, ' ' order by fi.item_index) as summaries
  from public.feedback_items fi
  where fi.feedback_id = f.id
) i on true
left join lateral (
  select array_agg(distinct ii.insight_id order by ii.insight_id) as insight_ids
  from public.insight_items ii
  join public.insights ins on ins.id = ii.insight_id
  where ii.feedback_id = f.id and ins.status in ('propose', 'actif')
) l on true;

revoke all on public.feedback_inbox from anon, authenticated;
