# Apply: review/publish gate + admin + link-prefill import

This delta adds two features on top of the existing Milestone A (accounts +
operator-owned listings) build: a **review/publish gate** (new and
resubmitted listings sit `pending` until an admin approves them) and a
**link-prefill import assist** on `/dashboard` (paste a URL, get a
best-effort title/description/photo-reference prefill from that page's own
public metadata).

Every file in this zip is a **complete replacement** for the file at that
same path in your repo (two are brand-new: `client/src/pages/AdminReview.tsx`
and `server/urlPrefill.ts`, plus the new migration file). Overwrite in place
— do not hand-merge.

## 1. Apply the files

Copy every file in this zip into your repo at the matching path, preserving
directories:

```
supabase/migrations/0002_review_gate_and_admin.sql   (new)
server/urlPrefill.ts                                  (new)
server/routes.ts
server/supabase.ts
client/src/lib/api.ts
client/src/contexts/ListingsContext.tsx
client/src/contexts/AuthContext.tsx
client/src/pages/Dashboard.tsx
client/src/pages/AdminReview.tsx                       (new)
client/src/App.tsx
client/src/components/SiteHeader.tsx
scripts/seed-catalog.ts
CLAUDE.md
README.md
marketplace-spec.md
ENVIRONMENT.md
.env.example
```

No new npm dependency and no new environment variable are introduced —
`.env.example` only gained explanatory comments, not a new key.

## 2. Run the new migration

In your Supabase project's SQL Editor (or `supabase db push` / `psql`),
run `supabase/migrations/0002_review_gate_and_admin.sql` **once**, after
`0001_init.sql` (which should already be applied from Milestone A). It:

- adds `'admin'` to `profiles.role`'s check constraint
- adds `'pending'` to `listings.status`'s check constraint and sets its
  default to `'draft'`
- adds `review_note`, `reviewed_at`, `reviewed_by` columns to `listings`
- adds an `is_admin()` helper, new admin RLS policies, and a
  `before update` trigger (`enforce_listing_review_gate`) that is the actual
  enforcement point for the status state machine (RLS's `with check` alone
  can't compare a row's old and new `status`)
- tightens the operator insert policy so a client can only ever insert a
  listing as `status = 'pending'`

It's safe to run once; re-running is idempotent (every statement is
`drop ... if exists` / `create or replace` / `add column if not exists`).

## 3. Promote your own account to admin

There's no self-serve admin signup by design. Sign up a **separate** account
for yourself (not the house "Revamp" operator account) at `/signup`, find
its user id in the Supabase dashboard (Authentication → Users), then run in
the SQL Editor:

```sql
update public.profiles set role = 'admin' where id = '<your-user-id>';
```

Sign in with that account and open `/admin` to review pending listings.

## 4. Rebuild and redeploy

```bash
pnpm install   # no new deps, but harmless to confirm
pnpm check
pnpm build
```

Both should pass clean. Redeploy to Netlify as usual.

## 5. Verification checklist

Work through these against your real deployment (this couldn't be exercised
from the sandbox that produced this delta — no live Supabase/Netlify
access there):

- [ ] As a signed-in operator, add a stay or tour listing at `/dashboard`.
      It should show a **"Pending review"** badge and must **not** appear
      on `/explore`, the map, or search yet.
- [ ] Sign in as the admin account and open `/admin`. The pending listing
      should appear with the operator's name and its full content.
- [ ] Approve it. It should now appear on `/explore` (and everywhere else
      the live catalog is read).
- [ ] Create a second listing and **reject** it from `/admin` with a note.
      On the operator's `/dashboard`, it should show **"Needs changes"**
      plus that note.
- [ ] Edit the rejected listing and save. It should move back to
      **"Pending review"** automatically (no separate "resubmit" button —
      saving is what resubmits it).
- [ ] As a non-admin (traveler or operator), try visiting `/admin` directly
      — you should be redirected away.
- [ ] Edit an already-**published** listing's content (price, description,
      etc.) and save. It should update immediately and **not** get knocked
      back into "Pending review."
- [ ] On `/dashboard`, use **"Prefill from a link"** with a real URL (an
      Airbnb listing, or any page with OpenGraph tags). Confirm it fills in
      title/description best-effort, and that if you try a URL with no
      usable metadata, the rest of the form still works (no hard failure).
- [ ] Confirm the prefill's fetched image (if any) only shows as a small
      **reference thumbnail** in the dialog and is never auto-saved into the
      listing's own `image` field — you still have to paste your own hosted
      image URL (or leave it blank for the brand placeholder).
- [ ] Restaurant (`type: "eat"`) listings should still be completely
      absent from `/dashboard`'s write UI, unaffected by any of the above.

If anything in this checklist fails, it's almost certainly one of: the
migration not run, the constraint name mismatch (if you'd previously renamed
`profiles_role_check`/`listings_status_check` — the migration's header
comment covers this), or the RLS trigger not created — recheck step 2.
