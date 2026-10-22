"""Book Mart POS. Build with PyInstaller from a 32-bit Python environment for Win7."""

import json
import math
import os
import secrets
import sqlite3
import sys
import threading
import webbrowser
from datetime import date, datetime
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for, abort
from werkzeug.security import check_password_hash, generate_password_hash


def resource_path(relative_path):
    """Resolve bundled resources both in development and in a PyInstaller build."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


def data_directory():
    override = os.environ.get("BOOK_MART_DATA_DIR")
    if override:
        location = Path(override)
    elif os.environ.get("LOCALAPPDATA"):
        location = Path(os.environ["LOCALAPPDATA"]) / "BookMart"
    else:
        location = Path(__file__).resolve().parent
    location.mkdir(parents=True, exist_ok=True)
    return location


DATA_DIR = data_directory()
DATABASE = DATA_DIR / "database.db"
app = Flask(
    __name__,
    template_folder=str(resource_path("templates")),
    static_folder=str(resource_path("static")),
)
app.config.update(
    SECRET_KEY=None,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    DATABASE=str(DATABASE),
)


def get_db():
    if "db" not in g:
        connection = sqlite3.connect(app.config["DATABASE"], timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def initialize_database():
    with app.app_context():
        db = get_db()
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin'
            );
            CREATE TABLE IF NOT EXISTS materials (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                unit TEXT NOT NULL,
                cost_per_unit REAL NOT NULL CHECK(cost_per_unit >= 0),
                current_stock REAL NOT NULL DEFAULT 0 CHECK(current_stock >= 0),
                reorder_level REAL NOT NULL DEFAULT 5 CHECK(reorder_level >= 0)
            );
            CREATE TABLE IF NOT EXISTS drinks (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                sell_price REAL NOT NULL CHECK(sell_price >= 0),
                recipe_json TEXT NOT NULL DEFAULT '[]',
                category TEXT NOT NULL DEFAULT 'hot' -- NEW COLUMN FOR HOT/COLD CLASSIFICATION
            );
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT '', -- ORIGINAL/HIGH COPY
                cost_price REAL NOT NULL CHECK(cost_price >= 0),
                sell_price REAL NOT NULL CHECK(sell_price >= 0),
                stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
                reorder_level INTEGER NOT NULL DEFAULT 3 CHECK(reorder_level >= 0)
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                timestamp TEXT NOT NULL,
                total_amount REAL NOT NULL,
                items_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed'
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                amount REAL NOT NULL CHECK(amount >= 0),
                note TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        
        # Migration Logic: Add columns if they don't exist (for older databases)
        migrations = [
            ("materials", "reorder_level", "REAL NOT NULL DEFAULT 5"),
            ("books", "reorder_level", "INTEGER NOT NULL DEFAULT 3"),
            ("drinks", "category", "TEXT NOT NULL DEFAULT 'hot'"), # Ensure category exists
        ]
        
        for table, column, definition in migrations:
            try:
                cols = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
                if column not in cols:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    print(f"Migrated: Added '{column}' to '{table}'")
            except Exception as e:
                print(f"Migration warning for {table}.{column}: {e}")

        db.execute(
            "INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)",
            ("admin", generate_password_hash("123456"), "admin"),
        )
        db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('secret_key', ?)",
            (secrets.token_hex(32),),
        )
        db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('shop_name', 'Book Mart')"
        )
        db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('shop_address', '')")
        app.config["SECRET_KEY"] = db.execute(
            "SELECT value FROM settings WHERE key = 'secret_key'"
        ).fetchone()["value"]
        db.commit()


def api_error(message, status=400):
    return jsonify({"error": message}), status


def admin_required(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not session.get("admin_id"):
            return api_error("Please sign in to continue.", 401)
        return function(*args, **kwargs)

    return wrapped


def positive_number(value, label, allow_zero=True):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(label + " must be a number.")
    if not math.isfinite(number) or number < 0 or (not allow_zero and number == 0):
        raise ValueError(label + " must be " + ("zero or greater." if allow_zero else "greater than zero."))
    return number


def product_recipe_cost(db, recipe):
    if not isinstance(recipe, list):
        raise ValueError("Recipe must be a JSON array.")
    cost = 0.0
    for ingredient in recipe:
        if not isinstance(ingredient, dict) or "material_id" not in ingredient or "qty" not in ingredient:
            raise ValueError("Each recipe item must contain material_id and qty.")
        try:
            material_id = int(ingredient["material_id"])
        except (TypeError, ValueError):
            raise ValueError("Recipe material_id must be an integer.")
        quantity = positive_number(ingredient["qty"], "Recipe quantity", False)
        material = db.execute(
            "SELECT cost_per_unit FROM materials WHERE id = ?", (material_id,)
        ).fetchone()
        if material is None:
            raise ValueError("Recipe references a material that no longer exists.")
        cost += material["cost_per_unit"] * quantity
    return cost


# --- Routes ---

@app.get("/")
def cashier_page():
    return render_template("cashier.html")

@app.get("/admin/login")
def admin_login_page():
    if session.get("admin_id"):
        return redirect(url_for("admin_dashboard_page"))
    return render_template("admin_login.html")

@app.post("/admin/login")
def admin_login():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    user = get_db().execute(
        "SELECT id, password_hash FROM users WHERE username = ? AND role = 'admin'",
        (username,),
    ).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return render_template("admin_login.html", error="Incorrect username or password."), 401
    session.clear()
    session["admin_id"] = user["id"]
    return redirect(url_for("admin_dashboard_page"))

@app.post("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("cashier_page"))

@app.get("/admin")
@admin_required
def admin_dashboard_page():
    return render_template("admin_dashboard.html")


# --- API Endpoints ---

@app.get("/api/products")
def product_list():
    """Unified endpoint for Cashier Grid - Includes Type & Category"""
    query = request.args.get("q", "").strip().lower()
    db = get_db()
    
    # Fetch Books - Include 'type'
    books_sql = "SELECT id, title AS name, sell_price, stock_quantity AS stock, 'book' AS kind, type FROM books"
    
    # Fetch Drinks - Include 'category'
    drinks_sql = "SELECT id, name, sell_price, recipe_json, NULL AS stock, 'drink' AS kind, category FROM drinks"
    
    params_books = ()
    params_drinks = ()
    
    if query:
        # Search by Name, Author, Type (Books) or Name, Category (Drinks)
        books_sql += " WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(type) LIKE ?"
        drinks_sql += " WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ?"
        
        like_q = f"%{query}%"
        params_books = (like_q, like_q, like_q)
        params_drinks = (like_q, like_q)
        
    books_sql += " ORDER BY title LIMIT 50"
    drinks_sql += " ORDER BY name LIMIT 50"

    books = [dict(r) for r in db.execute(books_sql, params_books)]
    for book in books:
        book["max_sellable_qty"] = max(0, int(book["stock"] or 0))

    material_rows = db.execute(
        "SELECT id, name, current_stock FROM materials"
    ).fetchall()
    materials = {row["id"]: dict(row) for row in material_rows}
    drinks = []
    for row in db.execute(drinks_sql, params_drinks):
        drink = dict(row)
        recipe_is_valid = True
        try:
            raw_recipe = json.loads(drink.pop("recipe_json"))
        except (TypeError, json.JSONDecodeError):
            raw_recipe = []
            recipe_is_valid = False
        if not isinstance(raw_recipe, list):
            raw_recipe = []
            recipe_is_valid = False

        recipe_by_material = {}
        for ingredient in raw_recipe:
            if not isinstance(ingredient, dict):
                recipe_is_valid = False
                continue
            try:
                material_id = int(ingredient["material_id"])
                amount = positive_number(ingredient["qty"], "Recipe quantity", False)
            except (KeyError, TypeError, ValueError):
                recipe_is_valid = False
                continue
            material = materials.get(material_id)
            if material is None:
                recipe_is_valid = False
                continue
            if material_id in recipe_by_material:
                recipe_by_material[material_id]["qty"] += amount
            else:
                recipe_by_material[material_id] = {
                    "material_id": material_id,
                    "qty": amount,
                    "current_stock": material["current_stock"],
                    "material_name": material["name"],
                }

        recipe = list(recipe_by_material.values())
        drink["recipe"] = recipe
        if not recipe_is_valid:
            drink["max_sellable_qty"] = 0
        elif not recipe:
            # A recipe-free drink has no material-based inventory cap.
            drink["max_sellable_qty"] = None
        else:
            drink["max_sellable_qty"] = min(
                int(math.floor(item["current_stock"] / item["qty"] + 0.000000001))
                for item in recipe
            )
        drinks.append(drink)
    
    # Combine and sort alphabetically by name
    all_products = books + drinks
    all_products.sort(key=lambda x: x['name'].lower())
    
    return jsonify(all_products)


@app.post("/api/orders")
def create_order():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return api_error("Order data must be a JSON object.")
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return api_error("The cart is empty.")
    if len(items) > 100:
        return api_error("Too many different items in one order.")
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        snapshots = []
        material_use = {}
        total = 0.0
        for entry in items:
            if not isinstance(entry, dict):
                raise ValueError("Invalid cart item.")
            kind = entry.get("kind")
            try:
                product_id = int(entry.get("id"))
                quantity = int(entry.get("quantity"))
            except (TypeError, ValueError):
                raise ValueError("Invalid product or quantity.")
            if quantity < 1 or quantity > 10000:
                raise ValueError("Quantity must be between 1 and 10,000.")
            
            if kind == "book":
                product = db.execute("SELECT * FROM books WHERE id = ?", (product_id,)).fetchone()
                if product is None:
                    raise ValueError("A book in this cart no longer exists.")
                if product["stock_quantity"] < quantity:
                    raise ValueError(product["title"] + " does not have enough stock.")
                db.execute(
                    "UPDATE books SET stock_quantity = stock_quantity - ? WHERE id = ?",
                    (quantity, product_id),
                )
                name, price = product["title"], product["sell_price"]
                unit_cost = product["cost_price"]
            elif kind == "drink":
                product = db.execute("SELECT * FROM drinks WHERE id = ?", (product_id,)).fetchone()
                if product is None:
                    raise ValueError("A drink in this cart no longer exists.")
                try:
                    recipe = json.loads(product["recipe_json"])
                except json.JSONDecodeError:
                    raise ValueError(product["name"] + " has an invalid recipe.")
                if not isinstance(recipe, list):
                    raise ValueError(product["name"] + " has an invalid recipe.")
                unit_cost = product_recipe_cost(db, recipe)
                for ingredient in recipe:
                    try:
                        material_id = int(ingredient["material_id"])
                        amount = positive_number(ingredient["qty"], "Recipe quantity", False)
                    except (KeyError, TypeError, ValueError) as error:
                        raise ValueError("Invalid recipe for " + product["name"] + ": " + str(error))
                    material_use[material_id] = material_use.get(material_id, 0) + amount * quantity
                name, price = product["name"], product["sell_price"]
            else:
                raise ValueError("Unknown product type.")
            
            total += price * quantity
            snapshots.append({
                "id": product_id,
                "kind": kind,
                "name": name,
                "quantity": quantity,
                "unit_price": price,
                "unit_cost": unit_cost,
                "line_total": round(price * quantity, 2),
            })
        
        # Deduct Materials Stock
        for material_id, amount in material_use.items():
            material = db.execute(
                "SELECT name, current_stock FROM materials WHERE id = ?", (material_id,)
            ).fetchone()
            if material is None:
                raise ValueError("A drink recipe references a missing material.")
            if material["current_stock"] + 1e-9 < amount:
                raise ValueError("Not enough " + material["name"] + " in stock.")
            db.execute(
                "UPDATE materials SET current_stock = MAX(0, current_stock - ?) WHERE id = ?",
                (amount, material_id),
            )
            
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        shop_settings = dict(db.execute(
            "SELECT key, value FROM settings WHERE key IN ('shop_name', 'shop_address')"
        ))
        
        cursor = db.execute(
            "INSERT INTO orders(timestamp, total_amount, items_json, status) VALUES (?, ?, ?, 'completed')",
            (now, round(total, 2), json.dumps(snapshots, ensure_ascii=False)),
        )
        order_id = cursor.lastrowid
        db.commit()
        
        return jsonify({
            "success": True,
            "order_id": order_id,
            "timestamp": now,
            "total_amount": round(total, 2),
            "items": snapshots,
            "shop": shop_settings,
        }), 201
        
    except ValueError as error:
        db.rollback()
        return api_error(str(error))
    except Exception as e:
        db.rollback()
        app.logger.exception("Unexpected error saving order")
        return api_error("System Error: Could not save order.", 500)


# --- NEW: Server-Side Receipt Generation for Printing ---
@app.get("/api/print-receipt/<int:order_id>")
def print_receipt_view(order_id):
    """Generates a clean HTML page optimized for thermal printers."""
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        abort(404)
    
    items = json.loads(order["items_json"])
    shop = dict(db.execute("SELECT key, value FROM settings WHERE key IN ('shop_name', 'shop_address')"))
    
    # Build simple HTML string
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            /* Thermal Printer Styles */
            body {{ font-family: 'Courier New', Courier, monospace; width: 280px; margin: 0 auto; padding: 10px; font-size: 12px; color: black; background: white; }}
            .header {{ text-align: center; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }}
            .shop-name {{ font-weight: bold; font-size: 14px; }}
            .info {{ font-size: 10px; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 5px; }}
            th, td {{ text-align: left; padding: 2px 0; vertical-align: top; }}
            .right {{ text-align: right; }}
            .total-row {{ border-top: 1px solid #000; margin-top: 5px; padding-top: 5px; font-weight: bold; display: flex; justify-content: space-between; }}
            .footer {{ text-align: center; margin-top: 10px; font-size: 10px; }}
            @media print {{
                body {{ margin: 0; padding: 0; width: 100%; }}
                .no-print {{ display: none; }}
            }}
        </style>
    </head>
    <body onload="window.print(); window.close()">
        <div class="header">
            <div class="shop-name">{shop.get('shop_name', 'BOOK MART')}</div>
            <div class="info">{shop.get('shop_address', '')}</div>
            <div class="info">Date: {datetime.fromisoformat(order['timestamp']).strftime('%Y-%m-%d %H:%M')}</div>
            <div class="info">Order #: {order['id']}</div>
        </div>
        
        <table>
            <tr><th>Item</th><th class="right">Qty</th><th class="right">Amt</th></tr>
            {''.join(f"<tr><td>{item['name'][:20]}</td><td class='right'>{item['quantity']}</td><td class='right'>{item['line_total']:.2f}</td></tr>" for item in items)}
        </table>
        
        <div class="total-row">
            <span>TOTAL:</span>
            <span>{order['total_amount']:.2f} EGP</span>
        </div>
        
        <div class="footer">
            Thank you for visiting!<br>Keep this receipt.
        </div>
    </body>
    </html>
    """
    return html_content


