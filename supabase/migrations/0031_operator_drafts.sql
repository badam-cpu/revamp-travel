-- 0031_operator_drafts.sql — let operators save a listing as a DRAFT instead of
-- only submitting it for review.
--
-- Before: the insert policy required status='pending', so a new listing always
-- went straight into the review queue. Now an operator can insert as 'draft'
-- (work in progress) OR 'pending' (submit), and toggle their own listing
-- between draft and pending freely. Admin-only publish is unchanged; a listing
-- still can't reach 'published' except via an admin (the review-gate trigger).

-- Insert: allow draft OR pending (own row, editable type, operator role).
drop policy if exists "operators can create their own stay/tour listings" on public.listings;
create policy "operators can create their own stay/tour listings"
  on public.listings for insert
  with check (
    auth.uid() = operator_id
    and type in ('stay', 'tour', 'experience')
    and status in ('draft', 'pending')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator')
  );

-- Review gate: broaden the operator-allowed status change from only
-- draft->pending to any move between draft and pending on their own row
-- (submit or withdraw-to-draft). Admin still performs any transition;
-- published stays locked from operators. Faithful copy of 0002's function
-- otherwise.
create or replace function public.enforce_listing_review_gate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service-role / seed
  end if;

  if new.status is distinct from old.status then
    if public.is_admin(auth.uid()) then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    elsif old.operator_id = auth.uid()
      and old.status in ('draft', 'pending')
      and new.status in ('draft', 'pending') then
      -- Operator toggling their own listing between draft and pending.
      -- Clear any prior rejection note when (re)submitting.
      if new.status = 'pending' then
        new.review_note := null;
      end if;
    else
      -- Silently ignore any other client-attempted status change so the rest
      -- of the row's edits still save.
      new.status := old.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_enforce_review_gate on public.listings;
create trigger listings_enforce_review_gate
  before update on public.listings
  for each row execute function public.enforce_listing_review_gate();
