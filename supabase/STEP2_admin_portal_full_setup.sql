-- SportCliq Admin Portal: complete database setup in ONE file.
-- Paste all of this into the Supabase SQL editor and run it. Safe to run again, including on top of an earlier run.
-- Contains, in order: 20261113000001, 20261113000002, 20261124000001, 20261124000002, 20261124000003, 20261124000004 and 20261124000005.
-- Additive only. Nothing existing in your SportCliq tables is dropped or rewritten.


-- ===================== 20261113000001_admin_enum_labels.sql =====================
-- SportCliq Admin Portal, step 1 of 2
-- Run this file on its own first, then run step 2.
-- It only ADDS enum labels the admin portal needs, and only when the enum
-- does not already have an equivalent label (matching ignores case, spaces,
-- underscores and the canceled/cancelled spelling). Nothing is renamed or removed.

create or replace function public.admin_norm(t text)
returns text
language sql
immutable
as $$
  select replace(lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]', '', 'g')), 'canceled', 'cancelled')
$$;

do $$
declare
  spec record;
  v_type oid;
  v_typname text;
  v_label text;
begin
  for spec in
    select * from (values
      ('notifications',         'target_type',  array['admin','all','user','event','organizers','venue_owners']),
      ('notifications',         'type',         array['push','email','both','in_app']),
      ('notifications',         'category',     array['admin_alert','announcement']),
      ('admins',                'role',         array['admin','super_admin']),
      ('admins',                'status',       array['active','inactive']),
      ('cashouts',              'status',       array['pending','approved','rejected']),
      ('cycling_cashouts',      'status',       array['pending','approved','rejected']),
      ('cashout_requests',      'status',       array['pending','approved','rejected']),
      ('venues',                'verified_status', array['pending','verified','rejected']),
      ('cycling_events',        'status',       array['cancelled']),
      ('cycling_attendees',     'status',       array['registered','checked_in','no_show'])
    ) as s(tbl, col, labels)
  loop
    select a.atttypid, t.typname into v_type, v_typname
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    where a.attrelid = to_regclass('public.' || spec.tbl)
      and a.attname = spec.col
      and t.typtype = 'e';

    if v_type is null then
      continue; -- table or column missing, or column is not an enum
    end if;

    foreach v_label in array spec.labels loop
      if not exists (
        select 1 from pg_enum e
        where e.enumtypid = v_type
          and public.admin_norm(e.enumlabel) = public.admin_norm(v_label)
      ) then
        execute format('alter type %s add value if not exists %L', v_type::regtype, v_label);
        raise notice 'Added label % to enum %', v_label, v_typname;
      end if;
    end loop;
    v_type := null;
  end loop;
end $$;

-- ===================== 20261113000002_admin_portal.sql =====================
-- SportCliq Admin Portal, step 2 of 2
-- Run after step 1 has finished.
--
-- Everything here is additive and safe to run more than once.
-- No existing table, column, constraint, policy or data is dropped or changed.
-- It only adds new nullable columns, one new table, new functions,
-- new policies (named admin_portal_*), new triggers (named admin_portal_*),
-- the avatars storage bucket if missing, and adds notifications to Realtime.

-------------------------------------------------------------------------------
-- 1. New columns
-------------------------------------------------------------------------------

-- Link admins to Supabase Auth users, plus profile fields the portal shows
alter table public.admins add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.admins add column if not exists first_name text;
alter table public.admins add column if not exists last_name text;
alter table public.admins add column if not exists avatar_url text;
alter table public.admins add column if not exists permissions jsonb default '[]'::jsonb;
create unique index if not exists admins_user_id_key on public.admins(user_id);

-- Notification history needs recipients, delivery status and who sent it
alter table public.notifications add column if not exists recipients integer default 0;
alter table public.notifications add column if not exists status text default 'sent';
alter table public.notifications add column if not exists sent_by uuid references public.admins(id) on delete set null;

-- Cashout review details
alter table public.cashouts add column if not exists rejection_reason text;
alter table public.cashouts add column if not exists reviewed_by uuid references public.admins(id) on delete set null;
alter table public.cashouts add column if not exists reviewed_at timestamptz;
alter table public.cycling_cashouts add column if not exists rejection_reason text;
alter table public.cycling_cashouts add column if not exists reviewed_by uuid references public.admins(id) on delete set null;
alter table public.cycling_cashouts add column if not exists reviewed_at timestamptz;
alter table public.venue_booking_cashout add column if not exists reviewed_by uuid references public.admins(id) on delete set null;
alter table public.venue_booking_cashout add column if not exists reviewed_at timestamptz;

-- Venue verification documents and rejection reason
alter table public.venues add column if not exists verification_documents text[];
alter table public.venues add column if not exists rejection_reason text;

-- Sport for matches (nullable, the portal treats empty as Football)
alter table public.matches add column if not exists sport text;

-- Helpful indexes for admin queries
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists notifications_sent_at_idx on public.notifications(sent_at desc);

-------------------------------------------------------------------------------
-- 2. New table for portal settings (commission rates)
-------------------------------------------------------------------------------

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
alter table public.admin_settings enable row level security;

insert into public.admin_settings(key, value)
values ('commission_rates', '{"match": 10, "cycling": 10, "venue": 10}'::jsonb)
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- 3. Helper functions
-------------------------------------------------------------------------------

create or replace function public.admin_norm(t text)
returns text language sql immutable as $$
  select replace(lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]', '', 'g')), 'canceled', 'cancelled')
$$;

-- Find the real enum label for a column, whatever its case or spacing
create or replace function public.admin_enum_label(p_table text, p_column text, p_candidates text[])
returns text language plpgsql stable as $$
declare
  v_type oid;
  v_label text;
  v_cand text;
begin
  select a.atttypid into v_type
  from pg_attribute a join pg_type t on t.oid = a.atttypid
  where a.attrelid = to_regclass('public.' || p_table) and a.attname = p_column and t.typtype = 'e';

  if v_type is null then
    return p_candidates[1];
  end if;

  foreach v_cand in array p_candidates loop
    select e.enumlabel into v_label from pg_enum e
    where e.enumtypid = v_type and public.admin_norm(e.enumlabel) = public.admin_norm(v_cand)
    limit 1;
    if v_label is not null then
      return v_label;
    end if;
  end loop;
  raise exception 'Enum for %.% has no label matching %', p_table, p_column, p_candidates;
end $$;

create or replace function public.admin_is_paid(t text)
returns boolean language sql immutable as $$
  select public.admin_norm(t) in ('paid','success','successful','completed','complete','confirmed','true')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and public.admin_norm(status::text) = 'active'
  )
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
      and public.admin_norm(status::text) = 'active'
      and public.admin_norm(role::text) = 'superadmin'
  )
$$;

create or replace function public.admin_current_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.admins where user_id = auth.uid() limit 1
$$;

create or replace function public.admin_require(p_super boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_super and not public.is_super_admin() then
    raise exception 'Only super admins can do this' using errcode = '42501';
  elsif not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
end $$;

-------------------------------------------------------------------------------
-- 4. Session, setup and audit
-------------------------------------------------------------------------------

-- True only while the admins table is empty (used by the first admin setup page)
create or replace function public.admin_setup_available()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.admins)
$$;

-- Called right after sign in. Returns the admin record and stamps last_login.
create or replace function public.admin_get_session()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.admins%rowtype;
begin
  select * into r from public.admins where user_id = auth.uid();
  if not found then
    return null;
  end if;
  if public.admin_norm(r.status::text) <> 'active' then
    raise exception 'This admin account is inactive' using errcode = '42501';
  end if;
  update public.admins set last_login = now() where id = r.id;
  return jsonb_build_object(
    'id', r.id, 'email', r.email, 'role', r.role::text, 'status', r.status::text,
    'first_name', r.first_name, 'last_name', r.last_name, 'avatar_url', r.avatar_url,
    'permissions', coalesce(r.permissions, '[]'::jsonb), 'created_at', r.created_at
  );
end $$;

create or replace function public.admin_log(p_action text, p_details text default null, p_ip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  insert into public.audit_logs(admin_id, action, details, ip_address)
  values (public.admin_current_id(), p_action, p_details, p_ip);
end $$;

create or replace function public.admin_record_action(p_action text, p_event_type text, p_target_table text, p_target_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_actions(admin_id, action_type, target_id, details, event_type, target_table)
  values (public.admin_current_id(), p_action, p_target_id, p_details, coalesce(p_event_type, 'profile'), p_target_table);
  insert into public.audit_logs(admin_id, action, details, ip_address)
  values (public.admin_current_id(),
          case when p_target_table in ('matches', 'cycling_events') then 'event_management' else 'user_management' end,
          p_action || ' on ' || p_target_table || ' ' || p_target_id, null);
end $$;

-------------------------------------------------------------------------------
-- 5. Revenue source used by dashboard and analytics
-------------------------------------------------------------------------------

-- Dropped first so this file can be rerun after update 3, which widens this function
drop function if exists public.admin_revenue_items(timestamptz, timestamptz);
create function public.admin_revenue_items(p_start timestamptz default null, p_end timestamptz default null)
returns table(kind text, amount numeric, at timestamptz, venue_id uuid)
language sql stable security definer set search_path = public as $$
  select * from (
    -- paid match registrations
    select 'match'::text, coalesce(m.price, 0) * coalesce(p.number_of_slots, 1), p.created_at, m.venue_id
    from public.players p join public.matches m on m.id = p.match_id
    where m.is_paid and public.admin_is_paid(p.payment_status)
    union all
    -- match tickets
    select 'match', coalesce(t.total_price, 0), coalesce(t.purchase_date, t.created_at), m.venue_id
    from public.tickets t join public.matches m on m.id = t.match_id
    union all
    -- paid cycling registrations
    select 'cycling', coalesce(e.price, 0) * coalesce(a.number_of_slots, 1), a.created_at, null::uuid
    from public.cycling_attendees a join public.cycling_events e on e.id_uuid = a.cycling_event_id_uuid
    where coalesce(a.payment_status, false) and not coalesce(e.is_free, true)
    union all
    -- paid venue bookings
    select 'venue', coalesce(b.amount, 0), b.created_at, b.venue_id
    from public.bookings b
    where public.admin_is_paid(b.payment_status)
  ) x(kind, amount, at, venue_id)
  where (p_start is null or x.at >= p_start) and (p_end is null or x.at < p_end)
$$;

-------------------------------------------------------------------------------
-- 6. Dashboard metrics
-------------------------------------------------------------------------------

create or replace function public.admin_get_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'total_events', (select count(*) from public.matches) + (select count(*) from public.cycling_events),
    'pending_cashouts',
        (select count(*) from public.cashouts where public.admin_norm(status::text) = 'pending')
      + (select count(*) from public.cycling_cashouts where public.admin_norm(status::text) = 'pending')
      + (select count(*) from public.venue_booking_cashout where public.admin_norm(status) = 'pending'),
    'total_revenue', (select coalesce(sum(amount), 0) from public.admin_revenue_items()),
    'active_venues', (select count(*) from public.venues
                      where coalesce(is_verified, false) or public.admin_norm(verified_status::text) in ('verified','true'))
  ) into v_result;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- 7. Analytics
-------------------------------------------------------------------------------

create or replace function public.admin_get_analytics(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text;
  v_rates jsonb;
  v_result jsonb;
begin
  perform public.admin_require();
  v_unit := case when p_end - p_start <= interval '92 days' then 'week' else 'month' end;
  select value into v_rates from public.admin_settings where key = 'commission_rates';
  v_rates := coalesce(v_rates, '{"match":0,"cycling":0,"venue":0}'::jsonb);

  with rev as (select * from public.admin_revenue_items(p_start, p_end)),
  rev_by_kind as (
    select kind, sum(amount) total from rev group by kind
  ),
  events as (
    select coalesce(nullif(m.sport, ''), 'Football') sport, m.created_at at from public.matches m
    where m.created_at >= p_start and m.created_at < p_end
    union all
    select 'Cycling', e.created_at from public.cycling_events e
    where e.created_at >= p_start and e.created_at < p_end
  )
  select jsonb_build_object(
    'period_unit', v_unit,
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.profiles where created_at < p_end),
      'new_users', (select count(*) from public.profiles where created_at >= p_start and created_at < p_end),
      'total_events', (select count(*) from events),
      'total_revenue', (select coalesce(sum(amount), 0) from rev),
      'active_venues', (select count(*) from public.venues
                        where coalesce(is_verified, false) or public.admin_norm(verified_status::text) in ('verified','true'))
    ),
    'revenue', jsonb_build_object(
      'match', coalesce((select total from rev_by_kind where kind = 'match'), 0),
      'cycling', coalesce((select total from rev_by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select total from rev_by_kind where kind = 'venue'), 0)
    ),
    'commission_rates', v_rates,
    'commission', jsonb_build_object(
      'match', round(coalesce((select total from rev_by_kind where kind = 'match'), 0) * coalesce((v_rates->>'match')::numeric, 0) / 100, 2),
      'cycling', round(coalesce((select total from rev_by_kind where kind = 'cycling'), 0) * coalesce((v_rates->>'cycling')::numeric, 0) / 100, 2),
      'venue', round(coalesce((select total from rev_by_kind where kind = 'venue'), 0) * coalesce((v_rates->>'venue')::numeric, 0) / 100, 2)
    ),
    'user_growth', coalesce((
      select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, created_at) period, count(*) c from public.profiles
            where created_at >= p_start and created_at < p_end group by 1) g), '[]'::jsonb),
    'revenue_trend', coalesce((
      select jsonb_agg(jsonb_build_object('period', period, 'match', m, 'cycling', c, 'venue', v) order by period)
      from (select date_trunc(v_unit, at) period,
                   sum(amount) filter (where kind = 'match') m,
                   sum(amount) filter (where kind = 'cycling') c,
                   sum(amount) filter (where kind = 'venue') v
            from rev group by 1) t), '[]'::jsonb),
    'event_trend', coalesce((
      select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, at) period, count(*) c from events group by 1) t), '[]'::jsonb),
    'top_sports', coalesce((
      select jsonb_agg(jsonb_build_object('sport', sport, 'count', c) order by c desc)
      from (select sport, count(*) c from events group by sport) s), '[]'::jsonb),
    'top_venues', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'city', city, 'events', events, 'revenue', revenue) order by revenue desc, events desc)
      from (
        select v.id, v.name, v.city,
               (select count(*) from public.matches m where m.venue_id = v.id and m.created_at >= p_start and m.created_at < p_end) events,
               coalesce((select sum(amount) from rev where rev.venue_id = v.id), 0) revenue
        from public.venues v
        order by revenue desc, events desc
        limit 10
      ) tv), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- 8. Users
-------------------------------------------------------------------------------

create or replace function public.admin_status_label(p_event_type text, p_status text)
returns text language sql immutable as $$
  select case public.admin_norm(p_status)
    when 'registered' then 'Registered'
    when 'confirmed' then 'Registered'
    when 'checkedin' then 'Checked In'
    when 'absent' then 'Absent'
    when 'noshow' then 'Absent'
    else null end
$$;

create or replace function public.admin_filter_user_ids(
  p_category text, p_start timestamptz, p_end timestamptz, p_search text
)
returns table(id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with params as (
    select public.admin_norm(coalesce(p_category, 'all')) v_cat,
           nullif(trim(coalesce(p_search, '')), '') v_search
  )
  select p.id, p.created_at from public.profiles p, params
  where (p_start is null or p.created_at >= p_start)
    and (p_end is null or p.created_at < p_end)
    and (
      params.v_cat in ('', 'all')
      or (params.v_cat = 'organizer' and exists (select 1 from public.user_organized_matches o where o.user_id = p.id))
      or (params.v_cat = 'host' and exists (select 1 from public.user_hosted_cycling h where h.user_id = p.id))
      or (params.v_cat = 'cycler' and exists (select 1 from public.user_joined_cycling c where c.user_id = p.id))
      or (params.v_cat = 'player' and exists (select 1 from public.user_joined_matches j where j.user_id = p.id))
      or (params.v_cat = 'venueowner' and exists (select 1 from public.venues v where v.user_id = p.id))
    )
    and (
      params.v_search is null
      or (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '') || ' ' || coalesce(p.nickname, '') || ' ' || coalesce(p.email, '')) ilike '%' || params.v_search || '%'
      or exists (select 1 from public.user_organized_matches o join public.matches m on m.id = o.match_id
                 where o.user_id = p.id and m.super_code ilike '%' || params.v_search || '%')
      or exists (select 1 from public.user_hosted_cycling h join public.cycling_events e on e.id_uuid = h.cycling_event_id
                 where h.user_id = p.id and e.supercode ilike '%' || params.v_search || '%')
      or exists (select 1 from public.user_joined_matches j join public.players pl on pl.id = j.player_id
                 where j.user_id = p.id and pl.confirmation_code ilike '%' || params.v_search || '%')
      or exists (select 1 from public.user_joined_cycling c join public.cycling_attendees a on a.id_uuid = c.attendee_id
                 where c.user_id = p.id and a.confirmation_code ilike '%' || params.v_search || '%')
      or exists (select 1 from public.access_pins ap where ap.user_id = p.id and ap.pin ilike '%' || params.v_search || '%')
    )
$$;