# --- CASHIER QUICK ACCESS ENDPOINT (NEW) ---
@app.get("/api/cashier/recent-orders")
def get_recent_orders_for_cashier():
    """Returns last 5 completed orders for quick reference by cashier."""
    db = get_db()
    rows = db.execute("""
        SELECT id, total_amount, timestamp 
        FROM orders 
        WHERE status = 'completed' 
        ORDER BY id DESC 
        LIMIT 5
    """).fetchall()
    
    return jsonify([dict(row) for row in rows])


# --- Admin APIs ---
@app.get("/api/admin/dashboard")
@admin_required
def dashboard_metrics():
    db = get_db()
    today = date.today().isoformat()
    sales = db.execute(
        "SELECT COALESCE(SUM(total_amount), 0) AS value FROM orders WHERE substr(timestamp, 1, 10) = ? AND status = 'completed'",
        (today,),
    ).fetchone()["value"]
    orders = db.execute(
        "SELECT items_json FROM orders WHERE substr(timestamp, 1, 10) = ? AND status = 'completed'",
        (today,),
    ).fetchall()
    cogs = 0.0
    for order in orders:
        for item in json.loads(order["items_json"]):
            cogs += item["unit_cost"] * item["quantity"]
    expenses = db.execute(
        "SELECT COALESCE(SUM(amount), 0) AS value FROM expenses WHERE date = ?", (today,)
    ).fetchone()["value"]
    
    # Low Stock Alerts - Including Type/Category info
    low_materials = db.execute(
        "SELECT name, current_stock AS stock, unit FROM materials WHERE current_stock <= reorder_level ORDER BY name"
    ).fetchall()
    
    low_books = db.execute(
        "SELECT title AS name, stock_quantity AS stock, 'copies (' || type || ')' AS unit FROM books WHERE stock_quantity <= reorder_level ORDER BY title"
    ).fetchall()
    
    settings = dict(db.execute("SELECT key, value FROM settings WHERE key IN ('shop_name', 'shop_address')"))
    return jsonify({
        "today_sales": round(sales, 2),
        "today_profit": round(sales - cogs - expenses, 2),
        "low_stock": [dict(row) for row in list(low_materials) + list(low_books)],
        "shop": settings,
    })

