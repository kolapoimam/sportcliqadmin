-- SportCliq Admin Portal, step 1 of 2
-- Run this file on its own first, then run step 2.
-- It only ADDS enum labels the admin portal needs, and only when the enum
-- does not already have an equivalent label (matching ignores case, spaces,
-- underscores and the canceled/cancelled spelling). Nothing is renamed or removed.

create or replace function public.admin_norm(t text)
returns text
language sql
immutable
as $$
  select replace(lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z0-9]', '', 'g')), 'canceled', 'cancelled')
$$;

do $$
declare
  spec record;
  v_type oid;
  v_typname text;
  v_label text;
begin
  for spec in
    select * from (values
      ('notifications',         'target_type',  array['admin','all','user','event','organizers','venue_owners']),
      ('notifications',         'type',         array['push','email','both','in_app']),
      ('notifications',         'category',     array['admin_alert','announcement']),
      ('admins',                'role',         array['admin','super_admin']),
      ('admins',                'status',       array['active','inactive']),
      ('cashouts',              'status',       array['pending','approved','rejected']),
      ('cycling_cashouts',      'status',       array['pending','approved','rejected']),
      ('cashout_requests',      'status',       array['pending','approved','rejected']),
      ('venues',                'verified_status', array['pending','verified','rejected']),
      ('cycling_events',        'status',       array['cancelled']),
      ('cycling_attendees',     'status',       array['registered','checked_in','no_show'])
    ) as s(tbl, col, labels)
  loop
    select a.atttypid, t.typname into v_type, v_typname
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    where a.attrelid = to_regclass('public.' || spec.tbl)
      and a.attname = spec.col
      and t.typtype = 'e';

    if v_type is null then
      continue; -- table or column missing, or column is not an enum
    end if;

    foreach v_label in array spec.labels loop
      if not exists (
        select 1 from pg_enum e
        where e.enumtypid = v_type
          and public.admin_norm(e.enumlabel) = public.admin_norm(v_label)
      ) then
        execute format('alter type %s add value if not exists %L', v_type::regtype, v_label);
        raise notice 'Added label % to enum %', v_label, v_typname;
      end if;
    end loop;
    v_type := null;
  end loop;
end $$;
