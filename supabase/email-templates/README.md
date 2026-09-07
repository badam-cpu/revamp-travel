# Branded auth email templates

Revamp-branded replacements for Supabase's default auth emails. Supabase stores
these in its own dashboard (not in this repo at runtime) — these files are the
versioned source of truth, paste them in by hand.

## Where to paste

Supabase Dashboard → **Authentication → Email Templates**. Pick each template
from the tab list, replace the **Message body (HTML)** with the matching file
here, set the **Subject**, and Save.

| File | Template tab | Suggested subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | `Confirm your email · revamp.` |
| `reset-password.html` | Reset Password | `Reset your password · revamp.` |
| `magic-link.html` | Magic Link | `Your sign-in link · revamp.` |
| `change-email.html` | Change Email Address | `Confirm your new email · revamp.` |
| `invite.html` | Invite user | `You're invited to Revamp Travel` |

Each uses Supabase's `{{ .ConfirmationURL }}` action link. Other variables you
can use: `{{ .Email }}`, `{{ .SiteURL }}`, `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .RedirectTo }}`.

## Two things the templates can't change

1. **Sender name/address** ("Mail App Supabase Noreply"). That's Supabase's
   shared/built-in mailer. To send from your own domain (e.g.
   `no-reply@revamp.travel`), configure **Custom SMTP** under
   Authentication → Emails → SMTP Settings with a provider (Resend, Postmark,
   SendGrid, SES, …). The template HTML here is independent of that — it works
   with either mailer.
2. **Rate limits.** The built-in mailer is throttled (a few emails/hour) and is
   meant for development, not production volume. Custom SMTP lifts that.

## Redirect / Site URL

For the confirmation and password-reset links to land on the live app (not
`localhost`), set **Authentication → URL Configuration → Site URL** to your
deployment origin (e.g. `https://revamptravel.netlify.app`) and add it to the
**Redirect URLs** allowlist (`https://revamptravel.netlify.app/**`). The
password reset flow returns to `/reset-password` on that origin.