create or replace function public.admin_get_users(
  p_page integer default 1,
  p_per_page integer default 20,
  p_category text default 'all',
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_search text default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_total integer;
  v_rows jsonb;
begin
  perform public.admin_require();

  select count(*) into v_total from public.admin_filter_user_ids(p_category, p_start, p_end, p_search);

  with page as (
    select f.id from public.admin_filter_user_ids(p_category, p_start, p_end, p_search) f
    order by f.created_at desc nulls last
    offset greatest(coalesce(p_page, 1) - 1, 0) * greatest(coalesce(p_per_page, 20), 1)
    limit greatest(coalesce(p_per_page, 20), 1)
  ),
  participations as (
    select j.user_id, 'match'::text event_type, m.id event_id, m.title event_title,
           coalesce(v.name, m.venue) location, coalesce(m.price, 0) value,
           coalesce(pl.number_of_slots, 1) slots, pl.player_status::text raw_status,
           pl.confirmation_code::text confirmation_code, j.created_at
    from public.user_joined_matches j
    join page on page.id = j.user_id
    join public.matches m on m.id = j.match_id
    left join public.venues v on v.id = m.venue_id
    left join public.players pl on pl.id = j.player_id
    union all
    select c.user_id, 'cycling', e.id_uuid, e.title, e.start_landmark_name, coalesce(e.price, 0),
           coalesce(a.number_of_slots, 1), a.attendee_status, a.confirmation_code, c.created_at
    from public.user_joined_cycling c
    join page on page.id = c.user_id
    join public.cycling_events e on e.id_uuid = c.cycling_event_id
    join public.cycling_attendees a on a.id_uuid = c.attendee_id
  ),
  latest as (
    select distinct on (user_id) * from participations order by user_id, created_at desc
  )
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc nulls last), '[]'::jsonb) into v_rows
  from (
    select
      p.id,
      trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as name,
      p.email,
      p.phone_number as phone,
      p.status as account_status,
      p.created_at,
      array_remove(array[
        case when exists (select 1 from public.user_organized_matches o where o.user_id = p.id) then 'Organizer' end,
        case when exists (select 1 from public.user_hosted_cycling h where h.user_id = p.id) then 'Host' end,
        case when exists (select 1 from public.user_joined_cycling c where c.user_id = p.id) then 'Cycler' end,
        case when exists (select 1 from public.user_joined_matches j where j.user_id = p.id) then 'Player' end,
        case when exists (select 1 from public.venues v where v.user_id = p.id) then 'Venue Owner' end
      ], null) as categories,
      l.event_type, l.event_id, l.event_title, l.location, l.value, l.slots,
      public.admin_status_label(l.event_type, l.raw_status) as event_status,
      l.confirmation_code,
      (select count(*) from public.user_organized_matches o where o.user_id = p.id)
        + (select count(*) from public.user_hosted_cycling h where h.user_id = p.id) as events_organized,
      (select count(*) from public.user_joined_matches j where j.user_id = p.id)
        + (select count(*) from public.user_joined_cycling c where c.user_id = p.id) as events_participated,
      coalesce((
        select sum(coalesce(m.price, 0) * coalesce(pl.number_of_slots, 1))
        from public.user_organized_matches o join public.matches m on m.id = o.match_id
        join public.players pl on pl.match_id = m.id
        where o.user_id = p.id and m.is_paid and public.admin_is_paid(pl.payment_status)), 0)
      + coalesce((
        select sum(coalesce(e.price, 0) * coalesce(a.number_of_slots, 1))
        from public.user_hosted_cycling h join public.cycling_events e on e.id_uuid = h.cycling_event_id
        join public.cycling_attendees a on a.cycling_event_id_uuid = e.id_uuid
        where h.user_id = p.id and coalesce(a.payment_status, false)), 0) as total_earned,
      coalesce((select sum(ut.amount) from public.user_transactions ut
                where ut.user_id = p.id and ut.transaction_type = 'payment'), 0)
      + coalesce((select sum(t.total_price) from public.tickets t where t.buyer_id = p.id), 0) as total_spent,
      coalesce(
        (select m.super_code from public.user_organized_matches o join public.matches m on m.id = o.match_id
         where o.user_id = p.id order by o.created_at desc limit 1),
        (select e.supercode from public.user_hosted_cycling h join public.cycling_events e on e.id_uuid = h.cycling_event_id
         where h.user_id = p.id order by h.created_at desc limit 1)) as super_code,
      (select ap.pin from public.access_pins ap where ap.user_id = p.id order by ap.created_at desc limit 1) as access_pin,
      (select max(c.created_at) from public.cashouts c where c.organizer_id = p.id) as last_cashout,
      greatest(p.updated_at, l.created_at,
        (select max(o.created_at) from public.user_organized_matches o where o.user_id = p.id),
        (select max(h.created_at) from public.user_hosted_cycling h where h.user_id = p.id)) as last_activity,
      coalesce((select jsonb_agg(b.name order by ub.earned_at) from public.user_badges ub
                join public.badges b on b.id = ub.badge_id where ub.user_id = p.id), '[]'::jsonb) as badges
    from page
    join public.profiles p on p.id = page.id
    left join latest l on l.user_id = p.id
  ) r;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- Change a user's status for a match or cycling event
create or replace function public.admin_update_user_status(p_user_id uuid, p_event_type text, p_event_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.admin_norm(p_status);
  v_player uuid;
  v_attendee uuid;
begin
  perform public.admin_require();
  if v_norm not in ('registered', 'checkedin', 'absent') then
    raise exception 'Unknown status %', p_status;
  end if;

  if p_event_type = 'match' then
    select player_id into v_player from public.user_joined_matches
    where user_id = p_user_id and match_id = p_event_id order by created_at desc limit 1;
    if v_player is null then raise exception 'Player record not found for this match'; end if;
    update public.players set
      player_status = (case v_norm when 'registered' then 'Registered' when 'checkedin' then 'Checked In' else 'Absent' end)::public.player_status,
      status = case v_norm when 'registered' then 'registered' when 'checkedin' then 'checked_in' else 'absent' end,
      updated_at = now()
    where id = v_player;
    perform public.admin_record_action('update_status', 'match', 'players', v_player, jsonb_build_object('status', p_status, 'user_id', p_user_id));
  elsif p_event_type = 'cycling' then
    select attendee_id into v_attendee from public.user_joined_cycling
    where user_id = p_user_id and cycling_event_id = p_event_id order by created_at desc limit 1;
    if v_attendee is null then raise exception 'Attendee record not found for this cycling event'; end if;
    update public.cycling_attendees set
      attendee_status = case v_norm when 'registered' then 'registered' when 'checkedin' then 'checked_in' else 'no_show' end,
      updated_at = now()
    where id_uuid = v_attendee;
    begin
      execute format('update public.cycling_attendees set status = %L where id_uuid = %L',
        public.admin_enum_label('cycling_attendees', 'status',
          case v_norm when 'registered' then array['registered'] when 'checkedin' then array['checked_in','checkedin'] else array['no_show','absent'] end),
        v_attendee);
    exception when others then null; -- the text column above is the source of truth
    end;
    perform public.admin_record_action('update_status', 'cycling', 'cycling_attendees', v_attendee, jsonb_build_object('status', p_status, 'user_id', p_user_id));
  else
    raise exception 'Event type or ID missing for status update.';
  end if;
end $$;

-- Suspend or activate a user, or record a reset or notification action
create or replace function public.admin_user_action(p_user_id uuid, p_action text, p_target_table text default 'profiles')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  if p_action = 'suspend' then
    update public.profiles set status = 'suspended', updated_at = now() where id = p_user_id;
  elsif p_action = 'activate' then
    update public.profiles set status = 'active', updated_at = now() where id = p_user_id;
  elsif p_action not in ('reset_password', 'send_notification') then
    raise exception 'Unknown action %', p_action;
  end if;
  perform public.admin_record_action(p_action,
    case p_target_table when 'user_joined_matches' then 'match' when 'user_joined_cycling' then 'cycling' else 'profile' end,
    coalesce(p_target_table, 'profiles'), p_user_id, jsonb_build_object('action', p_action));
end $$;

-------------------------------------------------------------------------------
-- 9. Events (matches and cycling)
-------------------------------------------------------------------------------

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
           (m.match_date + m.match_time)::timestamptz event_date,
           case when m.cancellation_status then 'cancelled' else m.status end status,
           (select count(*) from public.players p where p.match_id = m.id) participants,
           m.total_slots capacity,
           coalesce(v.name, m.venue) venue,
           coalesce((select sum(t.number_of_tickets) from public.tickets t where t.match_id = m.id), 0) tickets_sold,
           (select round(avg((coalesce(f.venue_quality,0) + coalesce(f.match_organization,0) + coalesce(f.referee_performance,0))::numeric / 3), 1)
              from public.feedback f where f.match_id = m.id) avg_rating,
           null::text start_landmark, null::text end_landmark,
           coalesce(m.price, 0) price, m.is_paid, m.super_code::text super_code, m.created_at
    from public.matches m left join public.venues v on v.id = m.venue_id
    union all
    select e.id_uuid, 'cycling', e.title, 'Cycling', e.host_name, e.host_phone,
           e.event_date,
           case when e.cancellation_status then 'cancelled' else lower(e.status::text) end,
           (select coalesce(sum(a.number_of_slots), 0) from public.cycling_attendees a where a.cycling_event_id_uuid = e.id_uuid),
           e.max_attendees,
           e.start_landmark_name,
           0, null,
           e.start_landmark_name, e.end_landmark_name,
           coalesce(e.price, 0), not e.is_free, e.supercode, e.created_at
    from public.cycling_events e
  )
  select coalesce(jsonb_agg(row_to_json(ev)::jsonb order by ev.event_date desc nulls last), '[]'::jsonb) into v_result
  from ev
  where (v_search is null or ev.title ilike '%' || v_search || '%' or ev.organizer ilike '%' || v_search || '%')
    and (coalesce(p_status, 'all') = 'all' or public.admin_norm(ev.status) = public.admin_norm(p_status)
         or (public.admin_norm(p_status) = 'completed' and public.admin_norm(ev.status) in ('completed','passed','ended')))
    and (coalesce(p_sport, 'all') = 'all' or lower(ev.sport) = lower(p_sport))
    and (p_start is null or ev.event_date >= p_start)
    and (p_end is null or ev.event_date < p_end);
  return v_result;
end $$;

create or replace function public.admin_update_event(p_event_type text, p_id uuid, p_title text, p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  if p_event_type = 'match' then
    update public.matches set title = coalesce(nullif(p_title, ''), title), match_date = coalesce(p_date, match_date), updated_at = now() where id = p_id;
    perform public.admin_record_action('update_event', 'match', 'matches', p_id, jsonb_build_object('title', p_title, 'date', p_date));
  else
    update public.cycling_events set title = coalesce(nullif(p_title, ''), title),
      event_date = case when p_date is null then event_date else (p_date + (event_date at time zone 'UTC')::time) at time zone 'UTC' end,
      updated_at = now()
    where id_uuid = p_id;
    perform public.admin_record_action('update_event', 'cycling', 'cycling_events', p_id, jsonb_build_object('title', p_title, 'date', p_date));
  end if;
end $$;

create or replace function public.admin_set_event_status(p_event_type text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  if public.admin_norm(p_status) <> 'cancelled' then
    raise exception 'Only cancelling is supported from the admin portal';
  end if;
  if p_event_type = 'match' then
    update public.matches set status = 'cancelled', cancellation_status = true, updated_at = now() where id = p_id;
    perform public.admin_record_action('cancel_event', 'match', 'matches', p_id, null);
  else
    execute format('update public.cycling_events set status = %L, cancellation_status = true, updated_at = now() where id_uuid = %L',
      public.admin_enum_label('cycling_events', 'status', array['cancelled','canceled']), p_id);
    perform public.admin_record_action('cancel_event', 'cycling', 'cycling_events', p_id, null);
  end if;
end $$;

create or replace function public.admin_delete_event(p_event_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  begin
    if p_event_type = 'match' then
      delete from public.matches where id = p_id;
    else
      delete from public.cycling_events where id_uuid = p_id;
    end if;
  exception when foreign_key_violation then
    raise exception 'This event has participants, payments or other records linked to it. Cancel it instead.';
  end;
  perform public.admin_record_action('delete_event', p_event_type, case p_event_type when 'match' then 'matches' else 'cycling_events' end, p_id, null);
end $$;

-------------------------------------------------------------------------------
-- 10. Cashouts (match, cycling and venue)
-------------------------------------------------------------------------------

create or replace function public.admin_get_cashouts(p_status text default 'all', p_start timestamptz default null, p_end timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  with c as (
    select c.id, 'cashouts'::text source,
           case when c.cycling_event_id_uuid is not null then 'Cycling' else 'Match' end type,
           coalesce(nullif(trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,'')), ''), m.organizer_name, e.host_name, 'Unknown') organizer,
           coalesce(c.total_cashout_eligible, c.total_amount_paid, 0) amount,
           lower(c.status::text) status, c.created_at,
           coalesce(m.title, e.title) event_title,
           coalesce(m.total_checked_in_players,
                    (select count(*) from public.players p where p.match_id = m.id and public.admin_norm(p.status) = 'checkedin'),
                    (select count(*) from public.cycling_attendees a where a.cycling_event_id_uuid = e.id_uuid and public.admin_norm(a.attendee_status) = 'checkedin')) checked_in,
           c.account_name, c.bank_name, c.bank_account_number account_number,
           nullif(nullif(c.rejection_reason, ''), 'NULL') rejection_reason, c.super_code
    from public.cashouts c
    left join public.matches m on m.id = c.match_id
    left join public.cycling_events e on e.id_uuid = c.cycling_event_id_uuid
    left join public.profiles pr on pr.id = c.organizer_id
    union all
    select c.id, 'cycling_cashouts', 'Cycling', e.host_name, c.total_amount_paid, lower(c.status::text), c.created_at,
           e.title,
           (select count(*) from public.cycling_attendees a where a.cycling_event_id_uuid = e.id_uuid and public.admin_norm(a.attendee_status) = 'checkedin'),
           c.account_name, c.bank_name, c.bank_account_number,
           nullif(nullif(c.rejection_reason, ''), 'NULL'), c.supercode
    from public.cycling_cashouts c
    left join public.cycling_events e on e.id_uuid = c.cycling_event_id_uuid
    union all
    select c.id, 'venue_booking_cashout', 'Venue',
           coalesce(nullif(trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,'')), ''), v.name),
           c.amount, lower(coalesce(c.status, 'pending')), c.created_at,
           v.name, null::bigint,
           c.account_holder_name, c.bank_name, c.account_number,
           nullif(nullif(c.rejection_reason, ''), 'NULL'), null
    from public.venue_booking_cashout c
    left join public.venues v on v.id = c.venue_id
    left join public.profiles pr on pr.id = v.user_id
  )
  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc nulls last), '[]'::jsonb) into v_result
  from c
  where (coalesce(p_status, 'all') = 'all' or public.admin_norm(c.status) = public.admin_norm(p_status))
    and (p_start is null or c.created_at >= p_start)
    and (p_end is null or c.created_at < p_end);
  return v_result;
end $$;

create or replace function public.admin_update_cashout_status(p_source text, p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.admin_norm(p_status);
  v_label text;
begin
  perform public.admin_require();
  if v_norm not in ('approved', 'rejected') then
    raise exception 'Status must be approved or rejected';
  end if;
  if v_norm = 'rejected' and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;
  if p_source not in ('cashouts', 'cycling_cashouts', 'venue_booking_cashout') then
    raise exception 'Unknown cashout source %', p_source;
  end if;

  if p_source = 'venue_booking_cashout' then
    v_label := v_norm;
  else
    v_label := public.admin_enum_label(p_source, 'status', array[v_norm]);
  end if;

  execute format(
    'update public.%I set status = %L, rejection_reason = %L, reviewed_by = %L, reviewed_at = now(), updated_at = now() where id = %L',
    p_source, v_label, case when v_norm = 'rejected' then p_reason else null end, public.admin_current_id(), p_id);

  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'cashout', v_norm || ' cashout ' || p_id || coalesce(' reason: ' || p_reason, ''));
end $$;

-------------------------------------------------------------------------------
-- 11. Venues
-------------------------------------------------------------------------------

create or replace function public.admin_venue_status(p_is_verified boolean, p_verified_status text)
returns text language sql immutable as $$
  select case
    when public.admin_norm(p_verified_status) = 'rejected' then 'rejected'
    when coalesce(p_is_verified, false) or public.admin_norm(p_verified_status) in ('verified', 'true') then 'verified'
    else 'pending' end
$$;

create or replace function public.admin_get_venues()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_result
  from (
    select v.id, v.name, v.address, v.city, v.state, v.map_link, v.created_at, v.booking_fee, v.price_per_hour,
           v.image_urls, v.verification_documents, nullif(v.rejection_reason, '') rejection_reason,
           public.admin_venue_status(v.is_verified, v.verified_status::text) status,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') owner_name,
           coalesce(p.phone_number, v.venue_phone::text) owner_phone,
           coalesce(p.email, v.email) owner_email,
           (select count(*) from public.matches m where m.venue_id = v.id) events_count,
           coalesce((select sum(b.amount) from public.bookings b where b.venue_id = v.id and public.admin_is_paid(b.payment_status)), 0) revenue
    from public.venues v
    left join public.profiles p on p.id = v.user_id
  ) x;
  return v_result;
end $$;

create or replace function public.admin_get_venue_bookings(p_venue_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'date', coalesce(b.match_date::timestamptz, b.created_at), 'amount', coalesce(b.amount, 0),
    'status', b.payment_status, 'title', b.title, 'booker_name', b.booker_name) order by b.created_at desc), '[]'::jsonb)
  into v_result
  from (select * from public.bookings where venue_id = p_venue_id order by created_at desc limit 100) b;
  return v_result;
