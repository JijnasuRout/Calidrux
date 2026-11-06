# Architecture

Calidrux is a single-user desktop app. A local FastAPI server does all the work, and a
native window (pywebview, using the Edge WebView2 engine built into Windows) shows the
interface. Nothing leaves the machine: data lives in one SQLite file.

```mermaid
flowchart LR
    subgraph Window["Desktop window (pywebview / WebView2)"]
        UI["Single-page UI<br/>HTML · CSS · JavaScript · Chart.js"]
    end
    subgraph Server["Local server (FastAPI + uvicorn, 127.0.0.1:8765)"]
        API["REST API<br/>api/app.py · warehouse/routes.py"]
        WH["Warehouse ops<br/>layout · floor map · put-away · expiry"]
        OPT["Optimization<br/>ABC · slotting (MIP) · pick routing (TSP)"]
        LAB["Optimization Lab<br/>Monte Carlo · what-if · sweeps"]
        SVC["Services<br/>inventory · FEFO · audit"]
    end
    DB[("SQLite<br/>%APPDATA%/Calidrux/calidrux.db")]
    ORT["Google OR-Tools"]
    UI <-->|JSON over HTTP| API
    API --> WH & OPT & SVC & LAB
    LAB --> OPT
    WH --> SVC
    OPT --> ORT
    WH & OPT & SVC --> DB
```

## Source layout

```
src/calidrux/
├── main.py                 # starts the server thread and opens the window
├── config.py               # settings + data folder (CALIDRUX_DATA_DIR overrides it)
├── seed.py                 # sample warehouse, stock and pick history
├── api/
│   ├── app.py              # REST routes for inventory, ABC, slotting, picking, audit, settings
│   └── static/             # the UI (no build step)
│       ├── index.html
│       ├── style.css       # base theme (blue & white)
│       ├── app.js          # original screens + view router
│       ├── warehouse.js    # floor map renderer + rack inspector
│       ├── warehouse-ops.js# receive & put-away, expiry board, layout designer
│       ├── overview.js     # Overview dashboard
│       ├── palette.js      # Ctrl+K command palette
│       ├── enhance.js      # picking route map, dropdown pickers, slotting/audit upgrades
│       ├── lab.js/.css     # Optimization Lab: sliders, live what-if charts
│       ├── motion.js/.css  # transitions, sliding indicators, toasts, chart defaults
│       └── warehouse.css
├── analytics/
│   └── lab.py              # Optimization Lab: route Monte Carlo, slotting what-if & sweep (/api/lab/*)
├── warehouse/
│   ├── layout.py           # layout spec, preview, apply (never strands stock)
│   ├── service.py          # floor snapshot, rack detail, expiry board, put-away, moves
│   └── routes.py           # /api/warehouse/*
├── optimization/
│   ├── abc.py              # Pareto / ABC classification
│   ├── slotting.py         # assignment model (OR-Tools SCIP)
│   └── picking.py          # FEFO allocation + TSP routing (OR-Tools RoutingModel)
├── services/
│   ├── inventory.py        # CRUD, receive/transfer/adjust, FEFO, cold-chain checks
│   └── audit.py            # append-only audit log
└── db/
    ├── session.py          # engine, sessions, in-place schema upgrades
    └── models/             # SQLAlchemy models
```

## Data model

```mermaid
erDiagram
    PRODUCT ||--o{ BATCH : "has lots"
    PRODUCT ||--o{ INVENTORY : stocked
    BATCH ||--o{ INVENTORY : "held as"
    LOCATION ||--o{ INVENTORY : holds
    MOVEMENT ||--|{ MOVEMENT_LINE : contains
    PICK_LIST ||--|{ PICK_LINE : contains
    PICK_LINE }o--|| LOCATION : "picked from"
    SLOTTING_RECOMMENDATION }o--|| LOCATION : "move to"
    PRODUCT {
      string sku
      string name
      enum storage_class "ambient | cold"
      decimal unit_cost
      decimal weight_kg
      int pick_frequency_30d
    }
    BATCH {
      string lot_number
      date expiry_date
      enum status "active | quarantine | expired"
    }
    LOCATION {
      string code "A01-B03-L2"
      enum zone_type "ambient | cold"
      int aisle
      int bay
      int level
      float x_coord
      float y_coord
      int capacity_units
      int max_weight_kg
      bool active
    }
    INVENTORY {
      decimal quantity
    }
    WAREHOUSE_LAYOUT {
      int aisles
      int bays_per_aisle
      int levels
      json cold_aisles
    }
    AUDIT_LOG {
      string entity_type
      string action
      json before_state
      json after_state
      string user_name
    }
```

## A receipt, end to end

```mermaid
sequenceDiagram
    actor Op as Operator
    participant UI as Receive screen
    participant API as /api/warehouse
    participant S as warehouse.service
    participant DB as SQLite
    Op->>UI: product, lot, expiry, quantity
    UI->>API: POST /putaway/suggest
    API->>S: filter by zone, weight, space, no-mixing → score
    S-->>UI: ranked slots + reasons
    UI-->>Op: suggestions + animated route from the dock
    Op->>UI: Put away
    UI->>API: POST /receive
    API->>S: check lot/expiry, re-check slot rules
    S->>DB: batch (if new), inventory, movement, audit entries
    S-->>UI: slot code
    UI-->>Op: box flies to the rack, map refreshes
```

## Design decisions

| Decision | Why |
|---|---|
| Local web server + native window | One codebase gives a modern UI and a real desktop app. WebView2 ships with Windows, so no browser engine is bundled (about 180 MB installed, versus about 400 MB for the earlier Qt version). |
| SQLite, offline | Zero setup, a single file to back up, and no network dependency on a warehouse floor. |
| Plain JavaScript, no build step | Anyone can read and change the UI; nothing to compile. |
| OR-Tools | Industrial-grade, free solvers for both the assignment model (MIP) and routing (TSP). |
| Slots are deactivated, not deleted | Movement and pick history keep valid references. |
| In-place schema upgrades | Users keep their data across versions without a migration step. |
| One motion layer (`motion.js`) | Every screen gets the same transitions without duplicating animation code. |

## Testing

`pytest` runs 37 tests in about 3 seconds:

- **Unit:** ABC classification, slotting constraints, the TSP solver.
- **End to end through HTTP:** every read endpoint, ABC, slotting, the pick lifecycle,
  and FEFO never picking expired lots.
- **Warehouse rules:** temperature zones, capacity, no product mixing, lot/expiry checks,
  holds, moves, layout changes blocked by stock, and database upgrades from earlier
  versions.
- **Lab:** reproducible simulations, optimized routes never longer than the baseline, and
  what-if runs that leave data and settings untouched.

GitHub Actions runs the suite on Windows and Linux with Python 3.11 and 3.12.
