# Book Mart

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
`%LOCALAPPDATA%\BookMart` on Windows (or the directory specified with
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

The first launch creates the database and the initial admin account:
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
pyinstaller --noconfirm --clean --onefile --windowed --name BookMart --add-data "templates;templates" --add-data "static;static" --collect-all webview app.py
```

The output is `dist\BookMart.exe`. On some Windows 7 installations, installing
PyWebView's native dependencies may require the matching 32-bit Microsoft
Visual C++ runtime and a compatible WebView2 runtime. Verify the chosen
PyWebView renderer works on the target PC before deployment. The cashier uses
XMLHttpRequest and ES5 syntax to retain compatibility with legacy renderers.
Keep the executable in a trusted local folder; the SQLite
database is created separately in the current user's Local AppData.

## Start automatically at Windows sign-in

After building, create a shortcut to `dist\BookMart.exe` and place it in the
current user's Startup folder. Open that folder with **Win+R**, enter
`shell:startup`, press Enter, and copy the shortcut there. The app starts
without requiring a browser window.

## Notes

- Drinks use a JSON recipe such as
  `[{"material_id":1,"qty":0.02},{"material_id":2,"qty":0.15}]`. Create materials
  first and use their numeric IDs in the recipe.
- A sale is committed in one SQLite transaction; invalid recipes and
  insufficient book/material stock reject the entire order.
- The cashier product API includes stock and drink recipe snapshots. Cart
  reservations validate books and shared drink ingredients before adding or
  increasing quantities; checkout still revalidates against the database.
- Admin materials and drink recipes use a local, cached material picker; recipe
  rows are validated and serialized to the existing `recipe_json` format.
- `expenses` can be managed using the Expenses button in Reports. Profit is
  calculated as sales minus snapshot COGS minus recorded expenses.
- Receipt printing uses the native/webview print flow and an 80 mm print style.
- For cashier fallback, `python app.py --web` serves only on `127.0.0.1`.