end $$;

create or replace function public.admin_set_venue_status(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.admin_norm(p_status);
begin
  perform public.admin_require();
  if v_norm not in ('pending', 'verified', 'rejected') then
    raise exception 'Status must be pending, verified or rejected';
  end if;
  execute format('update public.venues set is_verified = %L, verified_status = %L, rejection_reason = %L, updated_at = now() where id = %L',
    v_norm = 'verified',
    public.admin_enum_label('venues', 'verified_status', array[v_norm]),
    case when v_norm = 'rejected' then p_reason else null end,
    p_id);
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'venue_management', 'set venue ' || p_id || ' to ' || v_norm);
end $$;

create or replace function public.admin_delete_venue(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  begin
    delete from public.venues where id = p_id;
  exception when foreign_key_violation then
    raise exception 'This venue has matches, bookings or other records linked to it. Reject it instead.';
  end;
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'venue_management', 'deleted venue ' || p_id);
end $$;

-------------------------------------------------------------------------------
-- 12. Notifications
-------------------------------------------------------------------------------

create or replace function public.admin_send_notification(
  p_type text, p_target text, p_target_id uuid, p_title text, p_message text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target text := public.admin_norm(p_target);
  v_recipients integer := 0;
  v_row public.notifications%rowtype;
begin
  perform public.admin_require();
  if char_length(coalesce(p_message, '')) = 0 or char_length(p_message) > 500 then
    raise exception 'Message must be between 1 and 500 characters';
  end if;
  if v_target <> 'all' and p_target_id is null and v_target not in ('organizers', 'venueowners') then
    raise exception 'A target ID is required for this audience';
  end if;

  v_recipients := case v_target
    when 'all' then (select count(*) from public.profiles)
    when 'user' then (select count(*) from public.profiles where id = p_target_id)
    when 'event' then
      (select count(*) from public.players where match_id = p_target_id)
      + (select count(*) from public.cycling_attendees where cycling_event_id_uuid = p_target_id)
    when 'organizers' then
      (select count(distinct u) from (select user_id u from public.user_organized_matches
                                      union select user_id from public.user_hosted_cycling) o)
    when 'venueowners' then (select count(distinct user_id) from public.venues where user_id is not null)
    else 0 end;

  execute format(
    'insert into public.notifications(target_type, target_id, category, title, message, type, link, unread, recipients, status, sent_by)
     values (%L, %L, %L, %L, %L, %L, null, true, %s, %L, %L) returning *',
    public.admin_enum_label('notifications', 'target_type',
      case v_target when 'venueowners' then array['venue_owners','venue_owner','venueowners'] when 'organizers' then array['organizers','organizer'] else array[v_target] end),
    p_target_id,
    public.admin_enum_label('notifications', 'category', array['announcement','admin_alert']),
    coalesce(nullif(p_title, ''), 'SportCliq update'),
    p_message,
    public.admin_enum_label('notifications', 'type', array[public.admin_norm(p_type)]),
    v_recipients, 'sent', public.admin_current_id()
  ) into v_row;

  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'notification', 'sent ' || p_type || ' notification to ' || p_target || ' (' || v_recipients || ' recipients)');

  return to_jsonb(v_row) || jsonb_build_object('target_type', v_row.target_type::text, 'type', v_row.type::text, 'category', v_row.category::text);
end $$;

-- Alerts for admins when something happens on the platform.
-- Wrapped so a failure here can never block the original insert in the main app.
create or replace function public.admin_portal_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_message text;
  v_link text;
begin
  begin
    case tg_table_name
      when 'cashouts', 'cycling_cashouts', 'venue_booking_cashout' then
        v_title := 'New cashout request';
        v_message := 'A ' || case tg_table_name when 'venue_booking_cashout' then 'venue' when 'cycling_cashouts' then 'cycling' else 'match' end
                     || ' cashout request is waiting for review.';
        v_link := '/cashouts';
      when 'venues' then
        v_title := 'New venue listed';
        v_message := coalesce(new.name, 'A venue') || ' was added and needs verification.';
        v_link := '/venues';
      when 'matches' then
        v_title := 'New match created';
        v_message := coalesce(new.title, 'A match') || ' was created.';
        v_link := '/events';
      when 'cycling_events' then
        v_title := 'New cycling event';
        v_message := coalesce(new.title, 'A cycling event') || ' was created.';
        v_link := '/events';
      when 'bookings' then
        v_title := 'New venue booking';
        v_message := 'A venue booking was made.';
        v_link := '/venues';
      when 'profiles' then
        v_title := 'New user signed up';
        v_message := 'A new user joined SportCliq.';
        v_link := '/users';
      else
        return new;
    end case;

    execute format(
      'insert into public.notifications(target_type, category, title, message, type, link, unread, recipients, status)
       values (%L, %L, %L, %L, %L, %L, true, 0, %L)',
      public.admin_enum_label('notifications', 'target_type', array['admin']),
      public.admin_enum_label('notifications', 'category', array['admin_alert']),
      v_title, v_message,
      public.admin_enum_label('notifications', 'type', array['in_app', 'push']),
      v_link, 'alert');
  exception when others then
    raise warning 'admin_portal_notify skipped: %', sqlerrm;
  end;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['cashouts','cycling_cashouts','venue_booking_cashout','venues','matches','cycling_events','bookings','profiles'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_trigger where tgname = 'admin_portal_notify_' || t and tgrelid = to_regclass('public.' || t)
    ) then
      execute format('create trigger %I after insert on public.%I for each row execute function public.admin_portal_notify()',
        'admin_portal_notify_' || t, t);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 13. Admin management
-------------------------------------------------------------------------------

create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require(true);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'email', email, 'role', role::text, 'status', status::text, 'last_login', last_login,
    'created_at', created_at, 'first_name', first_name, 'last_name', last_name, 'linked', user_id is not null
  ) order by created_at), '[]'::jsonb) into v_result
  from public.admins;
  return v_result;
end $$;

create or replace function public.admin_set_admin_status(p_admin_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  if p_admin_id = public.admin_current_id() then
    raise exception 'You cannot change your own status';
  end if;
  execute format('update public.admins set status = %L, updated_at = now() where id = %L',
    public.admin_enum_label('admins', 'status', array[public.admin_norm(p_status)]), p_admin_id);
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'admin_management', 'set admin ' || p_admin_id || ' to ' || p_status);
end $$;

create or replace function public.admin_update_my_avatar(p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update public.admins set avatar_url = p_url, updated_at = now() where user_id = auth.uid();
end $$;

create or replace function public.admin_update_my_name(p_first text, p_last text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update public.admins set first_name = p_first, last_name = p_last, updated_at = now() where user_id = auth.uid();
end $$;

create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_object_agg(key, value) from public.admin_settings), '{}'::jsonb);
end $$;

create or replace function public.admin_set_commission_rates(p_rates jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  insert into public.admin_settings(key, value, updated_at) values ('commission_rates', p_rates, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'settings', 'updated commission rates ' || p_rates::text);
end $$;

-- Audit log with admin emails (so every admin can see who did what)
create or replace function public.admin_get_audit_logs(p_action text default null, p_limit integer default 1000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'admin_id', l.admin_id, 'admin_email', coalesce(a.email::text, 'Unknown'),
    'action', l.action, 'details', l.details, 'ip_address', l.ip_address, 'created_at', l.created_at
  ) order by l.created_at desc), '[]'::jsonb) into v_result
  from (
    select * from public.audit_logs
    where p_action is null or p_action = 'all' or action = p_action
    order by created_at desc
    limit greatest(coalesce(p_limit, 1000), 1)
  ) l
  left join public.admins a on a.id = l.admin_id;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- 14. Function permissions (signed in users only, each function checks admin)
-------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname in ('is_admin', 'is_super_admin'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    if f.proname = 'admin_setup_available' then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
    if f.proname = 'admin_enum_label' and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 15. Row level security policies (additive, only take effect where RLS is on)
-------------------------------------------------------------------------------

do $$
begin
  -- admins: each admin can read their own row, super admins can read all
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admins' and policyname = 'admin_portal_select_admins') then
    create policy admin_portal_select_admins on public.admins for select to authenticated
      using (user_id = auth.uid() or public.is_super_admin());
  end if;

  -- notifications: admins read all and mark as read
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'admin_portal_select_notifications') then
    create policy admin_portal_select_notifications on public.notifications for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'admin_portal_update_notifications') then
    create policy admin_portal_update_notifications on public.notifications for update to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;

  -- audit_logs: admins read all and write their own entries
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'admin_portal_select_audit_logs') then
    create policy admin_portal_select_audit_logs on public.audit_logs for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'admin_portal_insert_audit_logs') then
    create policy admin_portal_insert_audit_logs on public.audit_logs for insert to authenticated
      with check (public.is_admin() and admin_id = public.admin_current_id());
  end if;

  -- admin_actions: admins read
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_actions' and policyname = 'admin_portal_select_admin_actions') then
    create policy admin_portal_select_admin_actions on public.admin_actions for select to authenticated using (public.is_admin());
  end if;

  -- admin_settings (new table): admins read
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_settings' and policyname = 'admin_portal_select_settings') then
    create policy admin_portal_select_settings on public.admin_settings for select to authenticated using (public.is_admin());
  end if;
end $$;

-------------------------------------------------------------------------------
-- 16. Avatars storage bucket and policies
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'admin_portal_avatar_insert') then
    create policy admin_portal_avatar_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and name like 'public/%' and public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'admin_portal_avatar_select') then
    create policy admin_portal_avatar_select on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and name like 'public/%' and public.is_admin());
  end if;
end $$;

-------------------------------------------------------------------------------
-- 17. Realtime for the notification bell
-------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ===================== 20261124000001_admin_portal_v2.sql =====================
-- SportCliq Admin Portal, update 2 (run after 20261113000002_admin_portal.sql)
--
-- Fixes first admin setup:
--   * "Setup already completed" showed whenever the admins table had ANY row,
--     including old rows from before the portal that cannot sign in.
--     Setup now stays open until there is an active admin linked to a Supabase login.
--   * Setup no longer needs edge functions. It runs fully in the database,
--     protected by a setup secret you set once in the SQL editor.
-- Adds: admin creation in the database, role changes, venue create and edit,
-- fuller event and user edits, dashboard data, notification housekeeping.
--
-- Additive and safe to run more than once. Nothing existing is dropped or rewritten.
--
-- AFTER RUNNING THIS FILE, set your setup secret (pick your own long phrase):
--   select public.admin_set_setup_secret('your-long-secret-phrase');

create extension if not exists pgcrypto with schema extensions;

-------------------------------------------------------------------------------
-- Settings defaults
-------------------------------------------------------------------------------

insert into public.admin_settings(key, value)
values ('platform', '{"cashout_min": 1000, "currency": "NGN"}'::jsonb)
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- Setup status and secret
-------------------------------------------------------------------------------

create or replace function public.admin_has_active_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id is not null and public.admin_norm(status::text) = 'active'
  )
$$;

-- Setup is open while no active admin is linked to a login
create or replace function public.admin_setup_available()
returns boolean language sql stable security definer set search_path = public as $$
  select not public.admin_has_active_admin()
$$;

create or replace function public.admin_setup_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'available', not public.admin_has_active_admin(),
    'secret_set', exists (select 1 from public.admin_settings where key = 'setup_secret'),
    'legacy_admins', (select count(*) from public.admins where user_id is null)
  )
$$;

