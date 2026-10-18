# Branded auth email templates

Revamp-branded versions of Supabase's auth emails (sign-up confirmation,
password reset, …), in the same frame as every other Revamp email (the
`shell()` in `server/email.ts`: orange top bar, `revamp.` wordmark, the slogan
sign-off, Revamp Hospitality LLC footer). Supabase stores templates in its own
dashboard — these files are the versioned source; paste them in by hand.
Refreshed 2026-10-15 (the September versions said "Revamp Travel").

## 1. Send them through Resend (Custom SMTP) — do this first

Supabase's built-in mailer is for development: it sends a handful of emails
per hour, may only deliver to the project's team members, and sends from
`noreply@mail.app.supabase.io` — which also fails your domain's DMARC once it's
tightened. Route auth email through Resend instead:

Supabase Dashboard → **Authentication → Emails → SMTP Settings → Enable Custom SMTP**

| Field | Value |
| --- | --- |
| Sender email | `hello@revampvacations.com` |
| Sender name | `Revamp Vacations` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key — create a dedicated one (Resend → API Keys → "Supabase Auth", sending access, domain `revampvacations.com`) |
| Minimum interval between emails | keep the default |

Then **Authentication → Rate Limits → "Rate limit for sending emails"**: raise
from the tiny default to e.g. `60` per hour.

These emails then count toward the same Resend plan as booking and campaign
email.

## 2. Paste the templates

Supabase Dashboard → **Authentication → Emails → Templates**. For each tab,
replace the message body with the matching file and set the subject:

| File | Template tab | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | `Confirm your email` |
| `reset-password.html` | Reset Password | `Reset your password` |
| `magic-link.html` | Magic Link | `Your sign-in link` |
| `change-email.html` | Change Email Address | `Confirm your new email address` |
| `invite.html` | Invite user | `You're invited to Revamp Vacations` |

The app itself triggers **Confirm signup** and **Reset Password** (Signup page,
"Forgot password"). Magic Link / Change Email / Invite are only sent if someone
uses them from the Supabase dashboard — the admin "Log in as operator" feature
generates a link without sending any email. Variables used:
`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` (change email only).

## 3. URL configuration

**Authentication → URL Configuration**

- Site URL: `https://revampvacations.com`
- Redirect URLs: `https://revampvacations.com/**`, `https://revampstay.com/**`,
  `http://localhost:3000/**` (local development)

The password-reset link returns to `/reset-password` on the site the person
used.

## 4. Test

Sign up with a spare address and use "Forgot password" once. Both emails should
arrive from **Revamp Vacations <hello@revampvacations.com>** in the Revamp
frame, and the buttons should land on revampvacations.com.
