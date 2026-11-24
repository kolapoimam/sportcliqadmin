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
  select id into v_role_id from public.admin_roles where key = 'super_admin' limit 1;

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
    update public.admins set role_id = v_role_id where id = v_admin;
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
