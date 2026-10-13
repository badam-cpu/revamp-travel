---
target: operator bookings timeline
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-10-13T08-40-07Z
slug: client-src-components-operatorbookingstimeline-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Fetch failure looks like "no bookings"; no sync freshness; month menu stuck on "Today" |
| 2 | Match System / Real World | 3 | Unlabelled "14/21"; ISO dates in tooltips |
| 3 | User Control and Freedom | 2 | Block/price only via Calendar tab |
| 4 | Consistency and Standards | 2 | 3 availability formats; orange 5 meanings; bar heights vary |
| 5 | Error Prevention | 2 | Can open Direct booking under booked/synced days |
| 6 | Recognition Rather Than Recall | 2 | Header + legend scroll away |
| 7 | Flexibility and Efficiency | 1 | No keyboard, drag-select, bulk actions, search |
| 8 | Aesthetic and Minimalist Design | 2 | Price repeated in every cell; instruction paragraph |
| 9 | Error Recovery | 1 | Silent fetch errors; raw e.message toasts |
| 10 | Help and Documentation | 3 | Legend + copy, prose not affordance |
| **Total** | | **20/40** | **Acceptable** |

## Design Specificity Verdict
~70% category-interchangeable (Hostaway/Guesty). Product-specific: hotel→type→room hierarchy, ֏ prices, direct booking. Brand breaks: hard-coded blue-500 hatch; square corners on select/chips/grid.
Detector: CLI 0 findings (blind to Tailwind arbitrary classes). Browser: 2,351 flags — undersized-ui-text 2,347 (9–10px), low-contrast 8 (apricot 3.0:1), tiny-text 1, flat-type-hierarchy 1, cramped-padding/edge-flush-cards/layout-transition = false positives. Measured: basalt/40 2.46:1, basalt/45 2.81:1 (missed by detector).

## Priority Issues
- [P1] Grid not keyboard/screen-reader operable: 1,080 non-focusable div cells, no grid semantics, no focus rings on bars/type toggles. Fix: role=grid + roving tabindex + arrow keys + aria-labels. (/impeccable harden)
- [P1] Inverted hierarchy: 20px room bars, color-only status, ~2.5:1 contrasts, 9–10px numbers; Airbnb hatch dominates. Fix: near-full-height bars with status glyph, price only in free cells, ≥11px, ≥basalt/60, quiet palette hatch. (/impeccable layout, typeset)
- [P1] Window starts today; no half-day check-in/out offsets; clipped bars look like starts. Fix: start 3–7 days back, sticky Today, half-cell offsets, continues edge. (/impeccable layout)
- [P2] Header/legend not sticky; silent fetch failure; no sync freshness. Fix: sticky header, branded error + Retry, per-row "synced Xh ago" with stale warning. (/impeccable harden)
- [P2] Orange overloaded (today, override, month, hover +, awaiting, sold out, unassigned). Fix: orange = needs attention only; Full in bold basalt; override dot; neutral today tint. (/impeccable colorize)

## Persona Red Flags
Alex: no keyboard/drag-select; block/price requires tab switch; month menu resets.
Sam: direct booking keyboard-unreachable; color-only status; 9px 2.5:1 text; no grid semantics.
Ani (12-room guesthouse owner): ~16 rows push dates away; can't see in-house vs arriving; no arrivals/departures/cleaning view; Aha FAB covers cells; mobile shows ~2 days.

## Minor Observations
Weekday slice(0,2) breaks hy/ru; unbounded bookings query; no virtualization; bare Loading…; type filter appears conditionally; ISO tooltip dates; "Scroll right" copy as missing affordance.

## Questions to Consider
Lead with Revamp bookings + today's moves, external blocks as background? One Book/Block/Price popover on drag? Today + 7-day room board as default, 180-day strip secondary?
