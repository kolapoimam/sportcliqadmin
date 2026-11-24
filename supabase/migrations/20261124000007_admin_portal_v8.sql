-- SportCliq Admin portal v8
-- Additive only. Safe to run more than once.
--
--   1. Fixes "new row violates row-level security policy for table notifications" when a user asks
--      for a cashout. The database trigger that writes the notification ran with the user's own rights,
--      which the notifications table does not allow. Trigger functions that write notifications, and the
--      triggers on the cashout tables, now run with their owner's rights, the setup Supabase recommends.
--   2. Venue owner campaigns also email the venue's own contact address.
--   3. Tests a venue cashout request as a real signed in venue owner, then approve and reject, and shows
--      the result. Everything in the test is rolled back.

-------------------------------------------------------------------------------
-- 1. Trigger functions run with owner rights
-------------------------------------------------------------------------------
create table if not exists public.admin_portal_fix_log (
  fix text, target text, detail text, done_at timestamptz default now()
);
alter table public.admin_portal_fix_log enable row level security;
revoke all on public.admin_portal_fix_log from anon, authenticated;

do $$
declare
  f record;
begin
  for f in
    select distinct p.oid, p.oid::regprocedure as sig, p.prosecdef, p.proconfig
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and cn.nspname = 'public' and pn.nspname = 'public'
      and p.proname not like 'admin\_%'
      and (c.relname in ('cashouts', 'cycling_cashouts', 'venue_booking_cashout', 'cashout_requests', 'notifications')
           or p.prosrc ilike '%notifications%')
  loop
    if not f.prosecdef then
      begin
        execute format('alter function %s security definer', f.sig);
        insert into public.admin_portal_fix_log(fix, target) values ('runs with owner rights', f.sig::text);
      exception when others then
        insert into public.admin_portal_fix_log(fix, target, detail) values ('could not change', f.sig::text, sqlerrm);
      end;
    end if;
    if f.proconfig is null or not exists (select 1 from unnest(f.proconfig) x where x like 'search_path=%') then
      begin
        execute format('alter function %s set search_path = public, auth, extensions', f.sig);
      exception when others then null;
      end;
    end if;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 2. Venue contact emails for venue owner campaigns
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
  ),
  people as (
    select ids.uid, nullif(trim(coalesce(u.email, pr.email, n.audience_email)), '')::text em
    from ids left join auth.users u on u.id = ids.uid left join public.profiles pr on pr.id = ids.uid
    where ids.uid is not null
  ),
  venue_contacts as (
    -- A venue's own contact email, when it differs from the owner's login email
    select v.user_id uid, nullif(trim(to_jsonb(v)->>'email'), '')::text em
    from public.venues v
    where t in ('venueowners', 'venueowner') and v.user_id is not null
      and nullif(trim(to_jsonb(v)->>'email'), '') is not null
  )
  select uid, em from people
  union
  select vc.uid, vc.em from venue_contacts vc
  where not exists (select 1 from people p where lower(p.em) = lower(vc.em));
end $$;

revoke all on function public.admin_notification_recipients(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.admin_notification_recipients(uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.admin_notification_recipients(uuid) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.admin_notification_recipients(uuid) to service_role; end if;
end $$;

-------------------------------------------------------------------------------
-- 3. Test a venue cashout as a real venue owner. Rolled back.
-------------------------------------------------------------------------------
create table if not exists public.admin_portal_cashout_check (
  cashout_table text, check_name text, result text, detail text, checked_at timestamptz default now()
);
truncate public.admin_portal_cashout_check;

do $$
declare
  v_venue record;
  v_id uuid := gen_random_uuid();
  v_err text;
  step text;
  can_be_user boolean := true;
begin
  select v.id, v.user_id into v_venue from public.venues v where v.user_id is not null order by v.created_at desc nulls last limit 1;
  if v_venue.id is null then
    insert into public.admin_portal_cashout_check values ('venue_booking_cashout', 'Request as venue owner', 'skipped', 'No venue with an owner yet');
    return;
  end if;
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('role', 'none', true);
  exception when others then can_be_user := false;
  end;

  foreach step in array array['request', 'approve', 'reject'] loop
    begin
      -- Act as the venue owner, the way the app does
      perform set_config('request.jwt.claims', json_build_object('sub', v_venue.user_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_venue.user_id::text, true);
      if can_be_user then perform set_config('role', 'authenticated', true); end if;
      insert into public.venue_booking_cashout(id, venue_id, amount, bank_name, account_number, account_holder_name, status, created_at, updated_at)
      values (v_id, v_venue.id, 1, 'Test Bank', '0000000000', 'Cashout Check', 'Review', now(), now());
      if can_be_user then perform set_config('role', 'none', true); end if;
      if step = 'approve' then
        update public.venue_booking_cashout set status = 'Successful', reviewed_at = now() where id = v_id;
      elsif step = 'reject' then
        update public.venue_booking_cashout set status = 'Failed', rejection_reason = 'check', reviewed_at = now() where id = v_id;
      end if;
      raise exception 'CASHOUT_CHECK_OK';
    exception when others then
      get stacked diagnostics v_err = message_text;
      insert into public.admin_portal_cashout_check values ('venue_booking_cashout',
        case step when 'request' then 'Request as venue owner' else initcap(step) end,
        case when v_err = 'CASHOUT_CHECK_OK' then 'works' else 'fails' end,
        case when v_err = 'CASHOUT_CHECK_OK' then null else v_err end);
    end;
  end loop;

  insert into public.admin_portal_cashout_check values ('venue_booking_cashout', 'Tested as',
    case when can_be_user then 'signed in venue owner' else 'SQL editor role with the owner''s sign in' end, null);
end $$;

select 'fix' as kind, fix as name, target as result, detail from public.admin_portal_fix_log
where done_at > now() - interval '5 minutes'
union all
select 'check', check_name, result, detail from public.admin_portal_cashout_check
order by 1 desc, 2;
