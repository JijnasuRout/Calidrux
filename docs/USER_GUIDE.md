# User guide

A tour of every screen. On first launch Calidrux loads a sample warehouse, so everything
below works straight away.

The app is laid out as a drawing set, so each screen is a numbered **sheet** (G-001, W-101
and so on) listed in the sheet index on the left. The title block in the bottom-right
corner of each sheet shows its number, scale and revision. To change the look or add your
own sheets, see [CUSTOMIZING.md](CUSTOMIZING.md).

> **Tip:** press <kbd>Ctrl</kbd> + <kbd>K</kbd> (or <kbd>/</kbd>) anywhere to search
> sheets, products, lots and racks.

## G-001 Cover sheet

The first sheet: project data (units stored, stock value, slot and cold-room use), a key
plan of the floor, an inventory schedule by expiry bucket, general notes written from the
live numbers, the sheet index and a revision history built from the audit log.

![Cover sheet](screenshots/overview.png)

## W-101 Floor plan

A top-down plan of the warehouse.

- Each tile is a **rack**, and the bars inside it are its **shelf levels**.
- **Expiry** mode colours each shelf by its most urgent lot: red = expired,
  orange-red = ≤ 30 days, yellow highlighter = 31–90, light blue = 91–180, blue = later.
  A red triangle on a rack's corner means it holds expired stock.
- **Occupancy** mode shows how full each shelf is; **Zones** highlights the cold room.
- Type in the search box to find a SKU, product name or lot. The matching racks are
  outlined and everything else fades.
- Use <kbd>−</kbd> / <kbd>Fit</kbd> / <kbd>＋</kbd> to zoom.

![Floor plan](screenshots/floor-map.png)

### Rack elevation

Click any rack to open its front view. Cartons drop onto each shelf, sized by quantity
and coloured by expiry. Click a carton to see the lot: an expiry countdown, quantity,
value, slot and the date it was received. From there you can:

- **Move** it to another slot (only slots that pass the zone, space and no-mixing rules are offered),
- **Put the lot on hold**, or release it, and
- **Find this lot everywhere** on the map.

Use <kbd>←</kbd> <kbd>→</kbd> to step through racks and <kbd>Esc</kbd> to close.

![Rack elevation](screenshots/rack-inspector.png)

## W-102 Receiving & put-away

1. Choose the product. Cold-chain products are flagged.
2. Enter the lot number, expiry date and quantity. If the lot already exists, its expiry
   is filled in and locked.
3. Calidrux ranks the slots that can take the delivery and explains each choice. The
   map shows the route from the dock door.
4. Pick a suggestion, or click a highlighted rack, then **Put away**.

![Receive](screenshots/receive.png)

## W-103 Expiry schedule

Every lot in the building, grouped by how soon it expires.

- The tiles at the top show lines, units and value at risk. Click one to focus on it.
- The timeline shows every lot on a 12-month axis; bubble size is quantity.
- The board shows a card per stock line. Click a card to open its shelf.
  Expired lots get a one-click **Put lot on hold** button.
- Filter by text, zone, or "on hold only".

![Expiry schedule](screenshots/expiry-board.png)

## W-104 Layout

Set the size of the warehouse: aisles, bays per aisle, levels, which aisles are cold
rooms, slot capacity, weight limits and spacing. The preview marks **new** racks and racks
that would be **removed**. If a removed or re-zoned slot still holds stock, the change is
blocked and the panel lists the slots to clear first.

![Layout designer](screenshots/layout-designer.png)

## A-201 Optimization lab

Sliders drive four live what-if analyses. The four cards at the top summarise the impact
in dollars and percentages. Nothing in the warehouse changes.

- **Expiry write-off forecast:** set demand, units per pick and horizon to see the
  projected write-off, a cumulative curve, the biggest products at risk, and lots to act
  on. Click a lot to open its shelf.
- **Route savings simulator:** simulate up to 400 orders, then enter your orders per day,
  walking speed, labor cost and operating days to get labor saved per year.
- **Slotting trade-offs:** adjust the four cost weights and the solver re-runs live.
  **Map the trade-off curve** shows moves vs savings. **Use these weights** saves them for
  the Slotting screen.
- **ABC sensitivity:** move the A and B cut-offs and watch the Pareto chart re-classify.

![Optimization lab](screenshots/optimization-lab.png)

## A-202 ABC analysis

Classifies every SKU by usage value (picks × unit cost) into A, B and C, with a Pareto
chart. You can change the thresholds and save snapshots.

![ABC analysis](screenshots/abc-analysis.png)

## A-203 Slotting

Runs an OR-Tools assignment model that proposes the best slot for each product. You can
accept or reject each move, or accept all of them. Accepting moves the stock and records
it in the audit log.

## A-204 Pick routes

Build a pick list from product dropdowns, or use **Fill 6 random lines** for a demo.
Calidrux chooses lots by FEFO and orders the stops with a TSP solver. The route is drawn
on the floor plan next to the aisle-by-aisle baseline, with the distance saved. The
**Efficiency Metrics** tab tracks picks per hour and average savings.

![Pick route](screenshots/pick-route.png)

## R-301 Inventory register, R-302 Audit log, R-303 Settings

- **Inventory:** products, slots, lots, stock, manual receive, transfer and adjust, and
  CSV import. IDs are chosen from dropdowns.
- **Audit Log:** every change, searchable and filterable by entity.
- **Settings:** user name for the audit trail, dock position, ABC thresholds, slotting
  weights and database backup.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd> | Open search |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> | Move through and open search results |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next rack in the inspector |
| <kbd>Esc</kbd> | Close search, inspector or dialogs |

## Where your data lives

`%APPDATA%\Calidrux\calidrux.db` (Windows). Back it up from **Settings → Backup
Database**. To start over with fresh sample data, close the app, rename that file and
relaunch.
