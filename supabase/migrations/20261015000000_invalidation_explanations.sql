-- Expose persisted rejection reasons only through the existing reveal-protected read model.
create or replace function public.get_round_results(p_room_id uuid, p_round_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_standings jsonb;
begin
  if not public.is_room_member(p_room_id) then
    perform public.raise_app_error('not_member');
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  select * into v_round
    from public.rounds
   where id = coalesce(p_round_id, v_room.current_round_id) and room_id = p_room_id;
  if not found then
    perform public.raise_app_error('round_not_active');
  end if;
  if not public.round_results_visible(v_round.id) then
    perform public.raise_app_error('results_not_available');
  end if;

  v_standings := public.standings_through(p_room_id, v_round.round_number);

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'phase', v_room.phase,
    'round', jsonb_build_object(
      'id', v_round.id,
      'number', v_round.round_number,
      'letter', v_round.letter,
      'reveal_at', v_round.reveal_at,
      'lock_reason', v_round.lock_reason,
      'is_current', v_round.id = v_room.current_round_id
    ),
    'standings', v_standings,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_id', s.player_id,
               'display_name', rp.display_name,
               'left', rp.left_at is not null,
               'round_points', (select coalesce(sum(c.points), 0) from public.round_cells(v_round.id) c
                                 where c.player_id = s.player_id),
               'total_points', coalesce((
                 select (e ->> 'total_points')::integer
                   from jsonb_array_elements(v_standings) e
                  where e ->> 'player_id' = s.player_id::text), 0),
               'cells', (
                 select jsonb_agg(jsonb_build_object(
                          'category', c.category,
                          'answer', c.answer,
                          'state', c.state,
                          'points', c.points,
                          'duplicate_count', c.duplicate_count,
                          'validation_reason', a.validation_reason,
                          'validation_suggestion', a.validation_suggestion,
                          'host_invalidated', a.invalidated_at is not null,
                          'validation_timed_out', exists (select 1 from public.round_validations v
                            where v.round_id = v_round.id and v.player_id = c.player_id
                              and v.category = c.category and v.model = 'validation-timeout')
                        ) order by array_position(enum_range(null::public.answer_category), c.category))
                   from public.round_cells(v_round.id) c
                   left join public.answers a on a.round_id = v_round.id
                     and a.player_id = c.player_id and a.category = c.category
                  where c.player_id = s.player_id
               )
             ) order by rp.joined_at, s.player_id)
        from public.answer_sheets s
        join public.room_players rp on rp.room_id = s.room_id and rp.player_id = s.player_id
       where s.round_id = v_round.id
    ), '[]'::jsonb)
  );
end;
$$;
