-- STEP 6. Run after STEP5. Fixes the notifications type not null error on cashouts, then tests a venue cashout again.

-- SportCliq Admin portal v9
-- Additive only. Safe to run more than once.
--
--   1. Fixes "null value in column type of relation notifications violates not-null constraint" on cashouts.
--      Your cashout triggers save notifications without a type (and sometimes without a category or audience).
--      A small trigger now fills any missing value with one the table accepts before the row is saved.
--   2. Notifications those triggers send to a person (for example "your cashout was paid") now also show in
--      that person's notification list in the app.
--   3. Runs the venue cashout test again and shows the result.

create or replace function public.admin_portal_fill_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  begin
    if new.type is null then
      v := (public.admin_portal_notification_values('type', array['in_app', 'push', 'both', 'email']))[1];
      if v is not null then new.type := v; end if;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.category is null then
      v := (public.admin_portal_notification_values('category', array['general', 'announcement', 'system']))[1];
      if v is not null then new.category := v; end if;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.target_type is null then
      v := (public.admin_portal_notification_values('target_type',
              case when new.target_id is not null then array['user', 'all'] else array['all', 'user'] end))[1];
      if v is not null then new.target_type := v; end if;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.audience is null then
      new.audience := case when new.status = 'alert' then 'admin' else public.admin_norm(new.target_type::text) end;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.unread is null then new.unread := true; end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.title is null or new.title = '' then new.title := 'SportCliq update'; end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.message is null then new.message := ''; end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists aaa_admin_portal_fill_notification on public.notifications;
create trigger aaa_admin_portal_fill_notification
  before insert on public.notifications
  for each row execute function public.admin_portal_fill_notification();

revoke all on function public.admin_portal_fill_notification() from public;

-- Personal notifications from any source show in the person's list
create or replace function public.app_notification_for_user(n public.notifications, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text := public.admin_portal_notification_audience(n);
begin
  if p_user is null or coalesce(n.status, '') = 'alert' or t = 'admin' then return false; end if;
  if t = 'user' and n.target_id = p_user then return true; end if;
  if n.sent_by is null then return false; end if;
  return case
    when t = 'all' then true
    when t = 'event' then exists (select 1 from public.user_joined_matches j where j.user_id = p_user and j.match_id = n.target_id)
                       or exists (select 1 from public.user_joined_cycling c where c.user_id = p_user and c.cycling_event_id = n.target_id)
    when t in ('organizers', 'organizer') then exists (select 1 from public.user_organized_matches o where o.user_id = p_user)
                       or exists (select 1 from public.user_hosted_cycling h where h.user_id = p_user)
    when t in ('venueowners', 'venueowner') then exists (select 1 from public.venues v where v.user_id = p_user)
    else false end;
end $$;

revoke all on function public.app_notification_for_user(public.notifications, uuid) from public;

-- Venue cashout test, as a signed in venue owner. Rolled back.
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
end $$;

select check_name, result, detail from public.admin_portal_cashout_check order by check_name;
