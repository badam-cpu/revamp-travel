---
target: Home page (client/src/pages/Home.tsx)
total_score: 19
max_score: 28
na_heuristics: 7,9,10
p0_count: 0
p1_count: 2
timestamp: 2026-09-15T15-58-36Z
slug: client-src-pages-home-tsx
---
# Critique — Home (client/src/pages/Home.tsx) · Mode: Persuade

Method: single-context (degraded — no sub-agents; browser unavailable). Detector: 0 findings.

## Design Health Score — 19/28 (Acceptable, 68%); n/a: 7,9,10
1 Visibility 3 · 2 Match 2 · 3 Control 3 · 4 Consistency 2 · 5 Error Prevention 3 · 6 Recognition 2 · 8 Aesthetic 4

## Design Specificity: HIGH — unmistakably Revamp (re. watermark, apricot/basalt, editorial voice). Not generic. The flaw is two naming systems that never reconcile.

## Priority Issues
- [P1] Category cards don't carry the canonical category name. Nav says Stay/Eat/Tour/Experience; tiles say "Taste the landscape" etc. No mapping. Fix: add the system word as the tile kicker (e.g. "EAT — Tables, cellars & courtyards" + "Taste the landscape").
- [P1] Twin CTAs "Open the field guide" (/explore) vs "Open the field atlas" (/map) — near-identical, different destinations. Plus "Field note 001" = 3 "field" objects. Fix: differentiate (map CTA -> "Open the map").
- [P2] Home.tsx:132 map-list price uses static listing.priceLabel, ignoring the new currency switcher; featured cards convert, list doesn't. Fix: useCurrency().format.
- [P2] CTA lexicon scattered (5 metaphors, no repeated primary verb). Fix: one primary verb for "browse", reused.
- [P3] Search bar + "Find your way" + "Four ways in" = diffuse primary entry.

## Persona flags: Jordan can't map nav Eat -> "Taste the landscape"; Riley: AMD toggle leaves map-list prices in USD; Casey: long poetic titles wrap on mobile.

## Minor: native dd.mm.yyyy date input; decorative category alt correct.
