"""Local POS application. Build with PyInstaller from a 32-bit Win7 environment."""

import csv
import html
import io
import json
import math
import os
import secrets
import sqlite3
import sys
import threading
import unicodedata
import webbrowser
from datetime import date, datetime
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, redirect, render_template, request, send_file, session, url_for, abort
from werkzeug.security import check_password_hash, generate_password_hash


DEFAULT_SHOP_NAME = "Book Mart"
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 1000
MATERIAL_UNITS = {
    "kg": "كجم",
    "L": "لتر",
    "pcs": "قطعة",
}
DRINK_CATEGORIES = {
    "hot": "ساخن",
    "espresso": "إسبريسو",
    "juice": "عصائر طازة",
    "frappe": "فريبي/بلند",
    "iced": "مشروبات مثلجة",
    "soda": "موهيتو/صودا",
    "smoothie": "سموذي",
    "milkshake": "ميلك شيك",
    "hotchoc": "ساکولاة ساخنة",
}
RETAIL_CATEGORIES = {
    "softdrink": "مشروبات غازية/جاهزة",
    "cookie": "کوكيز",
    "extra": "إضافات",
}
CATEGORY_SEEDS = [
    (slug, label, "drink", order)
    for order, (slug, label) in enumerate(DRINK_CATEGORIES.items(), 1)
] + [
    (slug, label, "retail", order)
    for order, (slug, label) in enumerate(RETAIL_CATEGORIES.items(), 1)
]
SEEDED_DRINKS = [
    ("شاي", "hot", 30), ("يانسون", "hot", 40), ("أعشاب", "hot", 35),
    ("قهوة تركي", "hot", 50), ("قهوة فرنسي", "hot", 65), ("قهوة بندق", "hot", 70),
    ("سايدر ساخن", "hot", 70),
    ("إسبريسو شوت", "espresso", 75), ("ماكياتو", "espresso", 80),
    ("كورتادو", "espresso", 85), ("فلات وايت", "espresso", 100),
    ("لاتيه", "espresso", 110), ("كابتشينو", "espresso", 110),
    ("موكا", "espresso", 120), ("موكا أبيض", "espresso", 120),
    ("عصير فراولة", "juice", 90), ("عصير مانجو", "juice", 90),
    ("عصير ليمون", "juice", 70), ("عصير برتقال", "juice", 75),
    ("فريبي كلاسيك", "frappe", 130), ("فريبي كراميل", "frappe", 140),
    ("فريبي سولتد كراميل", "frappe", 140), ("فريبي كراميل كريم بروليه", "frappe", 140),
    ("فريبي موكا", "frappe", 140), ("فريبي موكا أبيض", "frappe", 140),
    ("ماتشا بلند", "frappe", 150), ("فريبي فراولة", "frappe", 130),
    ("فريبي خوخ", "frappe", 130), ("فريبي باشن فروت", "frappe", 130),
    ("فريبي بلوبيري", "frappe", 130),
    ("آيس لاتيه", "iced", 110), ("آيس كابتشينو", "iced", 110),
    ("آيس موكا", "iced", 120), ("آيس موكا أبيض", "iced", 120),
    ("آيس ماتشا لاتيه", "iced", 120), ("آيس إسبانيش لاتيه", "iced", 130),
    ("آيس شيكن وايت موكا", "iced", 150),
    ("موهيتو كلاسيك", "soda", 90), ("موهيتو مانجو", "soda", 100),
    ("موهيتو بلوبيري", "soda", 100), ("موهيتو فراولة", "soda", 100),
    ("موهيتو باشن فروت", "soda", 100), ("بلو كوراساو", "soda", 100),
    ("ميكس ريدبول", "soda", 120), ("كريزي بينك", "soda", 130),
    ("سموذي فراولة", "smoothie", 100), ("سموذي خوخ", "smoothie", 100),
    ("سموذي بلوبيري", "smoothie", 100), ("سموذي باشن فروت", "smoothie", 100),
    ("ميلك شيك شوكولاتة", "milkshake", 140), ("ميلك شيك كراميل", "milkshake", 140),
    ("ميلك شيك سولتد كراميل", "milkshake", 140), ("ميلك شيك فانيليا", "milkshake", 140),
    ("ميلك شيك أوريو", "milkshake", 140), ("ميلك شيك خوخ", "milkshake", 140),
    ("ميلك شيك باشن فروت", "milkshake", 140), ("ميلك شيك فراولة", "milkshake", 140),
    ("ميلك شيك بلوبيري", "milkshake", 140), ("ميلك شيك كيوي", "milkshake", 140),
    ("ميلك شيك مانجو", "milkshake", 140),
    ("ساکولاة ساخنة", "hotchoc", 110), ("ساکولاة مارشميلو", "hotchoc", 125),
    ("ساکولاة فراولة", "hotchoc", 130),
]
SEEDED_RETAIL = [
    ("بيبسي", "softdrink", 50), ("ريدبول", "softdrink", 80), ("مية", "softdrink", 15),
    ("كلاسيك كوكيز", "cookie", 50), ("ريد فيلفيت كوكيز", "cookie", 60),
    ("نكهة إضافية", "extra", 30), ("صوص إضافي", "extra", 30),
    ("دريم ويب", "extra", 30), ("شوت إسبريسو", "extra", 40),
]
RETAIL_BOOK_ALIASES = {
    "بيبسي": ("بيبسي", "softdrink", 50),
    "pepsi": ("بيبسي", "softdrink", 50),
    "softdrink": ("بيبسي", "softdrink", 50),
    "ريدبول": ("ريدبول", "softdrink", 80),
    "redbull": ("ريدبول", "softdrink", 80),
    "red bull": ("ريدبول", "softdrink", 80),
    "مية": ("مية", "softdrink", 15),
    "water": ("مية", "softdrink", 15),
    "cookie": ("كلاسيك كوكيز", "cookie", 50),
    "cookies": ("كلاسيك كوكيز", "cookie", 50),
    "كلاسيك كوكيز": ("كلاسيك كوكيز", "cookie", 50),
    "كوكيز": ("كلاسيك كوكيز", "cookie", 50),
    "کوكيز": ("كلاسيك كوكيز", "cookie", 50),
    "ريد فيلفيت كوكيز": ("ريد فيلفيت كوكيز", "cookie", 60),
    "extra": ("نكهة إضافية", "extra", 30),
    "extras": ("نكهة إضافية", "extra", 30),
    "نكهة إضافية": ("نكهة إضافية", "extra", 30),
    "صوص إضافي": ("صوص إضافي", "extra", 30),
    "اضافات": ("نكهة إضافية", "extra", 30),
    "إضافات": ("نكهة إضافية", "extra", 30),
    "دريم ويب": ("دريم ويب", "extra", 30),
    "شوت إسبريسو": ("شوت إسبريسو", "extra", 40),
}
SEEDED_BOOKS = [
    ("موسوعة العلوم", "Original", 80, 110, 39),
    ("رواية الظل", "High Copy", 60, 100, 6),
]