def inventory_rows(table):
    db = get_db()
    columns = {
        "books": "id, title, author, type, cost_price, sell_price, stock_quantity, reorder_level",
        "drinks": "id, name, sell_price, recipe_json, category", # Added category here
        "materials": "id, name, unit, cost_per_unit, current_stock, reorder_level",
    }
    return [dict(row) for row in db.execute("SELECT " + columns[table] + " FROM " + table + " ORDER BY id DESC")]

@app.get("/api/admin/<resource>")
@admin_required
def list_admin_resource(resource):
    if resource not in ("books", "drinks", "materials", "expenses"):
        return api_error("Unknown resource.", 404)
    if resource == "expenses":
        return jsonify([dict(row) for row in get_db().execute(
            "SELECT id, date, category, amount, note FROM expenses ORDER BY date DESC, id DESC LIMIT 500"
        )])
    return jsonify(inventory_rows(resource))

def resource_values(resource, data):
    if not isinstance(data, dict):
        raise ValueError("Request data must be a JSON object.")
    if resource == "books":
        title = str(data.get("title", "")).strip()
        author = str(data.get("author", "")).strip()
        kind = str(data.get("type", "")).strip()
        if not title:
            raise ValueError("Book title is required.")
        cost = positive_number(data.get("cost_price"), "Cost price")
        price = positive_number(data.get("sell_price"), "Sell price")
        stock_value = positive_number(data.get("stock_quantity"), "Stock quantity")
        reorder_value = positive_number(data.get("reorder_level", 3), "Reorder level")
        if not stock_value.is_integer() or not reorder_value.is_integer():
            raise ValueError("Book stock and reorder level must be whole numbers.")
        stock = int(stock_value)
        reorder = int(reorder_value)
        return (title, author, kind, cost, price, stock, reorder)
    
    if resource == "drinks":
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("Drink name is required.")
        price = positive_number(data.get("sell_price"), "Sell price")
        
        # Handle Category (Hot/Cold)
        category = str(data.get("category", "hot")).strip().lower()
        if category not in ("hot", "cold"):
            category = "hot"
            
        raw = data.get("recipe_json", "[]")
        recipe = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(recipe, list):
            raise ValueError("Recipe must be a JSON array.")
        normalized = []
        for ingredient in recipe:
            if not isinstance(ingredient, dict):
                raise ValueError("Each recipe item must contain material_id and qty.")
            material_id = int(ingredient["material_id"])
            quantity = positive_number(ingredient["qty"], "Recipe quantity", False)
            normalized.append({"material_id": material_id, "qty": quantity})
        product_recipe_cost(get_db(), normalized)
        
        # Return tuple includes category now
        return (name, price, json.dumps(normalized), category)
    
    if resource == "materials":
        name = str(data.get("name", "")).strip()
        unit = str(data.get("unit", "")).strip()
        if not name or not unit:
            raise ValueError("Material name and unit are required.")
        cost = positive_number(data.get("cost_per_unit"), "Cost per unit")
        stock = positive_number(data.get("current_stock"), "Current stock")
        reorder = positive_number(data.get("reorder_level", 5), "Reorder level")
        return (name, unit, cost, stock, reorder)
    
    if resource == "expenses":
        expense_date = str(data.get("date", date.today().isoformat()))
        try:
            date.fromisoformat(expense_date)
        except ValueError:
            raise ValueError("Expense date must use YYYY-MM-DD.")
        category = str(data.get("category", "")).strip()
        if not category:
            raise ValueError("Expense category is required.")
        amount = positive_number(data.get("amount"), "Amount")
        note = str(data.get("note", "")).strip()
        return (expense_date, category, amount, note)
    raise ValueError("Unknown resource.")

