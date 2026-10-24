(function () {
  "use strict";
  
  // ==========================================
  // GLOBAL VARIABLES & HELPERS
  // ==========================================
  var messageEl = document.getElementById("admin-message");
  var currentView = "dashboard";
  var materialPickers = [];
  var drinkRowsCache = [];
  var recipeRowStates = [];
  var materialNamePicker = null;
  var allCategoriesCache = [];

  if (!window.allMaterialsCache) window.allMaterialsCache = [];
  
  // Format number with commas and 2 decimal places: 10000 -> 10,000.00
  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "0.00";
    var num = Number(value);
    if (isNaN(num)) return "0.00";
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatLocalDate(date) {
    var month = String(date.getMonth() + 1);
    var day = String(date.getDate());
    return date.getFullYear() + "/" + (month.length < 2 ? "0" : "") + month +
      "/" + (day.length < 2 ? "0" : "") + day;
  }

  function currentMonthValue() {
    var date = new Date();
    var month = String(date.getMonth() + 1);
    return date.getFullYear() + "-" + (month.length < 2 ? "0" : "") + month;
  }

  function setClassFlag(element, className, enabled) {
    var classes;
    var index;
    if (!element) return;
    classes = element.className ? element.className.split(/\s+/) : [];
    index = classes.indexOf(className);
    if (enabled && index < 0) classes.push(className);
    else if (!enabled && index >= 0) classes.splice(index, 1);
    element.className = classes.join(" ");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[character];
    });
  }

  function categoryLabel(category) {
    var i;
    for (i = 0; i < allCategoriesCache.length; i += 1) {
      if (allCategoriesCache[i].slug === category) return allCategoriesCache[i].label_ar;
    }
    return category || "";
  }

  async function loadCategoriesCache() {
    allCategoriesCache = await apiCall("/api/categories");
    return allCategoriesCache;
  }

  function renderCategoryOptions(scope, selected) {
    var options = allCategoriesCache.filter(function (category) {
      return category.scope === scope && category.is_active;
    });
    return options.map(function (category) {
      return '<option value="' + escapeHtml(category.slug) + '"' +
        (String(selected) === category.slug ? " selected" : "") + '>' +
        escapeHtml(category.label_ar) + '</option>';
    }).join("");
  }

  function bindInlineCategoryCreator(scope, fieldPrefix) {
    var toggle = document.getElementById(fieldPrefix + "-new-category-toggle");
    var form = document.getElementById(fieldPrefix + "-new-category");
    var input = document.getElementById(fieldPrefix + "-new-category-label");
    var submit = document.getElementById(fieldPrefix + "-new-category-submit");
    var select = document.getElementById(fieldPrefix + "-category");
    if (!toggle || !form || !input || !submit || !select) return;
    toggle.addEventListener("click", function () {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
    submit.addEventListener("click", async function () {
      var label = input.value.replace(/^\s+|\s+$/g, "");
      var duplicate = allCategoriesCache.some(function (category) {
        return category.scope === scope &&
          category.label_ar.toLowerCase() === label.toLowerCase();
      });
      if (!label) {
        showMessage("اسم التصنيف مطلوب.");
        return;
      }
      if (duplicate) {
        showMessage("هذا التصنيف موجود بالفعل.");
        return;
      }
      try {
        var category = await apiCall("/api/categories", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({label_ar: label, scope: scope})
        });
        allCategoriesCache.push(category);
        var option = document.createElement("option");
        option.value = category.slug;
        option.textContent = category.label_ar;
        select.appendChild(option);
        select.value = category.slug;
        input.value = "";
        form.hidden = true;
        showMessage("تمت إضافة التصنيف.", true);
      } catch (error) {
        showMessage("تعذر إضافة التصنيف: " + error.message);
      }
    });
  }

  function normalizeSearchText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").toLowerCase();
  }

  function filterRows(rows, query, searchableText) {
    var normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return rows.slice(0);
    return rows.filter(function (row) {
      return normalizeSearchText(searchableText(row)).indexOf(normalizedQuery) >= 0;
    });
  }

  function bindInventorySearch(inputId, tableId, rows, searchableText, renderTable) {
    var input = document.getElementById(inputId);
    var timer = null;
    if (!input) return;
    input.addEventListener("input", function () {
      var query = input.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (document.getElementById(tableId)) {
          document.getElementById(tableId).innerHTML = renderTable(
            filterRows(rows, query, searchableText), !!normalizeSearchText(query)
          );
        }
      }, 200);
    });
  }

  async function apiCall(url, options) {
    try {
      var response = await fetch(url, options || {});
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذّر إتمام الطلب.");
      return data;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  function renderImportControls(resource) {
    return '<span class="import-controls">' +
      '<input type="file" id="import-file-' + resource + '" accept=".xlsx,.csv" hidden>' +
      '<button type="button" class="button button-secondary" id="import-button-' + resource + '">استيراد من Excel</button>' +
      '<a class="button button-secondary" href="/api/admin/templates/' + resource + '">تنزيل القالب</a>' +
      '</span><div id="import-result-' + resource + '" class="import-result" aria-live="polite"></div>';
  }

  function renderImportResult(resource, result) {
    var container = document.getElementById("import-result-" + resource);
    var html = '<p>تم استيراد ' + result.imported + ' صف، وتعذر استيراد ' + result.failed + ' صف.</p>';
    var i;
    if (!container) return;
    for (i = 0; i < (result.notes || []).length; i += 1) {
      html += '<p>' + escapeHtml(result.notes[i]) + '</p>';
    }
    if (result.errors && result.errors.length) {
      html += '<ul>' + result.errors.map(function (error) {
        return '<li>الصف ' + error.row + ': ' + escapeHtml(error.reason) + '</li>';
      }).join("") + '</ul>';
    }
    container.innerHTML = html;
    container.style.display = "block";
  }

  function bindImportControls(resource) {
    var button = document.getElementById("import-button-" + resource);
    var input = document.getElementById("import-file-" + resource);
    if (!button || !input) return;
    button.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", async function () {
      if (!input.files || !input.files.length) return;
      var formData = new FormData();
      formData.append("file", input.files[0]);
      button.disabled = true;
      try {
        var result = await apiCall("/api/admin/import/" + resource, {
          method: "POST",
          body: formData
        });
        var refresh = {
          books: loadBooksView,
          materials: loadMaterialsView,
          drinks: loadDrinksView,
          retail: loadRetailView
        }[resource];
        if (refresh) await refresh();
        renderImportResult(resource, result);
        showMessage("اكتمل الاستيراد: " + result.imported + " ناجح، " + result.failed + " غير ناجح.", result.failed ? "" : true);
      } catch (error) {
        showMessage("تعذر استيراد الملف: " + error.message);
      } finally {
        button.disabled = false;
        input.value = "";
      }
    });
  }

  function updateShopBrand(name) {
    var direction = /[\u0600-\u06ff]/.test(name) ? "rtl" : "ltr";
    ["admin-shop-name", "admin-eyebrow-shop-name", "cashier-shop-name", "login-shop-name"].forEach(function (id) {
      var brand = document.getElementById(id);
      if (brand) {
        brand.textContent = name;
        brand.setAttribute("dir", direction);
      }
    });
    document.title = document.title.replace(/\|.*$/, "| " + name);
  }

  function findMaterialById(id) {
      var materials = window.allMaterialsCache || [];
      var i;
      for (i = 0; i < materials.length; i += 1) {
        if (String(materials[i].id) === String(id)) return materials[i];
      }
      return null;
    }

  function disposeMaterialPickers() {
      var pickers = materialPickers.slice(0);
      var i;
      for (i = 0; i < pickers.length; i += 1) pickers[i].destroy();
      materialPickers = [];
      materialNamePicker = null;
    }

  function createMaterialPicker(containerEl, options) {
      options = options || {};
      var wrapper = document.createElement("div");
      var input = document.createElement("input");
      var dropdown = document.createElement("div");
      var hint = document.createElement("small");
      var selectedMaterialId = null;
      var activeIndex = -1;
      var suggestions = [];
      var destroyed = false;
      var allowFreeText = options.allowFreeText === true;

      wrapper.className = "mat-picker";
      input.type = "text";
      input.className = "mat-picker-input";
      input.placeholder = "اكتب اسم المادة...";
      input.required = options.required === true;
      input.setAttribute("autocomplete", "off");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      if (options.inputId) input.id = options.inputId;
      dropdown.className = "mat-picker-dropdown";
      dropdown.setAttribute("role", "listbox");
      dropdown.style.display = "none";
      hint.className = "mat-picker-hint";
      hint.style.display = "none";
      wrapper.appendChild(input);
      wrapper.appendChild(dropdown);
      wrapper.appendChild(hint);
      containerEl.appendChild(wrapper);

      function updateHint(text, state) {
        hint.textContent = text || "";
        hint.className = "mat-picker-hint" + (state ? " " + state : "");
        hint.style.display = text ? "block" : "none";
        setClassFlag(input, "mat-picker-invalid", state === "invalid");
      }

      function closeDropdown() {
        dropdown.style.display = "none";
        input.setAttribute("aria-expanded", "false");
        activeIndex = -1;
      }

      function selectMaterial(material, notify) {
        var previousId = selectedMaterialId;
        selectedMaterialId = material ? material.id : null;
        input.value = material ? material.name : input.value;
        closeDropdown();
        updateHint("", "");
        if (typeof options.onChange === "function") {
          options.onChange(material || null, input.value);
        }
        if (material && notify !== false && String(previousId) !== String(material.id) &&
            typeof options.onSelect === "function") {
          options.onSelect(material);
        }
      }

      function exactMatch(value) {
        var normalized = String(value || "").replace(/^\s+|\s+$/g, "").toLowerCase();
        var materials = window.allMaterialsCache || [];
        var i;
        for (i = 0; i < materials.length; i += 1) {
          if (String(materials[i].name || "").replace(/^\s+|\s+$/g, "").toLowerCase() === normalized) {
            return materials[i];
          }
        }
        return null;
      }

      function renderSuggestions() {
        var token = input.value.replace(/^\s+|\s+$/g, "").toLowerCase();
        var materials = window.allMaterialsCache || [];
        var starts = [];
        var contains = [];
        var i;
        var name;
        var material;
        var row;
        var cost;
        if (token.length < 2) {
          closeDropdown();
          return;
        }
        for (i = 0; i < materials.length; i += 1) {
          material = materials[i];
          name = String(material.name || "").toLowerCase();
          if (name.indexOf(token) === 0) starts.push(material);
          else if (name.indexOf(token) >= 0) contains.push(material);
        }
        suggestions = starts.concat(contains);
        dropdown.innerHTML = "";
        if (!suggestions.length) {
          closeDropdown();
          return;
        }
        for (i = 0; i < suggestions.length; i += 1) {
          material = suggestions[i];
          row = document.createElement("button");
          row.type = "button";
          row.className = "mat-picker-option";
          row.setAttribute("role", "option");
          cost = Number(material.cost_per_unit);
          row.textContent = material.name + " — " + (material.unit_label || material.unit) + " — " +
            (isNaN(cost) ? "0.00" : formatMoney(cost)) + " — " +
            formatMoney(material.current_stock);
          row.addEventListener("mousedown", function (event) {
            event.preventDefault();
          });
          row.addEventListener("click", (function (selected) {
            return function () { selectMaterial(selected, true); };
          }(material)));
          dropdown.appendChild(row);
        }
        dropdown.style.display = "block";
        input.setAttribute("aria-expanded", "true");
        activeIndex = -1;
      }

      function onInput() {
        var exact;
        selectedMaterialId = null;
        exact = exactMatch(input.value);
        if (exact) {
          selectMaterial(exact, true);
        } else {
          closeDropdown();
          if (!allowFreeText && input.value.replace(/^\s+|\s+$/g, "")) {
            updateHint("المادة غير مسجلة — أضفها أولاً من صفحة المواد.", "invalid");
          } else {
            updateHint("", "");
          }
          if (typeof options.onChange === "function") {
            options.onChange(null, input.value);
          }
          renderSuggestions();
        }
      }

      function onKeyDown(event) {
        var rows = dropdown.querySelectorAll(".mat-picker-option");
        var key = event.key || event.keyCode;
        if ((key === "ArrowDown" || key === 40) && rows.length) {
          event.preventDefault();
          activeIndex = (activeIndex + 1) % rows.length;
        } else if ((key === "ArrowUp" || key === 38) && rows.length) {
          event.preventDefault();
          activeIndex = activeIndex <= 0 ? rows.length - 1 : activeIndex - 1;
        } else if ((key === "Enter" || key === 13) && activeIndex >= 0 && suggestions[activeIndex]) {
          event.preventDefault();
          selectMaterial(suggestions[activeIndex], true);
          return;
        } else if (key === "Escape" || key === 27) {
          closeDropdown();
          return;
        } else {
          return;
        }
        var i;
        for (i = 0; i < rows.length; i += 1) {
          setClassFlag(rows[i], "active", i === activeIndex);
        }
      }

      function onDocumentClick(event) {
        if (!wrapper.contains(event.target)) closeDropdown();
      }

      input.addEventListener("input", onInput);
      input.addEventListener("keydown", onKeyDown);
      document.addEventListener("click", onDocumentClick);

      var picker = {
        input: input,
        getSelected: function () {
          return selectedMaterialId === null ? null : findMaterialById(selectedMaterialId);
        },
        getSelectedMaterial: function () {
          return picker.getSelected();
        },
        isInvalid: function () {
          return !allowFreeText && !!input.value.replace(/^\s+|\s+$/g, "") &&
            selectedMaterialId === null;
        },
        setSelected: function (id) {
          var material = findMaterialById(id);
          if (!material) {
            selectedMaterialId = null;
            input.value = "";
            updateHint("", "");
            return false;
          }
          selectMaterial(material, true);
          return true;
        },
        reset: function () {
          selectedMaterialId = null;
          input.value = "";
          closeDropdown();
          updateHint("", "");
          if (typeof options.onChange === "function") options.onChange(null, "");
        },
        showError: function (text) {
          updateHint(text, text ? "invalid" : "");
        },
        destroy: function () {
          var pickerIndex;
          if (destroyed) return;
          destroyed = true;
          input.removeEventListener("input", onInput);
          input.removeEventListener("keydown", onKeyDown);
          document.removeEventListener("click", onDocumentClick);
          closeDropdown();
          pickerIndex = materialPickers.indexOf(picker);
          if (pickerIndex >= 0) materialPickers.splice(pickerIndex, 1);
        }
      };
      materialPickers.push(picker);
      if (options.initialValueId !== undefined && options.initialValueId !== null) {
        picker.setSelected(options.initialValueId);
      }
      return picker;
  }

  function showMessage(text, isSuccess) {
    if(!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.className = "form-message" + (isSuccess ? " success" : "");
    setTimeout(() => { 
        if(messageEl && messageEl.textContent === text) {
            messageEl.textContent = ""; 
        }
    }, 5000);
  }

  // ==========================================
  // NAVIGATION LOGIC
  // ==========================================
  function switchView(view) {
    currentView = view;
    
    // Hide all views
    document.querySelectorAll(".admin-view").forEach(section => {
      section.hidden = section.id !== "view-" + view;
    });
    
    // Update active nav button
    document.querySelectorAll(".nav-item[data-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    
    // Update Title
    var titles = {dashboard: "لوحة المعلومات", books: "الكتب", drinks: "المشروبات", materials: "المواد", retail: "منتجات جاهزة", categories: "التصنيفات", reports: "التقارير", settings: "الإعدادات"};
    document.getElementById("page-title").textContent = titles[view] || "الإدارة";
    
    // Close mobile sidebar
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("nav-shade")?.classList.remove("open");
    
    showMessage("");
    
    // Load Content
    if (view === "dashboard") loadDashboard();
    else if (view === "books") loadBooksView();
    else if (view === "drinks") loadDrinksView();
    else if (view === "materials") loadMaterialsView();
    else if (view === "retail") loadRetailView();
    else if (view === "categories") loadCategoriesView();
    else if (view === "reports") renderReports();
    else if (view === "settings") renderSettings();
  }

  // ==========================================
  // DASHBOARD
  // ==========================================
  async function loadDashboard() {
    try {
      var data = await apiCall("/api/admin/dashboard");
      
      document.getElementById("metric-sales").textContent = formatMoney(data.today_sales);
      document.getElementById("metric-profit").textContent = formatMoney(data.today_profit);
      document.getElementById("metric-alerts").textContent = data.low_stock.length;
      
      var target = document.getElementById("low-stock-list");
      if (!data.low_stock.length) {
        target.innerHTML = '<p class="empty-table">لا توجد مواد منخفضة المخزون.</p>';
      } else {
        target.innerHTML = '<table><thead><tr><th>الصنف</th><th>المخزون</th><th>الوحدة</th></tr></thead><tbody>' +
          data.low_stock.map(item => 
            `<tr><td>${escapeHtml(item.name)}</td><td dir="ltr">${item.stock}</td><td>${escapeHtml(item.unit)}</td></tr>`
          ).join("") + "</tbody></table>";
      }
    } catch (error) { showMessage(error.message); }
  }

  // ==========================================
  // BOOKS VIEW (With Functional Edit Button)
  // ==========================================
  function renderBooksTable(rows, noResults) {
    if (!rows.length) {
      return '<p class="empty-table">' + (noResults ? "لا توجد نتائج." : "لا توجد كتب مضافة بعد.") + '</p>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>العنوان</th><th>المؤلف</th><th>دار النشر</th><th>النوع</th><th>التكلفة</th><th>السعر</th><th>المخزون</th><th>الإجراءات</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return `<tr><td>${escapeHtml(row.title)}</td>
          <td>${escapeHtml(row.author)}</td><td>${escapeHtml(row.publisher || "")}</td>
          <td><span class="book-type-tag ${row.type === "Original" ? "original" : "copy"}" dir="ltr">${escapeHtml(row.type)}</span></td>
          <td dir="ltr">${formatMoney(row.cost_price)}</td><td dir="ltr">${formatMoney(row.sell_price)}</td>
          <td dir="ltr">${row.stock_quantity}</td><td class="actions">
            <button class="button button-secondary small-btn" onclick="editBook(${Number(row.id)})">تعديل</button>
            <button class="button button-danger small-btn" onclick="deleteRecord('books', ${Number(row.id)}, loadBooksView)">حذف</button>
          </td></tr>`;
      }).join("") + "</tbody></table></div>";
  }

  async function loadBooksView() {
    var section = document.getElementById("view-books");
    try {
      var rows = await apiCall("/api/admin/books");
      
      var tableHtml = renderBooksTable(rows, false);

      // Form Markup for Adding/Editing Book
      var formHtml = `
        <form id="book-form" class="admin-form" style="display:none;">
          <input type="hidden" id="bk-edit-id"> <!-- Hidden field to store ID during edit -->
          
          <div class="field"><label>العنوان *</label><input type="text" id="bk-title" required></div>
          <div class="field"><label>المؤلف</label><input type="text" id="bk-author"></div>
          <div class="field"><label>دار النشر</label><input type="text" id="bk-publisher"></div>
          <div class="field">
            <label>النوع *</label>
            <select id="bk-type">
              <option value="Original">Original</option>
              <option value="High Copy">High Copy</option>
            </select>
          </div>
          <div class="field"><label>سعر التكلفة *</label><input type="number" step="0.01" min="0" id="bk-cost" required></div>
          <div class="field"><label>سعر البيع *</label><input type="number" step="0.01" min="0" id="bk-price" required></div>
          <div class="field"><label>كمية المخزون *</label><input type="number" min="0" id="bk-stock" required></div>
          <div class="form-actions">
            <button type="submit" class="button button-primary" id="bk-submit-btn">حفظ الكتاب</button>
            <button type="button" class="button button-secondary" onclick="document.getElementById('book-form').style.display='none'; resetBookForm();">إلغاء</button>
          </div>
        </form>
      `;

      section.innerHTML = `
        <article class="panel">
          <div class="panel-heading">
            <h2>مخزون الكتب</h2>
            <div class="inventory-heading-actions">
              <input id="books-search" class="search-box-inventory" type="search" placeholder="🔍 ابحث في الكتب..." aria-label="البحث في الكتب">
              ${renderImportControls("books")}
              <button class="button button-primary" onclick="toggleForm('book-form'); resetBookForm();">+ إضافة كتاب</button>
            </div>
          </div>
          ${formHtml}
          <div id="books-table-content">${tableHtml}</div>
        </article>
      `;
      bindInventorySearch(
        "books-search", "books-table-content", rows,
        function (row) { return [row.title, row.author, row.publisher, row.type].join(" "); },
        renderBooksTable
      );

      // Bind Submit Event (Handles both Add and Edit)
      document.getElementById("book-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        
        var editId = document.getElementById("bk-edit-id").value;
        var payload = {
          title: document.getElementById("bk-title").value,
          author: document.getElementById("bk-author").value,
          publisher: document.getElementById("bk-publisher").value,
          type: document.getElementById("bk-type").value,
          cost_price: parseFloat(document.getElementById("bk-cost").value),
          sell_price: parseFloat(document.getElementById("bk-price").value),
          stock_quantity: parseInt(document.getElementById("bk-stock").value)
        };
        
        try {
          var url = "/api/admin/books";
          var method = "POST";

          if (editId) {
             url += "/" + editId;
             method = "PUT";
          }

          await apiCall(url, { 
              method: method, 
              headers: {"Content-Type":"application/json"}, 
              body: JSON.stringify(payload) 
          });
          
          showMessage(editId ? "تم تحديث الكتاب." : "تم حفظ الكتاب.", true);
          
          // Reset and hide form
          this.style.display = 'none';
          resetBookForm();
          
          loadBooksView(); // Refresh table
          
        } catch(err) { 
            showMessage(err.message); 
        }
      });
      bindImportControls("books");

    } catch (error) { section.innerHTML = `<p>حدث خطأ: ${escapeHtml(error.message)}</p>`; }
  }
  window.loadBooksView = loadBooksView;

  // Helper to clear form fields when switching between Add/Edit modes
  window.resetBookForm = function() {
      var form = document.getElementById("book-form");
      if(form) {
          form.reset();
          document.getElementById("bk-edit-id").value = "";
          document.getElementById("bk-submit-btn").textContent = "حفظ الكتاب";
      }
  };

  // Global helper for editing book (NOW FUNCTIONAL)
  window.editBook = async function(id) {
     try {
        // 1. Fetch the specific book data from backend list
        var rows = await apiCall("/api/admin/books");
        var bookToEdit = rows.find(b => b.id === id);

        if (!bookToEdit) {
            alert("الكتاب غير موجود.");
            return;
        }

        // 2. Populate the Form Fields with existing data
        document.getElementById("bk-edit-id").value = bookToEdit.id;
        document.getElementById("bk-title").value = bookToEdit.title || "";
        document.getElementById("bk-author").value = bookToEdit.author || "";
        document.getElementById("bk-publisher").value = bookToEdit.publisher || "";
        document.getElementById("bk-type").value = bookToEdit.type || "Original";
        document.getElementById("bk-cost").value = bookToEdit.cost_price || 0;
        document.getElementById("bk-price").value = bookToEdit.sell_price || 0;
        document.getElementById("bk-stock").value = bookToEdit.stock_quantity || 0;

        // 3. Show the form and change button text
        var form = document.getElementById("book-form");
        form.style.display = "grid"; 
        
        var submitBtn = document.getElementById("bk-submit-btn");
        if(submitBtn) submitBtn.textContent = "تحديث الكتاب";

        // Scroll to top of panel smoothly
        document.querySelector("#view-books .panel-heading").scrollIntoView({ behavior: 'smooth' });

     } catch (error) {
         console.error(error);
         alert("تعذّر تحميل بيانات الكتاب: " + error.message);
     }
  };

  // ==========================================
  // DRINK RECIPE MATERIAL PICKER
  // ==========================================
  function setRecipeRowError(rowState, text) {
    if (!rowState || !rowState.error) return;
    rowState.error.textContent = text || "";
    rowState.error.style.display = text ? "block" : "none";
    setClassFlag(rowState.element, "has-error", !!text);
    if (rowState.picker) rowState.picker.showError(text);
  }

  function addRecipeRow(prefill) {
    var container = document.getElementById("recipe-rows");
    var row;
    var pickerHost;
    var quantityInput;
    var removeButton;
    var error;
    var rowState;
    if (!container) return null;

    row = document.createElement("div");
    row.className = "recipe-row";
    pickerHost = document.createElement("div");
    pickerHost.className = "recipe-material-host";
    quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.className = "recipe-quantity";
    quantityInput.min = "0.001";
    quantityInput.step = "any";
    quantityInput.placeholder = "الكمية";
    quantityInput.setAttribute("aria-label", "كمية المكوّن");
    removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "recipe-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "حذف المكوّن");
    error = document.createElement("small");
    error.className = "recipe-row-error";
    error.style.display = "none";
    row.appendChild(pickerHost);
    row.appendChild(quantityInput);
    row.appendChild(removeButton);
    row.appendChild(error);
    container.appendChild(row);

    rowState = {
      element: row,
      picker: null,
      quantity: quantityInput,
      error: error
    };
    rowState.picker = createMaterialPicker(pickerHost, {
      allowFreeText: false,
      initialValueId: prefill && prefill.material_id,
      onChange: function (material, value) {
        if (material) setRecipeRowError(rowState, "");
        else if (String(value || "").replace(/^\s+|\s+$/g, "")) {
          setRecipeRowError(rowState, "المادة غير مسجلة — أضفها أولاً من صفحة المواد.");
        } else {
          setRecipeRowError(rowState, "");
        }
      }
    });
    if (prefill && prefill.qty !== undefined && prefill.qty !== null) {
      quantityInput.value = prefill.qty;
    }
    quantityInput.addEventListener("input", function () {
      if (Number(quantityInput.value) > 0) setRecipeRowError(rowState, "");
    });
    removeButton.addEventListener("click", function () {
      rowState.picker.destroy();
      recipeRowStates = recipeRowStates.filter(function (item) { return item !== rowState; });
      row.parentNode.removeChild(row);
    });
    recipeRowStates.push(rowState);
    return rowState;
  }

  function collectRecipeRows() {
    var recipe = [];
    var valid = true;
    var i;
    var rowState;
    var material;
    var quantity;
    for (i = 0; i < recipeRowStates.length; i += 1) {
      rowState = recipeRowStates[i];
      material = rowState.picker.getSelected();
      quantity = Number(rowState.quantity.value);
      if (!material) {
        valid = false;
        if (rowState.picker.input.value.replace(/^\s+|\s+$/g, "")) {
          setRecipeRowError(rowState, "المادة غير مسجلة — أضفها أولاً من صفحة المواد.");
        } else {
          setRecipeRowError(rowState, "اختر مادة مسجلة.");
        }
      } else if (!isFinite(quantity) || quantity <= 0) {
        valid = false;
        setRecipeRowError(rowState, "أدخل كمية أكبر من صفر.");
      } else {
        setRecipeRowError(rowState, "");
        recipe.push({material_id: Number(material.id), qty: quantity});
      }
    }
    return valid ? recipe : null;
  }

  function clearRecipeRows() {
    var i;
    for (i = 0; i < recipeRowStates.length; i += 1) {
      recipeRowStates[i].picker.destroy();
    }
    recipeRowStates = [];
    var container = document.getElementById("recipe-rows");
    if (container) container.innerHTML = "";
  }

  async function saveDrinkHandler(event) {
    event.preventDefault();
    var form = document.getElementById("drink-form");
    var editId = document.getElementById("dk-edit-id").value;
    var recipe = collectRecipeRows();
    var price = Number(document.getElementById("dk-price").value);
    var payload;
    if (!recipe) {
      showMessage("يرجى تصحيح مكونات الوصفة المحددة قبل الحفظ.");
      return;
    }
    if (!isFinite(price) || price < 0) {
      showMessage("أدخل سعرًا صالحًا للمشروب.");
      return;
    }
    payload = {
      name: document.getElementById("dk-name").value,
      sell_price: price,
      recipe_json: JSON.stringify(recipe),
      category: document.getElementById("dk-category").value
    };
    try {
      await apiCall("/api/admin/drinks" + (editId ? "/" + editId : ""), {
        method: editId ? "PUT" : "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      showMessage(editId ? "تم تحديث المشروب." : "تم حفظ المشروب.", true);
      closeDrinkForm();
      form.reset();
      await loadDrinksView();
    } catch (error) {
      showMessage(error.message);
    }
  }

  function closeDrinkForm() {
    var form = document.getElementById("drink-form");
    clearRecipeRows();
    if (form) form.style.display = "none";
  }

  function openNewDrinkForm() {
    var form = document.getElementById("drink-form");
    if (!form) return;
    clearRecipeRows();
    form.reset();
    document.getElementById("dk-edit-id").value = "";
    document.getElementById("dk-submit-btn").textContent = "حفظ المشروب";
    form.style.display = "grid";
    addRecipeRow();
  }

  window.editDrink = function (id) {
    var drink = null;
    var i;
    var recipe;
    var form = document.getElementById("drink-form");
    if (!form) return;
    for (i = 0; i < drinkRowsCache.length; i += 1) {
      if (String(drinkRowsCache[i].id) === String(id)) {
        drink = drinkRowsCache[i];
        break;
      }
    }
    if (!drink) {
      showMessage("المشروب غير موجود. حدّث صفحة المشروبات ثم حاول مرة أخرى.");
      return;
    }
    clearRecipeRows();
    document.getElementById("dk-edit-id").value = drink.id;
    document.getElementById("dk-name").value = drink.name || "";
    document.getElementById("dk-price").value = drink.sell_price;
    document.getElementById("dk-category").value = drink.category === "cold" ? "iced" : (drink.category || "hot");
    document.getElementById("dk-submit-btn").textContent = "تحديث المشروب";
    form.style.display = "grid";
    try {
      recipe = JSON.parse(drink.recipe_json || "[]");
      if (!Array.isArray(recipe)) throw new Error("صيغة الوصفة غير صالحة.");
    } catch (error) {
      recipe = [];
    }
    if (!recipe.length) addRecipeRow();
    else {
      for (i = 0; i < recipe.length; i += 1) addRecipeRow(recipe[i]);
    }
    var heading = document.querySelector("#view-drinks .panel-heading");
    if (heading && heading.scrollIntoView) heading.scrollIntoView({behavior: "smooth"});
  };

  function renderDrinksTable(rows, noResults) {
    if (!rows.length) {
      return '<p class="empty-table">' + (noResults ? "لا توجد نتائج." : "لا توجد مشروبات مسجلة بعد.") + '</p>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>النوع</th><th>السعر</th><th>عدد المكونات</th><th>الإجراءات</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var count = 0;
        try {
          var parsed = JSON.parse(row.recipe_json || "[]");
          count = Array.isArray(parsed) ? parsed.length : 0;
        } catch (error) {
          count = 0;
        }
        return '<tr><td>' + escapeHtml(row.name) +
          '</td><td><span class="drink-type-tag">' + escapeHtml(categoryLabel(row.category === "cold" ? "iced" : row.category)) +
          '</span></td><td dir="ltr">' + formatMoney(row.sell_price) +
          '</td><td dir="ltr">' + count + ' مكونات</td><td class="actions">' +
          '<button class="button button-secondary small-btn" onclick="editDrink(' + Number(row.id) + ')">تعديل</button> ' +
          '<button class="button button-danger small-btn" onclick="deleteRecord(\'drinks\', ' + Number(row.id) + ', loadDrinksView)">حذف</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  async function loadDrinksView() {
    var section = document.getElementById("view-drinks");
    disposeMaterialPickers();
    recipeRowStates = [];
    try {
      var rows = await apiCall("/api/admin/drinks");
      window.allMaterialsCache = await apiCall("/api/admin/materials");
      await loadCategoriesCache();
      drinkRowsCache = rows;
      var tableHtml = renderDrinksTable(rows, false);

      section.innerHTML =
        '<article class="panel"><div class="panel-heading"><h2>قائمة المشروبات</h2>' +
        '<div class="inventory-heading-actions">' + renderImportControls("drinks") +
        '<input id="drinks-search" class="search-box-inventory" type="search" placeholder="🔍 ابحث في المشروبات..." aria-label="البحث في المشروبات">' +
        '<button type="button" class="button button-primary" onclick="openNewDrinkForm()">+ إضافة مشروب</button></div></div>' +
        '<form id="drink-form" class="admin-form recipe-builder" style="display:none;">' +
        '<input type="hidden" id="dk-edit-id">' +
        '<div class="field field-wide"><label for="dk-name">اسم المشروب *</label><input type="text" id="dk-name" required placeholder="مثال: لاتيه"></div>' +
        '<div class="field"><label for="dk-category">تصنيف المشروب *</label><div class="cat-select-row"><select id="dk-category" required>' +
        renderCategoryOptions("drink", "hot") + '</select><button type="button" id="dk-new-category-toggle" class="button button-secondary cat-add-button">➕ تصنيف</button></div>' +
        '<div id="dk-new-category" class="cat-inline-create" hidden><input id="dk-new-category-label" type="text" maxlength="80" placeholder="اسم التصنيف الجديد">' +
        '<button type="button" id="dk-new-category-submit" class="button button-primary small-btn">إضافة</button></div></div>' +
        '<div class="field"><label for="dk-price">سعر البيع (ج.م) *</label><input type="number" step="0.01" min="0" id="dk-price" required></div>' +
        '<div class="field field-wide"><label>مكونات الوصفة</label><div id="recipe-rows" class="recipe-rows"></div>' +
        '<button type="button" id="add-ingredient" class="button button-secondary recipe-add">+ إضافة مكوّن</button></div>' +
        '<div class="form-actions"><button type="submit" class="button button-primary" id="dk-submit-btn">حفظ المشروب</button>' +
        '<button type="button" class="button button-secondary" id="dk-cancel">إلغاء</button></div></form>' +
        '<div id="drinks-table-content">' + tableHtml + '</div></article>';

      bindInventorySearch(
        "drinks-search", "drinks-table-content", rows,
        function (row) { return [row.name, categoryLabel(row.category === "cold" ? "iced" : row.category)].join(" "); },
        renderDrinksTable
      );
      document.getElementById("drink-form").addEventListener("submit", saveDrinkHandler);
      document.getElementById("add-ingredient").addEventListener("click", function () { addRecipeRow(); });
      document.getElementById("dk-cancel").addEventListener("click", closeDrinkForm);
      bindInlineCategoryCreator("drink", "dk");
      bindImportControls("drinks");
    } catch (error) {
      section.innerHTML = '<p>حدث خطأ: ' + escapeHtml(error.message) + '</p>';
    }
  }
  window.loadDrinksView = loadDrinksView;
  window.openNewDrinkForm = openNewDrinkForm;

  // ==========================================
  // MATERIALS VIEW
  // ==========================================
  function similarMaterial(value) {
    var query = String(value || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    var materials = window.allMaterialsCache || [];
    var i;
    var name;
    var prefixLength;
    if (query.length < 1) return null;
    for (i = 0; i < materials.length; i += 1) {
      name = String(materials[i].name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
      if (!name || name === query) continue;
      prefixLength = 0;
      while (prefixLength < query.length && prefixLength < name.length &&
             query.charAt(prefixLength) === name.charAt(prefixLength)) prefixLength += 1;
      if (prefixLength >= 3 || name.indexOf(query) >= 0 || query.indexOf(name) >= 0) return materials[i];
    }
    return null;
  }

  function setMaterialSubmitLabel(text) {
    var button = document.getElementById("mt-submit-btn");
    if (button) button.textContent = text;
  }

  function fillMaterialFields(material) {
    document.getElementById("mt-edit-id").value = material.id;
    document.getElementById("mt-unit").value = {kg: "kg", L: "L", pcs: "pcs"}[material.unit] || "";
    var unitHint = document.getElementById("mt-unit-hint");
    if (unitHint) {
      unitHint.textContent = material.unit_needs_review
        ? "وحدة قديمة غير معروفة؛ اختر وحدة معتمدة قبل الحفظ."
        : "";
      unitHint.className = "material-name-hint" + (material.unit_needs_review ? " similar-warning" : "");
    }
    document.getElementById("mt-cost").value = material.cost_per_unit;
    document.getElementById("mt-stock").value = material.current_stock;
    document.getElementById("mt-reorder").value = material.reorder_level;
    setMaterialSubmitLabel("تحديث المادة");
    var hint = document.getElementById("mt-name-hint");
    hint.textContent = "تم اختيار مادة موجودة — سيؤدي الحفظ إلى تحديثها وليس إنشاء مادة مكررة.";
    hint.className = "material-name-hint similar-found";
  }

  function handleMaterialNameChange(material, value) {
    var editField = document.getElementById("mt-edit-id");
    var hint = document.getElementById("mt-name-hint");
    if (!editField || !hint || material) return;
    if (editField.value) {
      editField.value = "";
      document.getElementById("mt-unit").value = "";
      document.getElementById("mt-cost").value = "";
      document.getElementById("mt-stock").value = "";
      document.getElementById("mt-reorder").value = "5";
      var unitHint = document.getElementById("mt-unit-hint");
      if (unitHint) unitHint.textContent = "";
      setMaterialSubmitLabel("حفظ المادة");
    }
    var match = similarMaterial(value);
    if (match) {
      hint.textContent = "توجد مادة مشابهة: " + match.name + ". هل أنت متأكد أن هذه مادة جديدة؟";
      hint.className = "material-name-hint similar-warning";
    } else {
      hint.textContent = "";
      hint.className = "material-name-hint";
    }
  }

  function initializeMaterialNamePicker(initialId) {
    var host = document.getElementById("mt-name-picker");
    if (!host) return;
    if (materialNamePicker) materialNamePicker.destroy();
    host.innerHTML = "";
    materialNamePicker = createMaterialPicker(host, {
      inputId: "mt-name",
      allowFreeText: true,
      required: true,
      onSelect: fillMaterialFields,
      onChange: handleMaterialNameChange
    });
    if (initialId !== undefined && initialId !== null) materialNamePicker.setSelected(initialId);
  }

  function resetMaterialsForm() {
    var form = document.getElementById("mat-form");
    if (!form) return;
    if (materialNamePicker) {
      materialNamePicker.destroy();
      materialNamePicker = null;
    }
    form.reset();
    document.getElementById("mt-edit-id").value = "";
    document.getElementById("mt-reorder").value = "5";
    setMaterialSubmitLabel("حفظ المادة");
    var hint = document.getElementById("mt-name-hint");
    if (hint) {
      hint.textContent = "";
      hint.className = "material-name-hint";
    }
    var host = document.getElementById("mt-name-picker");
    if (host) host.innerHTML = "";
  }
  window.resetMaterialsForm = resetMaterialsForm;

  function openNewMaterialForm() {
    var form = document.getElementById("mat-form");
    if (!form) return;
    resetMaterialsForm();
    form.style.display = "grid";
    initializeMaterialNamePicker();
  }
  window.openNewMaterialForm = openNewMaterialForm;

  window.editMaterial = function (id) {
    var materials = window.allMaterialsCache || [];
    var i;
    var form = document.getElementById("mat-form");
    for (i = 0; i < materials.length; i += 1) {
      if (String(materials[i].id) === String(id)) {
        if (!form) return;
        resetMaterialsForm();
        form.style.display = "grid";
        initializeMaterialNamePicker(materials[i].id);
        var heading = document.querySelector("#view-materials .panel-heading");
        if (heading && heading.scrollIntoView) heading.scrollIntoView({behavior: "smooth"});
        return;
      }
    }
    showMessage("المادة غير موجودة. حدّث صفحة المواد ثم حاول مرة أخرى.");
  };

  function renderMaterialsTable(rows, noResults) {
    if (!rows.length) {
      return '<p class="empty-table">' + (noResults ? "لا توجد نتائج." : "لم تتم إضافة مواد بعد.") + '</p>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>اسم المادة</th><th>الوحدة</th><th>تكلفة الوحدة</th><th>المخزون</th><th>حد التنبيه</th><th>الإجراءات</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + escapeHtml(row.name) + '</td><td>' +
          escapeHtml(row.unit_label || row.unit) +
          (row.unit_needs_review ? ' <span class="unit-review-badge">تحتاج مراجعة</span>' : '') +
          '</td><td dir="ltr">' + formatMoney(row.cost_per_unit) +
          '</td><td dir="ltr">' + row.current_stock + '</td><td dir="ltr">' + row.reorder_level +
          '</td><td class="actions"><button class="button button-secondary small-btn" onclick="editMaterial(' + Number(row.id) + ')">تعديل</button> ' +
          '<button class="button button-danger small-btn" onclick="deleteRecord(\'materials\', ' + Number(row.id) + ', loadMaterialsView)">حذف</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  async function loadMaterialsView() {
    var section = document.getElementById("view-materials");
    disposeMaterialPickers();
    try {
      var rows = await apiCall("/api/admin/materials");
      window.allMaterialsCache = rows;
      var tableHtml = renderMaterialsTable(rows, false);

      section.innerHTML =
        '<article class="panel"><div class="panel-heading"><h2>المواد الخام</h2>' +
        '<div class="inventory-heading-actions">' + renderImportControls("materials") +
        '<input id="materials-search" class="search-box-inventory" type="search" placeholder="🔍 ابحث في المواد..." aria-label="البحث في المواد">' +
        '<button type="button" class="button button-primary" onclick="openNewMaterialForm()">+ إضافة مادة</button></div></div>' +
        '<form id="mat-form" class="admin-form" style="display:none;">' +
        '<input type="hidden" id="mt-edit-id">' +
        '<div class="field"><label for="mt-name">اسم المادة *</label><div id="mt-name-picker"></div>' +
        '<small id="mt-name-hint" class="material-name-hint"></small></div>' +
        '<div class="field"><label for="mt-unit">الوحدة *</label><select id="mt-unit" required>' +
        '<option value="kg">كجم</option><option value="L">لتر</option><option value="pcs">قطعة</option></select>' +
        '<small id="mt-unit-hint" class="material-name-hint"></small></div>' +
        '<div class="field"><label for="mt-cost">تكلفة الوحدة *</label><input type="number" step="0.01" min="0" id="mt-cost" required></div>' +
        '<div class="field"><label for="mt-stock">المخزون الحالي *</label><input type="number" step="0.01" min="0" id="mt-stock" required></div>' +
        '<div class="field"><label for="mt-reorder">حد تنبيه انخفاض المخزون</label><input type="number" step="0.01" min="0" id="mt-reorder" value="5"></div>' +
        '<div class="form-actions"><button type="submit" class="button button-primary" id="mt-submit-btn">حفظ المادة</button>' +
        '<button type="button" class="button button-secondary" id="mt-cancel">إلغاء</button></div></form>' +
        '<div id="materials-table-content">' + tableHtml + '</div></article>';

      bindInventorySearch(
        "materials-search", "materials-table-content", rows,
        function (row) { return [row.name, row.unit_label || row.unit].join(" "); },
        renderMaterialsTable
      );
      document.getElementById("mat-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var editId = document.getElementById("mt-edit-id").value;
        var nameInput = document.getElementById("mt-name");
        var exactName = (window.allMaterialsCache || []).filter(function (item) {
          return item.name.toLowerCase() === nameInput.value.replace(/^\s+|\s+$/g, "").toLowerCase();
        })[0];
        if (!editId && exactName) {
          showMessage("هذه المادة موجودة بالفعل. اخترها من الاقتراحات لتحديثها.");
          return;
        }
        var payload = {
          name: nameInput.value.replace(/^\s+|\s+$/g, ""),
          unit: document.getElementById("mt-unit").value,
          cost_per_unit: Number(document.getElementById("mt-cost").value),
          current_stock: Number(document.getElementById("mt-stock").value),
          reorder_level: Number(document.getElementById("mt-reorder").value)
        };
        try {
          await apiCall("/api/admin/materials" + (editId ? "/" + editId : ""), {
            method: editId ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
          });
          showMessage(editId ? "تم تحديث المادة." : "تم حفظ المادة.", true);
          this.style.display = "none";
          resetMaterialsForm();
          await loadMaterialsView();
        } catch (error) {
          showMessage(error.message);
        }
      });
      document.getElementById("mt-cancel").addEventListener("click", function () {
        resetMaterialsForm();
        document.getElementById("mat-form").style.display = "none";
      });
      bindImportControls("materials");
    } catch (error) {
      section.innerHTML = '<p>حدث خطأ: ' + escapeHtml(error.message) + '</p>';
    }
  }
  window.loadMaterialsView = loadMaterialsView;

  function renderRetailTable(rows, noResults) {
    if (!rows.length) {
      return '<p class="empty-table">' + (noResults ? "لا توجد نتائج." : "لا توجد منتجات جاهزة مسجلة بعد.") + '</p>';
    }
    return '<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>التصنيف</th><th>التكلفة</th><th>السعر</th><th>الكمية</th><th>الوحدة</th><th>الإجراءات</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + escapeHtml(row.name) +
          '</td><td>' + escapeHtml(row.category_label || categoryLabel(row.category)) +
          '</td><td dir="ltr">' + formatMoney(row.cost_price) + '</td><td dir="ltr">' +
          formatMoney(row.sell_price) + '</td><td dir="ltr">' + row.stock_quantity +
          '</td><td>' + escapeHtml(row.unit || "قطعة") + '</td><td class="actions">' +
          '<button class="button button-secondary small-btn" onclick="editRetail(' + Number(row.id) + ')">تعديل</button> ' +
          '<button class="button button-danger small-btn" onclick="deleteRecord(\'retail\', ' + Number(row.id) + ', loadRetailView)">حذف</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  function resetRetailForm() {
    var form = document.getElementById("retail-form");
    if (!form) return;
    form.reset();
    document.getElementById("ret-edit-id").value = "";
    document.getElementById("ret-unit").value = "قطعة";
    document.getElementById("ret-submit-btn").textContent = "حفظ المنتج";
  }

  function openNewRetailForm() {
    var form = document.getElementById("retail-form");
    if (!form) return;
    resetRetailForm();
    form.style.display = "grid";
  }
  window.openNewRetailForm = openNewRetailForm;

  window.editRetail = function (id) {
    apiCall("/api/admin/retail").then(function (rows) {
      var item = rows.filter(function (row) { return String(row.id) === String(id); })[0];
      var form = document.getElementById("retail-form");
      var categorySelect;
      if (!item || !form) {
        showMessage("المنتج الجاهز غير موجود.");
        return;
      }
      resetRetailForm();
      document.getElementById("ret-edit-id").value = item.id;
      document.getElementById("ret-name").value = item.name || "";
      document.getElementById("ret-cost").value = item.cost_price;
      document.getElementById("ret-price").value = item.sell_price;
      document.getElementById("ret-stock").value = item.stock_quantity;
      categorySelect = document.getElementById("ret-category");
      categorySelect.value = item.category;
      document.getElementById("ret-submit-btn").textContent = "تحديث المنتج";
      form.style.display = "grid";
    }).catch(function (error) { showMessage(error.message); });
  };

  async function loadRetailView() {
    var section = document.getElementById("view-retail");
    if (!section) return;
    try {
      var rows = await apiCall("/api/admin/retail");
      await loadCategoriesCache();
      section.innerHTML =
        '<article class="panel"><div class="panel-heading"><h2>المنتجات الجاهزة</h2>' +
        '<div class="inventory-heading-actions">' + renderImportControls("retail") +
        '<input id="retail-search" class="search-box-inventory" type="search" placeholder="🔍 ابحث في المنتجات الجاهزة..." aria-label="البحث في المنتجات الجاهزة">' +
        '<button type="button" class="button button-primary" onclick="openNewRetailForm()">+ إضافة منتج</button></div></div>' +
        '<form id="retail-form" class="admin-form" style="display:none;">' +
        '<input type="hidden" id="ret-edit-id">' +
        '<div class="field"><label for="ret-name">الاسم *</label><input id="ret-name" type="text" required></div>' +
        '<div class="field"><label for="ret-category">التصنيف *</label><div class="cat-select-row"><select id="ret-category" required>' +
        renderCategoryOptions("retail") + '</select><button type="button" id="ret-new-category-toggle" class="button button-secondary cat-add-button">➕ تصنيف</button></div>' +
        '<div id="ret-new-category" class="cat-inline-create" hidden><input id="ret-new-category-label" type="text" maxlength="80" placeholder="اسم التصنيف الجديد">' +
        '<button type="button" id="ret-new-category-submit" class="button button-primary small-btn">إضافة</button></div></div>' +
        '<div class="field"><label for="ret-cost">سعر التكلفة *</label><input id="ret-cost" type="number" min="0" step="0.01" required></div>' +
        '<div class="field"><label for="ret-price">سعر البيع *</label><input id="ret-price" type="number" min="0" step="0.01" required></div>' +
        '<div class="field"><label for="ret-stock">الكمية *</label><input id="ret-stock" type="number" min="0" step="1" required></div>' +
        '<div class="field"><label for="ret-unit">الوحدة</label><input id="ret-unit" type="text" value="قطعة" readonly></div>' +
        '<div class="form-actions"><button type="submit" id="ret-submit-btn" class="button button-primary">حفظ المنتج</button>' +
        '<button type="button" id="ret-cancel" class="button button-secondary">إلغاء</button></div></form>' +
        '<div id="retail-table-content">' + renderRetailTable(rows, false) + '</div></article>';

      bindInventorySearch(
        "retail-search", "retail-table-content", rows,
        function (row) { return [row.name, row.category_label || categoryLabel(row.category)].join(" "); },
        renderRetailTable
      );
      bindInlineCategoryCreator("retail", "ret");
      document.getElementById("retail-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var editId = document.getElementById("ret-edit-id").value;
        var payload = {
          name: document.getElementById("ret-name").value,
          category: document.getElementById("ret-category").value,
          cost_price: Number(document.getElementById("ret-cost").value),
          sell_price: Number(document.getElementById("ret-price").value),
          stock_quantity: Number(document.getElementById("ret-stock").value)
        };
        if (!payload.category || !payload.category.replace(/^\s+|\s+$/g, "")) {
          showMessage("أدخل تصنيف المنتج الجاهز.");
          return;
        }
        try {
          await apiCall("/api/admin/retail" + (editId ? "/" + editId : ""), {
            method: editId ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
          });
          showMessage(editId ? "تم تحديث المنتج الجاهز." : "تم حفظ المنتج الجاهز.", true);
          this.style.display = "none";
          resetRetailForm();
          await loadRetailView();
        } catch (error) { showMessage(error.message); }
      });
      document.getElementById("ret-cancel").addEventListener("click", function () {
        resetRetailForm();
        document.getElementById("retail-form").style.display = "none";
      });
      bindImportControls("retail");
    } catch (error) {
      section.innerHTML = '<p>حدث خطأ: ' + escapeHtml(error.message) + '</p>';
    }
  }
  window.loadRetailView = loadRetailView;

  function categoryScopeLabel(scope) {
    return {drink: "مشروبات", retail: "منتجات جاهزة", book: "كتب"}[scope] || scope;
  }

  function categoryForId(id) {
    return allCategoriesCache.filter(function (category) {
      return String(category.id) === String(id);
    })[0] || null;
  }

  function renderCategoryGroups(query) {
    var scopes = [
      {key: "drink", title: "☕ تصنيفات المشروبات", pill: "مشروبات"},
      {key: "retail", title: "🛒 تصنيفات المنتجات الجاهزة", pill: "جاهزة"},
      {key: "book", title: "📖 تصنيفات الكتب", pill: "كتب"}
    ];
    var html = "";
    var normalizedQuery = normalizeSearchText(query);
    var i;
    var group;
    var rows;
    var allRows;
    var index;
    var category;
    var disabledUp;
    var disabledDown;
    for (i = 0; i < scopes.length; i += 1) {
      group = scopes[i];
      allRows = allCategoriesCache.filter(function (item) {
        return item.scope === group.key;
      }).sort(function (left, right) {
        return Number(left.sort_order) - Number(right.sort_order) || Number(left.id) - Number(right.id);
      });
      if (group.key === "book" && !allRows.length) continue;
      rows = allRows.filter(function (item) {
        return !normalizedQuery || normalizeSearchText(item.label_ar).indexOf(normalizedQuery) >= 0;
      });
      html += '<section class="cat-group" data-scope="' + group.key + '"><header class="cat-group-header">' +
        '<h3>' + group.title + '</h3><span>' + rows.length + '</span></header>';
      if (!allRows.length) {
        html += '<p class="cat-group-empty">لا توجد تصنيفات في هذا النطاق — أضِف واحداً</p>';
      } else if (!rows.length) {
        html += '<p class="cat-group-empty">لا توجد نتائج</p>';
      } else {
        html += '<div class="cat-card-list">';
        for (index = 0; index < rows.length; index += 1) {
          category = rows[index];
          var fullIndex = allRows.indexOf(category);
          disabledUp = fullIndex === 0;
          disabledDown = fullIndex === allRows.length - 1;
          html += '<article class="cat-card' + (category.is_active ? "" : " is-inactive") +
            '" data-category-id="' + Number(category.id) + '"><div class="cat-card-identity">' +
            '<strong class="cat-card-name">' + escapeHtml(category.label_ar) + '</strong>' +
            '<span class="cat-pill cat-pill-' + group.key + '">' + group.pill + '</span>' +
            '<span class="cat-count' + (Number(category.product_count || 0) ? "" : " is-empty") + '">' +
            '· ' + (Number(category.product_count || 0) ? Number(category.product_count) + ' منتج' : "فاضي") +
            '</span></div><div class="cat-card-controls"><label class="cat-toggle">' +
            '<input type="checkbox" class="cat-active-toggle" data-id="' + Number(category.id) + '"' +
            (category.is_active ? " checked" : "") + '><span class="cat-toggle-track"></span>' +
            '<span class="cat-toggle-label">' + (category.is_active ? "نشط" : "معطّل") +
            '</span></label><div class="cat-card-actions"><span class="cat-reorder">' +
            '<button type="button" class="cat-icon-button" data-action="move-up" data-id="' + Number(category.id) +
            '" aria-label="نقل لأعلى" title="نقل لأعلى"' + (disabledUp ? " disabled" : "") + '>⌃</button>' +
            '<button type="button" class="cat-icon-button" data-action="move-down" data-id="' + Number(category.id) +
            '" aria-label="نقل لأسفل" title="نقل لأسفل"' + (disabledDown ? " disabled" : "") + '>⌄</button></span>' +
            '<button type="button" class="cat-icon-button" data-action="edit" data-id="' + Number(category.id) +
            '" aria-label="تعديل الاسم" title="تعديل الاسم">✏️</button>' +
            '<button type="button" class="cat-icon-button cat-icon-danger" data-action="delete" data-id="' +
            Number(category.id) + '" aria-label="حذف" title="حذف">🗑️</button></div></div></article>';
        }
        html += '</div>';
      }
      html += '</section>';
    }
    return html || '<p class="cat-group-empty">لا توجد تصنيفات مسجلة بعد.</p>';
  }

  function renderCategoryList() {
    var list = document.getElementById("categories-list");
    var search = document.getElementById("categories-search");
    if (list) list.innerHTML = renderCategoryGroups(search ? search.value : "");
  }

  function setCategoryForm(category) {
    var form = document.getElementById("category-form");
    if (!form) return;
    form.reset();
    document.getElementById("cat-edit-id").value = category ? category.id : "";
    document.getElementById("cat-label").value = category ? category.label_ar : "";
    document.getElementById("cat-scope").value = category ? category.scope : "drink";
    document.getElementById("cat-sort-order").value = category ? category.sort_order : 100;
    document.getElementById("cat-active").checked = category ? category.is_active : true;
    document.getElementById("cat-slug-view").textContent = category ? category.slug : "يُنشأ عند الحفظ";
    document.getElementById("cat-submit").textContent = category ? "تحديث التصنيف" : "حفظ التصنيف";
    form.style.display = "grid";
  }

  async function loadCategoriesView() {
    var section = document.getElementById("view-categories");
    if (!section) return;
    try {
      await loadCategoriesCache();
      section.innerHTML =
        '<article class="panel"><div class="cat-toolbar"><div><h2>إدارة التصنيفات</h2>' +
        '<p class="muted small">نظّم تصنيفات المشروبات والمنتجات الجاهزة والكتب.</p></div>' +
        '<div class="cat-toolbar-actions"><input id="categories-search" class="search-box-inventory" type="search" placeholder="🔍 ابحث بالاسم..." aria-label="البحث باسم التصنيف">' +
        '<button type="button" class="button button-primary" id="cat-add">+ إضافة تصنيف</button></div></div>' +
        '<form id="category-form" class="admin-form cat-form" style="display:none;"><input type="hidden" id="cat-edit-id">' +
        '<div class="field"><label for="cat-label">اسم التصنيف *</label><input id="cat-label" type="text" maxlength="80" required></div>' +
        '<div class="field"><label for="cat-scope">النطاق *</label><select id="cat-scope"><option value="drink">مشروبات</option>' +
        '<option value="retail">منتجات جاهزة</option><option value="book">كتب (محجوز للمستقبل)</option></select></div>' +
        '<div class="field"><label for="cat-sort-order">الترتيب</label><input id="cat-sort-order" type="number" step="1" value="100"></div>' +
        '<div class="field"><label>المعرّف الداخلي</label><code id="cat-slug-view" class="slug-ro" dir="ltr">يُنشأ عند الحفظ</code></div>' +
        '<div class="field"><label class="cat-form-active"><input id="cat-active" type="checkbox" checked> نشط</label></div>' +
        '<div class="form-actions"><button type="submit" id="cat-submit" class="button button-primary">حفظ التصنيف</button>' +
        '<button type="button" id="cat-cancel" class="button button-secondary">إلغاء</button></div></form>' +
        '<div id="categories-list" class="cat-groups">' + renderCategoryGroups("") + '</div>' +
        '<div id="cat-delete-modal" class="cat-modal" hidden></div></article>';
      var searchTimer = null;
      document.getElementById("categories-search").addEventListener("input", function () {
        var input = this;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          if (document.getElementById("categories-list")) renderCategoryList();
        }, 200);
      });
      document.getElementById("cat-add").addEventListener("click", function () {
        setCategoryForm(null);
      });
      document.getElementById("cat-cancel").addEventListener("click", function () {
        document.getElementById("category-form").style.display = "none";
      });
      document.getElementById("category-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var editId = document.getElementById("cat-edit-id").value;
        var payload = {
          label_ar: document.getElementById("cat-label").value,
          scope: document.getElementById("cat-scope").value,
          sort_order: Number(document.getElementById("cat-sort-order").value),
          is_active: document.getElementById("cat-active").checked
        };
        try {
          await apiCall("/api/categories" + (editId ? "/" + editId : ""), {
            method: editId ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
          });
          showMessage(editId ? "تم تحديث التصنيف." : "تمت إضافة التصنيف.", true);
          await loadCategoriesView();
        } catch (error) {
          showMessage("تعذر حفظ التصنيف: " + error.message);
        }
      });
      document.getElementById("categories-list").addEventListener("change", async function (event) {
        var toggle = event.target;
        if (!toggle.classList.contains("cat-active-toggle")) return;
        var category = categoryForId(toggle.getAttribute("data-id"));
        if (!category) return;
        toggle.disabled = true;
        try {
          await updateCategoryActive(category, toggle.checked);
          category.is_active = toggle.checked;
          showMessage(toggle.checked ? "تم تفعيل التصنيف." : "تم تعطيل التصنيف.", true);
          renderCategoryList();
        } catch (error) {
          toggle.checked = !toggle.checked;
          toggle.disabled = false;
          showMessage("تعذر تغيير حالة التصنيف: " + error.message);
        }
      });
      document.getElementById("categories-list").addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-action]") : event.target;
        var category;
        if (!button || !button.getAttribute("data-action")) return;
        category = categoryForId(button.getAttribute("data-id"));
        if (!category || button.disabled) return;
        if (button.getAttribute("data-action") === "edit") {
          setCategoryForm(category);
        } else if (button.getAttribute("data-action") === "delete") {
          window.deleteCategory(category);
        } else if (button.getAttribute("data-action") === "move-up") {
          window.moveCategory(category, "up");
        } else if (button.getAttribute("data-action") === "move-down") {
          window.moveCategory(category, "down");
        }
      });
    } catch (error) {
      section.innerHTML = '<p class="empty-table">تعذر تحميل التصنيفات: ' + escapeHtml(error.message) + '</p>';
    }
  }

  window.editCategory = function (id) {
    var category = categoryForId(id);
    if (!category) {
      showMessage("التصنيف غير موجود. حدّث الصفحة ثم حاول مرة أخرى.");
      return;
    }
    setCategoryForm(category);
  };

  async function updateCategoryActive(category, isActive) {
    await apiCall("/api/categories/" + category.id, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        label_ar: category.label_ar,
        scope: category.scope,
        sort_order: category.sort_order,
        is_active: isActive
      })
    });
  }

  function closeCategoryDeleteModal() {
    var modal = document.getElementById("cat-delete-modal");
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
  }

  async function deactivateCategory(category) {
    try {
      await updateCategoryActive(category, false);
      category.is_active = false;
      closeCategoryDeleteModal();
      showMessage("تم تعطيل التصنيف.", true);
      renderCategoryList();
      return true;
    } catch (error) {
      showMessage("تعذر تعطيل التصنيف: " + error.message);
      return false;
    }
  }

  async function confirmCategoryDelete(category, targetSlug) {
    var count = Number(category.product_count || 0);
    var url = "/api/categories/" + category.id;
    if (count) {
      var target = allCategoriesCache.filter(function (item) {
        return item.slug === targetSlug && item.scope === category.scope &&
          item.is_active && String(item.id) !== String(category.id);
      })[0];
      if (!target) {
        showMessage("اختر تصنيفًا نشطًا آخر من النطاق نفسه.");
        return;
      }
      url += "?reassign_to=" + encodeURIComponent(target.slug);
    }
    try {
      await apiCall(url, {method: "DELETE"});
      showMessage("تم حذف التصنيف ونقل المنتجات المرتبطة به إن وجدت.", true);
      closeCategoryDeleteModal();
      await loadCategoriesView();
      return true;
    } catch (error) {
      showMessage("تعذر حذف التصنيف: " + error.message);
      return false;
    }
  }

  window.deleteCategory = function (categoryOrId) {
    var category = typeof categoryOrId === "object"
      ? categoryOrId : categoryForId(categoryOrId);
    var modal = document.getElementById("cat-delete-modal");
    var targetCategories;
    var targetOptions;
    var count;
    if (!category) {
      showMessage("التصنيف غير موجود. حدّث الصفحة ثم حاول مرة أخرى.");
      return;
    }
    count = Number(category.product_count || 0);
    if (!count) {
      if (!window.confirm("حذف التصنيف «" + category.label_ar + "»؟")) return;
      confirmCategoryDelete(category, "");
      return;
    }
    if (!modal) return;
    targetCategories = allCategoriesCache.filter(function (item) {
      return item.scope === category.scope && item.is_active &&
        String(item.id) !== String(category.id);
    });
    targetOptions = '<option value="">اختر تصنيفًا بديلًا</option>' +
      targetCategories.map(function (item) {
        return '<option value="' + escapeHtml(item.slug) + '">' + escapeHtml(item.label_ar) + '</option>';
      }).join("");
    modal.innerHTML =
      '<div class="cat-modal-backdrop" data-action="modal-close"><section class="cat-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="cat-modal-title">' +
      '<button type="button" class="cat-modal-close" data-action="modal-cancel" aria-label="إغلاق">×</button>' +
      '<h3 id="cat-modal-title">التصنيف «' + escapeHtml(category.label_ar) + '» عليه ' + count + ' منتج</h3>' +
      '<p>لا يمكن حذف تصنيف مرتبط بمنتجات. انقل المنتجات إلى تصنيف آخر من نفس النطاق، أو عطّل التصنيف بدلاً من حذفه.</p>' +
      (targetCategories.length
        ? '<label for="cat-modal-target">التصنيف البديل</label><select id="cat-modal-target">' + targetOptions + '</select>'
        : '<p class="cat-modal-warning">لا يوجد تصنيف نشط آخر في هذا النطاق. أضف تصنيفًا أو عطّل هذا التصنيف.</p>') +
      '<div class="cat-modal-actions"><button type="button" class="button button-danger" data-action="modal-delete"' +
      (!targetCategories.length ? " disabled" : "") + '>نقل وحذف</button>' +
      '<button type="button" class="button button-secondary" data-action="modal-deactivate">عطّل فقط</button>' +
      '<button type="button" class="button button-secondary" data-action="modal-cancel">إلغاء</button></div></section></div>';
    modal.hidden = false;
    modal.addEventListener("click", async function handler(event) {
      var action = event.target.getAttribute("data-action");
      if (action === "modal-close" || action === "modal-cancel") {
        closeCategoryDeleteModal();
        modal.removeEventListener("click", handler);
      } else if (action === "modal-deactivate") {
        if (await deactivateCategory(category)) {
          modal.removeEventListener("click", handler);
        }
      } else if (action === "modal-delete") {
        var select = document.getElementById("cat-modal-target");
        if (!select || !select.value) {
          showMessage("اختر تصنيفًا بديلًا نشطًا من النطاق نفسه.");
          return;
        }
        if (await confirmCategoryDelete(category, select.value)) {
          modal.removeEventListener("click", handler);
        }
      }
    });
  };

  window.moveCategory = async function (categoryOrId, direction) {
    var category = typeof categoryOrId === "object"
      ? categoryOrId : categoryForId(categoryOrId);
    var group;
    var index;
    var neighbor;
    var oldOrder;
    var oldNeighborOrder;
    if (!category) return;
    group = allCategoriesCache.filter(function (item) {
      return item.scope === category.scope;
    }).sort(function (left, right) {
      return Number(left.sort_order) - Number(right.sort_order) || Number(left.id) - Number(right.id);
    });
    index = group.indexOf(category);
    neighbor = group[index + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    oldOrder = category.sort_order;
    oldNeighborOrder = neighbor.sort_order;
    category.sort_order = oldNeighborOrder;
    neighbor.sort_order = oldOrder;
    renderCategoryList();
    try {
      await apiCall("/api/categories/" + category.id + "/move", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({direction: direction})
      });
      await loadCategoriesCache();
      renderCategoryList();
    } catch (error) {
      category.sort_order = oldOrder;
      neighbor.sort_order = oldNeighborOrder;
      renderCategoryList();
      showMessage("تعذر نقل التصنيف: " + error.message);
    }
  };

  // ==========================================
  // COMMON UI HELPERS
  // ==========================================
  window.toggleForm = function(formId) {
    var form = document.getElementById(formId);
    if(form) {
        form.reset();
        form.style.display = form.style.display === 'grid' ? 'none' : 'grid';
    }
  };

  window.deleteRecord = async function(resource, id, refreshCallback) {
    var normalizedId = Number(id);
    var successMessages = {
      books: "تم حذف الكتاب",
      drinks: "تم حذف المشروب",
      materials: "تم حذف المادة",
      retail: "تم حذف المنتج الجاهز"
    };
    if (!isFinite(normalizedId) || normalizedId < 1) {
      showMessage("معرّف السجل غير صالح.");
      return;
    }
    if (!confirm("هل أنت متأكد من حذف هذا السجل؟")) return;
    try {
      await apiCall(`/api/admin/${resource}/${normalizedId}`, { method: "DELETE" });
      showMessage(successMessages[resource] || "تم حذف السجل.", true);
      if (refreshCallback) await refreshCallback();
    } catch(err) {
      showMessage(err.message);
    }
  };

  // ==========================================
  // REPORTS & SETTINGS
  // ==========================================
  async function renderReports() {
    var section = document.getElementById("view-reports");
    section.innerHTML = `
      <article class="panel">
        <div class="panel-heading"><h2>التقرير الشهري</h2></div>
        <div class="admin-form">
          <div class="field"><label>اختر الشهر</label><input type="month" id="rep-month" value="${currentMonthValue()}"></div>
          <div class="field form-actions"><button class="button button-primary" onclick="loadReportData()">عرض التقرير</button></div>
        </div>
        <div id="report-output"></div>
      </article>
    `;
  }

  window.loadReportData = async function() {
    var month = document.getElementById("rep-month").value;
    try {
      var res = await apiCall(`/api/admin/reports?month=${month}`);
      document.getElementById("report-output").innerHTML = `
        <div class="metric-grid">
          <div class="metric-card"><span>الإيرادات</span><strong dir="ltr">${formatMoney(res.revenue)}</strong></div>
          <div class="metric-card"><span>تكلفة البضاعة المباعة</span><strong dir="ltr">${formatMoney(res.cogs)}</strong></div>
          <div class="metric-card"><span>المصروفات</span><strong dir="ltr">${formatMoney(res.expenses)}</strong></div>
          <div class="metric-card"><span>صافي الربح</span><strong dir="ltr" style="color:${res.profit >= 0 ? '#059669' : '#dc2626'}">${formatMoney(res.profit)}</strong></div>
        </div>
        <p class="muted mt-2">${res.orders} عملية بيع.</p>
      `;
    } catch(e) { alert(e.message); }
  };

  async function renderSettings() {
    var section = document.getElementById("view-settings");
    try {
      // 1. Fetch current settings
      var data = await apiCall("/api/admin/settings");
      
      // 2. Build HTML with BOTH Shop Settings AND Password Change forms
      section.innerHTML = `
        <article class="panel">
          <div class="panel-heading"><h2>بيانات المتجر</h2></div>
          <form id="set-form" class="admin-form">
            <div class="field field-wide">
              <label for="st-name">اسم المتجر</label>
              <input type="text" id="st-name" value="${escapeHtml(data.shop_name)}">
            </div>
            <div class="field field-wide">
              <label for="st-addr">العنوان / رقم الهاتف</label>
              <textarea id="st-addr" placeholder="مثال: شارع ...، القاهرة | هاتف: 01...">${escapeHtml(data.shop_address)}</textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-primary">حفظ بيانات المتجر</button>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="panel-heading"><h2>الأمان</h2></div>
          <p class="muted small" style="margin-bottom:15px;">يمكنك تغيير كلمة مرور دخول الإدارة هنا.</p>
          <form id="pass-form" class="admin-form">
            <div class="field field-wide">
              <label for="new-pass">كلمة المرور الجديدة (6 أحرف على الأقل)</label>
              <input type="password" id="new-pass" minlength="6" required autocomplete="off">
            </div>
            <div class="field field-wide">
              <label for="conf-pass">تأكيد كلمة المرور الجديدة</label>
              <input type="password" id="conf-pass" minlength="6" required autocomplete="off">
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-danger">تحديث كلمة المرور</button>
            </div>
          </form>
        </article>
      `;
      
      // 3. Bind Save Shop Info Event
      document.getElementById("set-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        try {
          var savedSettings = await apiCall("/api/admin/settings", {
            method: "PUT",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ 
              shop_name: document.getElementById("st-name").value, 
              shop_address: document.getElementById("st-addr").value 
            })
          });
          document.getElementById("st-name").value = savedSettings.shop_name;
          updateShopBrand(savedSettings.shop_name);
          showMessage("تم حفظ بيانات المتجر بنجاح.", true);
        } catch(err) { 
          showMessage("تعذر حفظ بيانات المتجر: " + err.message);
        }
      });

      // 4. Bind Change Password Event (NO CURRENT PASSWORD REQUIRED)
      document.getElementById("pass-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        
        var newPass = document.getElementById("new-pass").value;
        var confPass = document.getElementById("conf-pass").value;

        // Client-side validation
        if (newPass !== confPass) {
          alert("كلمتا المرور غير متطابقتين.");
          return;
        }
        if (newPass.length < 6) {
          alert("يجب ألا تقل كلمة المرور عن 6 أحرف.");
          return;
        }

        try {
          await apiCall("/api/admin/password", {
            method: "PUT",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ 
              current_password: "", // Empty as requested
              new_password: newPass 
            })
          });
          
          showMessage("تم تحديث كلمة المرور. يرجى تسجيل الخروج ثم الدخول مرة أخرى.", true);
          this.reset(); // Clear form fields
          
          // Auto logout after 2 seconds
          setTimeout(() => { window.location.href = "/admin/logout"; }, 2000);

        } catch(err) { 
          showMessage("تعذر تحديث كلمة المرور: " + err.message);
        }
      });

    } catch(error) { 
      section.innerHTML = `<p class="empty-table">تعذر تحميل الإعدادات: ${escapeHtml(error.message)}</p>`;
    }
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================
  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  
  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
    document.getElementById("nav-shade")?.classList.toggle("open");
  });
  
  document.getElementById("today-date").textContent = "التاريخ: " + formatLocalDate(new Date());
  switchView(currentView);

})();