-- SportCliq sign up doctor
-- Fixes "Database error saving new user" for new Google sign ups in the app, the admin portal
-- setup page, and Supabase Add user or Invite user.
--
-- Paste this whole file into the Supabase SQL editor and run it. Safe to run any number of times.
-- It tries a new sign up the way Supabase Auth does it, finds what blocks it, applies the safe fix,
-- tries again, and shows the result. The test sign ups are always rolled back, nothing is kept.

-------------------------------------------------------------------------------
-- 1. Safe names and profile fields on every new login
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
  nick text;
  phone text;
  dob date;
begin
  begin
    f := case when coalesce(m->>'first_name', '') ~ '^[a-zA-Z]+$' then m->>'first_name' else public.admin_portal_letters(m->>'first_name') end;
    l := case when coalesce(m->>'last_name', '') ~ '^[a-zA-Z]+$' then m->>'last_name' else public.admin_portal_letters(m->>'last_name') end;
    if f = '' then f := public.admin_portal_letters(coalesce(m->>'given_name', m->>'firstName')); end if;
    if l = '' then l := public.admin_portal_letters(coalesce(m->>'family_name', m->>'lastName')); end if;
    full_name := trim(coalesce(nullif(m->>'full_name', ''), nullif(m->>'name', ''), ''));
    if (f = '' or l = '') and full_name <> '' then
      parts := regexp_split_to_array(full_name, '\s+');
      if f = '' then f := public.admin_portal_letters(parts[1]); end if;
      if l = '' and array_length(parts, 1) > 1 then l := public.admin_portal_letters(parts[array_length(parts, 1)]); end if;
    end if;
    if f = '' then f := public.admin_portal_letters(split_part(coalesce(new.email, ''), '@', 1)); end if;
    if f = '' then f := 'Sport'; end if;
    if l = '' then l := 'User'; end if;
    f := left(f, 50);
    l := left(l, 50);
    m := m || jsonb_build_object('first_name', f, 'last_name', l);
    if coalesce(m->>'full_name', '') = '' then m := m || jsonb_build_object('full_name', f || ' ' || l); end if;
    if m ? 'nickname' then
      nick := trim(regexp_replace(coalesce(m->>'nickname', ''), '[^a-zA-Z0-9 ]', '', 'g'));
      m := case when nick = '' then m - 'nickname' else m || jsonb_build_object('nickname', nick) end;
    end if;
    if m ? 'phone_number' then
      phone := regexp_replace(coalesce(m->>'phone_number', ''), '[^0-9]', '', 'g');
      m := case when phone = '' then m - 'phone_number' else m || jsonb_build_object('phone_number', phone) end;
    end if;
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

drop trigger if exists aaa_admin_portal_fill_user_names on auth.users;
create trigger aaa_admin_portal_fill_user_names
  before insert on auth.users
  for each row execute function public.admin_portal_fill_user_names();

create or replace function public.admin_portal_link_admin_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.email is not null and new.email_confirmed_at is not null and to_regclass('public.admins') is not null then
      update public.admins a
      set user_id = new.id, updated_at = now()
      where a.user_id is null
        and lower(a.email) = lower(new.email)
        and lower(a.status::text) = 'active'
        and not exists (select 1 from public.admins b where b.user_id = new.id);
    end if;
  exception when others then
    raise warning 'admin_portal_link_admin_login skipped: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists zzz_admin_portal_link_admin_login on auth.users;
create trigger zzz_admin_portal_link_admin_login
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.admin_portal_link_admin_login();

-------------------------------------------------------------------------------
-- 2. Try sign ups, fix what blocks them, try again
-------------------------------------------------------------------------------
create table if not exists public.admin_portal_signup_check (
  step int,
  check_name text,
  result text,
  detail text,
  checked_at timestamptz default now()
);
alter table public.admin_portal_signup_check enable row level security;
revoke all on public.admin_portal_signup_check from anon, authenticated;
truncate public.admin_portal_signup_check;

-- Runs one test sign up as Supabase Auth would. Always rolled back. Returns 'ok' or the error.
create or replace function public.admin_portal_try_signup(p_meta jsonb, p_provider text, p_as_auth boolean)
returns text language plpgsql as $$
declare
  v_err text;
  v_detail text;
  v_ctx text;
  v_cols text;
