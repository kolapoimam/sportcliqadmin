-- SportCliq Admin portal v4
-- Additive only. Safe to run more than once.
--
--   1. Fixes "Database error saving new user" when a login is created without a
--      first and last name (Supabase Add user, Supabase invite, admin setup, admin invites,
--      Google sign in). The app creates a profile from the sign up names and profiles
--      only accept letters, so this fills safe names before the user row is saved.
--   2. Push notifications with a tap link, OneSignal performance numbers and
--      in app views, opens and clicks.
--   3. Analytics with filters for revenue stream, sport and city.

-------------------------------------------------------------------------------
-- 1. Safe names on every new login
-------------------------------------------------------------------------------
create or replace function public.admin_portal_letters(p text)
returns text language sql immutable as $$
  select initcap(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z]', '', 'g')))
$$;

create or replace function public.admin_portal_fill_user_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  f text;
  l text;
  full_name text;
  parts text[];
begin
  begin
    -- Keep names the app already sent when they are valid
    f := case when coalesce(m->>'first_name', '') ~ '^[a-zA-Z]+$' then m->>'first_name' else public.admin_portal_letters(m->>'first_name') end;
    l := case when coalesce(m->>'last_name', '') ~ '^[a-zA-Z]+$' then m->>'last_name' else public.admin_portal_letters(m->>'last_name') end;

    if f = '' then f := public.admin_portal_letters(m->>'given_name'); end if;
    if l = '' then l := public.admin_portal_letters(m->>'family_name'); end if;

    full_name := trim(coalesce(nullif(m->>'full_name', ''), nullif(m->>'name', ''), ''));
    if (f = '' or l = '') and full_name <> '' then
      parts := regexp_split_to_array(full_name, '\s+');
      if f = '' then f := public.admin_portal_letters(parts[1]); end if;
      if l = '' and array_length(parts, 1) > 1 then l := public.admin_portal_letters(parts[array_length(parts, 1)]); end if;
    end if;

    if f = '' then f := public.admin_portal_letters(split_part(coalesce(new.email, ''), '@', 1)); end if;
    if f = '' then f := 'Sport'; end if;
    if l = '' then l := 'User'; end if;

    if (m->>'first_name') is distinct from f or (m->>'last_name') is distinct from l then
      new.raw_user_meta_data := m || jsonb_build_object('first_name', left(f, 50), 'last_name', left(l, 50));
    end if;
  exception when others then
    raise warning 'admin_portal_fill_user_names skipped: %', sqlerrm;
  end;
  return new;
end $$;

-- Named to run before any other before insert trigger on auth.users
do $$
begin
  if to_regclass('auth.users') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data')
     and not exists (select 1 from pg_trigger where tgname = 'aaa_admin_portal_fill_user_names' and tgrelid = 'auth.users'::regclass) then
    create trigger aaa_admin_portal_fill_user_names
      before insert on auth.users
      for each row execute function public.admin_portal_fill_user_names();
  end if;
end $$;

revoke all on function public.admin_portal_fill_user_names() from public;

-------------------------------------------------------------------------------
-- 2. Push notifications: tap link, image, OneSignal stats, in app events
-------------------------------------------------------------------------------
alter table public.notifications add column if not exists image_url text;
alter table public.notifications add column if not exists onesignal_id text;
alter table public.notifications add column if not exists push_stats jsonb;
alter table public.notifications add column if not exists stats_synced_at timestamptz;

