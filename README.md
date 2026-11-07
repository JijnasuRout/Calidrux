<p align="center">
  <img src="docs/brand/banner.png" alt="Calidrux — pharmaceutical warehouse optimizer" width="100%">
</p>

<p align="center">
  <a href="https://github.com/JijnasuRout/Calidrux/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JijnasuRout/Calidrux/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Python 3.11+" src="https://img.shields.io/badge/python-3.11%2B-1B3A94?style=flat-square&logo=python&logoColor=white">
  <img alt="OR-Tools" src="https://img.shields.io/badge/optimization-OR--Tools-1B3A94?style=flat-square">
  <img alt="FastAPI" src="https://img.shields.io/badge/API-FastAPI-1B3A94?style=flat-square&logo=fastapi&logoColor=white">
  <img alt="Offline" src="https://img.shields.io/badge/runs-offline-1B3A94?style=flat-square">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-1B3A94?style=flat-square"></a>
</p>

<p align="center">
  <b>See every unit of medicine in your warehouse: where it is, how fresh it is,<br>
  and the fastest way to put it away and pick it.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="docs/METHODS.md">Engineering notes</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/media/tour.gif" alt="Calidrux tour: cover sheet, floor plan, rack elevation, expiry schedule and search" width="100%">
</p>

## Optimization lab: move a slider, see the impact

Every number recomputes from the live warehouse as you drag. It's what-if only, so nothing
in the warehouse changes.

<p align="center"><img src="docs/media/optimization-lab.gif" alt="Optimization lab: sliders driving live expiry, route, slotting and ABC analyses" width="100%"></p>

| Panel | Sliders | What you get |
|---|---|---|
| **Expiry write-off forecast** | demand ×, units per pick, horizon | FEFO depletion simulation per lot, projected write-off in $ and units, lots to act on with a suggested action |
| **Route savings simulator** | orders, lines per order · orders/day, walking speed, labor $/h, days/year | Monte Carlo of up to 400 orders, each routed by OR-Tools vs aisle-by-aisle: savings distribution, scatter, and **annual labor $, hours, km and FTEs saved** |
| **Slotting trade-offs** | four cost weights | Re-solves the assignment model live and measures picker travel before vs after; sweeps relocation cost to map the **moves vs savings trade-off curve** |
| **ABC sensitivity** | A and B cut-offs | Live Pareto chart and class counts, and which SKUs change class |