-- Run this yourself in the SQL editor. It is not callable from the website.
create or replace function public.admin_set_setup_secret(p_secret text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(p_secret, '')) < 12 then
    raise exception 'Use a secret of at least 12 characters';
  end if;
  insert into public.admin_settings(key, value, updated_at)
  values ('setup_secret', jsonb_build_object('hash', extensions.crypt(p_secret, extensions.gen_salt('bf')), 'failed', 0), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return 'Setup secret saved. Open /setup on the admin portal and use this secret.';
end $$;

-- Shared: link an auth login to an admin row (updates an old row with the same email, or inserts)
create or replace function public.admin_link_login(p_user_id uuid, p_email text, p_role text, p_first text, p_last text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_role text := public.admin_enum_label('admins', 'role', array[p_role]);
  v_status text := public.admin_enum_label('admins', 'status', array['active']);
begin
  select id into v_id from public.admins where user_id = p_user_id or lower(email) = lower(p_email)
  order by (user_id = p_user_id) desc nulls last limit 1;

  if v_id is not null then
    execute format('update public.admins set user_id = %L, role = %L, status = %L,
                      first_name = coalesce(nullif(%L, ''''), first_name), last_name = coalesce(nullif(%L, ''''), last_name),
                      updated_at = now() where id = %L',
      p_user_id, v_role, v_status, p_first, p_last, v_id);
  else
    v_id := case when exists (select 1 from public.admins where id = p_user_id) then gen_random_uuid() else p_user_id end;
    execute format('insert into public.admins(id, user_id, email, password_hash, role, status, first_name, last_name)
                    values (%L, %L, %L, %L, %L, %L, nullif(%L, ''''), nullif(%L, ''''))',
      v_id, p_user_id, lower(p_email), 'managed_by_supabase_auth', v_role, v_status, p_first, p_last);
  end if;
  return v_id;
end $$;

-- First super admin. The website first calls supabase.auth.signUp for the email,
-- then this function checks the secret, sets the password, confirms the email and creates the admin.
create or replace function public.admin_bootstrap_super_admin(
  p_email text, p_password text, p_secret text, p_first text default null, p_last text default null
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret jsonb;
  v_user uuid;
  v_admin uuid;
begin
  if public.admin_has_active_admin() then
    return jsonb_build_object('ok', false, 'error', 'Setup has already been completed. Sign in instead.');
  end if;

  select value into v_secret from public.admin_settings where key = 'setup_secret';
  if v_secret is null then
    return jsonb_build_object('ok', false, 'error',
      'No setup secret yet. In the Supabase SQL editor run: select admin_set_setup_secret(''your-secret'');');
  end if;
  if coalesce((v_secret->>'failed')::int, 0) >= 10 then
    return jsonb_build_object('ok', false, 'error',
      'Too many wrong secrets. Set a new one in the SQL editor with admin_set_setup_secret to unlock.');
  end if;
  if extensions.crypt(coalesce(p_secret, ''), v_secret->>'hash') <> v_secret->>'hash' then
    update public.admin_settings
      set value = jsonb_set(value, '{failed}', to_jsonb(coalesce((value->>'failed')::int, 0) + 1)), updated_at = now()
      where key = 'setup_secret';
    return jsonb_build_object('ok', false, 'error', 'Invalid secret key.');
  end if;

  if char_length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters.');
  end if;

  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error',
      'Could not create the login. In Supabase go to Authentication > Users, add this email, then try again.');
  end if;

  update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = v_user;

  v_admin := public.admin_link_login(v_user, trim(p_email), 'super_admin', p_first, p_last);

  update public.admin_settings set value = jsonb_set(value, '{failed}', '0'::jsonb) where key = 'setup_secret';
  insert into public.audit_logs(admin_id, action, details)
  values (v_admin, 'admin_management', 'First super admin ' || lower(trim(p_email)) || ' created through setup');

  return jsonb_build_object('ok', true, 'admin_id', v_admin);
end $$;

-------------------------------------------------------------------------------
-- Admin management
-------------------------------------------------------------------------------

-- The website signs the new person up first (with the temporary password), then calls this.
create or replace function public.admin_create_admin(p_email text, p_role text, p_first text default null, p_last text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_admin uuid;
  v_existed boolean;
begin
  perform public.admin_require(true);
  if public.admin_norm(p_role) not in ('admin', 'superadmin') then
    raise exception 'Role must be admin or super_admin';
  end if;
  if exists (select 1 from public.admins where lower(email) = lower(trim(p_email)) and user_id is not null) then
    raise exception 'An admin with this email already exists';
  end if;

  select id, created_at into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user.id is null then
    raise exception 'No login found for this email. Check that sign ups are enabled in Supabase Auth.';
  end if;
  v_existed := v_user.created_at < now() - interval '5 minutes';

  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = v_user.id;
  v_admin := public.admin_link_login(v_user.id, trim(p_email), case when public.admin_norm(p_role) = 'superadmin' then 'super_admin' else 'admin' end, p_first, p_last);

  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'admin_management',
          'Created ' || p_role || ' ' || lower(trim(p_email)) || case when v_existed then ' (linked existing login, password unchanged)' else '' end);
  return jsonb_build_object('ok', true, 'id', v_admin, 'existed', v_existed);
end $$;

create or replace function public.admin_set_admin_role(p_admin_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  if p_admin_id = public.admin_current_id() then
    raise exception 'You cannot change your own role';
  end if;
  execute format('update public.admins set role = %L, updated_at = now() where id = %L',
    public.admin_enum_label('admins', 'role', array[case when public.admin_norm(p_role) = 'superadmin' then 'super_admin' else 'admin' end]),
    p_admin_id);
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'admin_management', 'Changed role of admin ' || p_admin_id || ' to ' || p_role);
end $$;

-------------------------------------------------------------------------------
-- Dashboard
-------------------------------------------------------------------------------

create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rates jsonb;
  v_result jsonb;
begin
  perform public.admin_require();
  select value into v_rates from public.admin_settings where key = 'commission_rates';
  v_rates := coalesce(v_rates, '{"match":0,"cycling":0,"venue":0}'::jsonb);

  with rev as (select * from public.admin_revenue_items(now() - interval '30 days', now())),
  days as (select generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d)
  select jsonb_build_object(
    'revenue_30d', (select coalesce(sum(amount), 0) from rev),
    'commission_30d', (select coalesce(sum(amount * coalesce((v_rates->>kind)::numeric, 0) / 100), 0) from rev),
    'new_users_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'events_upcoming', (select count(*) from public.matches where status = 'upcoming' and not coalesce(cancellation_status, false))
                       + (select count(*) from public.cycling_events where public.admin_norm(status::text) = 'upcoming'),
    'pending_venues', (select count(*) from public.venues where public.admin_venue_status(is_verified, verified_status::text) = 'pending'),
    'revenue_daily', (
      select jsonb_agg(jsonb_build_object('day', d, 'amount', coalesce((select sum(amount) from rev where date_trunc('day', rev.at) = days.d), 0)) order by d)
      from days),
    'signups_daily', (
      select jsonb_agg(jsonb_build_object('day', d, 'count', (select count(*) from public.profiles p where date_trunc('day', p.created_at) = days.d)) order by d)
      from days),
    'recent_activity', coalesce((
      select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', l.id, 'action', l.action, 'details', l.details, 'created_at', l.created_at, 'admin_email', a.email) x
        from public.audit_logs l left join public.admins a on a.id = l.admin_id
        order by l.created_at desc limit 6) r), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- Users
-------------------------------------------------------------------------------

create or replace function public.admin_update_user(p_user_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update public.profiles set
    first_name = coalesce(nullif(trim(p_data->>'first_name'), ''), first_name),
    last_name = coalesce(nullif(trim(p_data->>'last_name'), ''), last_name),
    nickname = case when p_data ? 'nickname' then nullif(trim(p_data->>'nickname'), '') else nickname end,
    phone_number = case when p_data ? 'phone' then nullif(trim(p_data->>'phone'), '') else phone_number end,
    state = case when p_data ? 'state' then nullif(trim(p_data->>'state'), '') else state end,
    updated_at = now()
  where id = p_user_id;
  perform public.admin_record_action('edit_profile', 'profile', 'profiles', p_user_id, p_data);
end $$;

-------------------------------------------------------------------------------
-- Events: fuller edit
-------------------------------------------------------------------------------

create or replace function public.admin_edit_event(p_event_type text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  if p_event_type = 'match' then
    update public.matches set
      title = coalesce(nullif(trim(p_data->>'title'), ''), title),
      match_date = coalesce((p_data->>'date')::date, match_date),
      match_time = coalesce((p_data->>'time')::time, match_time),
      start_time = coalesce((p_data->>'time')::time, start_time),
      total_slots = coalesce((p_data->>'capacity')::int, total_slots),
      price = case when p_data ? 'price' then nullif(p_data->>'price', '')::numeric else price end,
      sport = case when p_data ? 'sport' then nullif(p_data->>'sport', '') else sport end,
      notes = case when p_data ? 'notes' then p_data->>'notes' else notes end,
      updated_at = now()
    where id = p_id;
    perform public.admin_record_action('update_event', 'match', 'matches', p_id, p_data);
  else
    update public.cycling_events set
      title = coalesce(nullif(trim(p_data->>'title'), ''), title),
      event_date = case when p_data ? 'date' and nullif(p_data->>'date', '') is not null
                        then ((p_data->>'date')::date + coalesce((p_data->>'time')::time, (event_date at time zone 'Africa/Lagos')::time)) at time zone 'Africa/Lagos'
                        else event_date end,
      start_time = coalesce(nullif(p_data->>'time', ''), start_time),
      max_attendees = coalesce((p_data->>'capacity')::int, max_attendees),
      price = case when p_data ? 'price' then nullif(p_data->>'price', '')::numeric::int else price end,
      notes = case when p_data ? 'notes' then p_data->>'notes' else notes end,
      updated_at = now()
    where id_uuid = p_id;
    perform public.admin_record_action('update_event', 'cycling', 'cycling_events', p_id, p_data);
  end if;
end $$;

-------------------------------------------------------------------------------
-- Venues: create and edit
-------------------------------------------------------------------------------

create or replace function public.admin_save_venue(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_slug text;
begin
  perform public.admin_require();
  if nullif(trim(p_data->>'name'), '') is null or nullif(trim(p_data->>'address'), '') is null
     or nullif(trim(p_data->>'city'), '') is null or nullif(trim(p_data->>'state'), '') is null then
    raise exception 'Name, address, city and state are required';
  end if;

  if v_id is null then
    v_slug := trim(both '-' from lower(regexp_replace(p_data->>'name', '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(md5(random()::text), 1, 5);
    insert into public.venues(name, address, city, state, slug, booking_fee, price_per_hour, venue_phone, email, map_link, description, facilities, opening_hours)
    values (trim(p_data->>'name'), trim(p_data->>'address'), trim(p_data->>'city'), trim(p_data->>'state'), v_slug,
            nullif(p_data->>'booking_fee', '')::numeric, nullif(p_data->>'price_per_hour', '')::numeric,
            nullif(trim(p_data->>'phone'), ''), nullif(trim(p_data->>'email'), ''), nullif(trim(p_data->>'map_link'), ''),
            nullif(p_data->>'description', ''), nullif(p_data->>'facilities', ''), nullif(p_data->>'opening_hours', ''))
    returning id into v_id;
    insert into public.audit_logs(admin_id, action, details) values (public.admin_current_id(), 'venue_management', 'created venue ' || (p_data->>'name'));
  else
    update public.venues set
      name = trim(p_data->>'name'), address = trim(p_data->>'address'), city = trim(p_data->>'city'), state = trim(p_data->>'state'),
      booking_fee = nullif(p_data->>'booking_fee', '')::numeric,
      price_per_hour = nullif(p_data->>'price_per_hour', '')::numeric,
      venue_phone = nullif(trim(p_data->>'phone'), ''),
      email = nullif(trim(p_data->>'email'), ''),
      map_link = nullif(trim(p_data->>'map_link'), ''),
      description = nullif(p_data->>'description', ''),
      facilities = nullif(p_data->>'facilities', ''),
      opening_hours = nullif(p_data->>'opening_hours', ''),
      updated_at = now()
    where id = v_id;
    insert into public.audit_logs(admin_id, action, details) values (public.admin_current_id(), 'venue_management', 'edited venue ' || v_id);
  end if;
  return v_id;
end $$;

-- Venue list now also returns the editable fields
create or replace function public.admin_get_venues()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require();
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb) into v_result
  from (
    select v.id, v.name, v.address, v.city, v.state, v.map_link, v.created_at, v.booking_fee, v.price_per_hour,
           v.image_urls, v.verification_documents, nullif(v.rejection_reason, '') rejection_reason,
           v.venue_phone::text phone, v.email, v.description, v.facilities, v.opening_hours, v.aggregated_rating,
           public.admin_venue_status(v.is_verified, v.verified_status::text) status,
           nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') owner_name,
           coalesce(p.phone_number, v.venue_phone::text) owner_phone,
           coalesce(p.email, v.email) owner_email,
           (select count(*) from public.matches m where m.venue_id = v.id) events_count,
           coalesce((select sum(b.amount) from public.bookings b where b.venue_id = v.id and public.admin_is_paid(b.payment_status)), 0) revenue
    from public.venues v
    left join public.profiles p on p.id = v.user_id
  ) x;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- Notifications housekeeping
-------------------------------------------------------------------------------

create or replace function public.admin_mark_all_alerts_read()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require();
  update public.notifications set unread = false, read_at = coalesce(read_at, now())
  where coalesce(unread, true) and (target_type::text = 'admin' or public.admin_norm(category::text) = 'adminalert');
end $$;

create or replace function public.admin_delete_notification(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require(true);
  delete from public.notifications where id = p_id;
  insert into public.audit_logs(admin_id, action, details) values (public.admin_current_id(), 'notification', 'deleted notification ' || p_id);
end $$;

-------------------------------------------------------------------------------
-- Settings
-------------------------------------------------------------------------------

-- Never hand the setup secret hash to the browser
create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require();
  return coalesce((select jsonb_object_agg(key, value) from public.admin_settings where key <> 'setup_secret'), '{}'::jsonb)
         || jsonb_build_object('setup_secret_set', exists (select 1 from public.admin_settings where key = 'setup_secret'));
end $$;

create or replace function public.admin_set_commission_rates(p_rates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text;
begin
  perform public.admin_require(true);
  foreach k in array array['match', 'cycling', 'venue'] loop
    if (p_rates->>k) is null or (p_rates->>k)::numeric < 0 or (p_rates->>k)::numeric > 100 then
      raise exception 'Each rate must be between 0 and 100';
    end if;
  end loop;
  insert into public.admin_settings(key, value, updated_at)
  values ('commission_rates', jsonb_build_object('match', (p_rates->>'match')::numeric, 'cycling', (p_rates->>'cycling')::numeric, 'venue', (p_rates->>'venue')::numeric), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.audit_logs(admin_id, action, details)
  values (public.admin_current_id(), 'settings', 'updated commission rates ' || p_rates::text);
end $$;

-- The settings policy must not expose the setup secret row to admins reading the table directly
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_settings' and policyname = 'admin_portal_select_settings') then
    drop policy admin_portal_select_settings on public.admin_settings; -- our own policy from update 1, recreated below
  end if;
  create policy admin_portal_select_settings on public.admin_settings for select to authenticated
    using (public.is_admin() and key <> 'setup_secret');
end $$;

-------------------------------------------------------------------------------
-- Permissions
-------------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname in ('is_admin', 'is_super_admin'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
    if f.proname not in ('admin_set_setup_secret', 'admin_link_login') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname in ('admin_setup_available', 'admin_setup_status', 'admin_bootstrap_super_admin') then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
    if f.proname = 'admin_enum_label' and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- ===================== 20261124000002_admin_portal_v3.sql =====================
-- SportCliq Admin Portal, update 3 (run after RUN_THIS_admin_portal_setup.sql)
--
-- Adds:
--   * Roles and permissions (system roles plus your own custom roles)
--   * Admin invites by link, with password or Google sign in
--   * Mandatory two factor authentication (authenticator app) for every admin action,
--     plus a fresh code for payout approvals and every delete
--   * SportCliq fee rules: organisers and hosts pay nothing on their first 2 paid
--     activities (matches and rides together), then 5%. Venues get their first paid
--     booking free, then 10%. All configurable in Settings.
--   * Ambassadors: onboarding, venue and event assignment, wallet, manual payouts
--   * A full audit trail: who did what, when, from which IP and device, and what changed
--   * Push and email delivery tracking for notifications
--
-- Payouts are MANUAL. The portal records them, it does not move money.
-- Additive and safe to run more than once. Nothing in your existing SportCliq tables
-- is dropped or rewritten. Only functions created by earlier portal updates are replaced.

create extension if not exists pgcrypto with schema extensions;

-------------------------------------------------------------------------------
-- 1. Enum label for invited admins
-------------------------------------------------------------------------------
do $$
declare v_type oid;
begin
  select a.atttypid into v_type from pg_attribute a join pg_type t on t.oid = a.atttypid
  where a.attrelid = 'public.admins'::regclass and a.attname = 'status' and t.typtype = 'e';
  if v_type is not null and not exists (select 1 from pg_enum where enumtypid = v_type and public.admin_norm(enumlabel) = 'invited') then
    execute format('alter type %s add value if not exists %L', v_type::regtype, 'invited');
  end if;
end $$;

-------------------------------------------------------------------------------
-- 2. New tables
-------------------------------------------------------------------------------
create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  role_id uuid references public.admin_roles(id) on delete set null,
  token_hash text unique not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default now() + interval '7 days',
  invited_by uuid references public.admins(id) on delete set null,
  accepted_at timestamptz,
  accepted_user_id uuid,
  created_at timestamptz default now()
);
create index if not exists admin_invites_email_idx on public.admin_invites(lower(email));

create table if not exists public.ambassadors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  city text,
  state text,
  bank_name text,
  account_number text,
  account_name text,
  status text not null default 'active' check (status in ('active', 'paused', 'exited')),
  commission_rate numeric check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  onboarded_at timestamptz not null default now(),
  notes text,
  user_id uuid references auth.users(id) on delete set null,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.ambassador_assignments (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.ambassadors(id) on delete cascade,
  entity_type text not null check (entity_type in ('venue', 'match', 'cycling')),
  entity_id uuid not null,
  effective_from timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.admins(id) on delete set null,
  active boolean not null default true,
  unassigned_at timestamptz,
  unassigned_by uuid references public.admins(id) on delete set null
);
create unique index if not exists ambassador_assignments_one_active on public.ambassador_assignments(entity_type, entity_id) where active;
create index if not exists ambassador_assignments_amb_idx on public.ambassador_assignments(ambassador_id);

create table if not exists public.ambassador_payouts (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references public.ambassadors(id) on delete cascade,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  method text not null default 'manual_bank_transfer',
  reference text,
  note text,
  period_start date,
  period_end date,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz default now(),
  paid_by uuid references public.admins(id) on delete set null,
  paid_at timestamptz,
  cancelled_by uuid references public.admins(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text
);
create index if not exists ambassador_payouts_amb_idx on public.ambassador_payouts(ambassador_id);

-- Which permission each older portal function needs (read by admin_require)
create table if not exists public.admin_function_permissions (
  fn text primary key,
  permission text,
  fresh_mfa boolean not null default false
);

alter table public.admin_roles enable row level security;
alter table public.admin_invites enable row level security;
alter table public.ambassadors enable row level security;
alter table public.ambassador_assignments enable row level security;
alter table public.ambassador_payouts enable row level security;
alter table public.admin_function_permissions enable row level security;

-------------------------------------------------------------------------------
-- 3. New columns on portal and payout tables
-------------------------------------------------------------------------------
alter table public.admins add column if not exists role_id uuid references public.admin_roles(id) on delete set null;
alter table public.admins add column if not exists invited_by uuid references public.admins(id) on delete set null;

alter table public.audit_logs add column if not exists user_agent text;
alter table public.audit_logs add column if not exists entity_type text;
alter table public.audit_logs add column if not exists entity_id text;
alter table public.audit_logs add column if not exists metadata jsonb;
alter table public.audit_logs add column if not exists aal text;
alter table public.audit_logs add column if not exists auth_method text;
create index if not exists audit_logs_admin_idx on public.audit_logs(admin_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

alter table public.notifications add column if not exists push_sent integer;
alter table public.notifications add column if not exists email_sent integer;
alter table public.notifications add column if not exists delivery_error text;
alter table public.notifications add column if not exists delivered_at timestamptz;

alter table public.cashouts add column if not exists payout_reference text;
alter table public.cashouts add column if not exists payout_method text;
alter table public.cycling_cashouts add column if not exists payout_reference text;
alter table public.cycling_cashouts add column if not exists payout_method text;
alter table public.venue_booking_cashout add column if not exists payout_reference text;
alter table public.venue_booking_cashout add column if not exists payout_method text;

-------------------------------------------------------------------------------
-- 4. Settings: fee rules and ambassador rate
-------------------------------------------------------------------------------
insert into public.admin_settings(key, value) values
  ('commission_rules', '{
     "organizer": {"free_count": 2, "rate": 5},
     "venue": {"free_count": 1, "rate": 10},
     "ambassador": {"rate": 10}
   }'::jsonb)
on conflict (key) do nothing;

-------------------------------------------------------------------------------
-- 5. Permission catalogue and system roles
-------------------------------------------------------------------------------
create or replace function public.admin_permission_catalog()
returns jsonb language sql immutable as $$
  select '[
    {"module":"dashboard","label":"Dashboard","actions":["view"]},
    {"module":"analytics","label":"Analytics","actions":["view","export"]},
    {"module":"users","label":"Users","actions":["view","edit","suspend","message","export"]},
    {"module":"events","label":"Events","actions":["view","edit","cancel","delete"]},
    {"module":"venues","label":"Venues","actions":["view","create","edit","approve","delete"]},
    {"module":"cashouts","label":"Cashouts","actions":["view","approve","export"]},
    {"module":"ambassadors","label":"Ambassadors","actions":["view","create","edit","assign","payout","delete"]},
    {"module":"notifications","label":"Notifications","actions":["view","send","delete"]},
    {"module":"audit","label":"Audit log","actions":["view","export"]},
    {"module":"admins","label":"Admins","actions":["view","invite","edit","deactivate","reset_2fa"]},
    {"module":"roles","label":"Roles and permissions","actions":["view","manage"]},
    {"module":"settings","label":"Settings","actions":["view","edit"]}
  ]'::jsonb
$$;

create or replace function public.admin_all_permissions()
returns text[] language sql immutable as $$
  select array_agg((m->>'module') || '.' || a)
  from jsonb_array_elements(public.admin_permission_catalog()) m, jsonb_array_elements_text(m->'actions') a
$$;

insert into public.admin_roles(key, name, description, permissions, is_system) values
  ('super_admin', 'Super Admin', 'Full control of everything, including admins, roles and settings.', array['*'], true),
  ('admin', 'Admin', 'Runs day to day operations. Cannot manage admins, roles or settings, and cannot delete.',
     array['dashboard.view','analytics.view','analytics.export','users.view','users.edit','users.suspend','users.message','users.export',
           'events.view','events.edit','events.cancel','venues.view','venues.create','venues.edit','venues.approve',
           'cashouts.view','cashouts.approve','cashouts.export','ambassadors.view','ambassadors.create','ambassadors.edit','ambassadors.assign','ambassadors.payout',
           'notifications.view','notifications.send','audit.view','admins.view','roles.view','settings.view'], true),
  ('finance', 'Finance', 'Reviews and approves payouts and sees money reports.',
     array['dashboard.view','analytics.view','analytics.export','cashouts.view','cashouts.approve','cashouts.export',
           'ambassadors.view','ambassadors.payout','venues.view','events.view','audit.view','settings.view'], true),
  ('support', 'Support', 'Helps users, manages events and sends messages.',
     array['dashboard.view','users.view','users.edit','users.suspend','users.message','events.view','events.edit','events.cancel',
           'venues.view','notifications.view','notifications.send'], true),
  ('ambassador_manager', 'Ambassador Manager', 'Onboards ambassadors and assigns venues and events to them.',
     array['dashboard.view','analytics.view','ambassadors.view','ambassadors.create','ambassadors.edit','ambassadors.assign','venues.view','events.view'], true),
  ('viewer', 'Viewer (read only)', 'Can look at everything, cannot change anything.',
     array['dashboard.view','analytics.view','users.view','events.view','venues.view','cashouts.view','ambassadors.view','notifications.view','audit.view','admins.view','roles.view','settings.view'], true)
on conflict (key) do nothing;

-- Give existing admins a role that matches their old role column
update public.admins a set role_id = r.id
from public.admin_roles r
where a.role_id is null
  and r.key = case when public.admin_norm(a.role::text) = 'superadmin' then 'super_admin' else 'admin' end;

-------------------------------------------------------------------------------
-- 6. Auth, 2FA and permission helpers
-------------------------------------------------------------------------------
create or replace function public.admin_jwt_aal()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1')
$$;

-- True when the session verified an authenticator code in the last p_seconds
create or replace function public.admin_mfa_fresh(p_seconds integer default 300)
returns boolean language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) e
    where e->>'method' = 'totp'
      and to_timestamp((e->>'timestamp')::bigint) > now() - make_interval(secs => p_seconds)
  )
$$;

create or replace function public.admin_auth_method()
returns text language sql stable as $$
  select string_agg(distinct e->>'method', '+')
  from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)) e
$$;

-- The current admin row (linked and active), whatever the 2FA level
create or replace function public.admin_me()
returns public.admins language sql stable security definer set search_path = public as $$
  select * from public.admins where user_id = auth.uid() and public.admin_norm(status::text) = 'active' limit 1
$$;

create or replace function public.admin_role_of(a public.admins)
returns public.admin_roles language sql stable security definer set search_path = public as $$
  select r.* from public.admin_roles r
  where r.id = coalesce(a.role_id, (select id from public.admin_roles where key =
          case when public.admin_norm(a.role::text) = 'superadmin' then 'super_admin' else 'admin' end))
$$;

create or replace function public.admin_permissions()
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  a public.admins;
  r public.admin_roles;
begin
  a := public.admin_me();
  if a.id is null then return '{}'; end if;
  r := public.admin_role_of(a);
  if r.key = 'super_admin' or '*' = any(coalesce(r.permissions, '{}')) then return array['*']; end if;
  return coalesce(r.permissions, '{}');
end $$;

-- Active admin AND passed two factor in this session
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select (public.admin_me()).id is not null and public.admin_jwt_aal() = 'aal2'
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and '*' = any(public.admin_permissions())
$$;

create or replace function public.admin_can(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and ('*' = any(public.admin_permissions()) or p_perm = any(public.admin_permissions()))
$$;

create or replace function public.admin_current_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.admins where user_id = auth.uid() limit 1
$$;

create or replace function public.admin_require_perm(p_perm text default null, p_fresh boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if (public.admin_me()).id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if public.admin_jwt_aal() <> 'aal2' then
    raise exception 'MFA_REQUIRED: Verify with your authenticator app to continue' using errcode = '42501';
  end if;
  if p_perm is not null and not ('*' = any(public.admin_permissions()) or p_perm = any(public.admin_permissions())) then
    raise exception 'You do not have permission to do this (%)', p_perm using errcode = '42501';
  end if;
  if p_fresh and not public.admin_mfa_fresh() then
    raise exception 'MFA_STEP_UP: Enter your authenticator code to confirm this action' using errcode = '42501';
  end if;
end $$;

-- Older portal functions call admin_require(). It now looks up which function called it
-- and checks that function's permission from admin_function_permissions.
create or replace function public.admin_require(p_super boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_ctx text;
  v_fn text;
  v_map public.admin_function_permissions;
begin
  get diagnostics v_ctx = pg_context;
  v_fn := (regexp_match(substr(v_ctx, position(E'\n' in v_ctx) + 1), 'function (?:public\.)?([a-z_0-9]+)\('))[1];
  select * into v_map from public.admin_function_permissions where fn = v_fn;
  if found then
    perform public.admin_require_perm(v_map.permission, v_map.fresh_mfa);
  elsif p_super then
    perform public.admin_require_perm('*');
  else
    perform public.admin_require_perm(null);
  end if;
end $$;

insert into public.admin_function_permissions(fn, permission, fresh_mfa) values
  ('admin_get_metrics', 'dashboard.view', false),
  ('admin_get_dashboard', 'dashboard.view', false),
  ('admin_get_analytics', 'analytics.view', false),
  ('admin_get_users', 'users.view', false),
  ('admin_update_user_status', 'users.edit', false),
  ('admin_user_action', 'users.edit', false),
  ('admin_update_user', 'users.edit', false),
  ('admin_get_events', 'events.view', false),
  ('admin_update_event', 'events.edit', false),
  ('admin_edit_event', 'events.edit', false),
  ('admin_set_event_status', 'events.cancel', false),
  ('admin_delete_event', 'events.delete', true),
  ('admin_get_cashouts', 'cashouts.view', false),
  ('admin_update_cashout_status', 'cashouts.approve', true),
  ('admin_get_venues', 'venues.view', false),
  ('admin_get_venue_bookings', 'venues.view', false),
  ('admin_save_venue', 'venues.edit', false),
  ('admin_set_venue_status', 'venues.approve', false),
  ('admin_delete_venue', 'venues.delete', true),
  ('admin_send_notification', 'notifications.send', false),
  ('admin_delete_notification', 'notifications.delete', true),
  ('admin_mark_all_alerts_read', null, false),
  ('admin_list_admins', 'admins.view', false),
  ('admin_set_admin_status', 'admins.deactivate', false),
  ('admin_set_admin_role', 'admins.edit', false),
  ('admin_create_admin', 'admins.invite', false),
  ('admin_get_settings', 'settings.view', false),
  ('admin_set_commission_rates', 'settings.edit', false),
  ('admin_get_audit_logs', 'audit.view', false),
  ('admin_log', null, false),
  ('admin_update_my_avatar', null, false),
  ('admin_update_my_name', null, false)
on conflict (fn) do update set permission = excluded.permission, fresh_mfa = excluded.fresh_mfa;

-- Session details for the website. Works before 2FA so the site knows what to ask for.
create or replace function public.admin_get_session()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  a public.admins;
  r public.admin_roles;
  v_factors int;
begin
  select * into a from public.admins where user_id = auth.uid();
  if not found then return null; end if;
  if public.admin_norm(a.status::text) <> 'active' then
    raise exception 'This admin account is inactive' using errcode = '42501';
  end if;
  r := public.admin_role_of(a);
  select count(*) into v_factors from auth.mfa_factors where user_id = auth.uid() and status::text = 'verified';
  if public.admin_jwt_aal() = 'aal2' then
    update public.admins set last_login = now() where id = a.id and (last_login is null or last_login < now() - interval '5 minutes');
  end if;
  return jsonb_build_object(
    'id', a.id, 'email', a.email,
    'role', case when r.key = 'super_admin' then 'super_admin' else 'admin' end,
    'role_id', r.id, 'role_key', r.key, 'role_name', r.name,
    'status', a.status::text, 'first_name', a.first_name, 'last_name', a.last_name, 'avatar_url', a.avatar_url,
    'permissions', to_jsonb(public.admin_permissions()),
    'aal', public.admin_jwt_aal(), 'mfa_enrolled', v_factors > 0, 'created_at', a.created_at
  );
end $$;

-------------------------------------------------------------------------------
-- 7. Audit trail
-------------------------------------------------------------------------------
create or replace function public.admin_request_header(p_name text)
returns text language plpgsql stable as $$
begin
  return nullif(current_setting('request.headers', true), '')::json ->> p_name;
exception when others then
  return null;
end $$;

-- Every audit row gets IP, device, 2FA level and sign in method automatically
create or replace function public.admin_audit_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.ip_address is null or new.ip_address in ('', 'localhost') or new.ip_address like '%.sportcliq.com' or new.ip_address = 'admin.sportcliq.com' then
      new.ip_address := coalesce(
        nullif(trim(split_part(coalesce(public.admin_request_header('x-forwarded-for'), ''), ',', 1)), ''),
        public.admin_request_header('cf-connecting-ip'),
        public.admin_request_header('x-real-ip'),
        new.ip_address);
    end if;
    new.user_agent := coalesce(new.user_agent, public.admin_request_header('user-agent'));
    new.aal := coalesce(new.aal, public.admin_jwt_aal());
    new.auth_method := coalesce(new.auth_method, public.admin_auth_method());
    new.admin_id := coalesce(new.admin_id, public.admin_current_id());
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists admin_portal_audit_fill on public.audit_logs;
create trigger admin_portal_audit_fill before insert on public.audit_logs
for each row execute function public.admin_audit_fill();

-- Records what an admin changed in a table, column by column
create or replace function public.admin_audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  begin
    v_admin := public.admin_current_id();
    if v_admin is null then
      return coalesce(new, old);
    end if;
    v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
    v_new := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else '{}'::jsonb end;
    if tg_table_name = 'admin_settings' and coalesce(v_new->>'key', v_old->>'key') = 'setup_secret' then
      return coalesce(new, old);
    end if;
    for k in select jsonb_object_keys(v_old || v_new) loop
      continue when k in ('updated_at', 'password_hash', 'salt', 'reset_token', 'token_hash', 'encrypted_password');
      if (v_old -> k) is distinct from (v_new -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
      return new;
    end if;
    insert into public.audit_logs(admin_id, action, details, entity_type, entity_id, metadata)
    values (v_admin, 'data_change',
            lower(tg_op) || ' ' || tg_table_name || ' ' || coalesce(v_new->>'id', v_old->>'id', v_new->>'id_uuid', v_old->>'id_uuid', v_new->>'key', v_old->>'key', ''),
            tg_table_name, coalesce(v_new->>'id', v_old->>'id', v_new->>'id_uuid', v_old->>'id_uuid', v_new->>'key', v_old->>'key'),
            jsonb_build_object('operation', lower(tg_op), 'changes', v_changes));
  exception when others then
    raise warning 'admin audit skipped: %', sqlerrm;
  end;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['admins','admin_roles','admin_invites','admin_settings','ambassadors','ambassador_assignments','ambassador_payouts',
                           'venues','matches','cycling_events','cashouts','cycling_cashouts','venue_booking_cashout','profiles','players','cycling_attendees','notifications'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_trigger where tgname = 'admin_portal_audit_' || t and tgrelid = to_regclass('public.' || t)) then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.admin_audit_row_change()',
        'admin_portal_audit_' || t, t);
    end if;
  end loop;
end $$;

-- Generic logger for the website (page views, exports, sign in events)
create or replace function public.admin_log(p_action text, p_details text default null, p_ip text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm(null);
  insert into public.audit_logs(admin_id, action, details, ip_address)
  values (public.admin_current_id(), p_action, p_details, nullif(p_ip, ''));
end $$;

create or replace function public.admin_log_event(p_action text, p_details text default null, p_entity_type text default null, p_entity_id text default null, p_metadata jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Sign in events are allowed before 2FA so failed codes are recorded too
  if p_action in ('login_password', 'login_google', 'mfa_enrolled', 'mfa_verified', 'mfa_failed', 'logout', 'login_blocked') then
    if (public.admin_me()).id is null then raise exception 'Admin access required' using errcode = '42501'; end if;
  else
    perform public.admin_require_perm(null);
  end if;
  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id, metadata)
  values (public.admin_current_id(), p_action, p_details, p_entity_type, p_entity_id, p_metadata);
end $$;

create or replace function public.admin_get_audit_logs_v2(
  p_action text default null, p_admin uuid default null, p_entity_type text default null,
  p_start timestamptz default null, p_end timestamptz default null, p_search text default null,
  p_include_views boolean default false, p_limit integer default 50, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_total integer;
  v_rows jsonb;
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public.admin_require_perm('audit.view');
  with f as (
    select l.*, a.email::text admin_email, trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) admin_name
    from public.audit_logs l left join public.admins a on a.id = l.admin_id
    where (p_action is null or p_action = 'all' or l.action = p_action)
      and (p_admin is null or l.admin_id = p_admin)
      and (p_entity_type is null or p_entity_type = 'all' or l.entity_type = p_entity_type)
      and (p_start is null or l.created_at >= p_start)
      and (p_end is null or l.created_at < p_end)
      and (p_include_views or l.action <> 'page_view')
      and (v_q is null or concat_ws(' ', a.email, l.action, l.details, l.entity_type, l.entity_id, l.ip_address) ilike '%' || v_q || '%')
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
           select id, admin_id, coalesce(admin_email, 'System') admin_email, nullif(admin_name, '') admin_name, action, details, ip_address,
                  user_agent, entity_type, entity_id, metadata, aal, auth_method, created_at
           from f order by created_at desc limit greatest(coalesce(p_limit, 50), 1) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows,
    'actions', (select coalesce(jsonb_agg(distinct action), '[]'::jsonb) from public.audit_logs),
    'entities', (select coalesce(jsonb_agg(distinct entity_type), '[]'::jsonb) from public.audit_logs where entity_type is not null),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email) order by email), '[]'::jsonb) from public.admins));
end $$;

-------------------------------------------------------------------------------
-- 8. Fee engine (replaces the portal's earlier revenue function)
-------------------------------------------------------------------------------
create or replace function public.admin_commission_rules()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.admin_settings where key = 'commission_rules'),
                  '{"organizer":{"free_count":2,"rate":5},"venue":{"free_count":1,"rate":10},"ambassador":{"rate":10}}'::jsonb)
$$;

drop function if exists public.admin_revenue_items(timestamptz, timestamptz);
create function public.admin_revenue_items(p_start timestamptz default null, p_end timestamptz default null)
returns table(kind text, amount numeric, at timestamptz, venue_id uuid, source_type text, source_id uuid, rate numeric, commission numeric, organizer_key text)
language sql stable security definer set search_path = public as $$
  with rules as (select public.admin_commission_rules() r),
  org_rate as (select coalesce((r->'organizer'->>'rate')::numeric, 5) rate, coalesce((r->'organizer'->>'free_count')::int, 2) free from rules),
  ven_rate as (select coalesce((r->'venue'->>'rate')::numeric, 10) rate, coalesce((r->'venue'->>'free_count')::int, 1) free from rules),
  -- Paid activities per organiser or host. Matches and rides count together.
  acts as (
    select 'match'::text st, m.id sid, m.created_at,
      coalesce(to_jsonb(m)->>'user_id',
               (select o.user_id::text from public.user_organized_matches o where o.match_id = m.id and o.user_id is not null order by o.created_at limit 1),
               m.organizer_id::text,
               'phone:' || nullif(regexp_replace(coalesce(m.organizer_phone::text, ''), '\D', '', 'g'), ''),
               'match:' || m.id) okey
    from public.matches m where m.is_paid
    union all
    select 'cycling', e.id_uuid, e.created_at,
      coalesce((select h.user_id::text from public.user_hosted_cycling h where h.cycling_event_id = e.id_uuid order by h.created_at limit 1),
               e.host_id::text)
    from public.cycling_events e where not coalesce(e.is_free, true)
  ),
  ranked as (select st, sid, okey, row_number() over (partition by okey order by created_at, sid) rn from acts),
  act as (select ranked.*, case when rn <= o.free then 0 else o.rate end act_rate from ranked, org_rate o),
  items as (
    select 'match'::text kind, coalesce(m.price, 0) * coalesce(p.number_of_slots, 1) amount, p.created_at at, m.venue_id, 'match'::text st, m.id sid
    from public.players p join public.matches m on m.id = p.match_id
    where m.is_paid and public.admin_is_paid(p.payment_status)
    union all
    select 'match', coalesce(t.total_price, 0), coalesce(t.purchase_date, t.created_at), m.venue_id, 'match', m.id
    from public.tickets t join public.matches m on m.id = t.match_id
    union all
    select 'cycling', coalesce(e.price, 0) * coalesce(a.number_of_slots, 1), a.created_at, null::uuid, 'cycling', e.id_uuid
    from public.cycling_attendees a join public.cycling_events e on e.id_uuid = a.cycling_event_id_uuid
    where coalesce(a.payment_status, false) and not coalesce(e.is_free, true)
  ),
  bk as (
    select b.id, b.venue_id, coalesce(b.amount, 0) amount, b.created_at,
           row_number() over (partition by b.venue_id order by b.created_at, b.id) rn
    from public.bookings b where public.admin_is_paid(b.payment_status) and coalesce(b.amount, 0) > 0
  )
  select i.kind, i.amount, i.at, i.venue_id, i.st, i.sid,
         coalesce(act.act_rate, o.rate), round(i.amount * coalesce(act.act_rate, o.rate) / 100, 2), act.okey
  from items i cross join org_rate o left join act on act.st = i.st and act.sid = i.sid
  where (p_start is null or i.at >= p_start) and (p_end is null or i.at < p_end)
  union all
  select 'venue', bk.amount, bk.created_at, bk.venue_id, 'booking', bk.id,
         case when bk.rn <= v.free then 0 else v.rate end,
         round(bk.amount * (case when bk.rn <= v.free then 0 else v.rate end) / 100, 2), 'venue:' || bk.venue_id
  from bk cross join ven_rate v
  where (p_start is null or bk.created_at >= p_start) and (p_end is null or bk.created_at < p_end)
$$;

create or replace function public.admin_get_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('dashboard.view');
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'total_events', (select count(*) from public.matches) + (select count(*) from public.cycling_events),
    'pending_cashouts',
        (select count(*) from public.cashouts where public.admin_norm(status::text) = 'pending')
      + (select count(*) from public.cycling_cashouts where public.admin_norm(status::text) = 'pending')
      + (select count(*) from public.venue_booking_cashout where public.admin_norm(status) = 'pending'),
    'total_revenue', (select coalesce(sum(amount), 0) from public.admin_revenue_items()),
    'total_commission', (select coalesce(sum(commission), 0) from public.admin_revenue_items()),
    'active_venues', (select count(*) from public.venues where public.admin_venue_status(is_verified, verified_status::text) = 'verified'),
    'active_ambassadors', (select count(*) from public.ambassadors where status = 'active')
  ) into v_result;
  return v_result;
end $$;

create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('dashboard.view');
  with rev as (select * from public.admin_revenue_items(now() - interval '30 days', now())),
  days as (select generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d)
  select jsonb_build_object(
    'revenue_30d', (select coalesce(sum(amount), 0) from rev),
    'commission_30d', (select coalesce(sum(commission), 0) from rev),
    'new_users_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'events_upcoming', (select count(*) from public.matches where status = 'upcoming' and not coalesce(cancellation_status, false))
                       + (select count(*) from public.cycling_events where public.admin_norm(status::text) = 'upcoming'),
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

create or replace function public.admin_get_analytics(p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_unit text;
  v_result jsonb;
begin
  perform public.admin_require_perm('analytics.view');
  v_unit := case when p_end - p_start <= interval '92 days' then 'week' else 'month' end;

  with rev as (select * from public.admin_revenue_items(p_start, p_end)),
  by_kind as (select kind, sum(amount) total, sum(commission) comm from rev group by kind),
  events as (
    select coalesce(nullif(m.sport, ''), 'Football') sport, m.created_at at from public.matches m where m.created_at >= p_start and m.created_at < p_end
    union all
    select 'Cycling', e.created_at from public.cycling_events e where e.created_at >= p_start and e.created_at < p_end
  )
  select jsonb_build_object(
    'period_unit', v_unit,
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.profiles where created_at < p_end),
      'new_users', (select count(*) from public.profiles where created_at >= p_start and created_at < p_end),
      'total_events', (select count(*) from events),
      'total_revenue', (select coalesce(sum(amount), 0) from rev),
      'active_venues', (select count(*) from public.venues where public.admin_venue_status(is_verified, verified_status::text) = 'verified')
    ),
    'revenue', jsonb_build_object(
      'match', coalesce((select total from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select total from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select total from by_kind where kind = 'venue'), 0)),
    'commission', jsonb_build_object(
      'match', coalesce((select comm from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select comm from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select comm from by_kind where kind = 'venue'), 0)),
    -- Effective rate actually earned, after free activities and bookings
    'commission_rates', jsonb_build_object(
      'match', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'match'), 0),
      'cycling', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'cycling'), 0),
      'venue', coalesce((select round(comm / nullif(total, 0) * 100, 1) from by_kind where kind = 'venue'), 0)),
    'commission_rules', public.admin_commission_rules(),
    'free_activities', (select count(distinct source_id) from rev where rate = 0),
    'user_growth', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, created_at) period, count(*) c from public.profiles where created_at >= p_start and created_at < p_end group by 1) g), '[]'::jsonb),
    'revenue_trend', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'match', m, 'cycling', c, 'venue', v) order by period)
      from (select date_trunc(v_unit, at) period, sum(amount) filter (where kind = 'match') m, sum(amount) filter (where kind = 'cycling') c,
                   sum(amount) filter (where kind = 'venue') v from rev group by 1) t), '[]'::jsonb),
    'event_trend', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'count', c) order by period)
      from (select date_trunc(v_unit, at) period, count(*) c from events group by 1) t), '[]'::jsonb),
    'top_sports', coalesce((select jsonb_agg(jsonb_build_object('sport', sport, 'count', c) order by c desc)
      from (select sport, count(*) c from events group by sport) s), '[]'::jsonb),
    'top_venues', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'city', city, 'events', events, 'revenue', revenue) order by revenue desc, events desc)
      from (select v.id, v.name, v.city,
                   (select count(*) from public.matches m where m.venue_id = v.id and m.created_at >= p_start and m.created_at < p_end) events,
                   coalesce((select sum(amount) from rev where rev.venue_id = v.id), 0) revenue
            from public.venues v order by revenue desc, events desc limit 25) tv), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-------------------------------------------------------------------------------
