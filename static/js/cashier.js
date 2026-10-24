(function () {
  "use strict";

  var products = [];
  var cart = [];
  var reservedStock = {materials: {}, books: {}, retail: {}};
  var currentCategory = "all";
  var grid = document.getElementById("product-grid");
  var cartItemsContainer = document.getElementById("cart-items");
  var searchInput = document.getElementById("product-search");
  var payButton = document.getElementById("pay-button");
  var messageDiv = document.getElementById("cart-message");
  var totalCountSpan = document.getElementById("product-count");
  var totalAmountSpan = document.getElementById("cart-total");
  var settingsModal = document.getElementById("settings-modal");
  var recentOrdersList = document.getElementById("recent-orders-list");
  var quickSearchInput = document.getElementById("quick-product-search");
  var quickResultsContainer = document.getElementById("quick-search-results");
  var quickSearchTimer = null;
  var messageTimer = null;
  var lastStockFailure = null;
  var voidLastButton = document.getElementById("void-last-order");
  var activeCategories = [];

  function categoryLabel(slug) {
    var i;
    for (i = 0; i < activeCategories.length; i += 1) {
      if (activeCategories[i].slug === slug) return activeCategories[i].label_ar;
    }
    return "";
  }

  function money(amount) {
    var parts = Number(amount || 0).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function requestJson(url, options, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open((options && options.method) || "GET", url, true);
    xhr.setRequestHeader("Accept", "application/json");
    if (options && options.body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (error) {
        callback(new Error("أعاد الخادم استجابة غير صالحة."));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        callback(new Error(data.error || "فشل تنفيذ الطلب."));
        return;
      }
      callback(null, data);
    };
    xhr.onerror = function () {
      callback(new Error("تعذر الاتصال بالخادم المحلي."));
    };
    xhr.send(options && options.body ? options.body : null);
  }

  function showMessage(text, type) {
    if (!messageDiv) return;
    if (messageTimer) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
    messageDiv.textContent = text || "";
    messageDiv.className = "form-message " + (type || "");
    if (text && type !== "error") {
      messageTimer = setTimeout(function () {
        if (messageDiv && messageDiv.textContent === text) {
          messageDiv.textContent = "";
          messageDiv.className = "form-message";
        }
      }, 3000);
    }
  }

  function loadProducts() {
    requestJson("/api/categories/active", null, function (categoryError, categories) {
      activeCategories = categoryError ? [] : categories;
      requestJson("/api/products", null, function (error, data) {
        if (error) {
          if (window.console) console.error(error);
          showMessage("تعذر تحميل المنتجات: " + error.message, "error");
          return;
        }
        if (categoryError) {
          if (window.console) console.error(categoryError);
          showMessage("تعذر تحميل التصنيفات: " + categoryError.message, "error");
        }
        products = data;
        renderCategoryTabs();
        renderProducts();
      });
    });
  }

  function recipeFor(product) {
    return product && Object.prototype.toString.call(product.recipe) === "[object Array]"
      ? product.recipe : [];
  }

  function productFor(id, kind) {
    var i;
    for (i = 0; i < products.length; i += 1) {
      if (String(products[i].id) === String(id) && products[i].kind === kind) return products[i];
    }
    return null;
  }

  function reservedFor(map, id) {
    return Number(map[String(id)] || 0);
  }

  function getAvailableUnits(product) {
    var i;
    var available;
    var recipe;
    var stock;
    var reserved;
    if (product.kind === "book" || product.kind === "retail") {
      stock = Math.max(0, Number(product.stock || 0));
      return Math.max(0, stock - reservedFor(reservedStock[product.kind === "book" ? "books" : "retail"], product.id));
    }
    if (product.max_sellable_qty === 0 || !product.recipe_valid && product.recipe_valid !== undefined) return 0;
    if (product.max_sellable_qty === null || product.max_sellable_qty === undefined) return Infinity;
    recipe = recipeFor(product);
    available = Infinity;
    for (i = 0; i < recipe.length; i += 1) {
      stock = Number(recipe[i].current_stock);
      reserved = reservedFor(reservedStock.materials, recipe[i].material_id);
      if (!(Number(recipe[i].qty) > 0) || !isFinite(stock)) return 0;
      available = Math.min(available, Math.floor(Math.max(0, stock - reserved) / Number(recipe[i].qty) + 0.000000001));
    }
    return available;
  }

  function renderProducts() {
    var filteredProducts;
    var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
    var i;
    var product;
    var button;
    var isOut;
    var detailText;
    var subDetailText;
    var remaining;
    if (!grid) return;

    filteredProducts = products.filter(function (item) {
      var matchesSearch = !query || item.name.toLowerCase().indexOf(query) >= 0 ||
        item.author && item.author.toLowerCase().indexOf(query) >= 0;
      var tabParts = currentCategory.split(":");
      var matchesCategory = currentCategory === "all" ||
        currentCategory === "book" && item.kind === "book" ||
        tabParts[0] === "drink" && item.kind === "drink" &&
          (item.category === "cold" ? "iced" : item.category) === tabParts[1] ||
        tabParts[0] === "retail" && item.kind === "retail" && item.category === tabParts[1];
      return matchesSearch && matchesCategory;
    });
    if (totalCountSpan) totalCountSpan.textContent = filteredProducts.length;
    grid.innerHTML = "";
    if (!filteredProducts.length) {
      grid.innerHTML = '<p class="empty-message">لا توجد منتجات مطابقة في هذا التصنيف.</p>';
      return;
    }

    for (i = 0; i < filteredProducts.length; i += 1) {
      product = filteredProducts[i];
      remaining = getAvailableUnits(product);
      isOut = remaining < 1;
      button = document.createElement("button");
      button.className = "product-card" + (isOut ? " stock-empty" : "");
      button.disabled = isOut;
      if (product.kind === "book" || product.kind === "retail") {
        detailText = isOut ? "نفد المخزون" : remaining + " متاح";
        subDetailText = product.kind === "book"
          ? product.type === "Original" ? "Original" : product.type === "High Copy" ? "High Copy" : product.type || ""
          : categoryLabel(product.category) || product.category_label || "";
      } else {
        detailText = isOut ? "نفد المخزون" : remaining === Infinity ? "متوفر" : remaining + " متاح";
        subDetailText = categoryLabel(product.category === "cold" ? "iced" : product.category) ||
          product.category_label || "مشروب ساخن";
      }
      button.innerHTML =
        '<div class="p-name">' + escapeHtml(product.name) + '</div>' +
        (subDetailText ? '<div class="p-sub-detail">' + escapeHtml(subDetailText) + '</div>' : "") +
        '<div class="p-price" dir="ltr">' + money(product.sell_price) + ' ج.م</div>' +
        '<div class="p-type-badge">' + escapeHtml(detailText) + '</div>';
      button.addEventListener("click", (function (selectedProduct) {
        return function () { addToCart(selectedProduct); };
      }(product)));
      grid.appendChild(button);
    }
  }

  function recalculateReservations() {
    var i;
    var j;
    var item;
    var product;
    var recipe;
    var materialId;
    var amount;
    reservedStock = {materials: {}, books: {}, retail: {}};
    for (i = 0; i < cart.length; i += 1) {
      item = cart[i];
      if (item.kind === "book" || item.kind === "retail") {
        var stockMap = item.kind === "book" ? reservedStock.books : reservedStock.retail;
        stockMap[String(item.id)] = reservedFor(stockMap, item.id) + Number(item.quantity);
        continue;
      }
      product = productFor(item.id, item.kind) || item;
      recipe = recipeFor(product);
      for (j = 0; j < recipe.length; j += 1) {
        materialId = String(recipe[j].material_id);
        amount = Number(recipe[j].qty) * Number(item.quantity);
        reservedStock.materials[materialId] = reservedFor(reservedStock.materials, materialId) + amount;
      }
    }
    return reservedStock;
  }

  function reservationFailure() {
    var i;
    var j;
    var item;
    var product;
    var recipe;
    var stock;
    var reserved;
    var material;
    for (i = 0; i < cart.length; i += 1) {
      item = cart[i];
      product = productFor(item.id, item.kind) || item;
      if (product.kind === "book" || product.kind === "retail") {
        reserved = reservedFor(
          product.kind === "book" ? reservedStock.books : reservedStock.retail,
          product.id
        );
        stock = Number(product.stock || 0);
        if (reserved > stock + 0.000000001) {
          return {product: product.name, material: product.name, kind: product.kind};
        }
      } else {
        recipe = recipeFor(product);
        if (product.max_sellable_qty === 0 && cartContains(product.id, "drink")) {
          return {product: product.name, material: "recipe stock", kind: "drink"};
        }
        for (j = 0; j < recipe.length; j += 1) {
          material = recipe[j];
          reserved = reservedFor(reservedStock.materials, material.material_id);
          stock = Number(material.current_stock);
          if (!isFinite(stock) || reserved > stock + 0.000000001) {
            return {product: product.name, material: material.material_name || "ingredient", kind: "drink"};
          }
        }
      }
    }
    return null;
  }

  function cartContains(id, kind) {
    var i;
    for (i = 0; i < cart.length; i += 1) {
      if (String(cart[i].id) === String(id) && cart[i].kind === kind) return true;
    }
    return false;
  }

  function canAddToCart(product) {
    var i;
    var recipe;
    var material;
    var available;
    lastStockFailure = null;
    if (product.kind === "book" || product.kind === "retail") {
      available = Number(product.stock || 0) - reservedFor(
        product.kind === "book" ? reservedStock.books : reservedStock.retail,
        product.id
      );
      if (available < 1) {
        lastStockFailure = {material: product.name, kind: product.kind};
        return false;
      }
      return true;
    }
    recipe = recipeFor(product);
    if (!recipe.length) {
      if (product.max_sellable_qty !== null && product.max_sellable_qty !== undefined) {
        lastStockFailure = {material: "recipe stock", kind: "drink"};
        return false;
      }
      return true;
    }
    for (i = 0; i < recipe.length; i += 1) {
      material = recipe[i];
      available = Number(material.current_stock) - reservedFor(reservedStock.materials, material.material_id);
      if (!(Number(material.qty) > 0) || available + 0.000000001 < Number(material.qty)) {
        lastStockFailure = {material: material.material_name || "ingredient", kind: "drink"};
        return false;
      }
    }
    return true;
  }

  function showStockFailure(product, failure) {
    var reason = failure && (failure.kind === "book" || failure.kind === "retail")
      ? failure.kind === "book" ? "مخزون الكتاب المتاح" : "مخزون المنتج الجاهز المتاح"
      : "المادة الخام " + (failure ? failure.material : "المخزون");
    var text = "لا يمكن إضافة " + product.name + ". المخزون غير كافٍ لـ " + reason + ".";
    showMessage(text, "error");
    if (window.alert) window.alert(text);
  }

  function addToCart(product) {
    var i;
    var existing = null;
    showMessage("", "");
    if (!canAddToCart(product)) {
      showStockFailure(product, lastStockFailure);
      return false;
    }
    for (i = 0; i < cart.length; i += 1) {
      if (String(cart[i].id) === String(product.id) && cart[i].kind === product.kind) {
        existing = cart[i];
        break;
      }
    }
    if (existing) existing.quantity += 1;
    else {
      cart.push({
        id: product.id,
        kind: product.kind,
        name: product.name,
        price: product.sell_price,
        quantity: 1,
        type: product.type || "",
        category: product.category || "",
        stock: product.stock,
        max_sellable_qty: product.max_sellable_qty,
        recipe: recipeFor(product)
      });
    }
    recalculateReservations();
    renderCart();
    renderProducts();
    return true;
  }

  window.updateQuantitySafe = function (index, delta) {
    var item = cart[index];
    var oldQuantity;
    var failure;
    if (!item) return;
    oldQuantity = Number(item.quantity);
    if (oldQuantity + delta < 1) {
      cart.splice(index, 1);
    } else {
      item.quantity = oldQuantity + delta;
      recalculateReservations();
      failure = reservationFailure();
      if (failure) {
        item.quantity = oldQuantity;
        recalculateReservations();
        showStockFailure(item, failure);
        return;
      }
    }
    recalculateReservations();
    renderCart();
    renderProducts();
  };

  window.handleManualQtyChange = function (index, newValue) {
    var item = cart[index];
    var quantity = Number(newValue);
    var oldQuantity;
    var failure;
    if (!item) return;
    if (!isFinite(quantity) || quantity < 1 || Math.floor(quantity) !== quantity) {
      showMessage("يجب أن تكون الكمية عددًا صحيحًا لا يقل عن 1.", "error");
      renderCart();
      return;
    }
    oldQuantity = Number(item.quantity);
    item.quantity = quantity;
    recalculateReservations();
    failure = reservationFailure();
    if (failure) {
      item.quantity = oldQuantity;
      recalculateReservations();
      showStockFailure(item, failure);
      renderCart();
      return;
    }
    renderCart();
    renderProducts();
  };

  function renderCart() {
    var totalSum = 0;
    var i;
    var item;
    var row;
    var lineTotal;
    var subInfo;
    if (!cartItemsContainer) return;
    cartItemsContainer.innerHTML = "";
    if (!cart.length) {
      cartItemsContainer.innerHTML = '<p class="empty-message">اختر منتجًا لبدء البيع.</p>';
      if (payButton) payButton.disabled = true;
      if (totalAmountSpan) totalAmountSpan.textContent = "0.00";
      return;
    }
    for (i = 0; i < cart.length; i += 1) {
      item = cart[i];
      row = document.createElement("div");
      row.className = "cart-line";
      lineTotal = item.price * item.quantity;
      totalSum += lineTotal;
      subInfo = money(item.price) + (item.type ? " • " + item.type : "");
      row.innerHTML =
        '<div class="cart-line-info"><div class="cart-line-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="cart-line-sub">' + escapeHtml(subInfo) + '</div></div>' +
        '<div class="quantity-control">' +
        '<button class="qty-btn" onclick="updateQuantitySafe(' + i + ', -1)">−</button>' +
        '<input type="number" id="qty-input-' + i + '" value="' + item.quantity + '" min="1" step="1" style="width:55px;text-align:center;padding:4px;border:1px solid #ddd;border-radius:4px;">' +
        '<button class="qty-btn" onclick="updateQuantitySafe(' + i + ', 1)">+</button></div>' +
        '<div class="ci-total">' + money(lineTotal) + '</div>';
      cartItemsContainer.appendChild(row);
      (function (itemIndex) {
        var input = document.getElementById("qty-input-" + itemIndex);
        if (input) input.addEventListener("change", function (event) {
          window.handleManualQtyChange(itemIndex, event.target.value);
        });
      }(i));
    }
    if (totalAmountSpan) totalAmountSpan.textContent = money(totalSum);
    if (payButton) payButton.disabled = false;
  }

  if (payButton) {
    payButton.addEventListener("click", function () {
      var orderItems;
      if (!cart.length) return;
      payButton.disabled = true;
      payButton.innerHTML = "جارٍ التنفيذ...";
      showMessage("جارٍ حفظ عملية البيع...", "");
      orderItems = cart.map(function (item) {
        return {id: item.id, kind: item.kind, quantity: item.quantity};
      });
      requestJson("/api/orders", {
        method: "POST",
        body: JSON.stringify({items: orderItems})
      }, function (error, result) {
        if (error) {
          showMessage("خطأ: " + error.message, "error");
          payButton.disabled = !cart.length;
          payButton.innerHTML = "دفع وطباعة 🖨️";
          return;
        }
        cart = [];
        recalculateReservations();
        renderCart();
        renderProducts();
        showMessage("اكتملت عملية البيع رقم " + result.order_id + ".", "success");
        loadProducts();
        loadRecentOrders();
        window.setTimeout(function () {
          window.open("/api/print-receipt/" + result.order_id, "_blank", "width=300,height=500");
        }, 100);
        payButton.disabled = true;
        payButton.innerHTML = "دفع وطباعة 🖨️";
      });
    });
  }

  window.openSettingsModal = function () {
    if (settingsModal) {
      settingsModal.style.display = "flex";
      loadRecentOrders();
    }
  };

  window.closeSettingsModal = function () {
    if (settingsModal) settingsModal.style.display = "none";
  };

  function loadRecentOrders() {
    if (!recentOrdersList) return;
    recentOrdersList.innerHTML = '<li style="padding:10px;text-align:center;color:#9ca3af;">جارٍ تحميل السجل...</li>';
    requestJson("/api/cashier/recent-orders", null, function (error, orders) {
      var i;
      var html = "";
      if (error) {
        recentOrdersList.innerHTML = '<li style="padding:10px;color:red;font-size:12px;text-align:center;">تعذر تحميل سجل المبيعات</li>';
        if (voidLastButton) voidLastButton.disabled = false;
        return;
      }
      if (voidLastButton) voidLastButton.disabled = orders.length === 0;
      if (!orders.length) {
        recentOrdersList.innerHTML = '<li style="padding:10px;text-align:center;color:#9ca3af;">لا توجد مبيعات مسجلة اليوم.</li>';
        return;
      }
      for (i = 0; i < orders.length; i += 1) {
        html += '<li style="padding:8px 10px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:#6b7280;font-size:12px;">#' + escapeHtml(orders[i].id) + '</span>' +
          '<span dir="ltr" style="font-weight:bold;color:#059669;">' + money(orders[i].total_amount) + ' ج.م</span></li>';
      }
      recentOrdersList.innerHTML = html;
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener("click", function (event) {
      if (event.target === settingsModal) window.closeSettingsModal();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      renderProducts();
    });
  }

  function hideQuickResults() {
    if (quickResultsContainer) {
      quickResultsContainer.style.display = "none";
      quickResultsContainer.innerHTML = "";
    }
  }

  function showQuickResults() {
    if (quickResultsContainer) quickResultsContainer.style.display = "block";
  }

  function filterAndShowQuickResults(query) {
    var matches = [];
    var i;
    var item;
    var type;
    var html = "";
    for (i = 0; i < products.length; i += 1) {
      item = products[i];
      if (item.name.toLowerCase().indexOf(query) >= 0 ||
          item.author && item.author.toLowerCase().indexOf(query) >= 0) matches.push(item);
    }
    if (!matches.length) {
      quickResultsContainer.innerHTML = '<div class="no-results-msg">لم يتم العثور على منتجات</div>';
      showQuickResults();
      return;
    }
    for (i = 0; i < Math.min(matches.length, 7); i += 1) {
      item = matches[i];
      type = item.kind === "book"
        ? (item.type === "Original" ? "Original" : item.type === "High Copy" ? "High Copy" : "كتاب")
        : item.category_label || (item.category === "cold" ? "مشروب بارد" : "مشروب ساخن");
      html += '<div class="dropdown-item" onclick="selectQuickProduct(' + Number(item.id) + ', \'' +
        escapeHtml(item.kind) + '\')"><div><div class="di-name">' + escapeHtml(item.name) +
        '</div><div class="di-type">' + escapeHtml(type) + '</div></div><div class="di-price">' +
        money(item.sell_price) + ' ج.م</div></div>';
    }
    quickResultsContainer.innerHTML = html;
    showQuickResults();
  }

  if (quickSearchInput && quickResultsContainer) {
    quickSearchInput.addEventListener("input", function () {
      var query = this.value.trim().toLowerCase();
      clearTimeout(quickSearchTimer);
      if (!query) {
        hideQuickResults();
        return;
      }
      quickSearchTimer = setTimeout(function () {
        filterAndShowQuickResults(query);
      }, 200);
    });
    document.addEventListener("click", function (event) {
      if (!quickSearchInput.contains(event.target) && !quickResultsContainer.contains(event.target)) {
        hideQuickResults();
      }
    });
  }

  window.selectQuickProduct = function (id, kind) {
    var product = productFor(id, kind);
    if (product) addToCart(product);
    if (quickSearchInput) quickSearchInput.value = "";
    hideQuickResults();
  };

  function initCategoryTabs() {
    var tabsContainer = document.getElementById("category-tabs");
    if (!tabsContainer) return;
    tabsContainer.addEventListener("click", function (event) {
      var target = event.target;
      while (target && target !== tabsContainer && !target.classList.contains("cat-tab")) {
        target = target.parentNode;
      }
      if (!target || target === tabsContainer) return;
      var tabs = tabsContainer.querySelectorAll(".cat-tab");
      var i;
      for (i = 0; i < tabs.length; i += 1) tabs[i].classList.remove("active");
      target.classList.add("active");
      currentCategory = target.getAttribute("data-cat");
      renderProducts();
    });
  }

  function renderCategoryTabs() {
    var tabsContainer = document.getElementById("category-tabs");
    var html;
    var categories = [];
    var i;
    var product;
    var category;
    var productCategory;
    var hasCategory;
    var key;
    if (!tabsContainer) return;
    for (i = 0; i < activeCategories.length; i += 1) {
      category = activeCategories[i];
      // Books remain under the synthetic "الكتب" tab in v1.
      if (category.scope !== "drink" && category.scope !== "retail") continue;
      hasCategory = false;
      for (var k = 0; k < products.length; k += 1) {
        product = products[k];
        productCategory = product.category === "cold" ? "iced" : product.category;
        if (product.kind === category.scope && productCategory === category.slug) {
          hasCategory = true;
          break;
        }
      }
      if (hasCategory) categories.push(category);
    }
    if (currentCategory !== "all" && currentCategory !== "book" &&
        !categories.some(function (category) {
          return currentCategory === category.scope + ":" + category.slug;
        })) currentCategory = "all";
    html = '<button class="cat-tab' + (currentCategory === "all" ? " active" : "") +
      '" data-cat="all">الكل</button><button class="cat-tab' +
      (currentCategory === "book" ? " active" : "") + '" data-cat="book">الكتب</button>';
    for (i = 0; i < categories.length; i += 1) {
      key = categories[i].scope + ":" + categories[i].slug;
      html += '<button class="cat-tab tab-dyn-category' + (currentCategory === key ? " active" : "") +
        '" data-cat="' + escapeHtml(key) + '">' +
        escapeHtml(categories[i].label_ar) + '</button>';
    }
    tabsContainer.innerHTML = html;
  }

  function voidLastOrder() {
    if (!voidLastButton || voidLastButton.disabled) return;
    if (!window.confirm("متأكد إنك عايز تلغي آخر عملية بيع؟ هيتم إرجاع المخزون.")) return;
    voidLastButton.disabled = true;
    requestJson("/api/orders/void-last", {method: "POST", body: JSON.stringify({})}, function (error, result) {
      if (error) {
        if (window.console) console.error("تعذر إلغاء آخر عملية بيع:", error);
        showMessage(error.message, "error");
        voidLastButton.disabled = false;
        return;
      }
      if (window.console) console.info("تم إلغاء العملية وإرجاع المخزون:", result.order_id);
      showMessage("تم إلغاء العملية #" + result.order_id + " وإرجاع المخزون.", "success");
      loadRecentOrders();
      loadProducts();
    });
  }

  if (voidLastButton) voidLastButton.addEventListener("click", voidLastOrder);

  initCategoryTabs();
  window.addEventListener("focus", loadProducts);
  loadProducts();
}());