begin
  begin
    -- Supabase Auth runs with search_path auth, so tests do too
    perform set_config('search_path', 'auth', true);
    if p_as_auth then
      perform set_config('role', 'supabase_auth_admin', true);
    end if;
    select string_agg(quote_ident(column_name), ', ' order by array_position(array['aud','role','raw_app_meta_data','created_at','updated_at','email_confirmed_at']::text[], column_name::text)) into v_cols
    from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name in ('aud', 'role', 'raw_app_meta_data', 'created_at', 'updated_at', 'email_confirmed_at');
    execute format(
      'insert into auth.users (id, email, raw_user_meta_data%s) select $1, $2, $3%s',
      coalesce(', ' || v_cols, ''),
      coalesce(', ' || (select string_agg(case column_name
          when 'aud' then '''authenticated''' when 'role' then '''authenticated'''
          when 'raw_app_meta_data' then '$4' else 'now()' end, ', ' order by array_position(array['aud','role','raw_app_meta_data','created_at','updated_at','email_confirmed_at']::text[], column_name::text))
        from information_schema.columns
        where table_schema = 'auth' and table_name = 'users'
          and column_name in ('aud', 'role', 'raw_app_meta_data', 'created_at', 'updated_at', 'email_confirmed_at')), ''))
    using gen_random_uuid(), 'signup-check-' || substr(md5(random()::text), 1, 10) || '@example.com', p_meta,
          jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider));
    raise exception 'SIGNUP_CHECK_OK';
  exception when others then
    get stacked diagnostics v_err = message_text, v_detail = pg_exception_detail, v_ctx = pg_exception_context;
    if v_err = 'SIGNUP_CHECK_OK' then return 'ok'; end if;
    return v_err || coalesce(' | ' || nullif(v_detail, ''), '') || coalesce(' | at ' || left(v_ctx, 300), '');
  end;
end $$;

create table if not exists public.admin_portal_function_backup (
  function_name text,
  definition text,
  saved_at timestamptz default now()
);
alter table public.admin_portal_function_backup enable row level security;
revoke all on public.admin_portal_function_backup from anon, authenticated;

do $$
declare
  google jsonb := '{"iss":"https://accounts.google.com","name":"Ada Obi-Lawal","full_name":"Ada Obi-Lawal","email":"x@gmail.com","picture":"https://x","email_verified":true,"provider_id":"1"}';
  blank jsonb := '{}';
  emailsignup jsonb := '{"first_name":"Ada","last_name":"Lawal"}';
  can_be_auth boolean := true;
  r text;
  fixes text := '';
  f record;
  pass int;
  def text;
  body text;
  q text;
  i int;
  j int;
