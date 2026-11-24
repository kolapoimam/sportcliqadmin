-- SportCliq Admin Portal, update 3 (run after updates 1 and 2)
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
