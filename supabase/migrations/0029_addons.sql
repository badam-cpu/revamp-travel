-- Revamp Vacations — concierge add-ons (extra services). Run once, after 0001–0028.
--
-- Revamp-managed extra services (luggage storage, airport pickup, mid-stay
-- cleaning, …). The admin manages one catalog on site_settings.addons; guests
-- pick them in the booking box and chargeable ones are added to the PayLink
-- total (priced server-side). A snapshot of the chosen add-ons and their total
-- is stored on the booking. Add-on revenue is Revamp's — it is NOT part of the
-- operator base/payout, and no platform commission applies to it.
--
-- site_settings.addons shape:
--   [{ "id","name","description","priceCents","unit","onRequest","enabled" }]
--   unit ∈ 'flat' | 'per_night' | 'per_guest'
-- bookings.addons shape (snapshot):
--   [{ "id","name","unit","amountCents","onRequest" }]

alter table public.site_settings
  add column if not exists addons jsonb not null default '[]';

alter table public.bookings
  add column if not exists addons jsonb not null default '[]',
  add column if not exists addons_cents integer not null default 0;

-- Seed the concierge catalog (disabled, price 0) so the admin only has to set
-- AMD prices and enable them. Tiers are separate entries; variable services are
-- onRequest. Only seeds when the catalog is still empty.
do $$
begin
  update public.site_settings
  set addons = '[
    {"id":"luggage-12h","name":"Luggage storage (up to 12h, per bag)","description":"Secure luggage storage near the centre so you can explore before check-in or after check-out. Available 8:00-22:00.","priceCents":0,"unit":"per_item","onRequest":false,"enabled":false},
    {"id":"luggage-day","name":"Luggage storage (full day, per bag)","description":"Secure luggage storage for up to 24 hours, per bag. Available 8:00-22:00. Oversized bags (over 23kg) may cost extra.","priceCents":0,"unit":"per_item","onRequest":false,"enabled":false},
    {"id":"airport-sedan","name":"Airport pickup - Sedan (1-3)","description":"Professional driver meets you at arrivals and takes you to your stay. Includes up to 60 min waiting. Book 12h ahead.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"airport-suv","name":"Airport pickup - SUV (1-4)","description":"Professional driver meets you at arrivals. Includes up to 60 min waiting. Book 12h ahead.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"airport-minivan","name":"Airport pickup - Minivan (up to 6)","description":"Professional driver meets you at arrivals. Includes up to 60 min waiting. Book 12h ahead.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"mid-stay-cleaning","name":"Mid-stay cleaning","description":"A fresh clean and linen change partway through your stay.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"toiletries-lav","name":"Premium toiletries - LAV Essential Set","description":"LAV shampoo, hand soap, shower gel and conditioner (475ml). Order before 4:00 PM for same-day delivery.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"grocery-basic","name":"Grocery - Basic Essentials Pack","description":"Bread, milk, eggs, butter, cheese, coffee, tea, yogurt, water, fresh fruit and veg, ready on arrival. Order 12h ahead.","priceCents":0,"unit":"flat","onRequest":false,"enabled":false},
    {"id":"grocery-custom","name":"Grocery - Custom shopping","description":"Send your shopping list and we handle the rest (service fee plus the cost of groceries, billed after with receipts).","priceCents":0,"unit":"flat","onRequest":true,"enabled":false},
    {"id":"kids-equipment","name":"Kids equipment","description":"Cribs, high chairs and more on request for your stay.","priceCents":0,"unit":"per_item","onRequest":false,"enabled":false}
  ]'::jsonb
  where id = 1 and (addons is null or addons = '[]'::jsonb);
end $$;