@app.post("/api/admin/<resource>")
@admin_required
def create_admin_resource(resource):
    if resource not in ("books", "drinks", "materials", "expenses"):
        return api_error("Unknown resource.", 404)
    try:
        values = resource_values(resource, request.get_json(silent=True) or {})
        fields = {
            "books": "title, author, type, cost_price, sell_price, stock_quantity, reorder_level",
            "drinks": "name, sell_price, recipe_json, category", # Updated fields
            "materials": "name, unit, cost_per_unit, current_stock, reorder_level",
            "expenses": "date, category, amount, note",
        }[resource]
        placeholders = ", ".join("?" for _ in values)
        cursor = get_db().execute(
            "INSERT INTO " + resource + "(" + fields + ") VALUES (" + placeholders + ")", values
        )
        get_db().commit()
        return jsonify({"id": cursor.lastrowid}), 201
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, sqlite3.IntegrityError) as error:
        get_db().rollback()
        return api_error(str(error))

@app.route("/api/admin/<resource>/<int:item_id>", methods=["PUT", "DELETE"])
@admin_required
def edit_admin_resource(resource, item_id):
    if resource not in ("books", "drinks", "materials", "expenses"):
        return api_error("Unknown resource.", 404)
    db = get_db()
    if request.method == "DELETE":
        try:
            if resource == "materials":
                recipes = db.execute("SELECT recipe_json FROM drinks").fetchall()
                for row in recipes:
                    try:
                        recipe = json.loads(row["recipe_json"])
                    except json.JSONDecodeError:
                        continue
                    if isinstance(recipe, list) and any(
                        isinstance(item, dict) and str(item.get("material_id")) == str(item_id)
                        for item in recipe
                    ):
                        return api_error("This material is used in a drink recipe and cannot be deleted.", 409)
            cursor = db.execute("DELETE FROM " + resource + " WHERE id = ?", (item_id,))
            if cursor.rowcount == 0:
                return api_error("Record not found.", 404)
            db.commit()
            return jsonify({"ok": True})
        except sqlite3.IntegrityError:
            db.rollback()
            return api_error("This material is used in a drink recipe and cannot be deleted.", 409)
    try:
        values = resource_values(resource, request.get_json(silent=True) or {})
        fields = {
            "books": "title, author, type, cost_price, sell_price, stock_quantity, reorder_level",
            "drinks": "name, sell_price, recipe_json, category", # Updated fields
            "materials": "name, unit, cost_per_unit, current_stock, reorder_level",
            "expenses": "date, category, amount, note",
        }[resource].split(", ")
        assignments = ", ".join(field + " = ?" for field in fields)
        cursor = db.execute(
            "UPDATE " + resource + " SET " + assignments + " WHERE id = ?", values + (item_id,)
        )
        if cursor.rowcount == 0:
            return api_error("Record not found.", 404)
        db.commit()
        return jsonify({"ok": True})
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, sqlite3.IntegrityError) as error:
        db.rollback()
        return api_error(str(error))