create table if not exists public.app_notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null,
  event text not null check (event in ('view', 'open', 'click')),
  created_at timestamptz not null default now(),
  unique (notification_id, user_id, event)
);
create index if not exists app_notification_events_notification_idx on public.app_notification_events(notification_id, event);
alter table public.app_notification_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_notification_events' and policyname = 'app_notification_events_own') then
    create policy app_notification_events_own on public.app_notification_events
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- Is this admin notification meant for this user
create or replace function public.app_notification_for_user(n public.notifications, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text := public.admin_norm(n.target_type::text);
begin
  if p_user is null or n.sent_by is null or coalesce(n.status, '') = 'alert' then return false; end if;
  return case
    when t = 'all' then true
    when t = 'user' then n.target_id = p_user
    when t = 'event' then exists (select 1 from public.user_joined_matches j where j.user_id = p_user and j.match_id = n.target_id)
                       or exists (select 1 from public.user_joined_cycling c where c.user_id = p_user and c.cycling_event_id = n.target_id)
    when t = 'organizers' or t = 'organizer' then exists (select 1 from public.user_organized_matches o where o.user_id = p_user)
                       or exists (select 1 from public.user_hosted_cycling h where h.user_id = p_user)
    when t in ('venueowners', 'venueowner') then exists (select 1 from public.venues v where v.user_id = p_user)
    else false end;
end $$;

-- In app notification list for the signed in user (used by the SportCliq app)
create or replace function public.app_my_notifications(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select created_at into v_since from public.profiles where id = v_uid;
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n
               where public.app_notification_for_user(n, v_uid)
                 and n.sent_at >= coalesce(v_since, '-infinity'::timestamptz) - interval '30 days'
                 and not exists (select 1 from public.app_notification_events e where e.notification_id = n.id and e.user_id = v_uid and e.event in ('open', 'click'))),
    'items', coalesce((
      select jsonb_agg(x order by x->>'sent_at' desc) from (
        select jsonb_build_object(
          'id', n.id, 'title', n.title, 'message', n.message, 'link', n.link, 'image_url', n.image_url, 'sent_at', n.sent_at,
          'read', exists (select 1 from public.app_notification_events e where e.notification_id = n.id and e.user_id = v_uid and e.event in ('open', 'click'))) x
        from public.notifications n
        where public.app_notification_for_user(n, v_uid)
          and n.sent_at >= coalesce(v_since, '-infinity'::timestamptz) - interval '30 days'
        order by n.sent_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb)
  );
end $$;

-- The app records view (shown in the list), open (tapped in the list) and click (opened the link)
create or replace function public.app_track_notification(p_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  n public.notifications;
begin
  if v_uid is null or p_event not in ('view', 'open', 'click') then return; end if;
  select * into n from public.notifications where id = p_id;
  if not found or not public.app_notification_for_user(n, v_uid) then return; end if;
  insert into public.app_notification_events(notification_id, user_id, event) values (p_id, v_uid, p_event)
  on conflict (notification_id, user_id, event) do nothing;
end $$;

create or replace function public.app_mark_all_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.app_notification_events(notification_id, user_id, event)
  select n.id, v_uid, 'open' from public.notifications n where public.app_notification_for_user(n, v_uid)
  on conflict (notification_id, user_id, event) do nothing;
end $$;

-- Send with a tap link and optional image
create or replace function public.admin_send_notification_v2(
  p_type text, p_target text, p_target_id uuid, p_title text, p_message text, p_link text, p_image text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_image text := nullif(trim(coalesce(p_image, '')), '');
begin
  perform public.admin_require_perm('notifications.send');
  if v_link is not null and not (v_link ~ '^/' or v_link ~* '^https://') then
    raise exception 'The link must start with / or https://';
  end if;
  if v_image is not null and v_image !~* '^https://' then
    raise exception 'The image must be an https link';
  end if;
  v := public.admin_send_notification(p_type, p_target, p_target_id, p_title, p_message);
  update public.notifications set link = v_link, image_url = v_image where id = (v->>'id')::uuid;
  return v || jsonb_build_object('link', v_link, 'image_url', v_image);
end $$;

-- Used by the admin-dispatch function after it sends or refreshes stats
create or replace function public.admin_record_push_stats(p_id uuid, p_onesignal_id text, p_stats jsonb)
returns void language sql security definer set search_path = public as $$
  update public.notifications
  set onesignal_id = coalesce(nullif(p_onesignal_id, ''), onesignal_id),
      push_stats = coalesce(p_stats, push_stats),
      stats_synced_at = case when p_stats is null then stats_synced_at else now() end
  where id = p_id
$$;

-- Performance for one notification
create or replace function public.admin_notification_performance(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare n public.notifications;
begin
  perform public.admin_require_perm('notifications.view');
  select * into n from public.notifications where id = p_id;
  if not found then raise exception 'Notification not found'; end if;
  return jsonb_build_object(
    'id', n.id, 'recipients', coalesce(n.recipients, 0), 'push_sent', coalesce(n.push_sent, 0), 'email_sent', coalesce(n.email_sent, 0),
    'status', n.status, 'delivered_at', n.delivered_at, 'delivery_error', n.delivery_error,
    'onesignal_id', n.onesignal_id, 'push_stats', coalesce(n.push_stats, '{}'::jsonb), 'stats_synced_at', n.stats_synced_at,
    'inapp_views', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'view'),
    'inapp_opens', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'open'),
    'inapp_clicks', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'click'),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'opens', o, 'clicks', c) order by h) from (
        select date_trunc('hour', created_at) h, count(*) filter (where event = 'open') o, count(*) filter (where event = 'click') c
        from public.app_notification_events where notification_id = n.id group by 1 order by 1 limit 72) t), '[]'::jsonb)
  );
