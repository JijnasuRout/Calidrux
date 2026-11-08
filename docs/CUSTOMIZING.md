# Customizing Calidrux: a hands-on guide

This guide teaches you to change Calidrux yourself, from swapping a color to adding a
whole new screen. Each lesson is small, tells you exactly which file to open, and ends
with something you can see.

**What you need:** the project on your computer (see the README's Quick start), a code
editor ([VS Code](https://code.visualstudio.com/) is free and good), and Edge or Chrome.

---

## Part 1 — How the app is put together

Calidrux has two halves that talk to each other:

```
┌──────────────────────────┐   asks for data      ┌──────────────────────────────┐
│  The interface (what you │ ───────────────────▶ │  The server (Python)         │
│  see): HTML, CSS, JS in  │   /api/products       │  api/app.py, warehouse/,     │
│  src/calidrux/api/static │ ◀─────────────────── │  optimization/, analytics/   │
└──────────────────────────┘   gets back JSON      └──────────────────────────────┘
                                                              │ reads/writes
                                                              ▼
                                                  SQLite file: %APPDATA%\Calidrux
```

- **Python** does the thinking: it stores data, runs the optimizers, and answers
  requests like "give me every product" at addresses such as `/api/products`.
- **The interface** is a web page shown inside a desktop window. It has three kinds of
  file:
  - **HTML:** the structure. `index.html` holds the sidebar and the sheet frame.
  - **CSS:** the look. Colors, fonts, lines and spacing.
  - **JavaScript (JS):** the behaviour. It fetches data from the server and builds each
    screen.

### Where the look lives

| File | What it controls | How often you'll touch it |
|---|---|---|
| `static/theme.css` | **Design tokens:** every color, the fonts, line weights, corner radius | Often. Start here. |
| `static/drawing.css` | The drawing-sheet skin: sheet frame, title block, tables, buttons, sliders | Sometimes |
| `static/style.css`, `warehouse.css`, `lab.css`, `motion.css` | Older base styles that `drawing.css` overrides | Rarely |

**Token** just means a named value. Instead of writing `#1B3A94` in 200 places, the CSS
says `var(--ink)`, and `theme.css` defines `--ink: #1B3A94` once. Change it there and
everything changes.

### Where each screen lives

| Sheet | JavaScript file | Function that draws it |
|---|---|---|
| G-001 Cover sheet | `overview.js` | `viewOverview` |
| W-101 Floor plan + rack elevation | `warehouse.js` | `viewFloor`, `renderFloor`, `rackSvg` |
| W-102 Receiving, W-103 Expiry, W-104 Layout | `warehouse-ops.js` | `viewReceive`, `viewExpiry`, `viewLayout` |
| A-201 Optimization lab | `lab.js` | `viewLab` |
| A-202 ABC, R-301 Inventory, R-303 Settings | `app.js` | `viewABC`, `viewInventory`, `viewSettings` |
| A-203 Slotting, A-204 Pick routes, R-302 Audit | `enhance.js` | `viewSlotting`, `_renderPickPanel`, `viewAudit` |
| Sheet numbers + title block | `sheet.js` | `SHEETS`, `renderTitleBlock` |

Every screen is registered in one object called `VIEWS`. Clicking a sidebar link with
`data-view="floor"` calls `VIEWS.floor()`. That's the whole navigation system.

---

## Part 2 — Your editing loop

1. **Start the app** from the project folder:
   ```powershell
   .venv\Scripts\calidrux
   ```
2. **Also open it in your browser** at <http://127.0.0.1:8765>. It's the same app, but
   the browser gives you developer tools.
3. Press **F12** to open DevTools. Two tabs matter:
   - **Elements:** click the arrow icon (top-left of DevTools), then click anything on the
     page to see its HTML and CSS. In the *Styles* pane you can edit CSS live and see the
     result instantly. Nothing is saved, so experiment freely.
   - **Console:** shows errors in red. If a screen goes blank, look here first.
4. When you like a change, **copy it into the real file** in VS Code and save.
5. **Reload:** press **Ctrl + F5** in the browser (a hard refresh that skips the cache),
   or **Ctrl + R** in the app window.
   - Changes to **CSS, JS and HTML** need only a reload.
   - Changes to **Python** need a restart: close the app and run `calidrux` again.

> **Golden rule:** change one thing, reload, look. If it breaks, undo
> (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) and you're back where you were.

---

## Part 3 — Lessons

### Lesson 1 · Change the colors (5 minutes)

Open `src/calidrux/api/static/theme.css` and find:

```css
--ink:          #1B3A94;   /* cobalt: all linework and primary text */
```

Change it to a darker, almost-black navy and reload:

```css
--ink:          #0F2557;
```

Every line, label and number follows. Now try making the warnings more vivid:

```css
--highlight:    #FFD400;
```

**Tip:** to pick colors, search "color picker" in your browser, or use the color square
that appears next to any color in DevTools → Styles. Check that text stays readable: dark
ink on white should have a contrast ratio of at least 4.5:1. DevTools shows the ratio when
you click a color.

### Lesson 2 · Change line weights and corners (5 minutes)

Still in `theme.css`:

```css
--stroke:       1px;       /* standard line weight */
--stroke-heavy: 2px;       /* sheet border, section cuts */
--radius:       0px;       /* drawings have square corners */
```

Set `--stroke: 1.5px` for a bolder print, or `--radius: 4px` to soften the corners.
Keep the radius between 0 and 8px so it stays tight; technical drawings normally keep
corners square.

The icon tokens are here too:

```css
--icon-size:    16px;      /* Lucide icons (icons.js) */
--icon-stroke:  1.75;      /* icon line weight, in 24px icon units */
```

Try `--icon-stroke: 1.25` for finer icons that match the 1px linework.

### Lesson 3 · Change the font (10 minutes)

The app ships its own font files in `static/fonts/` so it looks the same offline.

- **Quick way:** use a font already on Windows. In `theme.css`, change
  ```css
  --font: 'B612', 'Segoe UI', system-ui, sans-serif;
  ```
  to, for example,
  ```css
  --font: 'Bahnschrift', 'Segoe UI', sans-serif;   /* Bahnschrift ships with Windows 10/11 */
  ```
- **Proper way:** download a font's `.woff2` files (Google Fonts and Fontsource offer
  free ones), put them in `static/fonts/`, and copy one of the `@font-face { … }` blocks at
  the top of `theme.css`, changing the name and file path.

### Lesson 3b · Use and add icons (10 minutes)

Icons come from [Lucide](https://lucide.dev/icons), a free open-source icon set. Only the
icons the app uses are bundled, in `static/icons.js`, so it still works offline.

**Use an icon that's already bundled.** In any JavaScript template, call `icon('name')`:

```js
`<button class="btn btn-ghost">${icon('rotate-cw')}Refresh</button>`
```

In plain HTML, write `<i data-icon="name"></i>` and it's swapped for the icon when the page
loads. The list of bundled names is at the top of `scripts/build_icons.py`.

**Add a new icon.**

1. Find it on [lucide.dev/icons](https://lucide.dev/icons), for example `truck`.
2. Add `"truck"` to the `NAMES` list in `scripts/build_icons.py`.
3. Download the icon files once, then rebuild `icons.js`:
   ```powershell
   npm pack lucide-static
   tar -xzf lucide-static-*.tgz
   python scripts\build_icons.py package\icons
   ```
   No Node.js? Download the zip from the Lucide GitHub releases page instead, and pass the
   path of its `icons` folder to the script.
4. Use `icon('truck')` anywhere.

Icons sit in a flex row with their label, so you don't need spaces or margins: buttons,
chips and the sheet index already put a 6px gap between the icon and the text.

### Lesson 4 · Rename a sheet (5 minutes)

Sheet numbers and titles are set in two places. Keep them in sync:

1. `static/sheet.js`, in the `SHEETS` object. This feeds the title block and the cover
   sheet's index:
   ```js
   floor:     { no: 'W-101', title: 'Floor plan', scale: '1:200' },
   ```
2. `static/index.html`, in the sidebar link:
   ```html
   <a href="#" class="nav-item" data-view="floor"><span class="sheet-no">W-101</span>Floor plan</a>
   ```

Change `Floor plan` to `Warehouse plan` in both places, reload, and look at the sidebar
and the title block.

### Lesson 5 · Add a line to the cover sheet (10 minutes)

The cover sheet's *Inventory schedule* is just a list in `overview.js`:

```js
const sched = [
  ['Units stored', fmt(k.units), 'floor'],
  ['Stock value', money(k.value), 'floor'],
  ...
];
```

Each row is `[label, value, sheet to open when clicked, highlight in red?]`. Add one:

```js
  ['Average units per used slot', fmt(k.units / Math.max(1, k.occupied_slots)), 'floor'],
```

Reload the cover sheet. `k` holds the warehouse KPIs from the server. To see everything
available, type `WH.floor.kpis` in the DevTools Console and press Enter.

### Lesson 6 · Build a new sheet (30 minutes)

You'll add **R-304 Product list**, a sheet that shows every product in a schedule.

**Step 1: add the sidebar link.** In `index.html`, under the Records group, after the
Settings link:

```html
<a href="#" class="nav-item" data-view="products"><span class="sheet-no">R-304</span>Product list</a>
```

**Step 2: register the sheet.** In `sheet.js`, add to `SHEETS`:

```js
  products:  { no: 'R-304', title: 'Product list', scale: 'NTS' },
```

**Step 3: write the screen.** Create a new file `static/products.js`:

```js
'use strict';
/* R-304 Product list */
async function viewProducts() {
  const products = await api('GET', '/api/products');          // ask the server
  const rows = products.map(p => [                             // one row per product
    `<span class="wh-loc">${esc(p.sku)}</span>`,
    esc(p.name),
    p.storage_class === 'cold' ? 'Cold room' : 'Ambient',
    '$' + p.unit_cost.toFixed(2),
  ]);
  document.getElementById('view-content').innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Product list</h1>
        <div class="page-sub">${products.length} products on file.</div></div>
    </div>
    <div class="card">
      <div class="card-title">Products</div>
      ${tbl(['SKU', 'Name', 'Storage', 'Unit cost'], rows)}
    </div>`;
}
VIEWS.products = viewProducts;                                 // connect it to the link
```

What's going on:
- `api('GET', '/api/products')` fetches data from the Python server.
- `.map(...)` turns each product into a row.
- `esc()` makes text safe to put into HTML. **Always use it on text that came from data.**
- `tbl()` builds a table, and `page-header`, `card` and `card-title` give you the drawing
  style for free.
- The last line plugs the function into the navigation.

**Step 4: load the file.** In `index.html`, near the bottom, after
`<script src="/static/lab.js"></script>`, add:

```html
<script src="/static/products.js"></script>
```

Hard-refresh (<kbd>Ctrl</kbd>+<kbd>F5</kbd>) and click **R-304** in the sidebar.
If it's blank, check the DevTools Console for a red error message; usually it's a typo or
a missing comma.

### Lesson 7 · Add your own data endpoint in Python (30 minutes)

Say the sheet should show only cold-chain products, and you want the server to do the
filtering.

**Step 1.** Open `src/calidrux/api/app.py`. Find the line `@app.get("/api/products")` and,
just above it, add a new endpoint:

```python
    @app.get("/api/products/cold")
    def products_cold():
        from calidrux.db.models.product import Product, StorageClass
        with get_session() as s:
            rows = s.query(Product).filter(Product.storage_class == StorageClass.COLD).all()
            return [p.to_dict() for p in rows]
```

Indentation matters in Python: these lines sit 4 spaces in, like the endpoints around them.

**Step 2.** Restart the app (Python changed), then open
<http://127.0.0.1:8765/api/products/cold> in the browser. You'll see the raw JSON. That's
exactly what your JavaScript receives.

**Step 3.** In `products.js`, change `'/api/products'` to `'/api/products/cold'`.

**Step 4: add a test** so the endpoint stays correct. Append to `tests/test_api.py`:

```python
def test_cold_products_endpoint(client):
    r = client.get("/api/products/cold")
    assert r.status_code == 200
    assert r.json() and all(p["storage_class"] == "cold" for p in r.json())
```

Run the tests from the project folder:

```powershell
.venv\Scripts\python -m pip install -e ".[dev]"   # once, installs pytest
.venv\Scripts\pytest
```

Green dots mean every test passed.

### Lesson 8 · Change how the floor plan colors racks (advanced)

Rack tiles are drawn by `renderFloor` in `warehouse.js`. Each shelf level's color comes
from `levelColor(mode, rack, level)`. For example, to make the *Occupancy* view turn red
when a shelf is over 95% full:

```js
if (mode === 'occupancy') return lvl.utilization > 0.95 ? 'var(--redline)' : 'var(--ink)';
```

The rack elevation drawing is plain SVG built in `rackSvg()`. Its parts have class names
like `wh-beam`, `wh-post` and `wh-carton`, which `drawing.css` styles.

---

## Part 4 — Save your work to GitHub

```powershell
git status                       # see what changed
git add -A                       # stage everything
git commit -m "Add product list sheet"
git push
```

GitHub Actions then runs the tests on Windows and Linux. A green check on the repo means
you didn't break anything.

If you started from a downloaded folder rather than a `git clone`, clone the repo once and
work inside that folder from then on (see the README's Quick start).

---

## Part 5 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| My CSS change doesn't show | Browser cache | <kbd>Ctrl</kbd>+<kbd>F5</kbd> |
| My Python change doesn't show | Server still running old code | Close the app, run `calidrux` again |
| Screen is blank | JavaScript error | F12 → Console, fix the line it names |
| `Address already in use` | Calidrux is already running | Close the other window |
| `ModuleNotFoundError` | Virtual environment not used | Run commands with `.venv\Scripts\...` |
| Colors look wrong in one place only | A style in that file overrides the token | Inspect it in DevTools; change the rule in `drawing.css` |

## Part 6 — Design rules this app follows

If you add screens, keep them consistent with the drawing-set idea:

1. **Linework, not decoration.** Use borders and rules to separate things. No glass
   (`backdrop-filter`), glows, blurred shadows, gradient blobs or rounded cards. Corners are
   square; if you change `--radius`, keep it between 2 and 8px everywhere.
2. **Lay things out on the grid.** Panels line up edge to edge in CSS grid columns, and
   body text is left-aligned. Centre only numbers in table cells and single icons.
3. **Color means something.** Cobalt is normal; redline is a problem; highlighter is a
   warning. Don't use red or yellow just to make something stand out.
4. **Sentence case and plain verbs.** Labels read "Units stored", not "UNITS STORED".
   Buttons say exactly what they do ("Put lot on hold", "Run solver"), and messages are
   sentences ("Stock moved to the new slot"), not "Accepted — …" fragments or marketing
   phrases like "Transform your workflow".
5. **Icons are Lucide, one per action.** Use `icon('name')`, never emoji or symbol
   characters like ❄ or ✓ as icons.
6. **Codes in the mono face, words in B612.** Slot codes (`A03-B05-L2`) and sheet numbers
   use `var(--mono)`; everything else uses `var(--font)`.
7. **Motion only answers an action.** Opening a rack, putting stock away or drawing a
   route can animate. Nothing moves just to decorate.