def resource_path(relative_path):
    """Resolve bundled resources both in development and in a PyInstaller build."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


def data_directory():
    override = os.environ.get("BOOK_MART_DATA_DIR")
    if override:
        location = Path(override)
    elif os.environ.get("LOCALAPPDATA"):
        location = Path(os.environ["LOCALAPPDATA"]) / DEFAULT_SHOP_NAME.replace(" ", "")
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
    MAX_CONTENT_LENGTH=MAX_IMPORT_BYTES + 65536,
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


def seed_catalog(db):
    for name, category, price in SEEDED_DRINKS:
        seed = db.execute(
            "INSERT OR IGNORE INTO catalog_seed_keys(name, kind, category) VALUES (?, 'drink', ?)",
            (name, category),
        )
        if seed.rowcount:
            exists = db.execute(
                "SELECT 1 FROM drinks WHERE name = ? AND category = ? LIMIT 1",
                (name, category),
            ).fetchone()
            if not exists:
                db.execute(
                    "INSERT OR IGNORE INTO drinks(name, sell_price, recipe_json, category) "
                    "VALUES (?, ?, '[]', ?)",
                    (name, price, category),
                )

    for name, category, price in SEEDED_RETAIL:
        seed = db.execute(
            "INSERT OR IGNORE INTO catalog_seed_keys(name, kind, category) VALUES (?, 'retail', ?)",
            (name, category),
        )
        if seed.rowcount:
            db.execute(
                """INSERT OR IGNORE INTO retail
                   (name, category, cost_price, sell_price, stock_quantity, unit)
                   VALUES (?, ?, 0, ?, 0, 'قطعة')""",
                (name, category, price),
            )

    for title, book_type, cost, price, stock in SEEDED_BOOKS:
        seed = db.execute(
            "INSERT OR IGNORE INTO catalog_seed_keys(name, kind, category) VALUES (?, 'book', ?)",
            (title, book_type),
        )
        if seed.rowcount:
            exists = db.execute(
                "SELECT 1 FROM books WHERE title = ? AND type = ? LIMIT 1",
                (title, book_type),
            ).fetchone()
            if not exists:
                db.execute(
                    """INSERT OR IGNORE INTO books
                       (title, author, publisher, type, cost_price, sell_price, stock_quantity)
                       VALUES (?, '', '', ?, ?, ?, ?)""",
                    (title, book_type, cost, price, stock),
                )


def normalized_catalog_name(value):
    text = str(value or "").strip().casefold().replace("ك", "ک").replace("ى", "ي")
    return "".join(character for character in text if character.isalnum())


def migrated_retail_details(title):
    normalized = normalized_catalog_name(title)
    for alias, details in RETAIL_BOOK_ALIASES.items():
        alias_normalized = normalized_catalog_name(alias)
        if alias_normalized == normalized or (
            len(alias_normalized) >= 5 and normalized.startswith(alias_normalized)
        ):
            return details
    if any(
        normalized_catalog_name(keyword) in normalized
        for keyword in ("كوكيز", "کوكيز")
    ):
        return (str(title).strip(), "cookie", 0)
    if any(
        normalized_catalog_name(keyword) in normalized
        for keyword in ("إضافات", "إضافي", "اضافي")
    ):
        return (str(title).strip(), "extra", 0)
    return None


def is_retail_book_collision(title):
    if migrated_retail_details(title) is not None:
        return True
    normalized = normalized_catalog_name(title)
    return any(
        normalized_catalog_name(keyword) in normalized
        for keyword in ("كوكيز", "کوكيز", "إضافات", "إضافي", "اضافي")
    )


def migrate_retail_books(db):
    if db.execute(
        "SELECT 1 FROM settings WHERE key = 'retail_books_migrated_v1'"
    ).fetchone():
        return
    books = db.execute("SELECT id, title, sell_price FROM books ORDER BY id").fetchall()
    for book in books:
        details = migrated_retail_details(book["title"])
        if details is None:
            continue
        retail_name, category, default_price = details
        db.execute(
            """INSERT OR IGNORE INTO retail
               (name, category, cost_price, sell_price, stock_quantity, unit)
               VALUES (?, ?, 0, ?, 0, 'قطعة')""",
            (retail_name, category, book["sell_price"] or default_price),
        )
        db.execute(
            "UPDATE retail SET sell_price = ? WHERE name = ? AND category = ?",
            (book["sell_price"] if book["sell_price"] is not None else default_price, retail_name, category),
        )
        db.execute("DELETE FROM books WHERE id = ?", (book["id"],))
    db.execute(
        "INSERT INTO settings(key, value) VALUES ('retail_books_migrated_v1', 'complete')"
    )


def seed_categories(db):
    for slug, label, scope, sort_order in CATEGORY_SEEDS:
        db.execute(
            """INSERT OR IGNORE INTO categories
               (slug, label_ar, scope, sort_order, is_active, created_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (slug, label, scope, sort_order, datetime.now().astimezone().isoformat(timespec="seconds")),
        )
    for table, scope in (("drinks", "drink"), ("retail", "retail")):
        for row in db.execute("SELECT DISTINCT category FROM " + table).fetchall():
            category = str(row["category"] or "").strip()
            if table == "drinks" and category.lower() == "cold":
                category = "iced"
            if not category:
                continue
            existing = db.execute(
                "SELECT scope FROM categories WHERE slug = ?", (category,)
            ).fetchone()
            if existing and existing["scope"] != scope:
                base = scope + "-" + category_slug_base(category)
                candidate = base
                suffix = 2
                while db.execute(
                    "SELECT 1 FROM categories WHERE slug = ?", (candidate,)
                ).fetchone():
                    candidate = base + "-" + str(suffix)
                    suffix += 1
                db.execute(
                    "UPDATE " + table + " SET category = ? WHERE category = ?",
                    (candidate, category),
                )
                category = candidate
            db.execute(
                """INSERT OR IGNORE INTO categories
                   (slug, label_ar, scope, sort_order, is_active, created_at)
                   VALUES (?, ?, ?, 100, 1, ?)""",
                (category, category, scope, datetime.now().astimezone().isoformat(timespec="seconds")),
            )


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
                publisher TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT '', -- ORIGINAL/HIGH COPY
                cost_price REAL NOT NULL CHECK(cost_price >= 0),
                sell_price REAL NOT NULL CHECK(sell_price >= 0),
                stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0)
            );
            CREATE TABLE IF NOT EXISTS retail (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                cost_price REAL NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
                sell_price REAL NOT NULL CHECK(sell_price >= 0),
                stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
                unit TEXT NOT NULL DEFAULT 'قطعة',
                UNIQUE(name, category)
            );
            CREATE TABLE IF NOT EXISTS catalog_seed_keys (
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                category TEXT NOT NULL,
                PRIMARY KEY(name, kind, category)
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                timestamp TEXT NOT NULL,
                total_amount REAL NOT NULL,
                items_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                cancelled_at TEXT
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
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                label_ar TEXT NOT NULL,
                scope TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 100,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT
            );
            """
        )
        
        # Migration Logic: Add columns if they don't exist (for older databases)
        migrations = [
            ("materials", "reorder_level", "REAL NOT NULL DEFAULT 5"),
            ("drinks", "category", "TEXT NOT NULL DEFAULT 'hot'"), # Ensure category exists
            ("books", "publisher", "TEXT NOT NULL DEFAULT ''"),
            ("orders", "cancelled_at", "TEXT"),
        ]
        
        for table, column, definition in migrations:
            try:
                cols = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
                if column not in cols:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                    print(f"Migrated: Added '{column}' to '{table}'")
            except Exception as e:
                print(f"Migration warning for {table}.{column}: {e}")

        # Legacy book reorder_level is intentionally retained in old databases but unused.
        if not db.execute(
            "SELECT 1 FROM settings WHERE key = 'data_normalization_v1'"
        ).fetchone():
            # One-time normalization: Arabic book types and recognizable material units only.
            db.execute(
                "UPDATE books SET type = 'Original' WHERE LOWER(TRIM(type)) IN ('أصلي', 'أصلية')"
            )
            db.execute(
                "UPDATE books SET type = 'High Copy' WHERE LOWER(TRIM(type)) IN ('نسخة عالية', 'نسخة', 'هاي كوبي')"
            )
            for row in db.execute("SELECT id, unit FROM materials").fetchall():
                normalized_unit = normalize_material_unit(row["unit"])
                if normalized_unit:
                    db.execute("UPDATE materials SET unit = ? WHERE id = ?", (normalized_unit, row["id"]))
            db.execute(
                "INSERT INTO settings(key, value) VALUES ('data_normalization_v1', 'complete')"
            )
        if not db.execute(
            "SELECT 1 FROM settings WHERE key = 'drink_categories_v2'"
        ).fetchone():
            db.execute("UPDATE drinks SET category = 'iced' WHERE LOWER(TRIM(category)) = 'cold'")
            db.execute(
                "INSERT INTO settings(key, value) VALUES ('drink_categories_v2', 'complete')"
            )

        seed_categories(db)
        migrate_retail_books(db)
        seed_catalog(db)
        db.execute(
            "INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)",
            ("admin", generate_password_hash("123456"), "admin"),
        )
        db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('secret_key', ?)",
            (secrets.token_hex(32),),
        )
        db.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES ('shop_name', ?)",
            (DEFAULT_SHOP_NAME,),
        )
        db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('shop_address', '')")
        app.config["SECRET_KEY"] = db.execute(
            "SELECT value FROM settings WHERE key = 'secret_key'"
        ).fetchone()["value"]
        db.commit()


def api_error(message, status=400):
    return jsonify({"error": message}), status


@app.errorhandler(413)
def request_too_large(_error):
    return api_error("حجم الملف يتجاوز الحد المسموح للاستيراد.")


def normalize_material_unit(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    text = "".join(character for character in text if not unicodedata.combining(character))
    aliases = {
        "kg": "kg", "كيلو": "kg", "كجم": "kg", "كغ": "kg",
        "kilogram": "kg", "kilograms": "kg",
        "l": "L", "لتر": "L", "ل": "L", "liter": "L", "litre": "L",
        "pcs": "pcs", "pc": "pcs", "piece": "pcs", "pieces": "pcs",
        "قطعة": "pcs", "حبة": "pcs",
    }
    return aliases.get(text)


def material_unit_label(value):
    return MATERIAL_UNITS.get(value, value or "")


def normalize_book_type(value):
    normalized = str(value or "").strip().casefold()
    if normalized == "original":
        return "Original"
    if normalized == "high copy":
        return "High Copy"
    raise ValueError("نوع الكتاب يجب أن يكون Original أو High Copy.")


def current_shop_name():
    row = get_db().execute("SELECT value FROM settings WHERE key = 'shop_name'").fetchone()
    return (row["value"].strip() if row and row["value"] else "") or DEFAULT_SHOP_NAME


def shop_name_direction(name):
    return "rtl" if any("\u0600" <= character <= "\u06ff" for character in name) else "ltr"


def shop_template_context():
    name = current_shop_name()
    return {
        "shop_name": name,
        "shop_name_dir": shop_name_direction(name),
        "logo_available": resource_path("static/img/logo.png").is_file(),
    }


def admin_required(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not session.get("admin_id"):
            return api_error("يرجى تسجيل الدخول للمتابعة.", 401)
        return function(*args, **kwargs)

    return wrapped


def cashier_session_required(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not session.get("cashier_session") and not session.get("admin_id"):
            return api_error("افتح شاشة الكاشير أولاً.", 401)
        return function(*args, **kwargs)

    return wrapped


def positive_number(value, label, allow_zero=True):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(label + " يجب أن يكون رقمًا.")
    if not math.isfinite(number) or number < 0 or (not allow_zero and number == 0):
        raise ValueError(label + (" يجب أن يكون صفرًا أو أكثر." if allow_zero else " يجب أن يكون أكبر من صفر."))
    return number


def product_recipe_cost(db, recipe):
    if not isinstance(recipe, list):
        raise ValueError("يجب أن تكون الوصفة قائمة مكونات صالحة.")
    cost = 0.0
    for ingredient in recipe:
        if not isinstance(ingredient, dict) or "material_id" not in ingredient or "qty" not in ingredient:
            raise ValueError("يجب تحديد المادة والكمية لكل مكوّن.")
        try:
            material_id = int(ingredient["material_id"])
        except (TypeError, ValueError):
            raise ValueError("معرّف المادة في الوصفة غير صالح.")
        quantity = positive_number(ingredient["qty"], "كمية المكوّن", False)
        material = db.execute(
            "SELECT cost_per_unit FROM materials WHERE id = ?", (material_id,)
        ).fetchone()
        if material is None:
            raise ValueError("تشير الوصفة إلى مادة غير موجودة.")
        cost += material["cost_per_unit"] * quantity
    return cost


# --- Routes ---

@app.get("/")
def cashier_page():
    session["cashier_session"] = True
    return render_template("cashier.html", **shop_template_context())

@app.get("/admin/login")
def admin_login_page():
    if session.get("admin_id"):
        return redirect(url_for("admin_dashboard_page"))
    return render_template("admin_login.html", **shop_template_context())

@app.post("/admin/login")
def admin_login():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    user = get_db().execute(
        "SELECT id, password_hash FROM users WHERE username = ? AND role = 'admin'",
        (username,),
    ).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return render_template(
            "admin_login.html",
            error="اسم المستخدم أو كلمة المرور غير صحيحة.",
            **shop_template_context(),
        ), 401
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
    return render_template("admin_dashboard.html", **shop_template_context())


# --- API Endpoints ---

@app.get("/api/products")
def product_list():
    """Unified endpoint for Cashier Grid - Includes Type & Category"""
    query = request.args.get("q", "").strip().lower()
    db = get_db()
    category_labels = {
        row["slug"]: row["label_ar"]
        for row in db.execute("SELECT slug, label_ar FROM categories")
    }
    
    # Fetch Books - Include 'type'
    books_sql = "SELECT id, title AS name, author, publisher, sell_price, stock_quantity AS stock, 'book' AS kind, type FROM books"
    
    # Fetch Drinks - Include 'category'
    drinks_sql = "SELECT id, name, sell_price, recipe_json, NULL AS stock, 'drink' AS kind, category FROM drinks"
    retail_sql = (
        "SELECT id, name, sell_price, stock_quantity AS stock, cost_price, unit, "
        "'retail' AS kind, category FROM retail"
    )
    
    params_books = ()
    params_drinks = ()
    
    if query:
        # Search by Name, Author, Type (Books) or Name, Category (Drinks)
        books_sql += " WHERE LOWER(title) LIKE ? OR LOWER(author) LIKE ? OR LOWER(type) LIKE ?"
        drinks_sql += " WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ?"
        retail_sql += " WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ?"
        
        like_q = f"%{query}%"
        params_books = (like_q, like_q, like_q)
        params_drinks = (like_q, like_q)
        params_retail = (like_q, like_q)
    else:
        params_retail = ()
        
    books_sql += " ORDER BY title LIMIT 100"
    drinks_sql += " ORDER BY name LIMIT 100"
    retail_sql += " ORDER BY name LIMIT 100"

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
        if str(drink.get("category", "")).strip().lower() == "cold":
            drink["category"] = "iced"
        drink["category_label"] = category_labels.get(
            drink["category"], drink["category"]
        )
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

    retail_products = []
    for row in db.execute(retail_sql, params_retail):
        product = dict(row)
        product["max_sellable_qty"] = max(0, int(product["stock"] or 0))
        product["category_label"] = category_labels.get(
            product["category"], product["category"]
        )
        retail_products.append(product)
    
    # Combine and sort alphabetically by name
    all_products = books + drinks + retail_products
    all_products.sort(key=lambda x: x['name'].lower())
    
    return jsonify(all_products)


@app.post("/api/orders")
def create_order():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return api_error("بيانات الطلب غير صالحة.")
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return api_error("السلة فارغة.")
    if len(items) > 100:
        return api_error("عدد المنتجات في الطلب أكبر من المسموح.")
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        snapshots = []
        material_use = {}
        total = 0.0
        for entry in items:
            if not isinstance(entry, dict):
                raise ValueError("أحد عناصر السلة غير صالح.")
            kind = entry.get("kind")
            try:
                product_id = int(entry.get("id"))
                quantity = int(entry.get("quantity"))
            except (TypeError, ValueError):
                raise ValueError("المنتج أو الكمية غير صالحين.")
            if quantity < 1 or quantity > 10000:
                raise ValueError("يجب أن تكون الكمية بين 1 و10,000.")
            
            if kind == "book":
                product = db.execute(
                    "SELECT id, title, cost_price, sell_price, stock_quantity FROM books WHERE id = ?",
                    (product_id,),
                ).fetchone()
                if product is None:
                    raise ValueError("أحد الكتب في السلة لم يعد موجودًا.")
                if product["stock_quantity"] < quantity:
                    raise ValueError("المخزون غير كافٍ من الكتاب: " + product["title"] + ".")
                db.execute(
                    "UPDATE books SET stock_quantity = stock_quantity - ? WHERE id = ?",
                    (quantity, product_id),
                )
                name, price = product["title"], product["sell_price"]
                unit_cost = product["cost_price"]
            elif kind == "retail":
                product = db.execute(
                    """SELECT id, name, cost_price, sell_price, stock_quantity, unit
                       FROM retail WHERE id = ?""",
                    (product_id,),
                ).fetchone()
                if product is None:
                    raise ValueError("أحد المنتجات الجاهزة في السلة لم يعد موجودًا.")
                if product["stock_quantity"] < quantity:
                    raise ValueError("المخزون غير كافٍ من المنتج: " + product["name"] + ".")
                db.execute(
                    "UPDATE retail SET stock_quantity = stock_quantity - ? WHERE id = ?",
                    (quantity, product_id),
                )
                name, price = product["name"], product["sell_price"]
                unit_cost = product["cost_price"]
            elif kind == "drink":
                product = db.execute("SELECT * FROM drinks WHERE id = ?", (product_id,)).fetchone()
                if product is None:
                    raise ValueError("أحد المشروبات في السلة لم يعد موجودًا.")
                try:
                    recipe = json.loads(product["recipe_json"])
                except json.JSONDecodeError:
                    raise ValueError("وصفة المشروب " + product["name"] + " غير صالحة.")
                if not isinstance(recipe, list):
                    raise ValueError("وصفة المشروب " + product["name"] + " غير صالحة.")
                unit_cost = product_recipe_cost(db, recipe)
                line_materials = {}
                for ingredient in recipe:
                    try:
                        material_id = int(ingredient["material_id"])
                        amount = positive_number(ingredient["qty"], "Recipe quantity", False)
                    except (KeyError, TypeError, ValueError) as error:
                        raise ValueError("وصفة المشروب " + product["name"] + " غير صالحة: " + str(error))
                    material_use[material_id] = material_use.get(material_id, 0) + amount * quantity
                    line_materials[material_id] = line_materials.get(material_id, 0) + amount * quantity
                name, price = product["name"], product["sell_price"]
            else:
                raise ValueError("نوع المنتج غير معروف.")
            
            total += price * quantity
            snapshot = {
                "id": product_id,
                "kind": kind,
                "name": name,
                "quantity": quantity,
                "unit_price": price,
                "unit_cost": unit_cost,
                "line_total": round(price * quantity, 2),
            }
            if kind == "drink":
                snapshot["materials_used"] = [
                    {"material_id": material_id, "total_qty": amount}
                    for material_id, amount in line_materials.items()
                ]
            snapshots.append(snapshot)
        
        # Deduct Materials Stock
        for material_id, amount in material_use.items():
            material = db.execute(
                "SELECT name, current_stock FROM materials WHERE id = ?", (material_id,)
            ).fetchone()
            if material is None:
                raise ValueError("تشير وصفة أحد المشروبات إلى مادة غير موجودة.")
            if material["current_stock"] + 1e-9 < amount:
                raise ValueError("المخزون غير كافٍ من المادة: " + material["name"] + ".")
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
        return api_error("حدث خطأ أثناء حفظ الطلب. يرجى المحاولة مرة أخرى.", 500)


@app.post("/api/orders/void-last")
@cashier_session_required
def void_last_order():
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        order = db.execute(
            "SELECT id, items_json FROM orders WHERE status = 'completed' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if order is None:
            db.rollback()
            return api_error("لا توجد عملية بيع لإلغائها.", 404)

        try:
            items = json.loads(order["items_json"])
        except (TypeError, json.JSONDecodeError):
            raise ValueError("تعذر قراءة تفاصيل آخر عملية بيع؛ لم يتم تغيير المخزون.")
        if not isinstance(items, list):
            raise ValueError("تفاصيل آخر عملية بيع غير صالحة؛ لم يتم تغيير المخزون.")

        for item in items:
            if not isinstance(item, dict):
                raise ValueError("تفاصيل أحد المنتجات غير صالحة؛ لم يتم تغيير المخزون.")
            try:
                product_id = int(item["id"])
                quantity = int(item["quantity"])
            except (KeyError, TypeError, ValueError):
                raise ValueError("بيانات مخزون أحد المنتجات غير صالحة؛ لم يتم تغيير المخزون.")
            if product_id < 1 or quantity < 1:
                raise ValueError("بيانات مخزون أحد المنتجات غير صالحة؛ لم يتم تغيير المخزون.")

            kind = item.get("kind")
            if kind in ("book", "retail"):
                table = "books" if kind == "book" else "retail"
                cursor = db.execute(
                    "UPDATE " + table + " SET stock_quantity = stock_quantity + ? WHERE id = ?",
                    (quantity, product_id),
                )
                if cursor.rowcount != 1:
                    raise ValueError("تعذر العثور على منتج لإرجاع مخزونه؛ لم يتم إلغاء العملية.")
            elif kind == "drink":
                materials_used = item.get("materials_used")
                if not isinstance(materials_used, list):
                    raise ValueError(
                        "هذه عملية بيع قديمة ولا تحتوي على تفاصيل المواد اللازمة لإرجاع المخزون."
                    )
                for used in materials_used:
                    if not isinstance(used, dict):
                        raise ValueError("تفاصيل المواد المستهلكة غير صالحة؛ لم يتم إلغاء العملية.")
                    try:
                        material_id = int(used["material_id"])
                        total_qty = positive_number(used["total_qty"], "كمية المادة", False)
                    except (KeyError, TypeError, ValueError) as error:
                        raise ValueError("تفاصيل المواد المستهلكة غير صالحة: " + str(error))
                    cursor = db.execute(
                        "UPDATE materials SET current_stock = current_stock + ? WHERE id = ?",
                        (total_qty, material_id),
                    )
                    if cursor.rowcount != 1:
                        raise ValueError("تعذر العثور على مادة لإرجاع مخزونها؛ لم يتم إلغاء العملية.")
            else:
                raise ValueError("نوع منتج غير معروف في آخر عملية بيع؛ لم يتم إلغاؤها.")

        cancelled_at = datetime.now().astimezone().isoformat(timespec="seconds")
        cursor = db.execute(
            "UPDATE orders SET status = 'cancelled', cancelled_at = ? "
            "WHERE id = ? AND status = 'completed'",
            (cancelled_at, order["id"]),
        )
        if cursor.rowcount != 1:
            raise ValueError("تم تغيير حالة العملية بالفعل؛ لم يتم إلغاء العملية مرة أخرى.")
        db.commit()
        app.logger.info("Order %s voided and stock restored", order["id"])
        return jsonify({"ok": True, "order_id": order["id"], "cancelled_at": cancelled_at})
    except ValueError as error:
        db.rollback()
        return api_error(str(error), 409)
    except Exception:
        db.rollback()
        app.logger.exception("Unexpected error voiding the latest order")
        return api_error("حدث خطأ أثناء إلغاء العملية؛ لم يتم تغيير حالة الطلب.", 500)


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
    shop_name = (shop.get("shop_name") or "").strip() or DEFAULT_SHOP_NAME
    shop_name_direction_value = shop_name_direction(shop_name)
    receipt_datetime = datetime.fromisoformat(order["timestamp"])
    receipt_time = receipt_datetime.strftime("%Y/%m/%d %I:%M %p")
    receipt_time = receipt_time.replace("AM", "ص").replace("PM", "م")
    
    # Build simple HTML string
    logo_html = (
        '<img src="/static/img/logo.png" alt="" style="max-width:110px;max-height:55px;margin-bottom:4px">'
        if resource_path("static/img/logo.png").is_file()
        else ""
    )
    html_content = f"""
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="utf-8">
        <style>
            /* Thermal Printer Styles */
            body {{ direction: rtl; font-family: 'Cairo','Tajawal','IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif; width: 280px; margin: 0 auto; padding: 10px; font-size: 13px; color: #2b2118; background: white; }}
            .header {{ text-align: center; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }}
            .shop-name {{ font-weight: bold; font-size: 14px; unicode-bidi: isolate; }}
            .info {{ font-size: 10px; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 5px; }}
            th, td {{ text-align: right; padding: 2px 0; vertical-align: top; }}
            .right {{ direction: ltr; text-align: left; unicode-bidi: isolate; }}
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
            {logo_html}
            <div class="shop-name"><bdi dir="{shop_name_direction_value}">{html.escape(shop_name)}</bdi></div>
            <div class="info">{html.escape(shop.get('shop_address', ''))}</div>
            <div class="info"><bdi dir="ltr">{receipt_time}</bdi></div>
            <div class="info">رقم الطلب: <bdi dir="ltr">{order['id']}</bdi></div>
        </div>
        
        <table>
            <tr><th>الصنف</th><th class="right">الكمية</th><th class="right">الإجمالي</th></tr>
            {''.join(f"<tr><td>{html.escape(str(item['name'])[:20])}</td><td class='right'>{item['quantity']}</td><td class='right'>{item['line_total']:.2f}</td></tr>" for item in items)}
        </table>
        
        <div class="total-row">
            <span>الإجمالي:</span>
            <span class="right">{order['total_amount']:,.2f} ج.م</span>
        </div>
        
        <div class="footer">
            شكرًا لزيارتكم<br>نسعد بخدمتكم دائمًا
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


def category_product_count(db, category):
    if category["scope"] == "drink":
        return db.execute(
            "SELECT COUNT(*) AS count FROM drinks WHERE category = ?", (category["slug"],)
        ).fetchone()["count"]
    if category["scope"] == "retail":
        return db.execute(
            "SELECT COUNT(*) AS count FROM retail WHERE category = ?", (category["slug"],)
        ).fetchone()["count"]
    return 0


def category_rows(db, active_only=False):
    where = "WHERE c.is_active = 1" if active_only else ""
    rows = db.execute(
        """SELECT c.id, c.slug, c.label_ar, c.scope, c.sort_order, c.is_active, c.created_at
           FROM categories c """ + where + " ORDER BY c.scope, c.sort_order, c.id"
    ).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["is_active"] = bool(item["is_active"])
        item["product_count"] = category_product_count(db, item)
        results.append(item)
    return results


def category_slug_base(label):
    normalized = unicodedata.normalize("NFKD", label)
    characters = []
    separator = False
    for character in normalized:
        if unicodedata.combining(character):
            continue
        if character.isalnum():
            characters.append(character.lower())
            separator = False
        elif characters and not separator:
            characters.append("-")
            separator = True
    slug = "".join(characters).strip("-")
    return slug or "category"


@app.get("/api/categories/active")
def active_categories():
    return jsonify(category_rows(get_db(), True))


@app.get("/api/categories")
@admin_required
def list_categories():
    return jsonify(category_rows(get_db()))


@app.post("/api/categories")
@admin_required
def create_category():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return api_error("بيانات التصنيف غير صالحة.")
    label = str(data.get("label_ar", "")).strip()
    scope = str(data.get("scope", "")).strip().lower()
    if not label:
        return api_error("اسم التصنيف مطلوب.")
    if scope not in ("drink", "retail", "book"):
        return api_error("نطاق التصنيف غير صالح.")
    try:
        sort_order = int(data.get("sort_order", 100))
    except (TypeError, ValueError):
        return api_error("ترتيب التصنيف يجب أن يكون عددًا صحيحًا.")
    db = get_db()
    base = category_slug_base(label)
    slug = base
    suffix = 2
    while db.execute("SELECT 1 FROM categories WHERE slug = ?", (slug,)).fetchone():
        slug = base + "-" + str(suffix)
        suffix += 1
    try:
        cursor = db.execute(
            """INSERT INTO categories
               (slug, label_ar, scope, sort_order, is_active, created_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (slug, label, scope, sort_order, datetime.now().astimezone().isoformat(timespec="seconds")),
        )
        db.commit()
        item = dict(db.execute(
            "SELECT id, slug, label_ar, scope, sort_order, is_active, created_at "
            "FROM categories WHERE id = ?", (cursor.lastrowid,)
        ).fetchone())
        item["is_active"] = bool(item["is_active"])
        item["product_count"] = 0
        return jsonify(item), 201
    except sqlite3.IntegrityError:
        db.rollback()
        return api_error("تعذر إنشاء التصنيف بسبب تعارض في البيانات.")


@app.put("/api/categories/<int:category_id>")
@admin_required
def update_category(category_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return api_error("بيانات التصنيف غير صالحة.")
    # Product rows reference slug; only the display label and category metadata may change.
    if "slug" in data:
        return api_error("المعرّف الداخلي للتصنيف لا يمكن تغييره.")
    label = str(data.get("label_ar", "")).strip()
    scope = str(data.get("scope", "")).strip().lower()
    if not label:
        return api_error("اسم التصنيف مطلوب.")
    if scope not in ("drink", "retail", "book"):
        return api_error("نطاق التصنيف غير صالح.")
    try:
        sort_order = int(data.get("sort_order", 100))
    except (TypeError, ValueError):
        return api_error("ترتيب التصنيف يجب أن يكون عددًا صحيحًا.")
    active_value = data.get("is_active", True)
    if active_value not in (True, False, 0, 1):
        return api_error("حالة التصنيف غير صالحة.")
    db = get_db()
    category = db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if category is None:
        return api_error("التصنيف غير موجود.", 404)
    if scope != category["scope"] and category_product_count(db, category):
        return api_error("لا يمكن تغيير نطاق تصنيف عليه منتجات.", 409)
    try:
        db.execute(
            """UPDATE categories SET label_ar = ?, scope = ?, sort_order = ?, is_active = ?
               WHERE id = ?""",
            (label, scope, sort_order, int(bool(active_value)), category_id),
        )
        db.commit()
        return jsonify({"ok": True})
    except sqlite3.IntegrityError:
        db.rollback()
        return api_error("تعذر تحديث التصنيف.")


@app.delete("/api/categories/<int:category_id>")
@admin_required
def delete_category(category_id):
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    category = db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if category is None:
        db.rollback()
        return api_error("التصنيف غير موجود.", 404)
    count = category_product_count(db, category)
    reassign_to = request.args.get("reassign_to", "").strip()
    if count and not reassign_to:
        db.rollback()
        return api_error(
            "التصنيف عليه " + str(count) +
            " منتج. انقل المنتجات لتصنيف آخر أو عطّله بدل الحذف.", 409
        )
    try:
        if count:
            target = db.execute(
                "SELECT * FROM categories WHERE slug = ? AND scope = ? AND is_active = 1",
                (reassign_to, category["scope"]),
            ).fetchone()
            if target is None or target["id"] == category_id:
                raise ValueError("اختر تصنيفًا نشطًا آخر من النطاق نفسه لإعادة التعيين.")
            table = "drinks" if category["scope"] == "drink" else "retail"
            db.execute(
                "UPDATE " + table + " SET category = ? WHERE category = ?",
                (target["slug"], category["slug"]),
            )
        db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        db.commit()
        return jsonify({"ok": True, "reassigned": count})
    except ValueError as error:
        db.rollback()
        return api_error(str(error), 409)
    except sqlite3.Error:
        db.rollback()
        app.logger.exception("Unable to delete category %s", category_id)
        return api_error("تعذر حذف التصنيف؛ لم يتم نقل المنتجات.", 500)


@app.post("/api/categories/<int:category_id>/move")
@admin_required
def move_category(category_id):
    data = request.get_json(silent=True) or {}
    direction = data.get("direction") if isinstance(data, dict) else None
    if direction not in ("up", "down"):
        return api_error("اتجاه النقل غير صالح.")
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        category = db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        if category is None:
            db.rollback()
            return api_error("التصنيف غير موجود.", 404)
        rows = db.execute(
            "SELECT id FROM categories WHERE scope = ? ORDER BY sort_order, id",
            (category["scope"],),
        ).fetchall()
        ids = [row["id"] for row in rows]
        index = ids.index(category_id)
        neighbor_index = index - 1 if direction == "up" else index + 1
        if neighbor_index < 0 or neighbor_index >= len(ids):
            db.rollback()
            return jsonify({"ok": True, "moved": False})
        ids[index], ids[neighbor_index] = ids[neighbor_index], ids[index]
        for position, item_id in enumerate(ids, 1):
            db.execute(
                "UPDATE categories SET sort_order = ? WHERE id = ?",
                (position * 10, item_id),
            )
        db.commit()
        return jsonify({"ok": True, "moved": True})
    except sqlite3.Error:
        db.rollback()
        app.logger.exception("Unable to reorder category %s", category_id)
        return api_error("تعذر تغيير ترتيب التصنيف.", 500)


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
    # Books are excluded from restock by design.
    low_stock = [
        dict(row, unit=material_unit_label(row["unit"]))
        for row in low_materials
    ]
    
    settings = dict(db.execute("SELECT key, value FROM settings WHERE key IN ('shop_name', 'shop_address')"))
    return jsonify({
        "today_sales": round(sales, 2),
        "today_profit": round(sales - cogs - expenses, 2),
        "low_stock": low_stock,
        "shop": settings,
    })

def inventory_rows(table):
    db = get_db()
    columns = {
        "books": "id, title, author, publisher, type, cost_price, sell_price, stock_quantity",
        "drinks": "id, name, sell_price, recipe_json, category", # Added category here
        "materials": "id, name, unit, cost_per_unit, current_stock, reorder_level",
        "retail": "id, name, category, cost_price, sell_price, stock_quantity, unit",
    }
    rows = [dict(row) for row in db.execute("SELECT " + columns[table] + " FROM " + table + " ORDER BY id DESC")]
    if table == "materials":
        for row in rows:
            row["unit_label"] = material_unit_label(row["unit"])
            row["unit_needs_review"] = normalize_material_unit(row["unit"]) is None
    elif table == "drinks":
        labels = {
            row["slug"]: row["label_ar"]
            for row in db.execute("SELECT slug, label_ar FROM categories")
        }
        for row in rows:
            category = "iced" if row["category"] == "cold" else row["category"]
            row["category_label"] = labels.get(category, category)
    elif table == "retail":
        labels = {
            row["slug"]: row["label_ar"]
            for row in db.execute("SELECT slug, label_ar FROM categories")
        }
        for row in rows:
            row["category_label"] = labels.get(
                row["category"], row["category"]
            )
    return rows

@app.get("/api/admin/<resource>")
@admin_required
def list_admin_resource(resource):
    if resource not in ("books", "drinks", "materials", "retail", "expenses"):
        return api_error("المورد المطلوب غير معروف.", 404)
    if resource == "expenses":
        return jsonify([dict(row) for row in get_db().execute(
            "SELECT id, date, category, amount, note FROM expenses ORDER BY date DESC, id DESC LIMIT 500"
        )])
    return jsonify(inventory_rows(resource))

def resource_values(resource, data):
    if not isinstance(data, dict):
        raise ValueError("بيانات الطلب غير صالحة.")
    if resource == "books":
        title = str(data.get("title", "")).strip()
        author = str(data.get("author", "")).strip()
        publisher = str(data.get("publisher", "")).strip()
        kind = normalize_book_type(data.get("type", ""))
        if not title:
            raise ValueError("عنوان الكتاب مطلوب.")
        normalized_title = normalized_catalog_name(title)
        retail_names = [
            row["name"] for row in get_db().execute("SELECT name FROM retail")
        ]
        retail_names.extend(RETAIL_BOOK_ALIASES.keys())
        if is_retail_book_collision(title) or any(
            normalized_catalog_name(name) == normalized_title for name in retail_names
        ):
            raise ValueError("هذا منتج جاهز، أضِفه من شاشة منتجات جاهزة لا الكتب.")
        cost = positive_number(data.get("cost_price"), "سعر التكلفة")
        price = positive_number(data.get("sell_price"), "سعر البيع")
        stock_value = positive_number(data.get("stock_quantity"), "كمية المخزون")
        if not stock_value.is_integer():
            raise ValueError("يجب أن تكون كمية المخزون عددًا صحيحًا.")
        stock = int(stock_value)
        return (title, author, publisher, kind, cost, price, stock)
    
    if resource == "drinks":
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("اسم المشروب مطلوب.")
        price = positive_number(data.get("sell_price"), "سعر البيع")
        
        category = str(data.get("category", "hot")).strip().lower()
        if category == "cold":
            category = "iced"
        if get_db().execute(
            "SELECT 1 FROM categories WHERE slug = ? AND scope = 'drink' AND is_active = 1",
            (category,),
        ).fetchone() is None:
            raise ValueError("اختر تصنيفًا صحيحًا للمشروب.")
            
        raw = data.get("recipe_json", "[]")
        recipe = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(recipe, list):
            raise ValueError("صيغة وصفة المشروب غير صالحة.")
        normalized = []
        for ingredient in recipe:
            if not isinstance(ingredient, dict):
                raise ValueError("يجب تحديد المادة والكمية لكل مكوّن.")
            material_id = int(ingredient["material_id"])
            quantity = positive_number(ingredient["qty"], "كمية المكوّن", False)
            normalized.append({"material_id": material_id, "qty": quantity})
        product_recipe_cost(get_db(), normalized)
        
        # Return tuple includes category now
        return (name, price, json.dumps(normalized), category)
    
    if resource == "materials":
        name = str(data.get("name", "")).strip()
        unit = normalize_material_unit(data.get("unit", ""))
        if not name:
            raise ValueError("اسم المادة مطلوب.")
        if not unit:
            raise ValueError("اختر وحدة صحيحة: كجم أو لتر أو قطعة.")
        cost = positive_number(data.get("cost_per_unit"), "تكلفة الوحدة")
        stock = positive_number(data.get("current_stock"), "المخزون الحالي")
        reorder = positive_number(data.get("reorder_level", 5), "حد التنبيه")
        return (name, unit, cost, stock, reorder)

    if resource == "retail":
        name = str(data.get("name", "")).strip()
        category = str(data.get("category", "")).strip()
        if not name:
            raise ValueError("اسم المنتج الجاهز مطلوب.")
        if not category or get_db().execute(
            "SELECT 1 FROM categories WHERE slug = ? AND scope = 'retail' AND is_active = 1",
            (category,),
        ).fetchone() is None:
            raise ValueError("اختر تصنيفًا نشطًا صحيحًا للمنتج الجاهز.")
        normalized_name = normalized_catalog_name(name)
        book_names = [row["title"] for row in get_db().execute("SELECT title FROM books")]
        book_names.extend(title for title, _, _, _, _ in SEEDED_BOOKS)
        if any(normalized_catalog_name(title) == normalized_name for title in book_names):
            raise ValueError("هذا عنوان كتاب، أضِفه من شاشة الكتب لا المنتجات الجاهزة.")
        cost = positive_number(data.get("cost_price"), "سعر التكلفة")
        price = positive_number(data.get("sell_price"), "سعر البيع")
        stock_value = positive_number(data.get("stock_quantity"), "كمية المخزون")
        if not stock_value.is_integer():
            raise ValueError("يجب أن تكون كمية المنتجات الجاهزة عددًا صحيحًا.")
        return (name, category, cost, price, int(stock_value), "قطعة")
    
    if resource == "expenses":
        expense_date = str(data.get("date", date.today().isoformat()))
        try:
            date.fromisoformat(expense_date)
        except ValueError:
            raise ValueError("يجب إدخال التاريخ بالصيغة سنة-شهر-يوم.")
        category = str(data.get("category", "")).strip()
        if not category:
            raise ValueError("تصنيف المصروف مطلوب.")
        amount = positive_number(data.get("amount"), "المبلغ")
        note = str(data.get("note", "")).strip()
        return (expense_date, category, amount, note)
    raise ValueError("المورد المطلوب غير معروف.")

@app.post("/api/admin/<resource>")
@admin_required
def create_admin_resource(resource):
    if resource not in ("books", "drinks", "materials", "retail", "expenses"):
        return api_error("المورد المطلوب غير معروف.", 404)
    try:
        values = resource_values(resource, request.get_json(silent=True) or {})
        fields = {
            "books": "title, author, publisher, type, cost_price, sell_price, stock_quantity",
            "drinks": "name, sell_price, recipe_json, category", # Updated fields
            "materials": "name, unit, cost_per_unit, current_stock, reorder_level",
            "retail": "name, category, cost_price, sell_price, stock_quantity, unit",
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
    if resource not in ("books", "drinks", "materials", "retail", "expenses"):
        return api_error("المورد المطلوب غير معروف.", 404)
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
                        return api_error("لا يمكن حذف هذه المادة لأنها مستخدمة في وصفة مشروب.", 409)
            cursor = db.execute("DELETE FROM " + resource + " WHERE id = ?", (item_id,))
            if cursor.rowcount == 0:
                return api_error("السجل غير موجود.", 404)
            db.commit()
            return jsonify({"ok": True})
        except sqlite3.IntegrityError:
            db.rollback()
            return api_error("لا يمكن حذف هذه المادة لأنها مستخدمة في وصفة مشروب.", 409)
    try:
        values = resource_values(resource, request.get_json(silent=True) or {})
        fields = {
            "books": "title, author, publisher, type, cost_price, sell_price, stock_quantity",
            "drinks": "name, sell_price, recipe_json, category", # Updated fields
            "materials": "name, unit, cost_per_unit, current_stock, reorder_level",
            "retail": "name, category, cost_price, sell_price, stock_quantity, unit",
            "expenses": "date, category, amount, note",
        }[resource].split(", ")
        assignments = ", ".join(field + " = ?" for field in fields)
        cursor = db.execute(
            "UPDATE " + resource + " SET " + assignments + " WHERE id = ?", values + (item_id,)
        )
        if cursor.rowcount == 0:
            return api_error("السجل غير موجود.", 404)
        db.commit()
        return jsonify({"ok": True})
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, sqlite3.IntegrityError) as error:
        db.rollback()
        return api_error(str(error))


IMPORT_HEADERS = {
    "books": ["العنوان", "المؤلف", "النوع", "دار النشر", "سعر التكلفة", "سعر البيع", "الكمية"],
    "materials": ["الاسم", "الوحدة", "سعر التكلفة للوحدة", "المخزون الحالي", "حد التنبيه"],
    "drinks": ["الاسم", "التصنيف", "سعر البيع", "الوصفة"],
    "retail": ["الاسم", "التصنيف", "سعر التكلفة", "سعر البيع", "الكمية"],
}


def import_book_type(value):
    normalized = str(value or "").strip().casefold()
    if normalized in ("أصلي", "أصلية"):
        return "Original"
    if normalized in ("نسخة عالية", "نسخة", "هاي كوبي"):
        return "High Copy"
    return normalize_book_type(value)


def import_category(value, scope="drink"):
    normalized = str(value or "").strip().casefold()
    categories = get_db().execute(
        "SELECT slug, label_ar FROM categories WHERE scope = ? AND is_active = 1",
        (scope,),
    ).fetchall()
    aliases = {}
    for category in categories:
        aliases[category["slug"].casefold()] = category["slug"]
        aliases[category["label_ar"].casefold()] = category["slug"]
    if scope == "drink":
        aliases.update({"بارد": "iced", "cold": "iced"})
    if normalized not in aliases:
        raise ValueError("التصنيف غير معروف أو غير نشط.")
    return aliases[normalized]


def parse_import_file(upload):
    filename = (upload.filename or "").lower()
    content = upload.read(MAX_IMPORT_BYTES + 1)
    if not content:
        raise ValueError("الملف فارغ.")
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError("حجم الملف يتجاوز الحد المسموح (5 ميجابايت).")
    if filename.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = content.decode("cp1256")
            except UnicodeDecodeError:
                raise ValueError("تعذر قراءة ترميز ملف CSV.")
        return list(csv.reader(io.StringIO(text)))
    if filename.endswith(".xlsx"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise ValueError("استيراد XLSX غير متاح. ثبّت متطلبات التطبيق ثم أعد المحاولة.")
        try:
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            worksheet = workbook.active
            if worksheet.max_row and worksheet.max_row > MAX_IMPORT_ROWS + 1:
                workbook.close()
                raise ValueError("الحد الأقصى للاستيراد " + str(MAX_IMPORT_ROWS) + " صف.")
            rows = []
            for index, row in enumerate(worksheet.iter_rows(values_only=True)):
                if index > MAX_IMPORT_ROWS:
                    break
                rows.append(list(row))
            workbook.close()
            return rows
        except ValueError as error:
            if str(error).startswith("الحد الأقصى"):
                raise
            raise ValueError("ملف XLSX غير صالح أو تالف.")
        except Exception:
            raise ValueError("ملف XLSX غير صالح أو تالف.")
    raise ValueError("اختر ملفًا بصيغة XLSX أو CSV.")


def clean_import_value(value):
    return "" if value is None else str(value).strip()


def import_row_values(resource, header_indexes, row, material_names):
    def value(header, optional=False):
        index = header_indexes.get(header)
        raw = clean_import_value(row[index]) if index is not None and index < len(row) else ""
        if not raw and not optional:
            raise ValueError("الحقل «" + header + "» مطلوب.")
        return raw

    if resource == "books":
        return resource_values("books", {
            "title": value("العنوان"),
            "author": value("المؤلف", True),
            "type": import_book_type(value("النوع")),
            "publisher": value("دار النشر", True),
            "cost_price": value("سعر التكلفة"),
            "sell_price": value("سعر البيع"),
            "stock_quantity": value("الكمية"),
        })
    if resource == "materials":
        unit = normalize_material_unit(value("الوحدة"))
        if not unit:
            raise ValueError("الوحدة غير صحيحة؛ استخدم كجم أو لتر أو قطعة.")
        return resource_values("materials", {
            "name": value("الاسم"),
            "unit": unit,
            "cost_per_unit": value("سعر التكلفة للوحدة"),
            "current_stock": value("المخزون الحالي"),
            "reorder_level": value("حد التنبيه", True) or 5,
        })
    if resource == "retail":
        return resource_values("retail", {
            "name": value("الاسم"),
            "category": import_category(value("التصنيف"), "retail"),
            "cost_price": value("سعر التكلفة"),
            "sell_price": value("سعر البيع"),
            "stock_quantity": value("الكمية"),
        })
    recipe_text = value("الوصفة", True)
    recipe = []
    if recipe_text:
        for ingredient_text in recipe_text.split(";"):
            ingredient_text = ingredient_text.strip()
            if not ingredient_text:
                continue
            if "=" not in ingredient_text:
                raise ValueError("صيغة الوصفة يجب أن تكون اسم المادة=الكمية.")
            material_name, quantity_text = ingredient_text.rsplit("=", 1)
            material_name = material_name.strip()
            material_matches = material_names.get(material_name.casefold(), [])
            if not material_matches:
                raise ValueError("المادة غير مسجلة: " + material_name + ". أضفها من صفحة المواد أولاً.")
            if len(material_matches) > 1:
                raise ValueError("اسم المادة مكرر ولا يمكن تحديده: " + material_name + ".")
            recipe.append({
                "material_id": material_matches[0]["id"],
                "qty": positive_number(quantity_text.strip(), "كمية المكوّن", False),
            })
    category_header = (
        "التصنيف" if "التصنيف" in header_indexes else "النوع(ساخن/بارد)"
    )
    category = import_category(value(category_header), "drink")
    return resource_values("drinks", {
        "name": value("الاسم"),
        "category": category,
        "sell_price": value("سعر البيع"),
        "recipe_json": json.dumps(recipe, ensure_ascii=False),
    })


@app.get("/api/admin/templates/<resource>")
@admin_required
def download_import_template(resource):
    if resource not in IMPORT_HEADERS:
        return api_error("القالب المطلوب غير معروف.", 404)
    try:
        from openpyxl import Workbook
        from openpyxl.worksheet.datavalidation import DataValidation
    except ImportError:
        return api_error("تنزيل قوالب XLSX يتطلب تثبيت متطلبات التطبيق.", 500)
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = {
        "books": "الكتب",
        "materials": "المواد",
        "drinks": "المشروبات",
        "retail": "منتجات جاهزة",
    }[resource]
    worksheet.sheet_view.rightToLeft = True
    worksheet.append(IMPORT_HEADERS[resource])
    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = worksheet.dimensions
    for column in worksheet.columns:
        worksheet.column_dimensions[column[0].column_letter].width = max(
            18, min(32, len(str(column[0].value or "")) + 5)
        )
    if resource == "books":
        validation = DataValidation(type="list", formula1='"Original,High Copy"', allow_blank=False)
        worksheet.add_data_validation(validation)
        validation.add("C2:C1001")
    elif resource == "materials":
        validation = DataValidation(type="list", formula1='"كجم,لتر,قطعة"', allow_blank=False)
        worksheet.add_data_validation(validation)
        validation.add("B2:B1001")
    elif resource == "drinks":
        category_labels = ",".join(
            row["label_ar"] for row in get_db().execute(
                "SELECT label_ar FROM categories WHERE scope = 'drink' AND is_active = 1 "
                "ORDER BY sort_order, id"
            )
        )
        validation = DataValidation(
            type="list", formula1='"' + category_labels + '"', allow_blank=False
        )
        worksheet.add_data_validation(validation)
        validation.add("B2:B1001")
    else:
        category_labels = ",".join(
            row["label_ar"] for row in get_db().execute(
                "SELECT label_ar FROM categories WHERE scope = 'retail' AND is_active = 1 "
                "ORDER BY sort_order, id"
            )
        )
        validation = DataValidation(
            type="list", formula1='"' + category_labels + '"', allow_blank=False
        )
        worksheet.add_data_validation(validation)
        validation.add("B2:B1001")
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)
    return send_file(
        output,
        as_attachment=True,
        download_name=resource + "-template.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.post("/api/admin/import/<resource>")
@admin_required
def import_admin_resource(resource):
    if resource not in IMPORT_HEADERS:
        return api_error("نوع الاستيراد غير معروف.", 404)
    upload = request.files.get("file")
    if upload is None:
        return api_error("اختر ملفًا للاستيراد.")
    try:
        rows = parse_import_file(upload)
        if not rows:
            raise ValueError("الملف لا يحتوي على صفوف.")
        headers = [clean_import_value(header) for header in rows[0]]
        header_indexes = {header: index for index, header in enumerate(headers)}
        if resource == "drinks" and "التصنيف" not in header_indexes:
            legacy_category_header = "النوع(ساخن/بارد)"
            if legacy_category_header in header_indexes:
                header_indexes["التصنيف"] = header_indexes[legacy_category_header]
        missing_headers = [header for header in IMPORT_HEADERS[resource] if header not in header_indexes]
        if missing_headers:
            raise ValueError("أعمدة القالب غير مكتملة: " + "، ".join(missing_headers) + ".")
        data_rows = rows[1:]
        if len(data_rows) > MAX_IMPORT_ROWS:
            raise ValueError("الحد الأقصى للاستيراد " + str(MAX_IMPORT_ROWS) + " صف.")
        notes = []
        if resource == "books" and any(
            header.strip().lower() in ("حد التنبيه", "reorder_level")
            for header in headers
        ):
            notes.append("تم تجاهل عمود حد التنبيه القديم للكتب.")
        db = get_db()
        material_names = {}
        if resource == "drinks":
            for material in db.execute("SELECT id, name FROM materials"):
                material_names.setdefault(material["name"].strip().casefold(), []).append(dict(material))
        fields = {
            "books": "title, author, publisher, type, cost_price, sell_price, stock_quantity",
            "materials": "name, unit, cost_per_unit, current_stock, reorder_level",
            "drinks": "name, sell_price, recipe_json, category",
            "retail": "name, category, cost_price, sell_price, stock_quantity, unit",
        }[resource]
        imported = 0
        errors = []
        for row_number, row in enumerate(data_rows, start=2):
            if not any(clean_import_value(value) for value in row):
                continue
            try:
                values = import_row_values(resource, header_indexes, row, material_names)
                placeholders = ", ".join("?" for _ in values)
                db.execute(
                    "INSERT INTO " + resource + "(" + fields + ") VALUES (" + placeholders + ")",
                    values,
                )
                db.commit()
                imported += 1
            except (ValueError, TypeError, KeyError, json.JSONDecodeError, sqlite3.IntegrityError) as error:
                db.rollback()
                errors.append({"row": row_number, "reason": str(error)})
        return jsonify({
            "imported": imported,
            "failed": len(errors),
            "errors": errors,
            "notes": notes,
        })
    except ValueError as error:
        return api_error(str(error))


@app.get("/api/admin/reports")
@admin_required
def monthly_report():
    month = request.args.get("month", date.today().strftime("%Y-%m"))
    try:
        parsed = datetime.strptime(month, "%Y-%m")
    except ValueError:
        return api_error("يجب إدخال الشهر بالصيغة سنة-شهر.")
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
    values = dict(rows)
    values["shop_name"] = values.get("shop_name") or DEFAULT_SHOP_NAME
    return jsonify(values)

@app.put("/api/admin/settings")
@admin_required
def update_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return api_error("بيانات الإعدادات غير صالحة.")
    name = str(data.get("shop_name", "")).strip()
    address = str(data.get("shop_address", "")).strip()
    db = get_db()
    db.execute("UPDATE settings SET value = ? WHERE key = 'shop_name'", (name,))
    db.execute("UPDATE settings SET value = ? WHERE key = 'shop_address'", (address,))
    db.commit()
    return jsonify({"ok": True, "shop_name": current_shop_name()})

@app.put("/api/admin/password")
@admin_required
def change_password():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return api_error("بيانات كلمة المرور غير صالحة.")
    
    new_password = data.get("new_password", "")
    
    # Validation: Only check length and existence of new password
    if not isinstance(new_password, str) or len(new_password) < 6:
        return api_error("يجب ألا تقل كلمة المرور الجديدة عن 6 أحرف.")
    
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

        with app.app_context():
            window_title = current_shop_name()
        webview.create_window(window_title, address, width=1100, height=720, min_size=(760, 540))
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