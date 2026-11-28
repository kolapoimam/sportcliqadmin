-- Cashout notices go to the right people, never to every user.
-- Safe to run more than once. Also saved as supabase/STEP8_cashout_notification_targeting.sql.
--
--   1. Notices the app's cashout triggers save on their own (new request, paid, failed) are
--      internal alerts for the admin team. Before, a missing audience was filled in as "all",
--      so they looked like broadcasts to every user and showed as not delivered.
--      The requester is told by the portal's own targeted notice when an admin approves or rejects.
--   2. Old cashout notices saved that way are moved to admin alerts.
--   3. Admin alerts can be delivered by push and email to active admins.

create or replace function public.admin_is_cashout_notice(n public.notifications)
returns boolean language sql stable as $$
  select n.sent_by is null
     and (coalesce(n.category::text, '') ~* '(cash.?out|payout|withdraw)'
          or coalesce(n.title, '') ~* '(cash.?out|payout|withdraw)'
          or coalesce(n.message, '') ~* '(cash.?out|payout|withdraw)')
$$;

create or replace function public.admin_portal_fill_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  -- System cashout notices are admin alerts, whatever the trigger that made them left empty
  begin
    if public.admin_is_cashout_notice(new) then
      new.audience := 'admin';
      new.status := 'alert';
      if new.target_type is null then
        v := (public.admin_portal_notification_values('target_type', array['admin', 'user', 'all']))[1];
        if v is not null then new.target_type := v; end if;
      end if;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification cashout: %', sqlerrm;
  end;
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
      -- Never fill in "all" for something nobody chose to broadcast
      v := (public.admin_portal_notification_values('target_type',
              case when new.target_id is not null then array['user', 'admin'] else array['admin', 'user'] end))[1];
      if v is not null then new.target_type := v; end if;
    end if;
  exception when others then raise warning 'admin_portal_fill_notification: %', sqlerrm;
  end;
  begin
    if new.audience is null then
      new.audience := case
        when new.status = 'alert' then 'admin'
        when new.target_id is null and new.sent_by is null then 'admin'
        else public.admin_norm(new.target_type::text) end;
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

-- Old system cashout notices that were saved as broadcasts become admin alerts
update public.notifications n set audience = 'admin', status = 'alert'
where public.admin_is_cashout_notice(n) and coalesce(n.audience, '') <> 'admin';

-- Recipients: admin alerts go to active admins
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
    -- A broadcast only ever goes out when an admin chose it
    select p.id uid from public.profiles p where t = 'all' and n.sent_by is not null
    union select n.target_id where t = 'user' and n.target_id is not null
    union select j.user_id from public.user_joined_matches j where t = 'event' and j.match_id = n.target_id
    union select c.user_id from public.user_joined_cycling c where t = 'event' and c.cycling_event_id = n.target_id
    union select o.user_id from public.user_organized_matches o where t = 'organizers'
    union select h.user_id from public.user_hosted_cycling h where t = 'organizers'
    union select v.user_id from public.venues v where t in ('venueowners', 'venueowner')
    union select a.user_id from public.admins a where t = 'admin' and a.user_id is not null and public.admin_norm(a.status::text) = 'active'
  ),
  people as (
    select ids.uid, nullif(trim(coalesce(u.email, pr.email, n.audience_email)), '')::text em
    from ids left join auth.users u on u.id = ids.uid left join public.profiles pr on pr.id = ids.uid
    where ids.uid is not null
  ),
  venue_contacts as (
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
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.admin_notification_recipients(uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.admin_notification_recipients(uuid) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.admin_notification_recipients(uuid) to service_role; end if;
end $$;

-- Delivery results that keep an alert an alert
create or replace function public.admin_record_alert_delivery(p_id uuid, p_push integer, p_email integer, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.notifications set push_sent = p_push, email_sent = p_email,
         delivery_error = nullif(p_error, ''), delivered_at = now(),
         recipients = greatest(coalesce(recipients, 0), coalesce(p_push, 0), coalesce(p_email, 0))
  where id = p_id
$$;
revoke all on function public.admin_record_alert_delivery(uuid, integer, integer, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.admin_record_alert_delivery(uuid, integer, integer, text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.admin_record_alert_delivery(uuid, integer, integer, text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.admin_record_alert_delivery(uuid, integer, integer, text) to service_role; end if;
end $$;
