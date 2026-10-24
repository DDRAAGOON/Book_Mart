# Arabic RTL Point-of-Sale

## Project structure

```text
Book_Mart/
|-- app.py
|-- database.db                 # Created automatically on first launch
|-- requirements.txt
|-- templates/
|   |-- cashier.html
|   |-- admin_login.html
|   `-- admin_dashboard.html
`-- static/
    |-- css/style.css
    `-- js/
        |-- cashier.js
        `-- admin.js
```

The app uses only local Flask endpoints and SQLite. It stores `database.db` under
the application folder in `%LOCALAPPDATA%` on Windows (or the directory specified with
`BOOK_MART_DATA_DIR`), avoiding write-permission problems in the installation
folder. The development fallback is the project directory.

## Run from source

Use 32-bit Python 3.9 when targeting 32-bit Windows 7:

```bat
py -3.9-32 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

The initial shop-name fallback is defined once as `DEFAULT_SHOP_NAME` in `app.py`;
the manager can replace it in Settings. The first launch creates the database and the initial admin account:
`admin` / `123456`. Change the password after signing in. For development in a
browser instead of the native desktop wrapper, run `python app.py --web` and
open `http://127.0.0.1:5000`.

## Build a single-file Windows executable

Build on the target Windows version with **32-bit Python 3.9**. Python and
PyInstaller do not cross-compile a Windows executable from another OS/bitness.
Install dependencies, then run:

```bat
py -3.9-32 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pyinstaller --noconfirm --clean --onefile --windowed --name PointOfSale --add-data "templates;templates" --add-data "static;static" --collect-all webview app.py
```

The output is `dist\PointOfSale.exe`. On some Windows 7 installations, installing
PyWebView's native dependencies may require the matching 32-bit Microsoft
Visual C++ runtime and a compatible WebView2 runtime. Verify the chosen
PyWebView renderer works on the target PC before deployment. The cashier uses
XMLHttpRequest and ES5 syntax to retain compatibility with legacy renderers.
Keep the executable in a trusted local folder; the SQLite
database is created separately in the current user's Local AppData.

## Start automatically at Windows sign-in

After building, create a shortcut to `dist\PointOfSale.exe` and place it in the
current user's Startup folder. Open that folder with **Win+R**, enter
`shell:startup`, press Enter, and copy the shortcut there. The app starts
without requiring a browser window.

## Notes

- The cashier, administration pages, and receipt use Arabic labels and
  right-to-left layout. Financial values and identifiers remain Latin-digit
  values for readability; the theme uses maroon, cream, and gold. The interface
  uses operating-system Arabic fonts when available and does not fetch fonts or
  other resources from the internet.
- An optional `static\img\logo.png` is shown in the cashier, admin, login, and
  receipt headers. Without it, the app displays its text brand.
- Drinks use a JSON recipe such as
  `[{"material_id":1,"qty":0.02},{"material_id":2,"qty":0.15}]`. Create materials
  first and use their numeric IDs in the recipe.
- A sale is committed in one SQLite transaction; invalid recipes and
  insufficient book/material/retail stock reject the entire order.
- Startup seeds the Arabic menu catalog idempotently: 63 drinks across the
  canonical drink categories and 9 retail products across soft drinks, cookies,
  and extras. Seeded drinks have empty recipes and zero recipe cost until
  configured; seeded retail has zero stock/cost and uses قطعة. Two Arabic sample
  books are also seeded with the specified sample prices and stock. A dedicated
  seed-key table prevents duplicate catalog rows without overwriting manager
  changes or matching products already in the database.
- Retail products are separate stock-tracked items. They appear in the unified
  cashier product feed and are reserved in the cart; checkout rechecks and
  decrements retail stock transactionally.
- Drink and retail categories are stored in SQLite and managed from the
  التصنيفات page. Active categories appear in cashier tabs only when they have
  products; products assigned to inactive or unknown categories remain visible
  under الكل and search. Books use one synthetic tab in v1.
- A category slug is an immutable internal key used by product records. Rename
  the Arabic display label instead; this updates the visible label without
  rewriting product rows. Categories with products must be reassigned before
  deletion, and the category editor provides that operation.
- On first startup after the category migration, retail-like book rows such as
  Pepsi are moved to Retail with their sell price preserved. Book and retail
  forms reject names that collide with the other catalog.
- The cashier product API includes stock and drink recipe snapshots. Cart
  reservations validate books and shared drink ingredients before adding or
  increasing quantities; checkout still revalidates against the database.
- Admin materials and drink recipes use a local, cached material picker; recipe
  rows are validated and serialized to the existing `recipe_json` format.
- Downloadable XLSX templates and XLSX/CSV imports are available for books,
  materials, and drinks. Imports allow up to 1,000 rows and report row-level
  validation failures while retaining successfully imported rows. Book types
  are stored as `Original` or `High Copy`; publisher is optional. Material units
  are stored as `kg`, `L`, or `pcs` and displayed as كجم، لتر، or قطعة. Unknown
  legacy units are preserved and flagged for correction. On first startup after
  this update, existing Arabic book-type values are normalized once; old book
  reorder columns are retained in the database but no longer used.
- `expenses` can be managed using the Expenses button in Reports. Profit is
  calculated as sales minus snapshot COGS minus recorded expenses.
- Receipt printing uses the native/webview print flow and an 80 mm print style.
- For cashier fallback, `python app.py --web` serves only on `127.0.0.1`.
