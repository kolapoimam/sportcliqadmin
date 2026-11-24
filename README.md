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

Old `/admin/...` links redirect to the new paths.

## Security model

The browser never holds the service role key. Admin rights are checked in the database.

* Admins sign in with Supabase Auth. `admins.user_id` links an admin to their login.
* Every admin feature calls a `public.admin_*` database function. Each one checks the caller is an active admin (or super admin) before doing anything.
* The `adminSession` saved in localStorage only decides which menu items show. Editing it gives no extra access.
* Creating admins and the first admin setup run in Supabase Edge Functions, which hold the service role key on the server.

## Setup

### 1. Database

In the Supabase SQL editor run these files **in order, one at a time**:

1. `supabase/migrations/20261113000001_admin_enum_labels.sql`
2. `supabase/migrations/20261113000002_admin_portal.sql`
3. `supabase/migrations/20261113000003_link_existing_admins_optional.sql` only if you already had rows in `admins`

All of it is additive and safe to run again. See the PR description for the full list of changes.

### 2. Edge functions

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ADMIN_SETUP_SECRET="a-long-random-string-of-32-plus-characters"
supabase secrets set ADMIN_ALLOWED_ORIGINS="https://admin.sportcliq.com,http://localhost:5173"
supabase functions deploy admin-create
supabase functions deploy admin-setup --no-verify-jwt
```

`admin-setup` needs `--no-verify-jwt` because nobody is signed in yet when it runs. It is protected by the secret key and only works while the admins table is empty.

### 3. Supabase Auth settings

In Authentication > URL Configuration add `https://admin.sportcliq.com/reset-password` to Redirect URLs so password reset emails land on the portal.

### 4. Hosting on Vercel

1. Import this repo in Vercel. It detects Vite.
2. Add environment variables from `.env.example`:
   * `VITE_SUPABASE_URL`
   * `VITE_SUPABASE_ANON_KEY`
   * `VITE_SITE_URL` = `https://admin.sportcliq.com`
   * `VITE_MAIN_APP_URL` = `https://sportcliq.com`
3. Add the domain `admin.sportcliq.com` in Project Settings > Domains and create the CNAME record Vercel shows you.

`vercel.json` sends every path to `index.html` and adds security headers.

### 5. First admin

Open `https://admin.sportcliq.com/setup`, enter your email, a password and the `ADMIN_SETUP_SECRET`. Then sign in and add other admins from the Admins page.

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev
```

## Things to know

* **Delivery of push and email.** The Notifications page records each notification in the `notifications` table with its recipient count. Sending the actual push or email needs your existing provider to pick those rows up.
* **Commission rates** live in the new `admin_settings` table. They start at 10% for match, cycling and venue. Change them in the SQL editor with `update admin_settings set value = '{"match":10,"cycling":10,"venue":10}' where key = 'commission_rates';`
* **Sport** comes from the new `matches.sport` column. Empty means Football until the main app starts filling it.
* **Admin alerts** for the bell come from triggers on new users, matches, cycling events, bookings, venues and cashouts. They are wrapped so they can never block the main app.
