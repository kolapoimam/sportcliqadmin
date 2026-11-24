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
