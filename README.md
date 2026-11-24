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
| `/settings` | Fee rules, roles and permissions, appearance | settings.view |
| `/ambassadors` | Ambassadors, assignments, earnings, payouts | ambassadors.view |
| `/mfa` | Two factor setup and sign in | Everyone signing in |
| `/invite` | Accept an admin invite | Invitees |

Old `/admin/...` links redirect to the new paths.

## Security model

The browser never holds the service role key. Admin rights are checked in the database.

* Admins sign in with Supabase Auth. `admins.user_id` links an admin to their login.
* Every admin feature calls a `public.admin_*` database function. Each one checks the caller is an active admin (or super admin) before doing anything.
* The `adminSession` saved in localStorage only decides which menu items show. Editing it gives no extra access.
* Creating admins and the first admin setup run in `security definer` database functions. The setup secret is stored hashed and is never sent to the browser.

## Setup

### 1. Database

Open `supabase/RUN_THIS_admin_portal_setup.sql`, paste all of it into the Supabase SQL editor and run it. It contains every portal update in order, is additive only, and is safe to run again on top of an earlier run.

Then set your setup secret, once, with your own phrase of 12 characters or more:

```sql
select admin_set_setup_secret('your-long-secret-phrase');
```

### 2. Supabase Auth

* **Multi factor.** Authentication > Multi-Factor: TOTP (authenticator app) must be enabled. It is on by default.
* **Google.** Authentication > Sign In / Providers > Google: turn it on with a Google Cloud OAuth client. In Google Cloud the authorised redirect URI is `https://qxafigbrfpxdklwoqkxj.supabase.co/auth/v1/callback`.
* **Email sign ups** must be allowed (Providers > Email). The portal signs new admins up, then the database confirms them.
* **Redirect URLs** (URL Configuration): add `https://admin.sportcliq.com/**`.

### 3. Push and email function

The `admin-dispatch` edge function sends notifications with OneSignal and Resend, and sends admin invite emails. It reuses the secrets the SportCliq app already has in the same Supabase project (`ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL`).

1. In this GitHub repo add the secret `SUPABASE_ACCESS_TOKEN` (Settings > Secrets and variables > Actions). Use the same token as the playarena repo.
2. Open Actions > "Deploy admin Supabase functions" > Run workflow. It also runs by itself when a function changes on main.

### 4. Vercel

Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` (`https://admin.sportcliq.com`), `VITE_MAIN_APP_URL` (`https://sportcliq.com`).

### 5. First admin

Open `https://admin.sportcliq.com/setup`, enter your details and the setup secret, then set up Google Authenticator. Invite everyone else from the Admins page.

## Security

* Two factor (Google Authenticator, saved as **SportCliq Admin**) is required for every admin at every sign in. The database refuses every admin action from a session that has not passed two factor.
* Payout approvals and every delete ask for a fresh code. The database checks the code was entered in the last 5 minutes.
* Roles and permissions live in `admin_roles`. Six built in roles, plus any custom roles made in Settings. Every admin function checks its permission in the database.
* The audit trail records sign ins, failed codes, page views, every admin action and every field an admin changes, with IP address and device.

## Fees

Organisers and hosts pay nothing on their first 2 paid activities (matches and rides counted together), then 5%. Venues get their first paid booking free, then 10%. Ambassadors earn 10% of SportCliq's fee from their assigned venues and events. All of this is editable in Settings.

## Payouts are manual

The portal is not connected to a transfer service and never moves money. Cashouts and ambassador payouts are sent from the SportCliq bank account by hand, then approved in the portal with the transfer reference.

## First super admin

kolapoimaam@gmail.com is set as the first super admin by `20261124000004_admin_portal_v5.sql`. Sign in with Google using that address, or add it in Supabase Authentication > Users with Auto Confirm on and a password. The login links to the admin record automatically.

## Push notifications

Admins send push, email or both from Notifications. Each push carries a tap link and an optional image, and the OneSignal id is saved so the portal can show sent, delivered, clicks and failures. The SportCliq app shows admin messages on its Notifications screen (/notifications) through `app_my_notifications()` and report views, opens and clicks with `app_track_notification(id, 'view' | 'open' | 'click')`.

## Install and privacy

The portal installs as an app on phones and desktops (Install app in the account menu). It is hidden from search engines with robots.txt, robots meta tags and an X-Robots-Tag header. There is no sitemap.

## Local development

```bash
cp .env.example .env.local   # fill in your Supabase URL and anon key
npm install
npm run dev
```