-- 9. Settings
-------------------------------------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require_perm('settings.view');
  return coalesce((select jsonb_object_agg(key, value) from public.admin_settings where key <> 'setup_secret'), '{}'::jsonb)
         || jsonb_build_object('commission_rules', public.admin_commission_rules(),
                               'setup_secret_set', exists (select 1 from public.admin_settings where key = 'setup_secret'));
end $$;

create or replace function public.admin_set_commission_rules(p_rules jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.admin_require_perm('settings.edit', true);
  v := jsonb_build_object(
    'organizer', jsonb_build_object('free_count', (p_rules->'organizer'->>'free_count')::int, 'rate', (p_rules->'organizer'->>'rate')::numeric),
    'venue', jsonb_build_object('free_count', (p_rules->'venue'->>'free_count')::int, 'rate', (p_rules->'venue'->>'rate')::numeric),
    'ambassador', jsonb_build_object('rate', (p_rules->'ambassador'->>'rate')::numeric));
  if (v->'organizer'->>'rate')::numeric not between 0 and 100 or (v->'venue'->>'rate')::numeric not between 0 and 100
     or (v->'ambassador'->>'rate')::numeric not between 0 and 100
     or (v->'organizer'->>'free_count')::int < 0 or (v->'venue'->>'free_count')::int < 0 then
    raise exception 'Rates must be between 0 and 100 and free counts cannot be negative';
  end if;
  insert into public.admin_settings(key, value, updated_at) values ('commission_rules', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-------------------------------------------------------------------------------
-- 10. Roles
-------------------------------------------------------------------------------
create or replace function public.admin_list_roles()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not (public.admin_can('roles.view') or public.admin_can('admins.view')) then
    perform public.admin_require_perm('roles.view');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'key', r.key, 'name', r.name, 'description', r.description, 'permissions', to_jsonb(r.permissions),
    'is_system', r.is_system, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'members', (select count(*) from public.admins a where (public.admin_role_of(a)).id = r.id)
  ) order by r.is_system desc, r.created_at), '[]'::jsonb) into v_result
  from public.admin_roles r;
  return jsonb_build_object('roles', v_result, 'catalog', public.admin_permission_catalog());
