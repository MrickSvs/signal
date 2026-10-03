-- Seeds insert explicit readable ids (C-001, T-101, R-001…). This function realigns the sequence
-- of an entity on the highest id in its table, so that the next generated id never collides with
-- a seeded one. It never moves a sequence backwards: ids are never reused (SPEC §7).

create function public.sync_id_sequence(entity text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  table_name text;
  sequence_name text;
  prefix text;
  highest bigint;
  current_value bigint;
begin
  case entity
    when 'customers' then table_name := 'customers'; sequence_name := 'public.customer_id_seq'; prefix := 'C';
    when 'feedbacks' then table_name := 'feedbacks'; sequence_name := 'public.feedback_id_seq'; prefix := 'R';
    when 'reference_tickets' then table_name := 'reference_tickets'; sequence_name := 'public.reference_ticket_id_seq'; prefix := 'T';
    else raise exception 'sync_id_sequence: unknown entity %', entity;
  end case;

  execute format(
    'select max((regexp_match(id, %L))[1]::bigint) from public.%I',
    '^' || prefix || '-(\d+)$',
    table_name
  ) into highest;

  -- Last value handed out, or start - 1 if the sequence was never used.
  select coalesce(pg_sequence_last_value(sequence_name::regclass), s.seqstart - 1)
    into current_value
    from pg_catalog.pg_sequence s
   where s.seqrelid = sequence_name::regclass;

  if highest is not null and highest > current_value then
    perform setval(sequence_name::regclass, highest, true);
    return highest;
  end if;
  return current_value;
end;
$$;

revoke execute on function public.sync_id_sequence(text) from public, anon, authenticated;
grant execute on function public.sync_id_sequence(text) to service_role;
