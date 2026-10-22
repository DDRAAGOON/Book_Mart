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

  if (!window.allMaterialsCache) window.allMaterialsCache = [];
  
  // Format number with commas and 2 decimal places: 10000 -> 10,000.00
  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "0.00";
    var num = Number(value);
    if (isNaN(num)) return "0.00";
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  async function apiCall(url, options) {
    try {
      var response = await fetch(url, options || {});
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed.");
      return data;
    } catch (err) {
      console.error(err);
      throw err;
    }
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
      input.placeholder = "Type material name...";
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
          row.textContent = material.name + " — " + material.unit + " — " +
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
            updateHint("Not registered — add it in the Materials tab first.", "invalid");
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
    var titles = {dashboard: "Dashboard", books: "Books", drinks: "Drinks", materials: "Materials", reports: "Reports", settings: "Settings"};
    document.getElementById("page-title").textContent = titles[view] || "Admin";
    
    // Close mobile sidebar
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("nav-shade")?.classList.remove("open");
    
    showMessage("");
    
    // Load Content
    if (view === "dashboard") loadDashboard();
    else if (view === "books") loadBooksView();
    else if (view === "drinks") loadDrinksView();
    else if (view === "materials") loadMaterialsView();
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
        target.innerHTML = '<p class="empty-table">No low-stock items.</p>';
      } else {
        target.innerHTML = '<table><thead><tr><th>Item</th><th>Stock</th><th>Unit</th></tr></thead><tbody>' +
          data.low_stock.map(item => 
            `<tr><td>${escapeHtml(item.name)}</td><td>${item.stock}</td><td>${escapeHtml(item.unit)}</td></tr>`
          ).join("") + "</tbody></table>";
      }
    } catch (error) { showMessage(error.message); }
  }

  // ==========================================
  // BOOKS VIEW (With Functional Edit Button)
  // ==========================================
  async function loadBooksView() {
    var section = document.getElementById("view-books");
    try {
      var rows = await apiCall("/api/admin/books");
      
      var tableHtml = rows.length ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Title</th><th>Author</th><th>Type</th><th>Cost</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(row => 
          `<tr>
            <td>${row.id}</td>
            <td>${escapeHtml(row.title)}</td>
            <td>${escapeHtml(row.author)}</td>
            <td><span style="padding:2px 6px; border-radius:4px; font-size:11px; background:${row.type === 'Original' ? '#dbeafe' : '#fef3c7'}; color:${row.type === 'Original' ? '#1d4ed8' : '#b45309'}">${escapeHtml(row.type)}</span></td>
            <td>${formatMoney(row.cost_price)}</td>
            <td>${formatMoney(row.sell_price)}</td>
            <td>${row.stock_quantity}</td>
            <td class="actions">
              <button class="button button-secondary small-btn" onclick="editBook(${row.id})">Edit</button>
              <button class="button button-danger small-btn" onclick="deleteRecord('books', ${row.id}, loadBooksView)">Del</button>
            </td>
          </tr>`
        ).join("") + '</tbody></table></div>' : '<p class="empty-table">No books added yet.</p>';

      // Form Markup for Adding/Editing Book
      var formHtml = `
        <form id="book-form" class="admin-form" style="display:none;">
          <input type="hidden" id="bk-edit-id"> <!-- Hidden field to store ID during edit -->
          
          <div class="field"><label>Title *</label><input type="text" id="bk-title" required></div>
          <div class="field"><label>Author</label><input type="text" id="bk-author"></div>
          <div class="field">
            <label>Type *</label>
            <select id="bk-type">
              <option value="Original">Original</option>
              <option value="High Copy">High Copy</option>
            </select>
          </div>
          <div class="field"><label>Cost Price *</label><input type="number" step="0.01" min="0" id="bk-cost" required></div>
          <div class="field"><label>Sell Price *</label><input type="number" step="0.01" min="0" id="bk-price" required></div>
          <div class="field"><label>Stock Qty *</label><input type="number" min="0" id="bk-stock" required></div>
          <div class="field"><label>Low Stock Alert</label><input type="number" min="0" id="bk-reorder" value="3"></div>
          <div class="form-actions">
            <button type="submit" class="button button-primary" id="bk-submit-btn">Save Book</button>
            <button type="button" class="button button-secondary" onclick="document.getElementById('book-form').style.display='none'; resetBookForm();">Cancel</button>
          </div>
        </form>
      `;

      section.innerHTML = `
        <article class="panel">
          <div class="panel-heading">
            <h2>Books Inventory</h2>
            <button class="button button-primary" onclick="toggleForm('book-form'); resetBookForm();">+ Add New Book</button>
          </div>
          ${formHtml}
          ${tableHtml}
        </article>
      `;

      // Bind Submit Event (Handles both Add and Edit)
      document.getElementById("book-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        
        var editId = document.getElementById("bk-edit-id").value;
        var payload = {
          title: document.getElementById("bk-title").value,
          author: document.getElementById("bk-author").value,
          type: document.getElementById("bk-type").value,
          cost_price: parseFloat(document.getElementById("bk-cost").value),
          sell_price: parseFloat(document.getElementById("bk-price").value),
          stock_quantity: parseInt(document.getElementById("bk-stock").value),
          reorder_level: parseInt(document.getElementById("bk-reorder").value)
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
          
          showMessage(editId ? "Book updated!" : "Book saved!", true);
          
          // Reset and hide form
          this.style.display = 'none';
          resetBookForm();
          
          loadBooksView(); // Refresh table
          
        } catch(err) { 
            showMessage(err.message); 
        }
      });

    } catch (error) { section.innerHTML = `<p>Error: ${error.message}</p>`; }
  }

  // Helper to clear form fields when switching between Add/Edit modes
  window.resetBookForm = function() {
      var form = document.getElementById("book-form");
      if(form) {
          form.reset();
          document.getElementById("bk-edit-id").value = "";
          document.getElementById("bk-submit-btn").textContent = "Save Book";
      }
  };

  // Global helper for editing book (NOW FUNCTIONAL)
  window.editBook = async function(id) {
     try {
        // 1. Fetch the specific book data from backend list
        var rows = await apiCall("/api/admin/books");
        var bookToEdit = rows.find(b => b.id === id);

        if (!bookToEdit) {
            alert("Book not found.");
            return;
        }

        // 2. Populate the Form Fields with existing data
        document.getElementById("bk-edit-id").value = bookToEdit.id;
        document.getElementById("bk-title").value = bookToEdit.title || "";
        document.getElementById("bk-author").value = bookToEdit.author || "";
        document.getElementById("bk-type").value = bookToEdit.type || "Original";
        document.getElementById("bk-cost").value = bookToEdit.cost_price || 0;
        document.getElementById("bk-price").value = bookToEdit.sell_price || 0;
        document.getElementById("bk-stock").value = bookToEdit.stock_quantity || 0;
        document.getElementById("bk-reorder").value = bookToEdit.reorder_level || 3;

        // 3. Show the form and change button text
        var form = document.getElementById("book-form");
        form.style.display = "grid"; 
        
        var submitBtn = document.getElementById("bk-submit-btn");
        if(submitBtn) submitBtn.textContent = "Update Book";

        // Scroll to top of panel smoothly
        document.querySelector("#view-books .panel-heading").scrollIntoView({ behavior: 'smooth' });

     } catch (error) {
         console.error(error);
         alert("Error loading book details: " + error.message);
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
    quantityInput.placeholder = "Qty";
    quantityInput.setAttribute("aria-label", "Ingredient quantity");
    removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "recipe-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "Remove ingredient");
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
          setRecipeRowError(rowState, "Not registered — add it in the Materials tab first.");
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
          setRecipeRowError(rowState, "Not registered — add it in the Materials tab first.");
        } else {
          setRecipeRowError(rowState, "Choose a registered material.");
        }
      } else if (!isFinite(quantity) || quantity <= 0) {
        valid = false;
        setRecipeRowError(rowState, "Enter a quantity greater than zero.");
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
      showMessage("Fix the highlighted recipe rows before saving.");
      return;
    }
    if (!isFinite(price) || price < 0) {
      showMessage("Enter a valid drink price.");
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
      showMessage(editId ? "Drink updated!" : "Drink saved!", true);
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
    document.getElementById("dk-submit-btn").textContent = "Save Drink";
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
      showMessage("Drink not found. Refresh the Drinks view and try again.");
      return;
    }
    clearRecipeRows();
    document.getElementById("dk-edit-id").value = drink.id;
    document.getElementById("dk-name").value = drink.name || "";
    document.getElementById("dk-price").value = drink.sell_price;
    document.getElementById("dk-category").value = drink.category || "hot";
    document.getElementById("dk-submit-btn").textContent = "Update Drink";
    form.style.display = "grid";
    try {
      recipe = JSON.parse(drink.recipe_json || "[]");
      if (!Array.isArray(recipe)) throw new Error("Recipe must be an array.");
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

  async function loadDrinksView() {
    var section = document.getElementById("view-drinks");
    disposeMaterialPickers();
    recipeRowStates = [];
    try {
      var rows = await apiCall("/api/admin/drinks");
      window.allMaterialsCache = await apiCall("/api/admin/materials");
      drinkRowsCache = rows;
      var tableHtml = rows.length ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Price</th><th>Ingredients count</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(function (row) {
          var count = 0;
          try {
            var parsed = JSON.parse(row.recipe_json || "[]");
            count = Array.isArray(parsed) ? parsed.length : 0;
          } catch (error) {
            count = 0;
          }
          return '<tr><td>' + row.id + '</td><td>' + escapeHtml(row.name) +
            '</td><td>' + escapeHtml(row.category || "hot") + '</td><td>' + formatMoney(row.sell_price) +
            '</td><td>' + count + ' items</td><td class="actions">' +
            '<button class="button button-secondary small-btn" onclick="editDrink(' + row.id + ')">Edit</button> ' +
            '<button class="button button-danger small-btn" onclick="deleteRecord(\'drinks\', ' + row.id + ', loadDrinksView)">Del</button></td></tr>';
        }).join("") + "</tbody></table></div>" : '<p class="empty-table">No drinks defined yet.</p>';

      section.innerHTML =
        '<article class="panel"><div class="panel-heading"><h2>Drinks Menu</h2>' +
        '<button type="button" class="button button-primary" onclick="openNewDrinkForm()">+ Add New Drink</button></div>' +
        '<form id="drink-form" class="admin-form recipe-builder" style="display:none;">' +
        '<input type="hidden" id="dk-edit-id">' +
        '<div class="field field-wide"><label for="dk-name">Drink Name *</label><input type="text" id="dk-name" required placeholder="e.g. Latte"></div>' +
        '<div class="field"><label for="dk-category">Drink Type / Temperature *</label><select id="dk-category" required>' +
        '<option value="hot">Hot Drink</option><option value="cold">Cold Drink</option></select></div>' +
        '<div class="field"><label for="dk-price">Sell Price (EGP) *</label><input type="number" step="0.01" min="0" id="dk-price" required></div>' +
        '<div class="field field-wide"><label>Recipe Ingredients</label><div id="recipe-rows" class="recipe-rows"></div>' +
        '<button type="button" id="add-ingredient" class="button button-secondary recipe-add">+ Add Ingredient</button></div>' +
        '<div class="form-actions"><button type="submit" class="button button-primary" id="dk-submit-btn">Save Drink</button>' +
        '<button type="button" class="button button-secondary" id="dk-cancel">Cancel</button></div></form>' +
        tableHtml + '</article>';

      document.getElementById("drink-form").addEventListener("submit", saveDrinkHandler);
      document.getElementById("add-ingredient").addEventListener("click", function () { addRecipeRow(); });
      document.getElementById("dk-cancel").addEventListener("click", closeDrinkForm);
    } catch (error) {
      section.innerHTML = '<p>Error: ' + escapeHtml(error.message) + '</p>';
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
    document.getElementById("mt-unit").value = material.unit || "";
    document.getElementById("mt-cost").value = material.cost_per_unit;
    document.getElementById("mt-stock").value = material.current_stock;
    document.getElementById("mt-reorder").value = material.reorder_level;
    setMaterialSubmitLabel("Update Material");
    var hint = document.getElementById("mt-name-hint");
    hint.textContent = "Editing existing material — saving will update it, not create a duplicate.";
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
      setMaterialSubmitLabel("Save Material");
    }
    var match = similarMaterial(value);
    if (match) {
      hint.textContent = "Similar material exists: " + match.name + ". Are you sure this is new?";
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
    setMaterialSubmitLabel("Save Material");
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
    showMessage("Material not found. Refresh the Materials view and try again.");
  };

  async function loadMaterialsView() {
    var section = document.getElementById("view-materials");
    disposeMaterialPickers();
    try {
      var rows = await apiCall("/api/admin/materials");
      window.allMaterialsCache = rows;
      var tableHtml = rows.length ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Unit</th><th>Cost/Unit</th><th>Stock</th><th>Alert Below</th><th>Actions</th></tr></thead><tbody>' +
        rows.map(function (row) {
          return '<tr><td>' + row.id + '</td><td>' + escapeHtml(row.name) + '</td><td>' +
            escapeHtml(row.unit) + '</td><td>' + formatMoney(row.cost_per_unit) +
            '</td><td>' + row.current_stock + '</td><td>' + row.reorder_level +
            '</td><td class="actions"><button class="button button-secondary small-btn" onclick="editMaterial(' + row.id + ')">Edit</button> ' +
            '<button class="button button-danger small-btn" onclick="deleteRecord(\'materials\', ' + row.id + ', loadMaterialsView)">Del</button></td></tr>';
        }).join("") + "</tbody></table></div>" : '<p class="empty-table">No materials added yet.</p>';

      section.innerHTML =
        '<article class="panel"><div class="panel-heading"><h2>Raw Materials</h2>' +
        '<button type="button" class="button button-primary" onclick="openNewMaterialForm()">+ Add New Material</button></div>' +
        '<form id="mat-form" class="admin-form" style="display:none;">' +
        '<input type="hidden" id="mt-edit-id">' +
        '<div class="field"><label for="mt-name">Material Name *</label><div id="mt-name-picker"></div>' +
        '<small id="mt-name-hint" class="material-name-hint"></small></div>' +
        '<div class="field"><label for="mt-unit">Unit (kg, L, pcs) *</label><input type="text" id="mt-unit" required placeholder="e.g. kg"></div>' +
        '<div class="field"><label for="mt-cost">Cost Per Unit *</label><input type="number" step="0.01" min="0" id="mt-cost" required></div>' +
        '<div class="field"><label for="mt-stock">Current Stock *</label><input type="number" step="0.01" min="0" id="mt-stock" required></div>' +
        '<div class="field"><label for="mt-reorder">Low Stock Alert Level</label><input type="number" step="0.01" min="0" id="mt-reorder" value="5"></div>' +
        '<div class="form-actions"><button type="submit" class="button button-primary" id="mt-submit-btn">Save Material</button>' +
        '<button type="button" class="button button-secondary" id="mt-cancel">Cancel</button></div></form>' +
        tableHtml + '</article>';

      document.getElementById("mat-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        var editId = document.getElementById("mt-edit-id").value;
        var nameInput = document.getElementById("mt-name");
        var exactName = (window.allMaterialsCache || []).filter(function (item) {
          return item.name.toLowerCase() === nameInput.value.replace(/^\s+|\s+$/g, "").toLowerCase();
        })[0];
        if (!editId && exactName) {
          showMessage("That material already exists. Select it from the suggestions to update it.");
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
          showMessage(editId ? "Material updated!" : "Material saved!", true);
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
    } catch (error) {
      section.innerHTML = '<p>Error: ' + escapeHtml(error.message) + '</p>';
    }
  }
  window.loadMaterialsView = loadMaterialsView;

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
    if(!confirm("Are you sure you want to delete this record?")) return;
    try {
      await apiCall(`/api/admin/${resource}/${id}`, { method: "DELETE" });
      showMessage("Deleted successfully.", true);
      if(refreshCallback) refreshCallback();
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
        <div class="panel-heading"><h2>Monthly Report</h2></div>
        <div class="admin-form">
          <div class="field"><label>Select Month</label><input type="month" id="rep-month" value="${new Date().toISOString().slice(0,7)}"></div>
          <div class="field form-actions"><button class="button button-primary" onclick="loadReportData()">Generate</button></div>
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
          <div class="metric-card"><span>Revenue</span><strong>${formatMoney(res.revenue)}</strong></div>
          <div class="metric-card"><span>COGS</span><strong>${formatMoney(res.cogs)}</strong></div>
          <div class="metric-card"><span>Expenses</span><strong>${formatMoney(res.expenses)}</strong></div>
          <div class="metric-card"><span>Profit</span><strong style="color:${res.profit >= 0 ? '#059669' : '#dc2626'}">${formatMoney(res.profit)}</strong></div>
        </div>
        <p class="muted mt-2">${res.orders} orders processed.</p>
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
          <div class="panel-heading"><h2>Shop Details</h2></div>
          <form id="set-form" class="admin-form">
            <div class="field field-wide">
              <label for="st-name">Shop Name</label>
              <input type="text" id="st-name" value="${escapeHtml(data.shop_name)}" required>
            </div>
            <div class="field field-wide">
              <label for="st-addr">Address / Phone Number</label>
              <textarea id="st-addr" placeholder="e.g., 123 Main St, Cairo | Tel: 010...">${escapeHtml(data.shop_address)}</textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-primary">Save Shop Info</button>
            </div>
          </form>
        </article>

        <article class="panel">
          <div class="panel-heading"><h2>Security</h2></div>
          <p class="muted small" style="margin-bottom:15px;">Change your admin login password here.</p>
          <form id="pass-form" class="admin-form">
            <div class="field field-wide">
              <label for="new-pass">New Password (Min 6 chars)</label>
              <input type="password" id="new-pass" minlength="6" required autocomplete="off">
            </div>
            <div class="field field-wide">
              <label for="conf-pass">Confirm New Password</label>
              <input type="password" id="conf-pass" minlength="6" required autocomplete="off">
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-danger">Update Password</button>
            </div>
          </form>
        </article>
      `;
      
      // 3. Bind Save Shop Info Event
      document.getElementById("set-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        try {
          await apiCall("/api/admin/settings", {
            method: "PUT",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ 
              shop_name: document.getElementById("st-name").value, 
              shop_address: document.getElementById("st-addr").value 
            })
          });
          showMessage("Shop details saved successfully!", true);
        } catch(err) { 
          showMessage("Error saving shop info: " + err.message); 
        }
      });

      // 4. Bind Change Password Event (NO CURRENT PASSWORD REQUIRED)
      document.getElementById("pass-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        
        var newPass = document.getElementById("new-pass").value;
        var confPass = document.getElementById("conf-pass").value;

        // Client-side validation
        if (newPass !== confPass) {
          alert("Passwords do not match!");
          return;
        }
        if (newPass.length < 6) {
          alert("Password must be at least 6 characters long.");
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
          
          showMessage("Password updated successfully! Please log out and log in again.", true);
          this.reset(); // Clear form fields
          
          // Auto logout after 2 seconds
          setTimeout(() => { window.location.href = "/admin/logout"; }, 2000);

        } catch(err) { 
          showMessage("Failed to update password: " + err.message); 
        }
      });

    } catch(error) { 
      section.innerHTML = `<p class="empty-table">Error loading settings: ${error.message}</p>`; 
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
  
  document.getElementById("today-date").textContent = new Date().toLocaleDateString();
  switchView(currentView);

})();