With the sample warehouse, optimized routes are about **20% shorter** for 8-stop orders and
about **29% shorter** for 16-stop orders. At 1,500 orders a day that is roughly **$72k a year**
of picker time. Re-slotting cuts expected picker travel by about **46–48%**, needing 10–16
relocations depending on the relocation cost. The models are explained in
[Engineering notes §11–13](docs/METHODS.md#11-expiry-write-off-forecast).

## Why Calidrux

A pharmaceutical warehouse isn't just shelves of boxes. Every lot has an **expiry date**,
some products must stay at **2–8 °C**, suspect lots go on **quality hold**, and every move
has to be **traceable**. Calidrux is a desktop warehouse system built around those rules,
with industrial engineering methods doing the planning:

- a **live floor map** that shows what is on every shelf and how close it is to expiry,
- **put-away suggestions** that respect temperature zones, capacity and lot rules,
- **FEFO picking** with **routes optimized by OR-Tools**, measured against a naive baseline,
- **ABC classification** and **slotting optimization** to keep fast movers close to the dock.

It runs fully offline on a Windows laptop, and one click loads a realistic sample warehouse.

## Design: a warehouse drawing set

Calidrux doesn't look like a typical web dashboard. It's laid out like the CAD drawing set
an engineer would hand a warehouse contractor: every screen is a numbered **sheet** on a
white page, with a zoned border, a **title block** (sheet number, scale, revision, drawn by)
and line work in one cobalt ink.

- **Sheet index instead of a menu:** G-001 Cover sheet, W-101 Floor plan, W-102 Receiving,
  W-103 Expiry schedule, A-201 Optimization lab, R-301 Inventory register, and so on.
- **The floor plan is drawn, not decorated:** aisle grid bubbles, a dimension line for the
  building, a scale bar, a north arrow, the dock door swing, and a red **revision triangle**
  on any rack holding expired stock. When it opens, it plots in like a pen plotter. That's
  the only decorative animation in the app.
- **Mark-up colours mean something:** red is a redline (expired, a problem), yellow is a
  highlighter (expiring soon), blue is the drawing itself. Nothing else gets colour.
- **Typography:** [B612](https://github.com/polarsys/b612), the typeface Airbus designed
  for cockpit displays, bundled so it works offline.
- **Sliders are rulers** with tick marks, and the cover sheet carries general notes and a
  revision history built from the audit log.

All colours, fonts, stroke weights and corner radius live in one file,
[`theme.css`](src/calidrux/api/static/theme.css). **Want to change something?**
[docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) is a hands-on guide, from recolouring the app
to adding your own sheet and API endpoint.

## Highlights

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>W-101 · Floor plan</h3>
      Every aisle, rack and shelf level, coloured by the earliest expiry on it (or by fill
      level or temperature zone). Type a SKU, product or lot and the matching racks light up.
    </td>
    <td width="50%" valign="top">
      <h3>Rack elevation</h3>
      Click a rack to open its front elevation at 1:25, with every carton drawn on its
      shelf. Click a carton to see the lot's expiry countdown, then move it, hold it, or find
      it everywhere.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>W-102 · Receiving & put-away</h3>
      Calidrux ranks the slots that can take a delivery (right zone, enough space, no product
      mixing, same-lot consolidation, fast movers near the dock) and draws the route from
      the dock door.
    </td>
    <td valign="top">
      <h3>W-103 · Expiry schedule</h3>
      Every lot grouped as expired, ≤ 30, 31–90, 91–180 and 180+ days, with value at risk, a
      12-month timeline and one-click quality holds.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>A-204 · Pick routes</h3>
      FEFO lot selection plus a travelling-salesman route from OR-Tools, drawn on the floor
      plan next to the aisle-by-aisle route. Sample routes are typically 15–30% shorter.
    </td>
    <td valign="top">
      <h3>W-104 · Layout</h3>
      Set aisles, bays, levels and cold rooms with a live preview. Changes that would strand
      stock are blocked, and retired slots are kept for audit history.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>A-202, A-203 · ABC & slotting</h3>
      Pareto classification by usage value, and an assignment model (OR-Tools SCIP) that
      places each product in its lowest-cost slot within cold-chain, quarantine and weight
      limits.
    </td>
    <td valign="top">
      <h3>A-201 · Optimization lab</h3>
      Sliders drive live what-if analyses: expiry write-off forecast, Monte Carlo route
      ROI in $/year, a slotting trade-off curve and ABC sensitivity.
    </td>
  </tr>
  <tr>
    <td valign="top" colspan="2">
      <h3>G-001 · Cover sheet</h3>
      Project data, a key plan of the whole floor, an inventory schedule, general notes
      written from live numbers, and a revision history from the append-only audit trail.
      <kbd>Ctrl</kbd>+<kbd>K</kbd> finds any sheet, lot or rack.
    </td>
  </tr>
</table>

## See it in action

**Receiving:** pick the product and quantity, get ranked slots with reasons, and watch the
delivery's route drawn from the dock to its shelf.

<p align="center"><img src="docs/media/receive.gif" alt="Receiving and put-away" width="88%"></p>

**Pick routing:** FEFO chooses the lots, OR-Tools orders the stops, and the red dashed line
is the aisle-by-aisle route it beats.

<p align="center"><img src="docs/media/pick-route.gif" alt="Optimized pick route" width="88%"></p>

<details>
<summary><b>More screenshots</b></summary>
<br>
<table>
  <tr>
    <td><img src="docs/screenshots/overview.png" alt="Cover sheet"><p align="center">G-001 Cover sheet</p></td>
    <td><img src="docs/screenshots/floor-map.png" alt="Floor plan"><p align="center">W-101 Floor plan</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/rack-inspector.png" alt="Rack elevation"><p align="center">Rack elevation</p></td>
    <td><img src="docs/screenshots/expiry-board.png" alt="Expiry schedule"><p align="center">W-103 Expiry schedule</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/layout-designer.png" alt="Layout"><p align="center">W-104 Layout</p></td>
    <td><img src="docs/screenshots/command-palette.png" alt="Find a sheet"><p align="center">Find a sheet, lot or rack (Ctrl+K)</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/pick-route.png" alt="Pick routes"><p align="center">A-204 Pick routes</p></td>
    <td><img src="docs/screenshots/abc-analysis.png" alt="ABC analysis"><p align="center">A-202 ABC analysis</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/lab-expiry.png" alt="Lab: expiry forecast"><p align="center">A-201 Lab: expiry write-off forecast</p></td>
    <td><img src="docs/screenshots/lab-slotting.png" alt="Lab: slotting trade-offs"><p align="center">A-201 Lab: slotting trade-off curve</p></td>
  </tr>
</table>
</details>

## How it works

| Problem | Method | Details |
|---|---|---|
| Which SKUs matter most? | ABC / Pareto on usage value $f_i \cdot c_i$ | [Notes §2](docs/METHODS.md#2-abc-classification) |
| Which lot ships first? | FEFO; expired and held lots are never picked | [Notes §3](docs/METHODS.md#3-expiry-control-fefo-and-shelf-life-buckets) |
| Where should a delivery go? | Hard rules + weighted score (velocity × distance, height, consolidation) | [Notes §4](docs/METHODS.md#4-put-away-choosing-a-slot-for-incoming-stock) |
| Where should each product live? | Linear assignment model, solved exactly with OR-Tools (SCIP) | [Notes §5](docs/METHODS.md#5-slotting-optimization-assignment-model) |
| In what order to pick? | Travelling-salesman problem, OR-Tools routing with Guided Local Search | [Notes §6](docs/METHODS.md#6-pick-routing-travelling-salesman-problem) |
| Can the layout change safely? | Grid reconciliation that blocks any change stranding stock | [Notes §7](docs/METHODS.md#7-layout-changes-that-never-strand-stock) |
| How much will expire unsold? | FEFO depletion simulation at a forecast demand rate | [Notes §11](docs/METHODS.md#11-expiry-write-off-forecast) |
| What is route optimization worth? | Monte Carlo over sampled orders → labor $/year | [Notes §12](docs/METHODS.md#12-route-savings-simulation-monte-carlo) |
| How many moves are worth making? | Parametric sweep of the slotting model | [Notes §13](docs/METHODS.md#13-slotting-trade-off-sweep) |

The full write-up, with formulas, assumptions and limitations, is in
**[docs/METHODS.md](docs/METHODS.md)**.

## Quick start

Requires **Windows 10/11** and **Python 3.11+**.

```powershell
git clone https://github.com/JijnasuRout/Calidrux.git
cd Calidrux
python -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\calidrux
```

The app opens in its own window and loads a sample warehouse on first launch: 20 SKUs,
about 60 lots, and 6 aisles × 8 bays × 4 levels (192 slots) including a cold room. If the
window can't open, Calidrux falls back to `http://127.0.0.1:8765` in your browser.

<details>
<summary><b>macOS / Linux, tests, and building a Windows installer</b></summary>

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
calidrux          # run the app
pytest            # 37 tests, about 3 seconds
```

Build a Windows app and installer:

```powershell
pip install -e ".[build]"
python installer\generate_icon.py
.\scripts\build_installer.ps1               # setup wizard (needs Inno Setup)
.\scripts\build_installer.ps1 -PortableOnly # portable zip only
```

| Output | Path |
|---|---|
| Standalone app | `dist\Calidrux\Calidrux.exe` |
| Setup wizard | `dist\installer\Calidrux-Setup-0.5.0.exe` |
| Portable zip | `dist\installer\Calidrux-Portable-0.5.0.zip` |

Data is stored in `%APPDATA%\Calidrux\` (or `~/.calidrux/Calidrux/`, or `CALIDRUX_DATA_DIR`
if set). Databases from earlier versions are upgraded automatically.
</details>

## Tech stack

| Layer | Technology |
|---|---|
| Optimization | Google OR-Tools (SCIP MIP for slotting, RoutingModel for TSP), pandas |
| Backend | Python 3.11+, FastAPI, uvicorn, SQLAlchemy 2, SQLite |
| Interface | HTML, CSS, JavaScript (no framework, no build step), Chart.js |
| Desktop | pywebview with Edge WebView2, PyInstaller, Inno Setup |
| Quality | pytest (37 tests), GitHub Actions on Windows and Linux |

More detail, including diagrams of the components, data model and request flow, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Roadmap

- [ ] GS1 barcode scanning at receiving and picking
- [ ] User accounts with roles and electronic sign-off for holds and releases
- [ ] Serial-number (unit-level) tracking for DSCSA / EU FMD
- [ ] Order batching and correlated (affinity) slotting
- [ ] Aisle-aware travel distances instead of straight lines

Calidrux is the warehouse layer of a larger end-to-end pharmaceutical supply chain project,
which will also cover manufacturing scheduling and hospital delivery routing.

## Author

**Jijnasu Prakash Rout** — Industrial Engineering, Purdue University ·
[LinkedIn](https://www.linkedin.com/in/jijnasu-rout-30b6b7358)

## License

[MIT](LICENSE)