end $$;

create or replace function public.admin_save_role(p_id uuid, p_name text, p_description text, p_permissions text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_bad text[];
  v_role public.admin_roles;
begin
  perform public.admin_require_perm('roles.manage');
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Give the role a name'; end if;
  select array_agg(x) into v_bad from unnest(coalesce(p_permissions, '{}')) x where x <> all(public.admin_all_permissions());
  if v_bad is not null then raise exception 'Unknown permissions: %', array_to_string(v_bad, ', '); end if;

  if v_id is null then
    insert into public.admin_roles(key, name, description, permissions, is_system, created_by)
    values ('custom_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
            coalesce(p_permissions, '{}'), false, public.admin_current_id())
    returning id into v_id;
  else
    select * into v_role from public.admin_roles where id = v_id;
    if not found then raise exception 'Role not found'; end if;
    if v_role.key = 'super_admin' then raise exception 'The Super Admin role always has every permission and cannot be edited'; end if;
    update public.admin_roles set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
      permissions = coalesce(p_permissions, '{}'), updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_delete_role(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.admin_roles;
begin
  perform public.admin_require_perm('roles.manage', true);
  select * into v_role from public.admin_roles where id = p_id;
  if not found then raise exception 'Role not found'; end if;
  if v_role.is_system then raise exception 'Built in roles cannot be deleted'; end if;
  if exists (select 1 from public.admins where role_id = p_id) then
    raise exception 'Move the admins on this role to another role first';
  end if;
  update public.admin_invites set role_id = null, status = 'revoked' where role_id = p_id and status = 'pending';
  delete from public.admin_roles where id = p_id;
end $$;

create or replace function public.admin_assign_role(p_admin_id uuid, p_role_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role public.admin_roles;
  v_target public.admins;
begin
  perform public.admin_require_perm('admins.edit');
  if p_admin_id = public.admin_current_id() then raise exception 'You cannot change your own role'; end if;
  select * into v_role from public.admin_roles where id = p_role_id;
  if not found then raise exception 'Role not found'; end if;
  select * into v_target from public.admins where id = p_admin_id;
  if (v_role.key = 'super_admin' or (public.admin_role_of(v_target)).key = 'super_admin') and not public.is_super_admin() then
    raise exception 'Only super admins can give or remove the Super Admin role';
  end if;
  execute format('update public.admins set role_id = %L, role = %L, updated_at = now() where id = %L',
    p_role_id, public.admin_enum_label('admins', 'role', array[case when v_role.key = 'super_admin' then 'super_admin' else 'admin' end]), p_admin_id);
end $$;

-------------------------------------------------------------------------------
-- 11. Admin list, invites, 2FA reset
-------------------------------------------------------------------------------
create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('admins.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'email', a.email, 'role', a.role::text, 'status', a.status::text, 'last_login', a.last_login, 'created_at', a.created_at,
    'first_name', a.first_name, 'last_name', a.last_name, 'avatar_url', a.avatar_url, 'linked', a.user_id is not null,
    'role_id', (public.admin_role_of(a)).id, 'role_name', (public.admin_role_of(a)).name, 'role_key', (public.admin_role_of(a)).key,
    'mfa_enabled', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status::text = 'verified'),
    'providers', (select coalesce(jsonb_agg(distinct i.provider), '[]'::jsonb) from auth.identities i where i.user_id = a.user_id)
  ) order by a.created_at), '[]'::jsonb) into v_result
  from public.admins a;
  return v_result;
end $$;

create or replace function public.admin_create_invite(p_email text, p_role_id uuid, p_first text default null, p_last text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_role public.admin_roles;
  v_id uuid;
  v_email text := lower(trim(p_email));
begin
  perform public.admin_require_perm('admins.invite');
  if v_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  select * into v_role from public.admin_roles where id = p_role_id;
  if not found then raise exception 'Pick a role'; end if;
  if v_role.key = 'super_admin' and not public.is_super_admin() then raise exception 'Only super admins can invite a Super Admin'; end if;
  if exists (select 1 from public.admins where lower(email) = v_email and user_id is not null and public.admin_norm(status::text) = 'active') then
    raise exception 'This person is already an active admin';
  end if;
  update public.admin_invites set status = 'revoked' where lower(email) = v_email and status = 'pending';
  insert into public.admin_invites(email, first_name, last_name, role_id, token_hash, invited_by)
  values (v_email, nullif(trim(coalesce(p_first, '')), ''), nullif(trim(coalesce(p_last, '')), ''), p_role_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), public.admin_current_id())
  returning id into v_id;
  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id, metadata)
  values (public.admin_current_id(), 'admin_management', 'Invited ' || v_email || ' as ' || v_role.name, 'admin_invites', v_id::text,
          jsonb_build_object('role', v_role.name));
  return jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email, 'role_name', v_role.name, 'expires_at', now() + interval '7 days');
end $$;

create or replace function public.admin_list_invites()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('admins.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.email, 'first_name', i.first_name, 'last_name', i.last_name, 'role_name', r.name,
    'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
    'expires_at', i.expires_at, 'created_at', i.created_at, 'invited_by', a.email
  ) order by i.created_at desc), '[]'::jsonb) into v_result
  from public.admin_invites i left join public.admin_roles r on r.id = i.role_id left join public.admins a on a.id = i.invited_by
  where i.created_at > now() - interval '90 days';
  return v_result;
end $$;

create or replace function public.admin_revoke_invite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('admins.invite');
  update public.admin_invites set status = 'revoked' where id = p_id and status = 'pending';
end $$;

-- Public: shows the accept page who the invite is for. Reveals nothing without the token.
create or replace function public.admin_invite_info(p_token text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('email', i.email, 'first_name', i.first_name, 'last_name', i.last_name, 'role_name', r.name,
         'expires_at', i.expires_at, 'invited_by', a.email,
         'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end)
  from public.admin_invites i left join public.admin_roles r on r.id = i.role_id left join public.admins a on a.id = i.invited_by
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.admin_finish_invite(i public.admin_invites, p_user uuid, p_first text, p_last text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role public.admin_roles;
  v_admin uuid;
begin
  select * into v_role from public.admin_roles where id = i.role_id;
  v_admin := public.admin_link_login(p_user, i.email, case when v_role.key = 'super_admin' then 'super_admin' else 'admin' end,
                                     coalesce(nullif(trim(coalesce(p_first, '')), ''), i.first_name), coalesce(nullif(trim(coalesce(p_last, '')), ''), i.last_name));
  update public.admins set role_id = coalesce(v_role.id, (select id from public.admin_roles where key = 'viewer')), invited_by = i.invited_by where id = v_admin;
  update public.admin_invites set status = 'accepted', accepted_at = now(), accepted_user_id = p_user where id = i.id;
  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id)
  values (v_admin, 'admin_management', i.email || ' accepted their invite as ' || coalesce(v_role.name, 'Viewer'), 'admins', v_admin::text);
  return v_admin;
end $$;

-- Accept with a password. The website signs the email up first, then calls this.
create or replace function public.admin_accept_invite(p_token text, p_password text, p_first text default null, p_last text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  i public.admin_invites;
  v_user uuid;
begin
  select * into i from public.admin_invites where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found or i.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'This invite is not valid any more. Ask for a new one.'); end if;
  if i.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This invite has expired. Ask for a new one.'); end if;
  if char_length(coalesce(p_password, '')) < 8 then return jsonb_build_object('ok', false, 'error', 'Password must be at least 8 characters.'); end if;
  select id into v_user from auth.users where lower(email) = lower(i.email) limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'Could not create your login. Check that email sign ups are enabled in Supabase, or use Google.');
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = v_user;
  perform public.admin_finish_invite(i, v_user, p_first, p_last);
  return jsonb_build_object('ok', true, 'email', i.email);
end $$;

-- Accept after signing in with Google. The Google email must match the invite.
create or replace function public.admin_accept_invite_oauth(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  i public.admin_invites;
  v_email text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in with Google first.'); end if;
  select * into i from public.admin_invites where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found or i.status <> 'pending' or i.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'This invite is not valid any more. Ask for a new one.');
  end if;
  select email into v_email from auth.users where id = auth.uid();
  if lower(coalesce(v_email, '')) <> lower(i.email) then
    return jsonb_build_object('ok', false, 'error', 'This invite is for ' || i.email || '. Sign in with that Google account.');
  end if;
  perform public.admin_finish_invite(i, auth.uid(), null, null);
  return jsonb_build_object('ok', true, 'email', i.email);
end $$;

-- Removes another admin's authenticator so they can set it up again
create or replace function public.admin_reset_admin_mfa(p_admin_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid;
begin
  perform public.admin_require_perm('admins.reset_2fa', true);
  if p_admin_id = public.admin_current_id() then raise exception 'You cannot reset your own two factor here'; end if;
  select user_id into v_user from public.admins where id = p_admin_id;
  if v_user is null then raise exception 'This admin has no login yet'; end if;
  delete from auth.mfa_factors where user_id = v_user;
  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id)
  values (public.admin_current_id(), 'admin_management', 'Reset two factor for admin ' || p_admin_id, 'admins', p_admin_id::text);
end $$;

-------------------------------------------------------------------------------
-- 12. Cashouts with manual payout reference
-------------------------------------------------------------------------------
create or replace function public.admin_update_cashout_status(p_source text, p_id uuid, p_status text, p_reason text, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_norm text := public.admin_norm(p_status);
  v_label text;
begin
  perform public.admin_require_perm('cashouts.approve', v_norm = 'approved');
  if v_norm not in ('approved', 'rejected') then raise exception 'Status must be approved or rejected'; end if;
  if v_norm = 'rejected' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A rejection reason is required'; end if;
  if p_source not in ('cashouts', 'cycling_cashouts', 'venue_booking_cashout') then raise exception 'Unknown cashout source %', p_source; end if;
  v_label := case when p_source = 'venue_booking_cashout' then v_norm else public.admin_enum_label(p_source, 'status', array[v_norm]) end;
  execute format(
    'update public.%I set status = %L, rejection_reason = %L, reviewed_by = %L, reviewed_at = now(), updated_at = now(),
       payout_reference = %L, payout_method = %L where id = %L',
    p_source, v_label, case when v_norm = 'rejected' then p_reason else null end, public.admin_current_id(),
    case when v_norm = 'approved' then nullif(trim(coalesce(p_reference, '')), '') else null end,
    case when v_norm = 'approved' then 'manual_bank_transfer' else null end, p_id);
  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id, metadata)
  values (public.admin_current_id(), 'cashout', v_norm || ' cashout ' || p_id, p_source, p_id::text,
          jsonb_build_object('status', v_norm, 'reason', p_reason, 'reference', p_reference, 'method', 'manual_bank_transfer'));
end $$;

-------------------------------------------------------------------------------
-- 13. Ambassadors
-------------------------------------------------------------------------------
-- Every naira an ambassador earns: their share of SportCliq's commission on
-- bookings at their venues (from the assignment date) and on their assigned events.
create or replace function public.admin_ambassador_items(p_ambassador uuid default null)
returns table(ambassador_id uuid, assignment_id uuid, entity_type text, entity_id uuid, at timestamptz, revenue numeric, commission numeric, rate numeric, earning numeric)
language sql stable security definer set search_path = public as $$
  with def as (select coalesce((public.admin_commission_rules()->'ambassador'->>'rate')::numeric, 10) rate),
  rev as (select * from public.admin_revenue_items())
  select a.ambassador_id, a.id, a.entity_type, a.entity_id, r.at, r.amount, r.commission,
         coalesce(amb.commission_rate, def.rate), round(r.commission * coalesce(amb.commission_rate, def.rate) / 100, 2)
  from public.ambassador_assignments a
  join public.ambassadors amb on amb.id = a.ambassador_id
  cross join def
  join rev r on (a.entity_type = 'venue' and r.source_type = 'booking' and r.venue_id = a.entity_id and r.at >= a.effective_from)
             or (a.entity_type in ('match', 'cycling') and r.source_type = a.entity_type and r.source_id = a.entity_id)
  where (p_ambassador is null or a.ambassador_id = p_ambassador)
    and (a.unassigned_at is null or r.at < a.unassigned_at)
$$;

create or replace function public.admin_get_ambassadors()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('ambassadors.view');
  with items as (select * from public.admin_ambassador_items()),
  pay as (select ambassador_id,
                 coalesce(sum(amount) filter (where status = 'paid'), 0) paid,
                 coalesce(sum(amount) filter (where status = 'pending'), 0) pending,
                 max(paid_at) last_paid
          from public.ambassador_payouts group by ambassador_id)
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.earned desc, x.full_name), '[]'::jsonb) into v_result
  from (
    select amb.id, amb.full_name, amb.email, amb.phone, amb.city, amb.state, amb.status, amb.commission_rate, amb.onboarded_at,
           amb.bank_name, amb.account_number, amb.account_name, amb.notes, amb.created_at,
           (select count(*) from public.ambassador_assignments s where s.ambassador_id = amb.id and s.active and s.entity_type = 'venue') venues,
           (select count(*) from public.ambassador_assignments s where s.ambassador_id = amb.id and s.active and s.entity_type in ('match', 'cycling')) events,
           coalesce((select sum(revenue) from items i where i.ambassador_id = amb.id), 0) revenue,
           coalesce((select sum(commission) from items i where i.ambassador_id = amb.id), 0) commission,
           coalesce((select sum(earning) from items i where i.ambassador_id = amb.id), 0) earned,
           coalesce((select sum(earning) from items i where i.ambassador_id = amb.id and i.at >= now() - interval '30 days'), 0) earned_30d,
           coalesce(p.paid, 0) paid, coalesce(p.pending, 0) pending,
           coalesce((select sum(earning) from items i where i.ambassador_id = amb.id), 0) - coalesce(p.paid, 0) - coalesce(p.pending, 0) balance,
           p.last_paid
    from public.ambassadors amb left join pay p on p.ambassador_id = amb.id
  ) x;
  return v_result;
