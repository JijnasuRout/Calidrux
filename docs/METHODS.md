# Engineering notes — the methods behind Calidrux

Calidrux applies standard industrial engineering and operations research methods to a
pharmaceutical warehouse. This page explains each method, the exact model the code
implements, the assumptions behind it, and where it lives in the source. Everything
below matches the code in `src/calidrux/`.

**Contents**

1. [Warehouse model](#1-warehouse-model)
2. [ABC classification](#2-abc-classification)
3. [Expiry control (FEFO and shelf-life buckets)](#3-expiry-control-fefo-and-shelf-life-buckets)
4. [Put-away: choosing a slot for incoming stock](#4-put-away-choosing-a-slot-for-incoming-stock)
5. [Slotting optimization (assignment model)](#5-slotting-optimization-assignment-model)
6. [Pick routing (travelling-salesman problem)](#6-pick-routing-travelling-salesman-problem)
7. [Layout changes that never strand stock](#7-layout-changes-that-never-strand-stock)
8. [Compliance-minded design](#8-compliance-minded-design)
9. [KPIs](#9-kpis)
10. [Limitations and next steps](#10-limitations-and-next-steps)

---

## 1. Warehouse model

The building is a grid of **aisles × bays × levels**. Each `(aisle, bay, level)` is one
storage **slot** (`Location`), and the levels at one `(aisle, bay)` form a **rack**.

| Property | Meaning |
|---|---|
| `zone_type` | `ambient` (15–25 °C) or `cold` (2–8 °C). Whole aisles are designated cold rooms. |
| `capacity_units` | How many units the slot holds. |
| `max_weight_kg` | Weight limit per slot. |
| `x_coord, y_coord` | Floor position in metres: $x = s_a \cdot \text{aisle}$, $y = w_b \cdot \text{bay}$, where $s_a$ is aisle spacing and $w_b$ is bay width. The dock and dispatch point is at the origin. |

Stock is held as `Inventory(product, batch, location, quantity)`, so the same lot can sit
in several slots and the system always knows exactly where every unit is.

*Source: `warehouse/layout.py`, `db/models/`.*

---

## 2. ABC classification

ABC analysis is a Pareto classification: a small share of SKUs usually carries most of the
usage value, and those SKUs deserve the best locations and the tightest control.

For each SKU $i$, the usage value over the last 30 days is

$$
\text{UV}_i = f_i \cdot c_i
$$

where $f_i$ is the pick frequency (picks per 30 days) and $c_i$ is the unit cost.
SKUs are sorted by $\text{UV}_i$ in descending order and the cumulative share is computed.
A SKU's class depends on the cumulative share **before** it is added:

$$
P_i = \frac{\sum_{j < i} \text{UV}_j}{\sum_j \text{UV}_j}, \qquad
\text{class}_i =
\begin{cases}
A & P_i < \tau_A \\
B & \tau_A \le P_i < \tau_B \\
C & \text{otherwise}
\end{cases}
$$

The defaults are $\tau_A = 0.80$ and $\tau_B = 0.95$, and both can be changed in Settings.
Using the share *before* the item matters: with the share *after*, a single dominant SKU
could cross 80% by itself and be wrongly classed as B. A test covers this case.

Classes feed the slotting cost (A items are pulled toward the dock) and the suggested zone
(A = golden zone near dispatch, B = mid zone, C = bulk/rear).

*Source: `optimization/abc.py`.*

---

## 3. Expiry control (FEFO and shelf-life buckets)

**FEFO (first-expired, first-out).** When a pick list is created, each line is filled
from the lots with the **earliest expiry date first**. Only lots that meet all of these
conditions are eligible:

- status `active` (not on quality hold), and
- expiry date ≥ today (an expired lot is never picked, even if nobody has put it on hold yet), and
- held in an active slot.

When two lots expire on the same day, the smaller quantity is taken first, which clears
partial slots.

**Shelf-life buckets.** Every stock line is classified by days left,
$d = \text{expiry} - \text{today}$:

| Bucket | Rule | Colour |
|---|---|---|
| Expired | $d < 0$ or status `expired` | red |
| Critical | $0 \le d \le 30$ | orange |
| Warning | $31 \le d \le 90$ | amber |
| Watch | $91 \le d \le 180$ | light blue |
| OK | $d > 180$ | blue |

The floor map colours each shelf level by the **most urgent** bucket on it. The expiry
board shows units and **value at risk** (quantity × unit cost) per bucket.

**At receiving:** a new lot that is already expired is refused. If a lot number is already
on file, its expiry date is locked to the recorded one, so the same lot can't end up with
two different dates. Lots on quality hold can't be received into.

*Source: `services/inventory.py` (`allocate_fefo`), `warehouse/service.py`.*

---

## 4. Put-away: choosing a slot for incoming stock

Put-away is solved with a transparent **rule-based scoring heuristic**: hard rules filter
the candidate slots, then a weighted score ranks the ones that remain. This runs on every
receipt and needs to be instant and explainable, so each suggestion shows its reasons.

**Hard rules (a slot is only a candidate if all hold):**

1. The temperature zone matches the product (cold chain → cold room only).
2. Product unit weight ≤ the slot's weight limit.
3. Free capacity ≥ the received quantity.
4. **No mixing:** the slot holds nothing, or only this same product. Mixing different
   products in one slot is a common cause of picking errors, and pharma distribution
   practice avoids it.

**Score (lower is better):**

$$
S = \underbrace{\frac{d}{d_{\max}}\,(0.35 + 1.3\,v)}_{\text{travel}}
  + \underbrace{\frac{\ell - 1}{L - 1}\,(0.15 + 0.6\,v)}_{\text{height}}
  - \underbrace{B}_{\text{consolidation}}
$$

- $d$ is the slot's distance from the dock and $d_{\max}$ is the farthest compatible slot.
- $v = f / f_{\max}$ is the product's **velocity** (pick frequency relative to the fastest mover).
- $\ell$ is the slot's level and $L$ is the top level. Low levels form the "golden zone",
  between waist and shoulder height.
- $B = 1.2$ if the slot already holds **the same lot**, $0.7$ for the same product,
  $0.25$ for the same rack, and $0$ otherwise.

The effect: fast movers land close to the dock and on low levels, slow movers go deeper,
and stock consolidates instead of scattering. If no single slot can take the whole receipt,
the system says so and suggests splitting it into pallets.

*Source: `warehouse/service.py` (`suggest_putaway`, `receive_into_slot`).*

---

## 5. Slotting optimization (assignment model)

Slotting re-plans **which slot each product should occupy**. It is modelled as a linear
assignment problem and solved exactly with Google OR-Tools (SCIP mixed-integer solver).

**Decision variable:** $x_{ij} = 1$ if product $i$ is assigned to slot $j$.

$$
\min \sum_i \sum_j c_{ij}\,x_{ij}
\quad \text{s.t.} \quad
\sum_j x_{ij} = 1 \;\; \forall i, \qquad
\sum_i x_{ij} \le 1 \;\; \forall j, \qquad
x_{ij} \in \{0, 1\}
$$

**Cost of placing product $i$ in slot $j$:**

$$
c_{ij} = w_{\text{abc}}\, m_i\, d_j
       + w_{\text{pick}}\, 0.1\, f_i\, d_j
       + w_{\text{weight}}\, g_i\, \ell_j
       + w_{\text{reloc}}\, r_{ij}
$$

| Symbol | Meaning |
|---|---|
| $d_j$ | distance from slot $j$ to dispatch |
| $m_i$ | ABC multiplier: A = 3.0, B = 1.5, C = 0.5 |
| $f_i$ | pick frequency |
| $g_i$ | unit weight (kg) |
| $\ell_j$ | slot level, so heavy items are pushed down |
| $r_{ij}$ | relocation cost: 0 if already there, 10 if it must move, 5 if it currently has no slot |
| $w_\ast$ | weights, editable in Settings (defaults 1.0, 0.5, 0.3, 0.2) |

**Feasibility.** Infeasible pairs get a prohibitive cost $M = 10^6$:

- cold product in an ambient slot, or the reverse;
- product heavier than the slot's weight limit;
- product with a lot on **quality hold**, which must not be moved while under investigation.

Any assignment that could only be made at cost $M$ is **discarded, never recommended**.
Each recommendation goes through an accept/reject step, and accepting one performs an
audited stock transfer.

*Source: `optimization/slotting.py`.*

---

## 6. Pick routing (travelling-salesman problem)

A pick list visits a set of slots and returns to the dock, so finding the order is a
**travelling-salesman problem (TSP)**.

- **Graph:** the dock plus every slot on the list. Edge cost is the Euclidean distance
  between floor coordinates in centimetres (OR-Tools requires integer costs).
- **Solver:** OR-Tools `RoutingModel`. It builds a first tour with `PATH_CHEAPEST_ARC`.
  For tours with more than 8 stops it then improves the tour with **Guided Local Search**,
  limited to 2 seconds.
  - *Why the cut-off:* Guided Local Search never stops by itself and always runs until its
    time limit, even on a 3-stop tour. An earlier version always used a 10-second limit,
    so every pick list took 10 seconds to create.
- **Baseline:** the naive route visits stops in aisle → bay → level order. Every pick list
  stores both distances, so the saving is measurable.

With the sample data, optimized routes are typically **15–30% shorter** than the
aisle-by-aisle baseline. The Picking screen draws both routes on the floor plan.

*Source: `optimization/picking.py`.*

---

## 7. Layout changes that never strand stock

The layout designer lets you resize the building. Applying a new layout reconciles the
new grid with the slots that already exist:

| Situation | Action |
|---|---|
| Position exists in the new grid and has a slot | keep the slot (same code, stock and history); update zone, capacity and coordinates |
| Position is new | create a slot |
| Slot is outside the new grid and **empty** | **deactivate** it (kept for audit history, never deleted) |
| Slot is outside the new grid and **holds stock** | **block** the whole change |
| Slot holds stock and would switch between cold and ambient | **block** the whole change |
| Slot holds more than its new capacity | allow, with a warning |

The preview shows exactly what will be added, kept, removed or blocked before anything is
saved. The change runs in a single database transaction.

*Source: `warehouse/layout.py`.*

---

## 8. Compliance-minded design

Calidrux is a prototype, not a validated GxP system, but it follows the habits such a
system needs:

- **Audit trail:** every write records before and after state, user and time. The log is
  append-only.
- **Quality hold (quarantine):** held lots can't be picked, received into or re-slotted.
- **Cold chain:** zone checks apply to receiving, transfers, put-away and slotting.
- **No silent data loss:** slots are retired, never deleted, and older databases are
  upgraded in place on startup.

---

## 9. KPIs

| KPI | Definition |
|---|---|
| Slot utilization | occupied slots ÷ active slots |
| Capacity utilization | units stored ÷ total slot capacity (shown separately for the cold room) |
| Value at risk | Σ quantity × unit cost for expired and ≤ 30-day lots |
| Picks per hour | completed pick lines ÷ (total pick duration in hours) |
| Distance savings | $(\bar d_{\text{baseline}} - \bar d_{\text{optimized}}) \,/\, \bar d_{\text{baseline}}$ |

---

## 10. Limitations and next steps

- Distances are straight-line between slot coordinates. Real travel follows aisles, so a
  rectilinear or graph-based distance would be more accurate.
- The slotting model is one product per slot and doesn't consider affinity, meaning
  products that are often picked together. Correlated slotting and order batching are the
  largest gains reported in the warehousing literature.
- There's no serial-number (unit-level) tracking yet; DSCSA and EU FMD require it.
- Single user, no electronic signatures. A validated system would add roles and
  21 CFR Part 11-style sign-offs.
