---
target: home page hero section
total_score: 17
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 2
timestamp: 2026-10-11T14-43-15Z
slug: client-src-pages-home-tsx
---
# Critique: Home hero (client/src/pages/Home.tsx:127-152 + SearchBar.tsx)
Method: dual-agent (A: afd58d58e56bb4992 · B: abe4cca7525f06fcc)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | 10-photo slideshow, no position/indicator; WHEN field unlabeled purpose |
| 2 | Match real world | 2 | Static "Morning road to Geghard" caption over 10 unrelated photos; ↓ arrow leaves page |
| 3 | User control | 2 | Auto-advance, no pause (WCAG 2.2.2) |
| 4 | Consistency | 2 | 3 labels → /explore; Search button rounded-[0px] |
| 5 | Error prevention | 2 | Past dates allowed |
| 6 | Recognition | 3 | Clear labels |
| 7 | Flexibility | n/a | Persuade surface |
| 8 | Aesthetic/minimal | 2 | ~18 targets, 3 orange competitors before Search |
| 9 | Error recovery | 2 | Empty submit → unfiltered /explore silently |
| 10 | Help | n/a | Persuade surface |
| Total | | 17/32 (53%) | Acceptable |

Specificity: half-authored — "re." pattern, palette, subcopy are Revamp; headline "Stay. Experience. Repeat." is category-generic and omits Eat/Tour/Visit. Detector: 0 findings in Home.tsx/SearchBar.tsx; 2 index.css findings off-hero (false positives here). Overlay unavailable (in-app browser blocks localhost).

Priority issues:
- [P0] Hardcoded caption "Field note 001 / Morning road to Geghard" (Home.tsx:148) over 10 rotating photos; only slide 0 has (generic) alt. Fix: per-slide {src,caption,alt} in site_settings; hide caption when none. → harden
- [P1] Search below/at fold (bar y=758 @900px; mobile Search ~y1000); orange spread over header pill "Open the field guide", hero link, chat FAB — all → /explore. Fix: shorten hero (min-h-[720px], pb-28), demote header pill on Home, link "Browse all of Armenia →". → layout
- [P1] A11y: no focus on search cells (SearchBar.tsx:39,57,65 ring-0); 10px eyebrow tuff ~2.3:1, labels ~2.8:1; slideshow no pause. → audit
- [P2] Mobile: chat FAB covers WHERE; 317px stacked search; 10 eager full-size JPEGs no srcset. Fix: hide FAB while hero search visible; mobile "Where to?" sheet; lazy slides + fetchpriority on first. → adapt
- [P2] Generic headline; native dd.mm.yyyy date input, no min. Fix: AvailabilityCalendar popover "Add dates", min today; Armenia-specific headline test. → clarify / polish

Personas: Jordan — 3 synonyms for /explore, categories unnamed, caption doubt. Riley — past dates, silent check-out drop, empty submit, no focus. Casey — FAB over WHERE, Search below fold, 10 full photos on cellular.

Minor: caption overlaps bar by 3px; "re." behind orange "Experience."; admin heroHeadline loses orange accent; eyebrow uses tuff (non-core tint).
