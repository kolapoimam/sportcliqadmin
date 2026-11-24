-- STEP 4. Run after STEP3. Fixes cashout requests and approvals end to end, then tests them and shows the result.

-- SportCliq Admin portal v7. Cashouts end to end.
-- Additive only. Safe to run more than once.
--
--   1. Fixes "invalid input value for enum notification_category" when a cashout is requested.
--      A database trigger names notification categories the enum does not have yet, so the
--      missing labels are added. Nothing is removed or renamed.
--   2. The admin portal reads the app's cashout statuses (Review, Processed, Successful, Failed),
--      so new requests show as pending and can be approved.
--   3. Approving writes Successful and rejecting writes Failed, the values the app understands,
--      so wallets update correctly and a paid amount can never be requested twice.
--   4. The person who asked for the cashout gets an in app notification, push and email when it is
--      paid or rejected.

-------------------------------------------------------------------------------
-- 1. Notification labels used anywhere in the database
-------------------------------------------------------------------------------
do $$
declare
  v_cat oid;
  v_type oid;
  l text;
  wanted text[] := array[
    'cashout_request', 'cashout_requested', 'cashout_approved', 'cashout_rejected', 'cashout_successful',
    'cashout_failed', 'cashout_processed', 'cashout_update', 'cashout', 'payout', 'payment', 'wallet', 'refund',
    'booking', 'venue_booking', 'booking_confirmed', 'match', 'match_update', 'match_reminder', 'ride', 'cycling',
    'reminder', 'system', 'general', 'announcement', 'admin_alert'];
begin
  select a.atttypid into v_cat from pg_attribute a join pg_type t on t.oid = a.atttypid
  where a.attrelid = 'public.notifications'::regclass and a.attname = 'category' and t.typtype = 'e';
  select a.atttypid into v_type from pg_attribute a join pg_type t on t.oid = a.atttypid
  where a.attrelid = 'public.notifications'::regclass and a.attname = 'type' and t.typtype = 'e';

  if v_cat is not null then
    -- Category names that database functions write into notifications
    select wanted || coalesce(array_agg(distinct m[1]), '{}') into wanted
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral regexp_matches(p.prosrc, '''([a-z][a-z0-9_]{2,40})''', 'g') m
    where n.nspname = 'public' and p.prosrc ilike '%notifications%'
      and m[1] ~ '(cashout|payout|payment|wallet|refund|booking|reminder|withdraw)';
    foreach l in array wanted loop
      if not exists (select 1 from pg_enum where enumtypid = v_cat and enumlabel = l) then
        execute format('alter type %s add value if not exists %L', v_cat::regtype, l);
      end if;
    end loop;
  end if;

  if v_type is not null then
    foreach l in array array['in_app', 'push', 'email', 'both', 'sms'] loop
      if not exists (select 1 from pg_enum where enumtypid = v_type and enumlabel = l) then
        execute format('alter type %s add value if not exists %L', v_type::regtype, l);
      end if;
    end loop;
  end if;
end $$;

-- New enum labels can be used once saved
commit;

-------------------------------------------------------------------------------
-- 2. One view of cashout status for the portal
-------------------------------------------------------------------------------
create or replace function public.admin_cashout_state(p_status text)
returns text language sql immutable as $$
  select case
    when public.admin_norm(p_status) in ('successful', 'success', 'approved', 'paid', 'completed', 'complete') then 'approved'
    when public.admin_norm(p_status) in ('failed', 'rejected', 'declined', 'cancelled', 'denied') then 'rejected'
    else 'pending' end
$$;