end $$;

-- Summary numbers for the notifications list
create or replace function public.admin_notification_summary(p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require_perm('notifications.view');
  return coalesce((select jsonb_object_agg(n.id, jsonb_build_object(
      'push_stats', coalesce(n.push_stats, '{}'::jsonb),
      'views', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'view'),
      'opens', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'open'),
      'clicks', (select count(*) from public.app_notification_events e where e.notification_id = n.id and e.event = 'click')))
    from public.notifications n where n.id = any(p_ids)), '{}'::jsonb);
end $$;

-------------------------------------------------------------------------------
-- 3. Analytics with filters
-------------------------------------------------------------------------------
create or replace function public.admin_get_analytics_v2(
  p_start timestamptz, p_end timestamptz, p_stream text default null, p_sport text default null, p_city text default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text;
  v_stream text := nullif(lower(trim(coalesce(p_stream, ''))), '');
  v_sport text := nullif(lower(trim(coalesce(p_sport, ''))), '');
  v_city text := nullif(lower(trim(coalesce(p_city, ''))), '');
  v_result jsonb;
begin
  perform public.admin_require_perm('analytics.view');
  if v_stream = 'all' then v_stream := null; end if;
  if v_sport = 'all' then v_sport := null; end if;
  if v_city = 'all' then v_city := null; end if;
  v_unit := case when p_end - p_start <= interval '31 days' then 'day' when p_end - p_start <= interval '92 days' then 'week' else 'month' end;

  with rev0 as (
    select r.kind, r.amount, r.at, r.rate, r.commission, r.source_type, r.source_id,
           coalesce(r.venue_id, m.venue_id) venue_id,
           case r.source_type when 'match' then coalesce(nullif(m.sport, ''), 'Football') when 'cycling' then 'Cycling' else 'Venue booking' end sport,
           coalesce(vv.city, lm.state, '') city,
           coalesce(m.title, e.title, vv.name, 'Item') title
    from public.admin_revenue_items(p_start, p_end) r
    left join public.matches m on r.source_type = 'match' and m.id = r.source_id
    left join public.cycling_events e on r.source_type = 'cycling' and e.id_uuid = r.source_id
    left join public.landmarks lm on lm.id_uuid = e.start_landmark_id
    left join public.venues vv on vv.id = coalesce(r.venue_id, m.venue_id)
  ),
  rev as (
    select * from rev0
    where (v_stream is null or kind = v_stream)
      and (v_sport is null or lower(sport) = v_sport)
      and (v_city is null or lower(city) = v_city)
  ),
  by_kind as (select kind, sum(amount) total, sum(commission) comm, count(*) n from rev group by kind),
  events0 as (
    select 'match'::text kind, coalesce(nullif(m.sport, ''), 'Football') sport, coalesce(v.city, '') city, m.created_at at
    from public.matches m left join public.venues v on v.id = m.venue_id
    where m.created_at >= p_start and m.created_at < p_end
    union all
    select 'cycling', 'Cycling', coalesce(l.state, ''), e.created_at
    from public.cycling_events e left join public.landmarks l on l.id_uuid = e.start_landmark_id
    where e.created_at >= p_start and e.created_at < p_end
  ),
  events as (
    select * from events0
    where (v_stream is null or v_stream = 'venue' or kind = v_stream)
      and (v_sport is null or lower(sport) = v_sport)
      and (v_city is null or lower(city) = v_city)
  )
  select jsonb_build_object(
    'period_unit', v_unit,
    'filters', jsonb_build_object('stream', coalesce(v_stream, 'all'), 'sport', coalesce(p_sport, 'all'), 'city', coalesce(p_city, 'all')),
    'options', jsonb_build_object(
      'sports', coalesce((select jsonb_agg(s order by s) from (
          select distinct coalesce(nullif(sport, ''), 'Football') s from public.matches union select 'Cycling') x), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(c order by c) from (
          select distinct trim(city) c from public.venues where coalesce(trim(city), '') <> '') x), '[]'::jsonb)),
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.profiles where created_at < p_end),
      'new_users', (select count(*) from public.profiles where created_at >= p_start and created_at < p_end),
      'total_events', (select count(*) from events),
      'total_revenue', (select coalesce(sum(amount), 0) from rev),
      'total_commission', (select coalesce(sum(commission), 0) from rev),
      'transactions', (select count(*) from rev),
      'avg_ticket', (select coalesce(round(avg(amount), 2), 0) from rev),
      'active_venues', (select count(*) from public.venues v where public.admin_venue_status(v.is_verified, v.verified_status::text) = 'verified'
                        and (v_city is null or lower(trim(v.city)) = v_city))
    ),
    'revenue', jsonb_build_object(
      'match', coalesce((select total from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select total from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select total from by_kind where kind = 'venue'), 0)),
    'commission', jsonb_build_object(
      'match', coalesce((select comm from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select comm from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select comm from by_kind where kind = 'venue'), 0)),
    'commission_rates', jsonb_build_object(
      'match', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'venue'), 0)),
    'commission_rules', public.admin_commission_rules(),
    'free_activities', (select count(distinct source_id) from rev where rate = 0),
    'user_growth', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, created_at) period, count(*) c from public.profiles where created_at >= p_start and created_at < p_end group by 1) g), '[]'::jsonb),
    'revenue_trend', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'match', m, 'cycling', c, 'venue', v, 'commission', k) order by period)
      from (select date_trunc(v_unit, at) period, coalesce(sum(amount) filter (where kind = 'match'), 0) m, coalesce(sum(amount) filter (where kind = 'cycling'), 0) c,
                   coalesce(sum(amount) filter (where kind = 'venue'), 0) v, coalesce(sum(commission), 0) k from rev group by 1) t), '[]'::jsonb),
    'event_trend', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, at) period, count(*) c from events group by 1) t), '[]'::jsonb),
    'top_sports', coalesce((select jsonb_agg(jsonb_build_object('sport', sport, 'count', c) order by c desc)
      from (select sport, count(*) c from events group by sport) s), '[]'::jsonb),
    'top_cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'revenue', r, 'count', c) order by r desc)
      from (select coalesce(nullif(city, ''), 'Unknown') city, sum(amount) r, count(*) c from rev group by 1 order by 2 desc limit 20) s), '[]'::jsonb),
    'top_venues', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'city', city, 'events', events, 'revenue', revenue) order by revenue desc, events desc)
      from (select v.id, v.name, v.city,
                   (select count(*) from public.matches m where m.venue_id = v.id and m.created_at >= p_start and m.created_at < p_end
                      and (v_sport is null or lower(coalesce(nullif(m.sport, ''), 'Football')) = v_sport)) events,
                   coalesce((select sum(amount) from rev where rev.venue_id = v.id), 0) revenue
            from public.venues v where (v_city is null or lower(trim(v.city)) = v_city)
            order by revenue desc, events desc limit 100) tv), '[]'::jsonb),
    'transactions_list', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', at, 'kind', kind, 'title', title, 'sport', sport, 'city', city, 'amount', amount, 'rate', rate, 'commission', commission) x
        from rev order by at desc limit 2000) t), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- 3b. Payout receipt details
