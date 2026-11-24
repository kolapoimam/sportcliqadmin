-- STEP 3. Run after STEP2. Fixes notifications_target_type_check and adds sending to one user by email.

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
