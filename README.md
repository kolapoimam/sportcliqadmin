# Sport Cliq Admin

Admin portal for Sport Cliq, hosted at **admin.sportcliq.com**.

React, TypeScript, Vite, Tailwind and Supabase. Font is Plus Jakarta Sans and colours are Sport Cliq green, black and white.

## Pages

| Path | Page | Who |
| --- | --- | --- |
| `/login` | Sign in | Everyone |
| `/setup` | Create the first super admin (only while there are no admins) | Everyone |
| `/reset-password` | Request a reset email and set a new password | Everyone |
| `/` | Dashboard with metrics and quick actions | Admins |
| `/users` | Users, event status, suspend, reset password, message | Admins |
| `/events` | Matches and cycling events, edit, cancel, delete | Admins (delete is super admin only) |
| `/cashouts` | Approve or reject cashouts | Admins |
| `/venues` | Verify, reject, toggle, delete venues | Admins (delete is super admin only) |
| `/analytics` | Charts, revenue, commission, CSV and PDF export | Admins |
| `/notifications` | Send notifications and see history | Admins |
| `/audit` | Audit log with filters and CSV export | Admins (export is super admin only) |
| `/admins` | Manage admin accounts | Super admins |
| `/profile` | Avatar, name and password | Admins |
| `/settings` | Commission rates, dark mode, help | Admins (rates are super admin only) |

Old `/admin/...` links redirect to the new paths.

## Security model

The browser never holds the service role key. Admin rights are checked in the database.

* Admins sign in with Supabase Auth. `admins.user_id` links an admin to their login.
* Every admin feature calls a `public.admin_*` database function. Each one checks the caller is an active admin (or super admin) before doing anything.
* The `adminSession` saved in localStorage only decides which menu items show. Editing it gives no extra access.
* Creating admins and the first admin setup run in `security definer` database functions. The setup secret is stored hashed and is never sent to the browser.

## Setup

### 1. Database

In the Supabase SQL editor run these files **in order, one at a time**. All of them are additive and safe to run again.

1. `supabase/migrations/20261113000001_admin_enum_labels.sql`
2. `supabase/migrations/20261113000002_admin_portal.sql`
3. `supabase/migrations/20261124000001_admin_portal_v2.sql`

Then set your setup secret, using your own phrase of 12 characters or more:

```sql
select admin_set_setup_secret('your-long-secret-phrase');
```

No edge functions are needed. First admin setup and creating admins run in the database.

### 2. Supabase Auth settings

* Authentication > URL Configuration: add `https://admin.sportcliq.com/reset-password` and `https://admin.sportcliq.com/login` to Redirect URLs.
* Authentication > Providers > Email: sign ups must be allowed. The portal signs a new admin up, then the database confirms them.

### 3. Vercel

Environment variables from `.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` (`https://admin.sportcliq.com`) and `VITE_MAIN_APP_URL` (`https://sportcliq.com`). Redeploy after changing them.

### 4. First admin

Open `https://admin.sportcliq.com/setup`, fill in your details and the setup secret. You are signed in straight away. Setup stays open until there is an active admin linked to a login, so older rows in the `admins` table no longer block it. If you use an email that already has a Sport Cliq login, its password becomes the one you enter.

After 10 wrong secrets setup locks. Run `admin_set_setup_secret` again to unlock it.

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev
```

## Things to know

* **Delivery of push and email.** The Notifications page records each notification in the `notifications` table with its recipient count. Sending the actual push or email needs your existing provider to pick those rows up.
* **Commission rates** live in `admin_settings` and are edited by super admins on the Settings page. Commission is revenue for each stream (paid match slots and tickets, paid cycling registrations, paid venue bookings) times that stream's rate.
* **Sport** comes from the new `matches.sport` column. Empty means Football until the main app starts filling it.
* **Admin alerts** for the bell come from triggers on new users, matches, cycling events, bookings, venues and cashouts. They are wrapped so they can never block the main app.
