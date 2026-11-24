-- OPTIONAL. Only run this if the admins table already had rows before the portal.
-- The portal signs admins in with Supabase Auth. Older admin rows used their own
-- password_hash, so they are not linked to a Supabase Auth login yet.
--
-- For each existing admin:
--   1. In Supabase Dashboard > Authentication > Users, click "Add user" with the same
--      email and a password (tick "Auto Confirm User").
--   2. Then run this. It only fills the new user_id column where it is empty.

update public.admins a
set user_id = u.id
from auth.users u
where a.user_id is null
  and lower(u.email) = lower(a.email);

select email, role, status, user_id is not null as linked from public.admins order by created_at;
