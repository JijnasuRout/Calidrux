# Changelog

All notable changes to Calidrux. Versions follow [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-11-06 · Optimization Lab

### Added
- **Optimization Lab:** a new screen of slider-driven what-if analyses, with an impact
  strip summarising the results in dollars and percentages.
  - **Expiry write-off forecast:** FEFO depletion simulation per lot at an adjustable
    demand, units per pick and horizon. Shows projected write-off ($, units, % of stock),
    a cumulative curve, the top products at risk, and lots to act on with suggested
    actions.
  - **Route savings simulator:** Monte Carlo of up to 400 frequency-weighted orders, each
    routed by OR-Tools vs aisle-by-aisle. Shows the savings histogram, a scatter, p10,
    median and p90, and an ROI calculator (orders/day, walking speed, labor rate,
    operating days → $, hours, km and FTEs per year).
  - **Slotting trade-offs:** live re-solve of the assignment model with four weight
    sliders. Shows travel before vs after, distance by ABC class, a proposed move list, a
    relocation-cost sweep plotting the moves vs savings curve, and "Use these weights".
  - **ABC sensitivity:** live Pareto re-classification and the SKUs that change class.
- Custom animated sliders: filled track, spring thumb, value badge.
- New API: `POST /api/lab/routes`, `/api/lab/slotting`, `/api/lab/slotting/sweep`.
  What-ifs run in rolled-back savepoints and restore settings.
- `solve_tsp(..., improve=False)` for fast bulk simulation.
- 4 new tests (37 in total). Documentation: Engineering notes §11–13, Lab GIF and
  screenshots.

## [0.3.0] — 2026-11-06 · Motion & polish

### Added
- **Overview dashboard:** greeting, KPI tiles, a live mini floor map, expiry outlook with
  value at risk, an "Act next" list of urgent lots, zone fill and recent activity.
- **Command palette (Ctrl+K or /):** jump to any screen, product, lot or rack from the
  keyboard.
- **Pick-route map:** each pick list is drawn on the floor plan with numbered stops, an
  animated walker and the aisle-by-aisle baseline for comparison. Pick lists can now have
  several lines, chosen from product dropdowns.
- **App-wide motion:** launch splash, staggered screen entrances, skeleton loading, a
  sliding sidebar indicator, sliding tab and segment indicators, count-up numbers, spring
  toasts with progress bars, and animated charts. Reduced-motion settings are respected.
- **Friendlier forms:** raw product, lot and slot ID boxes are now searchable dropdowns.
- Slotting: "Accept all", a progress bar while solving, and clearer move display.
- Audit log: search, entity filter and relative times.
- Sample data now includes routed pick history, so the metrics have data from the start.
- Documentation: methods notes, architecture, user guide, demo GIFs.

### Fixed
- **FEFO could pick an expired lot.** Allocation skipped held lots but not lots past their
  expiry date. Expired lots are now never allocated.
- **Slotting could recommend infeasible moves** (for example, moving a product with a lot
  on quality hold) at the 10⁶ penalty cost. Those assignments are now discarded.
- **ABC results showed "0" as every product name** (a pandas `row.name` mix-up).
- Audit notes showed quantities like "238.0 units".

## [0.2.0] — 2026-11-06 · Warehouse operations

### Added
- **Floor map:** racks coloured by expiry, occupancy or zone, search by SKU, product or
  lot, zoom, and a dedicated cold-room zone.
- **Rack inspector:** animated front view with cartons per lot, a lot card with expiry
  countdown, and move, hold/release and find-everywhere actions.
- **Receive & put away:** ranked slot suggestions (zone, capacity, no mixing,
  consolidation, velocity × distance) with an animated route from the dock.
- **Expiry board:** shelf-life buckets with value at risk, a 12-month timeline and a card
  board.
- **Layout designer:** configurable aisles, bays, levels, cold aisles, capacity and
  spacing with a live preview. It refuses changes that would strand stock, and retires
  slots instead of deleting them.
- Automatic in-place database upgrades; a richer sample warehouse (192 slots, about 60
  lots).

## [0.1.0] — 2026-11-06 · First public release

- FastAPI + pywebview desktop app with inventory, ABC analysis, OR-Tools slotting, FEFO
  picking with TSP routing, and an audit log.
- Blue-and-white theme.
- Fixed pick routing always running the full 10-second Guided Local Search budget.
- Removed the unused PySide6 UI. Added a CI workflow, an MIT license and end-to-end API
  tests.
