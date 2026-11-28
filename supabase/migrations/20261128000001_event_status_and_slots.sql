-- Event status from real dates, and participant counts from booked slots.
-- Safe to run more than once. Also saved as supabase/STEP7_event_status_and_slots.sql.

-- Reads a time written as 18:30, 18:30:00 or 6:30 PM. Returns null for anything else.
create or replace function public.admin_to_time(p text)
returns time language plpgsql immutable as $$
begin
  if p is null or trim(p) = '' then return null; end if;
  return trim(p)::time;
exception when others then
  return null;
end $$;

-- When a match starts and ends, read as Lagos wall clock time
create or replace function public.admin_match_window(p_date date, p_start text, p_end text, out starts_at timestamptz, out ends_at timestamptz)
language plpgsql stable as $$
declare s time := coalesce(public.admin_to_time(p_start), time '00:00'); e time := public.admin_to_time(p_end);
begin
  starts_at := (p_date + s) at time zone 'Africa/Lagos';
  if e is null or e <= s then ends_at := starts_at + interval '2 hours';
  else ends_at := (p_date + e) at time zone 'Africa/Lagos'; end if;
end $$;

-- Rides store the day in event_date and the clock time in start_time
create or replace function public.admin_ride_window(p_date timestamptz, p_start text, p_end text, p_dur_type text, p_dur_value numeric, out starts_at timestamptz, out ends_at timestamptz)
language plpgsql stable as $$
declare s time := public.admin_to_time(p_start); e time := public.admin_to_time(p_end); d date := (p_date at time zone 'Africa/Lagos')::date; mins int;
begin
  starts_at := case when s is null then p_date else (d + s) at time zone 'Africa/Lagos' end;
  if e is not null and s is not null and e > s then
    ends_at := (d + e) at time zone 'Africa/Lagos';
  else
    mins := case lower(coalesce(p_dur_type, '')) when 'hours' then coalesce(p_dur_value, 0) * 60 when 'minutes' then coalesce(p_dur_value, 0) else 180 end;
    ends_at := starts_at + make_interval(mins => greatest(30, coalesce(nullif(mins, 0), 180)));
  end if;
end $$;

-- upcoming, live, passed or cancelled. Never trusts a stored label.
create or replace function public.admin_event_status(p_cancelled boolean, p_starts timestamptz, p_ends timestamptz)
returns text language sql stable as $$
  select case
    when coalesce(p_cancelled, false) then 'cancelled'
    when now() >= p_ends then 'passed'
    when now() >= p_starts then 'live'
    else 'upcoming' end
$$;

