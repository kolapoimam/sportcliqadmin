-- Who registered for a match or ride, for the admin portal.
-- Safe to run more than once. Also saved as supabase/STEP9_event_participants.sql.

create or replace function public.admin_get_event_participants(p_event_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_result jsonb;
begin
  perform public.admin_require_perm('events.view');
  if p_event_type = 'match' then
    select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) into v_result from (
      select jsonb_build_object(
        'id', p.id,
        'name', p.player_name,
        'phone', coalesce(p.details->>'phone', pr.phone_number),
        'email', coalesce(nullif(p.details->>'email', 'sportcliqapp@gmail.com'), u.email, pr.email),
        'slots', coalesce(p.number_of_slots, 1),
        'payment', p.payment_status,
        'status', p.player_status::text,
        'cancelled', coalesce(p.cancellation_status, false),
        'code', p.confirmation_code,
        'payment_reference', p.details->>'payment_reference',
        'account', case when j.user_id is not null then true else false end,
        'details', coalesce(p.details, '{}'::jsonb) - 'payment_reference' - 'payment_status' - 'email' - 'phone',
        'created_at', p.created_at) x
      from public.players p
      left join public.user_joined_matches j on j.player_id = p.id
      left join auth.users u on u.id = j.user_id
      left join public.profiles pr on pr.id = j.user_id
      where p.match_id = p_id) t;
  else
    select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb) into v_result from (
      select jsonb_build_object(
        'id', a.id_uuid,
        'name', a.attendee_name,
        'phone', a.attendee_phone,
        'email', coalesce(u.email, pr.email),
        'slots', coalesce(a.number_of_slots, 1),
        'payment', case when a.payment_status is true then 'paid' when a.payment_status is false then 'unpaid' else null end,
        'status', coalesce(a.status::text, a.attendee_status),
        'cancelled', public.admin_norm(coalesce(a.status::text, '')) in ('cancelled', 'canceled'),
        'code', a.confirmation_code,
        'payment_reference', null,
        'account', case when j.user_id is not null then true else false end,
        'details', jsonb_strip_nulls(jsonb_build_object(
          'bike', case when a.is_own_bike then 'Own bike' when a.is_rental_bike then 'Rental bike' else null end)),
        'created_at', a.created_at) x
      from public.cycling_attendees a
      left join public.user_joined_cycling j on j.attendee_id = a.id_uuid
      left join auth.users u on u.id = j.user_id
      left join public.profiles pr on pr.id = j.user_id
      where a.cycling_event_id_uuid = p_id) t;
  end if;
  return v_result;
end $$;

insert into public.admin_function_permissions(fn, permission, fresh_mfa)
values ('admin_get_event_participants', 'events.view', false)
on conflict (fn) do update set permission = excluded.permission;

revoke all on function public.admin_get_event_participants(text, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.admin_get_event_participants(text, uuid) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then grant execute on function public.admin_get_event_participants(text, uuid) to authenticated; end if;
end $$;