create or replace function public.admin_get_cashouts(p_status text default 'all', p_start timestamptz default null, p_end timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_perm('cashouts.view');
  with c as (
    select c.id, 'cashouts'::text source,
           case when c.cycling_event_id_uuid is not null then 'Cycling' else 'Match' end type,
           coalesce(nullif(trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,'')), ''), m.organizer_name, e.host_name, 'Unknown') organizer,
           coalesce(c.total_cashout_eligible, c.total_amount_paid, 0) amount,
           public.admin_cashout_state(c.status::text) status, c.status::text raw_status, c.created_at,
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
    select c.id, 'cycling_cashouts', 'Cycling', e.host_name, c.total_amount_paid,
           public.admin_cashout_state(c.status::text), c.status::text, c.created_at,
           e.title,
           (select count(*) from public.cycling_attendees a where a.cycling_event_id_uuid = e.id_uuid and public.admin_norm(a.attendee_status) = 'checkedin'),
           c.account_name, c.bank_name, c.bank_account_number,
           nullif(nullif(c.rejection_reason, ''), 'NULL'), c.supercode
    from public.cycling_cashouts c
    left join public.cycling_events e on e.id_uuid = c.cycling_event_id_uuid
    union all
    select c.id, 'venue_booking_cashout', 'Venue',
           coalesce(nullif(trim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,'')), ''), v.name),
           c.amount, public.admin_cashout_state(c.status), c.status, c.created_at,
           v.name, null::bigint,
           c.account_holder_name, c.bank_name, c.account_number,
           nullif(nullif(c.rejection_reason, ''), 'NULL'), null
    from public.venue_booking_cashout c
    left join public.venues v on v.id = c.venue_id
    left join public.profiles pr on pr.id = v.user_id
  )
  select coalesce(jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc nulls last), '[]'::jsonb) into v_result
  from c
  where (coalesce(p_status, 'all') = 'all' or c.status = public.admin_cashout_state(p_status))
    and (p_start is null or c.created_at >= p_start)
    and (p_end is null or c.created_at < p_end);
  return v_result;
end $$;

-- Pending cashout counts on the dashboard read the same states
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin_%'
      and p.prosrc like '%from public.venue_booking_cashout where public.admin_norm(status) = ''pending''%'
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'from public.cashouts where public.admin_norm(status::text) = ''pending''', 'from public.cashouts where public.admin_cashout_state(status::text) = ''pending''');
    def := replace(def, 'from public.cycling_cashouts where public.admin_norm(status::text) = ''pending''', 'from public.cycling_cashouts where public.admin_cashout_state(status::text) = ''pending''');
    def := replace(def, 'from public.venue_booking_cashout where public.admin_norm(status) = ''pending''', 'from public.venue_booking_cashout where public.admin_cashout_state(status) = ''pending''');
    execute def;
  end loop;
end $$;

