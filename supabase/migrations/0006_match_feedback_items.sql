-- PLAN 4.1. Semantic search of the agent's search_feedbacks tool (SPEC §10.5): the closest items
-- to a query vector (cosine, HNSW index of 0001), best item per feedback. The vector of an item is
-- « underlying problem — summary » (ADR-010), so the search matches problems, not wording.
create function public.match_feedback_items(
  query_embedding extensions.vector(1024),
  match_count int default 50,
  min_similarity float default 0.3
)
returns table (feedback_id text, item_id text, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select distinct on (m.feedback_id) m.feedback_id, m.item_id, m.similarity
  from (
    select fi.feedback_id, fi.id as item_id, 1 - (fi.embedding <=> query_embedding) as similarity
    from public.feedback_items fi
    where fi.embedding is not null
    order by fi.embedding <=> query_embedding
    limit greatest(match_count, 1) * 3
  ) m
  where m.similarity >= min_similarity
  order by m.feedback_id, m.similarity desc;
$$;

revoke all on function public.match_feedback_items(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.match_feedback_items(extensions.vector, int, float) to service_role;