end $$;

create or replace function public.admin_get_ambassador(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('ambassadors.view');
  with items as (select * from public.admin_ambassador_items(p_id))
  select jsonb_build_object(
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'entity_type', s.entity_type, 'entity_id', s.entity_id, 'active', s.active, 'assigned_at', s.assigned_at,
        'effective_from', s.effective_from, 'unassigned_at', s.unassigned_at, 'assigned_by', ad.email,
        'name', coalesce(v.name, m.title, e.title, 'Removed'),
        'subtitle', case s.entity_type when 'venue' then concat_ws(', ', v.city, v.state)
                                       when 'match' then to_char(m.match_date, 'DD Mon YYYY') || coalesce(' · ' || m.venue, '')
                                       else to_char(e.event_date, 'DD Mon YYYY') || coalesce(' · ' || e.start_landmark_name, '') end,
        'revenue', coalesce((select sum(revenue) from items i where i.assignment_id = s.id), 0),
        'commission', coalesce((select sum(commission) from items i where i.assignment_id = s.id), 0),
        'earning', coalesce((select sum(earning) from items i where i.assignment_id = s.id), 0)
      ) order by s.active desc, s.assigned_at desc)
      from public.ambassador_assignments s
      left join public.venues v on s.entity_type = 'venue' and v.id = s.entity_id
      left join public.matches m on s.entity_type = 'match' and m.id = s.entity_id
      left join public.cycling_events e on s.entity_type = 'cycling' and e.id_uuid = s.entity_id
      left join public.admins ad on ad.id = s.assigned_by
      where s.ambassador_id = p_id), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount', p.amount, 'status', p.status, 'method', p.method, 'reference', p.reference, 'note', p.note,
        'period_start', p.period_start, 'period_end', p.period_end, 'created_at', p.created_at, 'paid_at', p.paid_at,
        'created_by', c.email, 'paid_by', pb.email, 'cancel_reason', p.cancel_reason) order by p.created_at desc)
      from public.ambassador_payouts p left join public.admins c on c.id = p.created_by left join public.admins pb on pb.id = p.paid_by
      where p.ambassador_id = p_id), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', mth, 'earning', coalesce(e, 0), 'revenue', coalesce(r, 0)) order by mth)
      from (select g mth, (select sum(earning) from items i where date_trunc('month', i.at) = g) e, (select sum(revenue) from items i where date_trunc('month', i.at) = g) r
            from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') g) mm), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(row_to_json(l)::jsonb order by l.at desc) from (select * from items order by at desc limit 100) l), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.admin_save_ambassador(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform public.admin_require_perm(case when p_id is null then 'ambassadors.create' else 'ambassadors.edit' end);
  if nullif(trim(coalesce(p_data->>'full_name', '')), '') is null then raise exception 'Full name is required'; end if;
  if v_id is null then
    insert into public.ambassadors(full_name, email, phone, city, state, bank_name, account_number, account_name, commission_rate, onboarded_at, notes, created_by)
    values (trim(p_data->>'full_name'), nullif(lower(trim(coalesce(p_data->>'email', ''))), ''), nullif(trim(coalesce(p_data->>'phone', '')), ''),
            nullif(trim(coalesce(p_data->>'city', '')), ''), nullif(trim(coalesce(p_data->>'state', '')), ''),
            nullif(trim(coalesce(p_data->>'bank_name', '')), ''), nullif(trim(coalesce(p_data->>'account_number', '')), ''), nullif(trim(coalesce(p_data->>'account_name', '')), ''),
            nullif(p_data->>'commission_rate', '')::numeric, coalesce(nullif(p_data->>'onboarded_at', '')::timestamptz, now()),
            nullif(p_data->>'notes', ''), public.admin_current_id())
    returning id into v_id;
  else
    update public.ambassadors set
      full_name = trim(p_data->>'full_name'),
      email = nullif(lower(trim(coalesce(p_data->>'email', ''))), ''),
      phone = nullif(trim(coalesce(p_data->>'phone', '')), ''),
      city = nullif(trim(coalesce(p_data->>'city', '')), ''),
      state = nullif(trim(coalesce(p_data->>'state', '')), ''),
      bank_name = nullif(trim(coalesce(p_data->>'bank_name', '')), ''),
      account_number = nullif(trim(coalesce(p_data->>'account_number', '')), ''),
      account_name = nullif(trim(coalesce(p_data->>'account_name', '')), ''),
      commission_rate = nullif(p_data->>'commission_rate', '')::numeric,
      onboarded_at = coalesce(nullif(p_data->>'onboarded_at', '')::timestamptz, onboarded_at),
      notes = nullif(p_data->>'notes', ''),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_set_ambassador_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('ambassadors.edit');
  if p_status not in ('active', 'paused', 'exited') then raise exception 'Status must be active, paused or exited'; end if;
  update public.ambassadors set status = p_status, updated_at = now() where id = p_id;
end $$;

create or replace function public.admin_delete_ambassador(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('ambassadors.delete', true);
  if exists (select 1 from public.ambassador_payouts where ambassador_id = p_id and status = 'paid') then
    raise exception 'This ambassador has paid payouts on record. Mark them as exited instead.';
  end if;
  delete from public.ambassadors where id = p_id;
end $$;

create or replace function public.admin_assign_to_ambassador(p_ambassador uuid, p_entity_type text, p_entity_id uuid, p_effective_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.admin_require_perm('ambassadors.assign');
  if p_entity_type not in ('venue', 'match', 'cycling') then raise exception 'Unknown type'; end if;
  if not exists (select 1 from public.ambassadors where id = p_ambassador and status = 'active') then raise exception 'Ambassador not found or not active'; end if;
  if p_entity_type = 'venue' and not exists (select 1 from public.venues where id = p_entity_id) then raise exception 'Venue not found'; end if;
  if p_entity_type = 'match' and not exists (select 1 from public.matches where id = p_entity_id) then raise exception 'Match not found'; end if;
  if p_entity_type = 'cycling' and not exists (select 1 from public.cycling_events where id_uuid = p_entity_id) then raise exception 'Ride not found'; end if;
  update public.ambassador_assignments set active = false, unassigned_at = now(), unassigned_by = public.admin_current_id()
  where entity_type = p_entity_type and entity_id = p_entity_id and active;
  insert into public.ambassador_assignments(ambassador_id, entity_type, entity_id, effective_from, assigned_by)
  values (p_ambassador, p_entity_type, p_entity_id, coalesce(p_effective_from, now()), public.admin_current_id())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_unassign_from_ambassador(p_assignment uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('ambassadors.assign');
  update public.ambassador_assignments set active = false, unassigned_at = now(), unassigned_by = public.admin_current_id()
  where id = p_assignment and active;
end $$;

-- Search venues, matches or rides to assign, showing who has them now
create or replace function public.admin_search_assignable(p_type text, p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform public.admin_require_perm('ambassadors.assign');
  if p_type = 'venue' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select jsonb_build_object('id', v.id, 'name', v.name, 'subtitle', concat_ws(', ', v.city, v.state),
             'current', (select amb.full_name from public.ambassador_assignments s join public.ambassadors amb on amb.id = s.ambassador_id
                         where s.entity_type = 'venue' and s.entity_id = v.id and s.active)) x
      from public.venues v where q is null or concat_ws(' ', v.name, v.city, v.state) ilike '%' || q || '%'
      order by v.created_at desc limit 30) t;
  elsif p_type = 'match' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select jsonb_build_object('id', m.id, 'name', m.title, 'subtitle', to_char(m.match_date, 'DD Mon YYYY') || ' · ' || coalesce(m.organizer_name, ''),
             'current', (select amb.full_name from public.ambassador_assignments s join public.ambassadors amb on amb.id = s.ambassador_id
                         where s.entity_type = 'match' and s.entity_id = m.id and s.active)) x
      from public.matches m where q is null or concat_ws(' ', m.title, m.organizer_name, m.super_code) ilike '%' || q || '%'
      order by m.match_date desc limit 30) t;
  else
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result from (
      select jsonb_build_object('id', e.id_uuid, 'name', e.title, 'subtitle', to_char(e.event_date, 'DD Mon YYYY') || ' · ' || coalesce(e.host_name, ''),
             'current', (select amb.full_name from public.ambassador_assignments s join public.ambassadors amb on amb.id = s.ambassador_id
                         where s.entity_type = 'cycling' and s.entity_id = e.id_uuid and s.active)) x
      from public.cycling_events e where q is null or concat_ws(' ', e.title, e.host_name, e.supercode) ilike '%' || q || '%'
      order by e.event_date desc limit 30) t;
  end if;
  return v_result;
end $$;

create or replace function public.admin_create_ambassador_payout(p_ambassador uuid, p_amount numeric, p_note text default null, p_start date default null, p_end date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_balance numeric;
  v_id uuid;
begin
  perform public.admin_require_perm('ambassadors.payout');
  if coalesce(p_amount, 0) <= 0 then raise exception 'Amount must be more than zero'; end if;
  select coalesce((select sum(earning) from public.admin_ambassador_items(p_ambassador)), 0)
       - coalesce((select sum(amount) from public.ambassador_payouts where ambassador_id = p_ambassador and status in ('paid', 'pending')), 0)
  into v_balance;
  if p_amount > v_balance then raise exception 'Amount is more than the available balance of %', round(v_balance, 2); end if;
  insert into public.ambassador_payouts(ambassador_id, amount, note, period_start, period_end, created_by)
  values (p_ambassador, round(p_amount, 2), nullif(trim(coalesce(p_note, '')), ''), p_start, p_end, public.admin_current_id())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_mark_ambassador_payout_paid(p_payout uuid, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('ambassadors.payout', true);
  if nullif(trim(coalesce(p_reference, '')), '') is null then raise exception 'Add the bank transfer reference'; end if;
  update public.ambassador_payouts set status = 'paid', reference = trim(p_reference), paid_by = public.admin_current_id(), paid_at = now()
  where id = p_payout and status = 'pending';
  if not found then raise exception 'Only pending payouts can be marked as paid'; end if;
end $$;

create or replace function public.admin_cancel_ambassador_payout(p_payout uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_perm('ambassadors.payout');
  update public.ambassador_payouts set status = 'cancelled', cancelled_by = public.admin_current_id(), cancelled_at = now(), cancel_reason = p_reason
  where id = p_payout and status = 'pending';
  if not found then raise exception 'Only pending payouts can be cancelled'; end if;
end $$;

-------------------------------------------------------------------------------
-- 14. Notification delivery (used by the admin-dispatch edge function)
-------------------------------------------------------------------------------
create or replace function public.admin_notification_recipients(p_id uuid)
returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  n public.notifications;
  t text;
begin
  select * into n from public.notifications where id = p_id;
  if not found then return; end if;
  t := public.admin_norm(n.target_type::text);
  return query
  with ids as (
    select p.id uid from public.profiles p where t = 'all'
    union select n.target_id where t = 'user' and n.target_id is not null
    union select j.user_id from public.user_joined_matches j where t = 'event' and j.match_id = n.target_id
    union select c.user_id from public.user_joined_cycling c where t = 'event' and c.cycling_event_id = n.target_id
    union select o.user_id from public.user_organized_matches o where t = 'organizers'
    union select h.user_id from public.user_hosted_cycling h where t = 'organizers'
    union select v.user_id from public.venues v where t in ('venueowners', 'venueowner')
  )
  select ids.uid, coalesce(u.email, pr.email)::text
  from ids left join auth.users u on u.id = ids.uid left join public.profiles pr on pr.id = ids.uid
  where ids.uid is not null;
end $$;

create or replace function public.admin_record_delivery(p_id uuid, p_push integer, p_email integer, p_status text, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.notifications set push_sent = p_push, email_sent = p_email, status = p_status,
         delivery_error = nullif(p_error, ''), delivered_at = now(),
         recipients = greatest(coalesce(recipients, 0), coalesce(p_push, 0), coalesce(p_email, 0))
  where id = p_id
$$;

-------------------------------------------------------------------------------
-- 15. Row level security for the new tables
-------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_roles' and policyname = 'admin_portal_select_roles') then
    create policy admin_portal_select_roles on public.admin_roles for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_invites' and policyname = 'admin_portal_select_invites') then
    create policy admin_portal_select_invites on public.admin_invites for select to authenticated using (public.admin_can('admins.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ambassadors' and policyname = 'admin_portal_select_ambassadors') then
    create policy admin_portal_select_ambassadors on public.ambassadors for select to authenticated using (public.admin_can('ambassadors.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ambassador_assignments' and policyname = 'admin_portal_select_amb_assign') then
    create policy admin_portal_select_amb_assign on public.ambassador_assignments for select to authenticated using (public.admin_can('ambassadors.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ambassador_payouts' and policyname = 'admin_portal_select_amb_payouts') then
    create policy admin_portal_select_amb_payouts on public.ambassador_payouts for select to authenticated using (public.admin_can('ambassadors.view'));
  end if;
end $$;

-------------------------------------------------------------------------------
-- 16. Function permissions
-------------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname in ('is_admin', 'is_super_admin'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('revoke all on function %s from service_role', f.sig); end if;

    if f.proname not in ('admin_set_setup_secret', 'admin_link_login', 'admin_finish_invite', 'admin_notification_recipients', 'admin_record_delivery') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname in ('admin_setup_available', 'admin_setup_status', 'admin_bootstrap_super_admin', 'admin_invite_info', 'admin_accept_invite') then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
    if f.proname in ('admin_enum_label', 'admin_notification_recipients', 'admin_record_delivery', 'admin_can', 'admin_permissions', 'admin_me',
                     'admin_role_of', 'admin_jwt_aal', 'admin_norm') and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;


-- ===================== 20261124000003_admin_portal_v4.sql =====================
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


-- ===================== 20261124000004_admin_portal_v5.sql =====================
-- SportCliq Admin portal v5
-- Additive only. Safe to run more than once. Run after v4.
--
--   1. Makes kolapoimaam@gmail.com the first super admin.
--   2. Links an admin to their login automatically once that login exists with a confirmed email
--      (Google sign in, or Supabase Authentication > Add user with Auto Confirm).
--   3. Makes sign up metadata safe for every profile rule (names, nickname, phone number, date of birth),
--      so "Database error saving new user" cannot come back from bad metadata.

-------------------------------------------------------------------------------
-- 1. Safer sign up metadata
-------------------------------------------------------------------------------
create or replace function public.admin_portal_fill_user_names()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  f text;
  l text;
  full_name text;
  parts text[];
  nick text;
  phone text;
  dob date;
begin
  begin
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
    m := m || jsonb_build_object('first_name', left(f, 50), 'last_name', left(l, 50));

    -- Nickname may only hold letters, numbers and spaces
    if m ? 'nickname' then
      nick := trim(regexp_replace(coalesce(m->>'nickname', ''), '[^a-zA-Z0-9 ]', '', 'g'));
      m := case when nick = '' then m - 'nickname' else m || jsonb_build_object('nickname', nick) end;
    end if;

    -- Phone number may only hold digits
    if m ? 'phone_number' then
      phone := regexp_replace(coalesce(m->>'phone_number', ''), '[^0-9]', '', 'g');
      m := case when phone = '' then m - 'phone_number' else m || jsonb_build_object('phone_number', phone) end;
    end if;

    -- Date of birth must be a real date at least 13 years ago
    if m ? 'date_of_birth' then
      begin
        dob := (m->>'date_of_birth')::date;
        if dob > current_date - interval '13 years' then m := m - 'date_of_birth'; end if;
      exception when others then
        m := m - 'date_of_birth';
      end;
    end if;

    if m is distinct from coalesce(new.raw_user_meta_data, '{}'::jsonb) then
      new.raw_user_meta_data := m;
    end if;
  exception when others then
    raise warning 'admin_portal_fill_user_names skipped: %', sqlerrm;
  end;
  return new;
end $$;

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

-------------------------------------------------------------------------------
-- 2. Link admins to their login once the email is confirmed
-------------------------------------------------------------------------------
create or replace function public.admin_portal_link_admin_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.email is not null and new.email_confirmed_at is not null then
      update public.admins a
      set user_id = new.id, updated_at = now()
      where a.user_id is null
        and lower(a.email) = lower(new.email)
        and public.admin_norm(a.status::text) = 'active'
        and not exists (select 1 from public.admins b where b.user_id = new.id);
    end if;
  exception when others then
    raise warning 'admin_portal_link_admin_login skipped: %', sqlerrm;
  end;
  return new;
end $$;

do $$
begin
  if to_regclass('auth.users') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') then
    if not exists (select 1 from pg_trigger where tgname = 'zzz_admin_portal_link_admin_login' and tgrelid = 'auth.users'::regclass) then
      create trigger zzz_admin_portal_link_admin_login
        after insert or update of email_confirmed_at, email on auth.users
        for each row execute function public.admin_portal_link_admin_login();
    end if;
  end if;
end $$;

revoke all on function public.admin_portal_fill_user_names() from public;
revoke all on function public.admin_portal_link_admin_login() from public;

-------------------------------------------------------------------------------
-- 3. kolapoimaam@gmail.com is the first super admin
-------------------------------------------------------------------------------
do $$
declare
  v_email text := 'kolapoimaam@gmail.com';
  v_user uuid;
  v_admin uuid;
  v_role_id uuid;
  v_role text := public.admin_enum_label('admins', 'role', array['super_admin']);
  v_status text := public.admin_enum_label('admins', 'status', array['active']);
begin
  select id into v_user from auth.users where lower(email) = v_email order by created_at limit 1;
  if to_regclass('public.admin_roles') is not null then
    execute 'select id from public.admin_roles where key = ''super_admin'' limit 1' into v_role_id;
  end if;

  if v_user is not null then
    -- Existing login: link it, confirm the email so password sign in works, and make it super admin
    v_admin := public.admin_link_login(v_user, v_email, 'super_admin', 'Kolapo', 'Imam');
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_user;
  else
    select id into v_admin from public.admins where lower(email) = v_email limit 1;
    if v_admin is null then
      v_admin := gen_random_uuid();
      execute format('insert into public.admins(id, email, password_hash, role, status, first_name, last_name)
                      values (%L, %L, %L, %L, %L, %L, %L)',
        v_admin, v_email, 'managed_by_supabase_auth', v_role, v_status, 'Kolapo', 'Imam');
    else
      execute format('update public.admins set role = %L, status = %L, updated_at = now() where id = %L', v_role, v_status, v_admin);
    end if;
  end if;

  if v_role_id is not null then
    execute format('update public.admins set role_id = %L where id = %L', v_role_id, v_admin);
  end if;

  if not exists (select 1 from public.audit_logs where entity_type = 'admins' and entity_id = v_admin::text and details = 'Set as the first super admin by database setup') then
    insert into public.audit_logs(admin_id, action, details, entity_type, entity_id)
    values (v_admin, 'admin_management', 'Set as the first super admin by database setup', 'admins', v_admin::text);
  end if;
exception when others then
  raise warning 'Could not set the first super admin: %', sqlerrm;
  raise;
end $$;

-- Check the result
select a.email, a.role::text as role, r.name as role_name, a.status::text as status,
       a.user_id is not null as login_linked
from public.admins a left join public.admin_roles r on r.id = a.role_id
where lower(a.email) = 'kolapoimaam@gmail.com';


-- ===================== 20261124000005_admin_portal_v6.sql =====================
-- SportCliq Admin portal v6
-- Additive only. Safe to run more than once.
--
--   1. Fixes "notifications_target_type_check" when an admin sends a notification. The live table only
--      accepts some audience values, so the audience the admin picked is now kept in its own column and
--      target_type gets a value the table accepts.
--   2. Send to one user by email address instead of user ID.
--   3. Admin alerts (new user, new cashout, new venue) use the same safe insert so they stop failing quietly.

alter table public.notifications add column if not exists audience text;
alter table public.notifications add column if not exists audience_email text;
alter table public.notifications add column if not exists channel text;
alter table public.notifications add column if not exists image_url text;
alter table public.notifications add column if not exists recipients integer default 0;
alter table public.notifications add column if not exists status text;
alter table public.notifications add column if not exists sent_by uuid;
create index if not exists notifications_audience_idx on public.notifications(audience, target_id);

-- The values a notifications column accepts, best match first
create or replace function public.admin_portal_notification_values(p_column text, p_prefer text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_type oid;
  v_labels text[];
  v_out text[] := '{}';
  p text;
  l text;
begin
  select a.atttypid into v_type
  from pg_attribute a where a.attrelid = 'public.notifications'::regclass and a.attname = p_column and not a.attisdropped;
  select array_agg(e.enumlabel order by e.enumsortorder) into v_labels from pg_enum e where e.enumtypid = v_type;
  if v_labels is null then
    return p_prefer;
  end if;
  foreach p in array coalesce(p_prefer, '{}') loop
    foreach l in array v_labels loop
      if public.admin_norm(l) = public.admin_norm(p) and not l = any(v_out) then v_out := v_out || l; end if;
    end loop;
  end loop;
  foreach l in array v_labels loop
    if not l = any(v_out) then v_out := v_out || l; end if;
  end loop;
  return v_out;
end $$;

-- Inserts a notification with values the table accepts. The real audience and channel are kept in
-- audience and channel, so delivery and the app never depend on what target_type and type could hold.
create or replace function public.admin_portal_insert_notification(
  p_audience text, p_target_id uuid, p_audience_email text, p_categories text[], p_title text, p_message text,
  p_channel text, p_link text, p_image text, p_status text, p_sent_by uuid, p_recipients integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_aud text := public.admin_norm(p_audience);
  v_targets text[];
  v_cats text[];
  v_types text[];
  t text;
  c text;
  ty text;
  v_id uuid;
  v_err text;
begin
  v_targets := public.admin_portal_notification_values('target_type',
    case v_aud
      when 'venueowners' then array['venue_owners', 'venue_owner', 'venueowners', 'all']
      when 'organizers' then array['organizers', 'organizer', 'all']
      when 'admin' then array['admin', 'admins', 'all']
      else array[v_aud, 'all'] end);
  v_cats := public.admin_portal_notification_values('category', p_categories);
  v_types := public.admin_portal_notification_values('type',
    case public.admin_norm(p_channel)
      when 'both' then array['both', 'push', 'email', 'in_app']
      when 'email' then array['email', 'both', 'push', 'in_app']
      when 'push' then array['push', 'both', 'in_app', 'email']
      else array['in_app', 'push', 'both', 'email'] end);

  foreach t in array v_targets loop
    foreach c in array v_cats[1:3] loop
      foreach ty in array v_types[1:4] loop
        begin
          execute format(
            'insert into public.notifications(target_type, target_id, category, title, message, type, link, image_url, unread, recipients, status, sent_by, audience, audience_email, channel)
             values (%L, %L, %L, %L, %L, %L, %L, %L, true, %s, %L, %L, %L, %L, %L) returning id',
            t, p_target_id, c, left(coalesce(nullif(p_title, ''), 'SportCliq update'), 255), p_message, ty, p_link, p_image,
            coalesce(p_recipients, 0), p_status, p_sent_by, v_aud, p_audience_email, public.admin_norm(p_channel))
          into v_id;
          return v_id;
        exception when check_violation or invalid_text_representation or not_null_violation then
          v_err := sqlerrm;
        end;
      end loop;
    end loop;
  end loop;
  raise exception 'Could not save the notification: %', coalesce(v_err, 'no accepted values');
end $$;

-- Send from the admin portal. One user is picked by email address.
create or replace function public.admin_send_notification_v3(
  p_type text, p_target text, p_target_email text, p_target_id uuid, p_title text, p_message text, p_link text, p_image text
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_target text := public.admin_norm(p_target);
  v_email text := nullif(lower(trim(coalesce(p_target_email, ''))), '');
  v_target_id uuid := p_target_id;
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_image text := nullif(trim(coalesce(p_image, '')), '');
  v_recipients integer := 0;
  v_id uuid;
  v_row public.notifications;
begin
  perform public.admin_require_perm('notifications.send');
  if char_length(coalesce(p_message, '')) = 0 or char_length(p_message) > 500 then
    raise exception 'Message must be between 1 and 500 characters';
  end if;
  if v_link is not null and not (v_link ~ '^/' or v_link ~* '^https://') then
    raise exception 'The link must start with / or https://';
  end if;
  if v_image is not null and v_image !~* '^https://' then
    raise exception 'The image must be an https link';
  end if;
  if v_target not in ('all', 'user', 'event', 'organizers', 'venueowners') then
    raise exception 'Unknown audience %', p_target;
  end if;

  if v_target = 'user' then
    if v_email is null then raise exception 'Enter the email address of the user'; end if;
    select p.id into v_target_id from public.profiles p where lower(p.email) = v_email limit 1;
    if v_target_id is null then
      select u.id into v_target_id from auth.users u where lower(u.email) = v_email limit 1;
    end if;
    if v_target_id is null then raise exception 'No SportCliq user has the email %', v_email; end if;
  elsif v_target = 'event' then
    if v_target_id is null then raise exception 'Pick the match or ride'; end if;
  else
    v_target_id := null;
    v_email := null;
  end if;

  v_recipients := case v_target
    when 'all' then (select count(*) from public.profiles)
    when 'user' then 1
    when 'event' then
      (select count(*) from public.players where match_id = v_target_id)
      + (select count(*) from public.cycling_attendees where cycling_event_id_uuid = v_target_id)
    when 'organizers' then
      (select count(distinct u) from (select user_id u from public.user_organized_matches
                                      union select user_id from public.user_hosted_cycling) o)
    when 'venueowners' then (select count(distinct user_id) from public.venues where user_id is not null)
    else 0 end;

  v_id := public.admin_portal_insert_notification(
    v_target, v_target_id, v_email, array['announcement', 'general', 'admin_alert'], p_title, p_message,
    p_type, v_link, v_image, 'sent', public.admin_current_id(), v_recipients);

  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id)
  values (public.admin_current_id(), 'notification',
          'sent ' || p_type || ' notification to ' || coalesce(v_email, p_target) || ' (' || v_recipients || ' recipients)',
          'notifications', v_id::text);

  select * into v_row from public.notifications where id = v_id;
  return to_jsonb(v_row) || jsonb_build_object('target_type', v_row.target_type::text, 'type', v_row.type::text, 'category', v_row.category::text);
end $$;

-- Older callers go through the same safe path
create or replace function public.admin_send_notification_v2(
  p_type text, p_target text, p_target_id uuid, p_title text, p_message text, p_link text, p_image text
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_email text;
begin
  if public.admin_norm(p_target) = 'user' then
    select coalesce(p.email, u.email) into v_email
    from auth.users u left join public.profiles p on p.id = u.id where u.id = p_target_id;
  end if;
  return public.admin_send_notification_v3(p_type, p_target, v_email, p_target_id, p_title, p_message, p_link, p_image);
end $$;

-- Who a notification is for, read from the saved audience
create or replace function public.admin_portal_notification_audience(n public.notifications)
returns text language sql stable as $$
  select public.admin_norm(coalesce(n.audience, n.target_type::text))
$$;

create or replace function public.app_notification_for_user(n public.notifications, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text := public.admin_portal_notification_audience(n);
begin
  if p_user is null or n.sent_by is null or coalesce(n.status, '') = 'alert' or t = 'admin' then return false; end if;
  return case
    when t = 'all' then true
    when t = 'user' then n.target_id = p_user
    when t = 'event' then exists (select 1 from public.user_joined_matches j where j.user_id = p_user and j.match_id = n.target_id)
                       or exists (select 1 from public.user_joined_cycling c where c.user_id = p_user and c.cycling_event_id = n.target_id)
    when t in ('organizers', 'organizer') then exists (select 1 from public.user_organized_matches o where o.user_id = p_user)
                       or exists (select 1 from public.user_hosted_cycling h where h.user_id = p_user)
    when t in ('venueowners', 'venueowner') then exists (select 1 from public.venues v where v.user_id = p_user)
    else false end;
end $$;

create or replace function public.admin_notification_recipients(p_id uuid)
returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = public, auth as $$
declare
  n public.notifications;
  t text;
begin
  select * into n from public.notifications where id = p_id;
  if not found then return; end if;
  t := public.admin_portal_notification_audience(n);
  return query
  with ids as (
    select p.id uid from public.profiles p where t = 'all'
    union select n.target_id where t = 'user' and n.target_id is not null
    union select j.user_id from public.user_joined_matches j where t = 'event' and j.match_id = n.target_id
    union select c.user_id from public.user_joined_cycling c where t = 'event' and c.cycling_event_id = n.target_id
    union select o.user_id from public.user_organized_matches o where t = 'organizers'
    union select h.user_id from public.user_hosted_cycling h where t = 'organizers'
    union select v.user_id from public.venues v where t in ('venueowners', 'venueowner')
  )
  select ids.uid, coalesce(u.email, pr.email)::text
  from ids left join auth.users u on u.id = ids.uid left join public.profiles pr on pr.id = ids.uid
  where ids.uid is not null;
end $$;

-- Admin alerts through the safe insert
create or replace function public.admin_portal_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_message text;
  v_link text;
begin
  begin
    case tg_table_name
      when 'cashouts', 'cycling_cashouts', 'venue_booking_cashout' then
        v_title := 'New cashout request';
        v_message := 'A ' || case tg_table_name when 'venue_booking_cashout' then 'venue' when 'cycling_cashouts' then 'cycling' else 'match' end
                     || ' cashout request is waiting for review.';
        v_link := '/cashouts';
      when 'venues' then
        v_title := 'New venue listed';
        v_message := coalesce(new.name, 'A venue') || ' was added and needs verification.';
        v_link := '/venues';
      when 'matches' then
        v_title := 'New match created';
        v_message := coalesce(new.title, 'A match') || ' was created.';
        v_link := '/events';
      when 'cycling_events' then
        v_title := 'New cycling event';
        v_message := coalesce(new.title, 'A cycling event') || ' was created.';
        v_link := '/events';
      when 'bookings' then
        v_title := 'New venue booking';
        v_message := 'A venue booking was made.';
        v_link := '/venues';
      when 'profiles' then
        v_title := 'New user signed up';
        v_message := 'A new user joined SportCliq.';
        v_link := '/users';
      else
        return new;
    end case;
    perform public.admin_portal_insert_notification('admin', null, null, array['admin_alert', 'system', 'announcement'],
      v_title, v_message, 'in_app', v_link, null, 'alert', null, 0);
  exception when others then
    raise warning 'admin_portal_notify skipped: %', sqlerrm;
  end;
  return new;
end $$;

-- Fill the audience for notifications sent before this update
update public.notifications set audience = case when status = 'alert' then 'admin' else public.admin_norm(target_type::text) end
where audience is null;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_portal_notification_values', 'admin_portal_insert_notification',
      'admin_send_notification_v3', 'admin_send_notification_v2', 'admin_portal_notification_audience',
      'app_notification_for_user', 'admin_notification_recipients', 'admin_portal_notify')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname in ('admin_send_notification_v3', 'admin_send_notification_v2') and exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname = 'admin_notification_recipients' and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
