-- STEP 1. Fixes "Database error saving new user" for Supabase Add user, Invite user,
-- the admin setup screen and Google sign in.
-- Standalone. It needs nothing else from the admin portal. Safe to run more than once.
--
-- Why it happens: the app creates a profile for every new login and the profile needs a
-- first and last name made of letters only. Logins made from the Supabase dashboard carry
-- no names, so the profile insert fails and Supabase rejects the user.
-- This fills safe values before the user row is saved.

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

drop trigger if exists aaa_admin_portal_fill_user_names on auth.users;
create trigger aaa_admin_portal_fill_user_names
  before insert on auth.users
  for each row execute function public.admin_portal_fill_user_names();

-- Link an admin record to its login once the email is confirmed
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

revoke all on function public.admin_portal_fill_user_names() from public;
revoke all on function public.admin_portal_link_admin_login() from public;

-- Shows every trigger on auth.users. aaa_admin_portal_fill_user_names must be in the list.
select t.tgname as trigger_name, p.proname as function_name, n.nspname as function_schema
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
order by t.tgname;