create or replace function public.admin_get_events(
  p_search text default null, p_status text default 'all', p_sport text default 'all',
  p_start timestamptz default null, p_end timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public.admin_require();
  with ev as (
    select m.id, 'match'::text event_type, m.title, coalesce(nullif(m.sport, ''), 'Football') sport,
           m.organizer_name organizer, m.organizer_phone::text organizer_phone,
           w.starts_at event_date, w.ends_at end_date,
           public.admin_event_status(m.cancellation_status, w.starts_at, w.ends_at) status,
           -- Slots booked, so one player paying for three counts as three
           (select coalesce(sum(coalesce(p.number_of_slots, 1)), 0) from public.players p
             where p.match_id = m.id and not coalesce(p.cancellation_status, false)) participants,
           (select count(*) from public.players p where p.match_id = m.id and not coalesce(p.cancellation_status, false)) registrations,
           (select count(distinct j.user_id) from public.user_joined_matches j join public.players p on p.id = j.player_id
             where j.match_id = m.id and not coalesce(p.cancellation_status, false)) unique_users,
           m.total_slots capacity,
           coalesce(v.name, m.venue) venue,
           coalesce((select sum(t.number_of_tickets) from public.tickets t where t.match_id = m.id), 0) tickets_sold,
           (select round(avg((coalesce(f.venue_quality,0) + coalesce(f.match_organization,0) + coalesce(f.referee_performance,0))::numeric / 3), 1)
              from public.feedback f where f.match_id = m.id) avg_rating,
           null::text start_landmark, null::text end_landmark,
           coalesce(m.price, 0) price, m.is_paid, m.super_code::text super_code, m.created_at
    from public.matches m
    left join public.venues v on v.id = m.venue_id
    cross join lateral public.admin_match_window(m.match_date, coalesce(m.start_time::text, m.match_time::text), m.end_time::text) w
    union all
    select e.id_uuid, 'cycling', e.title, 'Cycling', e.host_name, e.host_phone,
           w.starts_at, w.ends_at,
           public.admin_event_status(e.cancellation_status, w.starts_at, w.ends_at),
           (select coalesce(sum(coalesce(a.number_of_slots, 1)), 0) from public.cycling_attendees a
             where a.cycling_event_id_uuid = e.id_uuid and public.admin_norm(coalesce(a.status::text, '')) not in ('cancelled', 'canceled')),
           (select count(*) from public.cycling_attendees a
             where a.cycling_event_id_uuid = e.id_uuid and public.admin_norm(coalesce(a.status::text, '')) not in ('cancelled', 'canceled')),
           (select count(distinct j.user_id) from public.user_joined_cycling j where j.cycling_event_id = e.id_uuid),
           e.max_attendees,
           e.start_landmark_name,
           0, null,
           e.start_landmark_name, e.end_landmark_name,
           coalesce(e.price, 0), not e.is_free, e.supercode, e.created_at
    from public.cycling_events e
    cross join lateral public.admin_ride_window(e.event_date, e.start_time::text, e.end_time::text, e.duration_type::text, e.duration_value::numeric) w
  )
  select coalesce(jsonb_agg(row_to_json(ev)::jsonb order by ev.event_date desc nulls last), '[]'::jsonb) into v_result
  from ev
  where (v_search is null or ev.title ilike '%' || v_search || '%' or ev.organizer ilike '%' || v_search || '%')
    and (coalesce(p_status, 'all') = 'all' or ev.status = lower(p_status)
         or (lower(p_status) in ('completed', 'ended') and ev.status = 'passed'))
    and (coalesce(p_sport, 'all') = 'all' or lower(ev.sport) = lower(p_sport))
    and (p_start is null or ev.event_date >= p_start)
    and (p_end is null or ev.event_date < p_end);
  return v_result;
end $$;

-- Dashboard: upcoming means it has not started and is not cancelled
create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('dashboard.view');
  with rev as (select * from public.admin_revenue_items(now() - interval '30 days', now())),
  days as (select generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d),
  st as (
    select public.admin_event_status(m.cancellation_status, w.starts_at, w.ends_at) s
    from public.matches m cross join lateral public.admin_match_window(m.match_date, coalesce(m.start_time::text, m.match_time::text), m.end_time::text) w
    union all
    select public.admin_event_status(e.cancellation_status, w.starts_at, w.ends_at)
    from public.cycling_events e cross join lateral public.admin_ride_window(e.event_date, e.start_time::text, e.end_time::text, e.duration_type::text, e.duration_value::numeric) w
  )
  select jsonb_build_object(
    'revenue_30d', (select coalesce(sum(amount), 0) from rev),
    'commission_30d', (select coalesce(sum(commission), 0) from rev),
    'new_users_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'events_upcoming', (select count(*) from st where s = 'upcoming'),
    'events_live', (select count(*) from st where s = 'live'),
    'pending_venues', (select count(*) from public.venues where public.admin_venue_status(is_verified, verified_status::text) = 'pending'),
    'revenue_daily', (select jsonb_agg(jsonb_build_object('day', d, 'amount', coalesce((select sum(amount) from rev where date_trunc('day', rev.at) = days.d), 0)) order by d) from days),
    'signups_daily', (select jsonb_agg(jsonb_build_object('day', d, 'count', (select count(*) from public.profiles p where date_trunc('day', p.created_at) = days.d)) order by d) from days),
    'recent_activity', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', l.id, 'action', l.action, 'details', l.details, 'created_at', l.created_at, 'admin_email', a.email) x
        from public.audit_logs l left join public.admins a on a.id = l.admin_id
        where l.action not in ('page_view')
        order by l.created_at desc limit 6) r), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