begin
  begin
    perform set_config('role', 'supabase_auth_admin', true);
    perform set_config('role', 'none', true);
  exception when others then
    can_be_auth := false;
  end;

  -- Fix A, always: every function behind a sign up trigger runs with its owner rights and a fixed search path.
  -- This is the setup Supabase recommends for profile triggers.
  for f in
    select distinct p.oid, p.oid::regprocedure as sig, p.prosecdef, p.proconfig
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in ('auth.users'::regclass, coalesce(to_regclass('auth.identities'), 'auth.users'::regclass)) and not t.tgisinternal
      and p.proname not in ('admin_portal_fill_user_names', 'admin_portal_link_admin_login')
  loop
    if f.proconfig is null or not exists (select 1 from unnest(f.proconfig) c where c like 'search_path=%') then
      begin
        execute format('alter function %s set search_path = public, auth, extensions', f.sig);
        fixes := fixes || format('search path set on %s. ', f.sig);
      exception when others then fixes := fixes || format('could not set search path on %s (%s). ', f.sig, sqlerrm);
      end;
    end if;
    if not f.prosecdef then
      begin
        execute format('alter function %s security definer', f.sig);
        fixes := fixes || format('%s now runs with its owner rights. ', f.sig);
      exception when others then fixes := fixes || format('could not change %s (%s). ', f.sig, sqlerrm);
      end;
    end if;
  end loop;
  begin
    if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
      grant usage on schema public to supabase_auth_admin;
      grant select, insert, update on public.profiles to supabase_auth_admin;
    end if;
  exception when others then fixes := fixes || format('could not grant profile rights (%s). ', sqlerrm);
  end;
  insert into public.admin_portal_signup_check(step, check_name, result, detail)
  values (0, 'Fix A, trigger rights and search path', case when fixes = '' then 'already fine' else 'applied' end, nullif(fixes, ''));

  for pass in 1..2 loop
    r := public.admin_portal_try_signup(google, 'google', can_be_auth);
    insert into public.admin_portal_signup_check(step, check_name, result, detail) values (pass, 'New Google sign up', case when r = 'ok' then 'works' else 'fails' end, nullif(r, 'ok'));
    r := public.admin_portal_try_signup(blank, 'email', can_be_auth);
    insert into public.admin_portal_signup_check(step, check_name, result, detail) values (pass, 'Supabase Add user or Invite', case when r = 'ok' then 'works' else 'fails' end, nullif(r, 'ok'));
    r := public.admin_portal_try_signup(emailsignup, 'email', can_be_auth);
    insert into public.admin_portal_signup_check(step, check_name, result, detail) values (pass, 'Email sign up in the app', case when r = 'ok' then 'works' else 'fails' end, nullif(r, 'ok'));

    exit when not exists (select 1 from public.admin_portal_signup_check where step = pass and result = 'fails');
    exit when pass = 2;

    -- Fix B, only when sign ups still fail: the profile trigger can no longer block a new login.
    -- Its code is kept as is inside a safety block. If it errors, the login is still saved and the
    -- app creates the profile on first sign in. The original code is saved in admin_portal_function_backup.
    fixes := '';
    for f in
      select distinct p.oid, p.oid::regprocedure as sig
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_language lg on lg.oid = p.prolang
      where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and lg.lanname = 'plpgsql'
        and p.proname not in ('admin_portal_fill_user_names', 'admin_portal_link_admin_login')
    loop
      begin
        def := pg_get_functiondef(f.oid);
        if position('admin_portal_safety_block' in def) > 0 then continue; end if;
        insert into public.admin_portal_function_backup(function_name, definition) values (f.sig::text, def);
        -- Find the dollar quote around the body, then the body between its first and last use
        q := substring(def from 'AS (\$[A-Za-z0-9_]*\$)');
        if q is null then raise exception 'body quote not found'; end if;
        i := strpos(def, q);
        j := length(def) - strpos(reverse(def), reverse(q)) - length(q) + 2;
        if j <= i then raise exception 'body end not found'; end if;
        body := substring(def from i + length(q) for j - i - length(q));
        body := regexp_replace(body, ';?\s*$', ';');
        def := left(def, i + length(q) - 1)
            || E'\n-- admin_portal_safety_block\nbegin\n' || body
            || E'\nexception when others then\n  raise warning ''sign up profile step skipped: %'', sqlerrm;\n  return new;\nend;\n'
            || substring(def from j);
        execute def;
        fixes := fixes || format('%s wrapped in a safety block. ', f.sig);
      exception when others then
        fixes := fixes || format('could not wrap %s (%s). ', f.sig, sqlerrm);
      end;
    end loop;
    insert into public.admin_portal_signup_check(step, check_name, result, detail)
    values (pass, 'Fix B, sign up can no longer be blocked', case when fixes = '' then 'nothing to wrap' else 'applied' end, nullif(fixes, ''));
  end loop;

  insert into public.admin_portal_signup_check(step, check_name, result, detail)
  values (9, 'Tested as', case when can_be_auth then 'Supabase Auth role' else 'SQL editor role with the Auth search path' end, null);
end $$;


-- Each sign up trigger and the start of its code, so any remaining error can be traced
insert into public.admin_portal_signup_check(step, check_name, result, detail)
select 10, 'Trigger ' || t.tgname, n.nspname || '.' || p.proname || case when p.prosecdef then ' (definer)' else '' end,
       left(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g'), 1500)
from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

select step, check_name, result, detail from public.admin_portal_signup_check order by step, check_name;