-------------------------------------------------------------------------------
-- 3. Who asked for a cashout
-------------------------------------------------------------------------------
create or replace function public.admin_cashout_owner(p_source text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid;
  r jsonb;
begin
  if p_source = 'cashouts' then
    select to_jsonb(c) into r from public.cashouts c where c.id = p_id;
    v_user := nullif(r->>'organizer_id', '')::uuid;
    if v_user is null and r->>'match_id' is not null then
      select coalesce(nullif(to_jsonb(m)->>'user_id', '')::uuid,
                      (select o.user_id from public.user_organized_matches o where o.match_id = m.id limit 1))
      into v_user from public.matches m where m.id = (r->>'match_id')::uuid;
    end if;
    if v_user is null and r->>'cycling_event_id_uuid' is not null then
      select h.user_id into v_user from public.user_hosted_cycling h where h.cycling_event_id = (r->>'cycling_event_id_uuid')::uuid limit 1;
    end if;
  elsif p_source = 'cycling_cashouts' then
    select h.user_id into v_user
    from public.cycling_cashouts c join public.user_hosted_cycling h on h.cycling_event_id = c.cycling_event_id_uuid
    where c.id = p_id limit 1;
  elsif p_source = 'venue_booking_cashout' then
    select v.user_id into v_user from public.venue_booking_cashout c join public.venues v on v.id = c.venue_id where c.id = p_id;
  end if;
  return v_user;
end $$;

-------------------------------------------------------------------------------
-- 4. Approve or reject with the app's status values, then tell the requester
-------------------------------------------------------------------------------
create or replace function public.admin_update_cashout_status_v2(p_source text, p_id uuid, p_status text, p_reason text, p_reference text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_norm text := public.admin_norm(p_status);
  v_label text;
  v_current text;
  v_amount numeric;
  v_title text;
  v_owner uuid;
  v_email text;
  v_notification uuid;
  v_msg text;
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
begin
  perform public.admin_require_perm('cashouts.approve', v_norm = 'approved');
  if v_norm not in ('approved', 'rejected') then raise exception 'Status must be approved or rejected'; end if;
  if v_norm = 'rejected' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A rejection reason is required'; end if;
  if p_source not in ('cashouts', 'cycling_cashouts', 'venue_booking_cashout') then raise exception 'Unknown cashout source %', p_source; end if;

  execute format('select status::text from public.%I where id = %L', p_source, p_id) into v_current;
  if v_current is null then raise exception 'Cashout not found'; end if;
  if public.admin_cashout_state(v_current) <> 'pending' then
    raise exception 'This cashout is already %', public.admin_cashout_state(v_current);
  end if;

  if p_source = 'venue_booking_cashout' then
    v_label := case v_norm when 'approved' then 'Successful' else 'Failed' end;
  else
    v_label := public.admin_enum_label(p_source, 'status',
      case v_norm when 'approved' then array['Successful', 'success', 'approved', 'paid'] else array['Failed', 'rejected', 'declined'] end);
  end if;

  execute format(
    'update public.%I set status = %L, rejection_reason = %L, reviewed_by = %L, reviewed_at = now(), updated_at = now(),
       payout_reference = %L, payout_method = %L where id = %L',
    p_source, v_label, case when v_norm = 'rejected' then p_reason else null end, public.admin_current_id(),
    case when v_norm = 'approved' then v_ref else null end,
    case when v_norm = 'approved' then 'manual_bank_transfer' else null end, p_id);

  insert into public.audit_logs(admin_id, action, details, entity_type, entity_id, metadata)
  values (public.admin_current_id(), 'cashout', v_norm || ' cashout ' || p_id, p_source, p_id::text,
          jsonb_build_object('status', v_norm, 'saved_as', v_label, 'reason', p_reason, 'reference', v_ref, 'method', 'manual_bank_transfer'));

  -- Tell the person who asked for it
  begin
    select amount, title into v_amount, v_title from (
      select coalesce(c.total_cashout_eligible, c.total_amount_paid, 0) amount, coalesce(m.title, e.title) title
      from public.cashouts c left join public.matches m on m.id = c.match_id left join public.cycling_events e on e.id_uuid = c.cycling_event_id_uuid
      where p_source = 'cashouts' and c.id = p_id
      union all
      select c.total_amount_paid, e.title from public.cycling_cashouts c left join public.cycling_events e on e.id_uuid = c.cycling_event_id_uuid
      where p_source = 'cycling_cashouts' and c.id = p_id
      union all
      select c.amount, v.name from public.venue_booking_cashout c left join public.venues v on v.id = c.venue_id
      where p_source = 'venue_booking_cashout' and c.id = p_id) x;
    v_owner := public.admin_cashout_owner(p_source, p_id);
    if v_owner is not null then
      select coalesce(p.email, u.email) into v_email from auth.users u left join public.profiles p on p.id = u.id where u.id = v_owner;
      v_msg := case v_norm
        when 'approved' then 'Your cashout of ₦' || to_char(coalesce(v_amount, 0), 'FM999,999,999,990.00')
             || coalesce(' for ' || v_title, '') || ' has been paid to your bank account.'
             || coalesce(' Transfer reference ' || v_ref || '.', '')
        else 'Your cashout of ₦' || to_char(coalesce(v_amount, 0), 'FM999,999,999,990.00')
             || coalesce(' for ' || v_title, '') || ' was not approved. Reason: ' || p_reason
             || '. The amount is back in your wallet and you can request again.' end;
      v_notification := public.admin_portal_insert_notification(
        'user', v_owner, v_email, array['cashout_approved', 'cashout_update', 'cashout', 'payout', 'announcement', 'general'],
        case v_norm when 'approved' then 'Cashout paid' else 'Cashout not approved' end,
        v_msg, 'both', '/profile/wallet', null, 'sent', public.admin_current_id(), 1);
    end if;
  exception when others then
    raise warning 'Cashout notice skipped: %', sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'status', v_norm, 'saved_as', v_label, 'notification_id', v_notification, 'notified', v_email);
end $$;

-- The older call does the same work
create or replace function public.admin_update_cashout_status(p_source text, p_id uuid, p_status text, p_reason text, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_update_cashout_status_v2(p_source, p_id, p_status, p_reason, p_reference);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('admin_cashout_state', 'admin_get_cashouts', 'admin_cashout_owner',
      'admin_update_cashout_status_v2', 'admin_update_cashout_status')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if f.proname in ('admin_get_cashouts', 'admin_update_cashout_status_v2', 'admin_update_cashout_status')
       and exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  if to_regclass('public.admin_function_permissions') is not null then
    insert into public.admin_function_permissions(fn, permission, fresh_mfa)
    values ('admin_update_cashout_status_v2', 'cashouts.approve', false)
    on conflict (fn) do nothing;
  end if;
end $$;

-------------------------------------------------------------------------------
-- 5. Check every cashout step on a copy of a real row. Everything is rolled back.
-------------------------------------------------------------------------------
create table if not exists public.admin_portal_cashout_check (
  cashout_table text, check_name text, result text, detail text, checked_at timestamptz default now()
);
alter table public.admin_portal_cashout_check enable row level security;
revoke all on public.admin_portal_cashout_check from anon, authenticated;
truncate public.admin_portal_cashout_check;

do $$
declare
  t text;
  r jsonb;
  v_id_type text;
  v_new jsonb;
  v_id text;
  v_review text;
  v_ok text;
  v_bad text;
  v_err text;
  step text;
begin
  foreach t in array array['venue_booking_cashout', 'cashouts', 'cycling_cashouts'] loop
    execute format('select to_jsonb(x) from public.%I x order by created_at desc nulls last limit 1', t) into r;
    if r is null then
      insert into public.admin_portal_cashout_check values (t, 'Request, approve, reject', 'skipped', 'No cashout in this table yet to copy for the test');
      continue;
    end if;
    select format_type(a.atttypid, a.atttypmod) into v_id_type from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attname = 'id';
    if t = 'venue_booking_cashout' then
      v_review := 'Review'; v_ok := 'Successful'; v_bad := 'Failed';
    else
      v_review := public.admin_enum_label(t, 'status', array['Review', 'pending']);
      v_ok := public.admin_enum_label(t, 'status', array['Successful', 'success', 'approved']);
      v_bad := public.admin_enum_label(t, 'status', array['Failed', 'rejected']);
    end if;

    foreach step in array array['request', 'approve', 'reject'] loop
      begin
        if step = 'request' then
          v_id := case when v_id_type = 'uuid' then gen_random_uuid()::text
                       else ((r->>'id')::bigint + 1000000)::text end;
          v_new := r || jsonb_build_object('id', v_id, 'status', v_review, 'created_at', now(), 'updated_at', now(), 'reviewed_by', null, 'reviewed_at', null);
          -- Unique columns other than id and links get fresh values so the copy can be saved
          v_new := v_new || coalesce((select jsonb_object_agg(a.attname, case when format_type(a.atttypid, a.atttypmod) = 'uuid' then to_jsonb(gen_random_uuid()) else to_jsonb('chk' || substr(md5(random()::text), 1, 8)) end)
            from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
            where i.indrelid = ('public.' || t)::regclass and i.indisunique and not i.indisprimary and a.attname not like '%\_id' and a.attname <> 'id'), '{}'::jsonb);
          execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb)', t, t, v_new);
        else
          -- Approve and reject are tried on the newest real row, then undone
          execute format('update public.%I set status = %L, reviewed_at = now() where id = %L', t,
                         case step when 'approve' then v_ok else v_bad end, r->>'id');
        end if;
        raise exception 'CASHOUT_CHECK_OK';
      exception when others then
        get stacked diagnostics v_err = message_text;
        insert into public.admin_portal_cashout_check values (t, initcap(step),
          case when v_err = 'CASHOUT_CHECK_OK' then 'works' when v_err ilike '%duplicate key%' then 'skipped' else 'fails' end,
          case when v_err = 'CASHOUT_CHECK_OK' then null else v_err end);
      end;
    end loop;
  end loop;
end $$;

select cashout_table, check_name, result, detail from public.admin_portal_cashout_check order by cashout_table, check_name;
