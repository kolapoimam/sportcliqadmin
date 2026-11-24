-- SportCliq Admin Portal: complete database setup in ONE file.
-- Paste all of this into the Supabase SQL editor and run it once. Safe to run again.
-- It contains, in order: 20261113000001, 20261113000002 and 20261124000001.
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

create or replace function public.admin_revenue_items(p_start timestamptz default null, p_end timestamptz default null)
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