@app.get("/api/admin/reports")
@admin_required
def monthly_report():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    try:
        parsed = datetime.strptime(month, "%Y-%m")
    except ValueError:
        return api_error("Month must use YYYY-MM.")
    prefix = parsed.strftime("%Y-%m")
    orders = get_db().execute(
        "SELECT total_amount, items_json FROM orders WHERE substr(timestamp, 1, 7) = ? AND status = 'completed'",
        (prefix,),
    ).fetchall()
    revenue = sum(row["total_amount"] for row in orders)
    cogs = sum(
        item["unit_cost"] * item["quantity"]
        for row in orders
        for item in json.loads(row["items_json"])
    )
    expenses = get_db().execute(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE substr(date, 1, 7) = ?",
        (prefix,),
    ).fetchone()["total"]
    return jsonify({
        "month": prefix,
        "revenue": round(revenue, 2),
        "cogs": round(cogs, 2),
        "expenses": round(expenses, 2),
        "profit": round(revenue - cogs - expenses, 2),
        "orders": len(orders),
    })

@app.get("/api/admin/settings")
@admin_required
def get_settings():
    rows = get_db().execute(
        "SELECT key, value FROM settings WHERE key IN ('shop_name', 'shop_address')"
    )
    return jsonify(dict(rows))

@app.put("/api/admin/settings")
@admin_required
def update_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return api_error("Settings must be a JSON object.")
    name = str(data.get("shop_name", "")).strip()
    address = str(data.get("shop_address", "")).strip()
    if not name:
        return api_error("Shop name is required.")
    db = get_db()
    db.execute("UPDATE settings SET value = ? WHERE key = 'shop_name'", (name,))
    db.execute("UPDATE settings SET value = ? WHERE key = 'shop_address'", (address,))
    db.commit()
    return jsonify({"ok": True})

@app.put("/api/admin/password")
@admin_required
def change_password():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return api_error("Password data must be a JSON object.")
    
    new_password = data.get("new_password", "")
    
    # Validation: Only check length and existence of new password
    if not isinstance(new_password, str) or len(new_password) < 6:
        return api_error("New password must be at least 6 characters.")
    
    db = get_db()
    # Update directly without checking old password since session is already validated by @admin_required
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(new_password), session["admin_id"]),
    )
    db.commit()
    return jsonify({"ok": True})


def run_desktop():
    from werkzeug.serving import make_server

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    address = "http://127.0.0.1:" + str(server.server_port)
    try:
        import webview

        webview.create_window("Book Mart", address, width=1100, height=720, min_size=(760, 540))
        webview.start()
    except ImportError:
        app.logger.warning("pywebview is unavailable; opening the local app in the default browser.")
        webbrowser.open(address)
        thread.join()
    finally:
        server.shutdown()


if __name__ == "__main__":
    initialize_database()
    if "--web" in sys.argv:
        app.run(host="127.0.0.1", port=5000, threaded=True)
    else:
        run_desktop()
else:
    initialize_database()