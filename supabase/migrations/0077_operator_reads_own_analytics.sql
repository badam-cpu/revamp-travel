-- 0077_operator_reads_own_analytics.sql
-- Expose per-listing engagement analytics (0068) to the OWNING operator, so the
-- operator dashboard can show each operator their own listings' numbers. An
-- operator only ever sees analytics for listings whose operator_id is theirs —
-- so an operator with only stays sees only stay data, and since restaurants
-- ('eat') are house-owned (no operator insert policy exists for them), no normal
-- operator can ever see restaurant analytics. Admin read (0068) is unchanged;
-- all writes stay service-role-only via bump_listing_metric().

drop policy if exists "operator reads own listing analytics" on public.listing_analytics_daily;
create policy "operator reads own listing analytics" on public.listing_analytics_daily
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_analytics_daily.listing_id
        and l.operator_id = auth.uid()
    )
  );
