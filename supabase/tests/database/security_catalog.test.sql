-- pgTAP: security invariants of the whole schema (regression guard for v1.0).
-- Any new function, table or grant that weakens the model fails here.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- Every SECURITY DEFINER function pins an empty search_path.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
  0::bigint,
  'every SECURITY DEFINER function has search_path = ''''');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not coalesce(p.proconfig, '{}') @> array['search_path=""']
      and p.prokind = 'f'),
  0::bigint,
  'every function (definer or not) has search_path = ''''');

-- The anon role (not signed in) can execute nothing in public.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint,
  'anon can execute no public function');

-- Signed-in clients can execute exactly the intended surface.
select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['create_room', 'join_room', 'leave_room', 'heartbeat', 'start_game', 'set_round_ready',
        'save_answers', 'lock_answers', 'set_results_ready', 'get_game_state', 'get_round_results',
        'set_answer_invalidated', 'start_next_round', 'finish_game', 'get_game_summary',
        'report_visibility', 'get_round_activity',
        'is_room_member', 'is_round_member', 'can_access_room_topic', 'round_answers_revealed'],
  'authenticated can execute exactly the 17 RPCs and the 4 RLS helpers');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['check_request'],
  'in private, clients can only run the request hook');

-- Row Level Security everywhere, no client write privileges anywhere.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'RLS is enabled on every public table');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'insert')
        or has_table_privilege('authenticated', c.oid, 'update')
        or has_table_privilege('authenticated', c.oid, 'delete')
        or has_table_privilege('authenticated', c.oid, 'truncate'))),
  0::bigint,
  'authenticated has no write privilege on any public table');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert'))),
  0::bigint,
  'anon has no table access at all');

select is(
  (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
  0::bigint,
  'there are only read policies in public');

select ok(
  not has_table_privilege('authenticated', 'private.rate_limit_counters', 'select')
  and not has_table_privilege('authenticated', 'private.rate_limit_rules', 'update'),
  'clients cannot read or tune rate limits');

select ok(
  not has_column_privilege('authenticated', 'public.rounds', 'letter', 'select'),
  'the hidden letter column stays unreadable');

select ok(
  not has_table_privilege('authenticated', 'public.answer_invalidation_events', 'select'),
  'the invalidation audit trail is not readable by clients');

-- Realtime publication carries status tables only — never answers or rounds.
select set_eq(
  $$ select tablename::text from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' $$,
  array['rooms', 'room_players', 'answer_sheets', 'ready_checks', 'visibility_events'],
  'only status tables are published to Realtime');

-- Realtime channel authorization exists for the private room topics.
select is(
  (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'),
  2::bigint,
  'room channels are authorized by RLS on realtime.messages');

select * from finish();
rollback;