-------------------------------------------------------------------------------
create or replace function public.admin_cashout_receipt(p_source text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  perform public.admin_require_perm('cashouts.view');
  if p_source not in ('cashouts', 'cycling_cashouts', 'venue_booking_cashout') then raise exception 'Unknown cashout source'; end if;
  execute format(
    'select jsonb_build_object(''payout_reference'', c.payout_reference, ''payout_method'', c.payout_method, ''reviewed_at'', c.reviewed_at,
            ''status'', c.status::text, ''reviewed_by'', nullif(trim(coalesce(a.first_name, '''') || '' '' || coalesce(a.last_name, '''')), ''''), ''reviewer_email'', a.email)
     from public.%I c left join public.admins a on a.id = c.reviewed_by where c.id = $1', p_source)
  into r using p_id;
  if r is null then raise exception 'Cashout not found'; end if;
  return r;
end $$;

-------------------------------------------------------------------------------
-- 4. Grants
-------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'admin_portal_letters', 'app_notification_for_user', 'app_my_notifications', 'app_track_notification', 'app_mark_all_notifications_read',
      'admin_send_notification_v2', 'admin_record_push_stats', 'admin_notification_performance', 'admin_notification_summary', 'admin_get_analytics_v2',
      'admin_cashout_receipt')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname = 'admin_record_push_stats' then
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
    elsif f.proname not in ('admin_portal_letters', 'app_notification_for_user') then
      if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f.sig); end if;
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.app_notification_events to authenticated;
  end if;
end $$;
