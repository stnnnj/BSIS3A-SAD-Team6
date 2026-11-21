/* CCMC RetailFlow — INVENTORY MODULE
   All stock-table behavior, filters, animation triggers and manual stock
   adjustments live here, not in a shared owner-modules.js file. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { products: [], transactions: [] };
  const number = (value) => Number(value || 0).toLocaleString("en-PH");
  const escapeHTML = (value) =>
    String(value ?? "—").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const shortDate = (value) => {
    if (!value) return "—";
    return escapeHTML(String(value).replace("T", " ").slice(0, 16));
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Unexpected server response.");
    }
    if (response.status === 401) {
      window.location.replace("/frontend/index.html");
      throw new Error("Your session expired. Please sign in again.");
    }
    if (response.status === 403) {
      window.location.replace("/frontend/staff-dashboard.html");
      throw new Error("Owner permission is required.");
    }
    if (!response.ok || !payload.success)
      throw new Error(payload.message || "Unable to complete request.");
    return payload;
  }

  function notify(message, success = false) {
    $("notice").innerHTML =
      `<div class="alert ${success ? "alert-success" : "alert-danger"} mb-0" role="alert">${escapeHTML(message)}</div>`;
  }

  function stockBadge(status) {
    const css =
      status === "Out of Stock" ? "out" : status === "Low Stock" ? "low" : "ok";
    return `<span class="rf-pill ${css}">${escapeHTML(status)}</span>`;
  }

  function renderProducts() {
    const term = $("searchInput").value.trim().toLowerCase();
    const category = $("categoryFilter").value;
    const status = $("statusFilter").value;
    const filtered = state.products.filter((p) => {
      const searchable = [
        p.item_code,
        p.barcode,
        p.product_name,
        p.brand,
        p.category_name,
      ]
        .join(" ")
        .toLowerCase();
      return (
        searchable.includes(term) &&
        (!category || String(p.category_name || "") === category) &&
        (!status || p.stock_status === status)
      );
    });
    $("resultCount").textContent =
      `${filtered.length.toLocaleString("en-PH")} of ${state.products.length.toLocaleString("en-PH")} products`;
    const body = $("inventoryTable");
    if (!filtered.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="rf-empty">No matching products found.</td></tr>';
      return;
    }
    body.innerHTML = filtered
      .map(
        (p) => `
      <tr class="${p.stock_status === "Out of Stock" ? "rf-out-of-stock" : ""}">
        <td><span class="rf-mono">${escapeHTML(p.item_code)}</span></td>
        <td><div class="rf-item-name">${escapeHTML(p.product_name)}</div>
            <div class="rf-item-sub">${escapeHTML([p.brand, p.size, p.color].filter(Boolean).join(" · ") || "—")}</div></td>
        <td>${escapeHTML(p.category_name)}</td>
        <td class="rf-num">${number(p.current_qty)}</td>
        <td>${number(p.min_stock_level)}</td>
        <td>${stockBadge(p.stock_status)}</td>
        <td><button class="btn btn-sm btn-outline-secondary rf-adjust-row" type="button" data-id="${Number(p.product_id)}">Adjust</button></td>
      </tr>`,
      )
      .join("");
  }

  function fillProductOptions() {
    const previous = $("productSelect").value;
    $("productSelect").innerHTML =
      '<option value="">Select a product</option>' +
      state.products
        .map(
          (p) =>
            `<option value="${Number(p.product_id)}">${escapeHTML(p.item_code)} · ${escapeHTML(p.product_name)} (${number(p.current_qty)} on hand)</option>`,
        )
        .join("");
    if (
      previous &&
      state.products.some((p) => String(p.product_id) === previous)
    )
      $("productSelect").value = previous;
  }

  async function loadInventory() {
    $("inventoryTable").innerHTML =
      '<tr><td colspan="7" class="rf-empty">Loading inventory…</td></tr>';
    try {
      const data = await api("/api/owner/inventory/overview");
      state.products = data.products || [];
      $("statProducts").textContent = number(data.stats.products);
      $("statUnits").textContent = number(data.stats.units);
      $("statLow").textContent = number(data.stats.low_stock);
      $("statOut").textContent = number(data.stats.out_of_stock);
      const selectedCategory = $("categoryFilter").value;
      const categories = [
        ...new Set(state.products.map((p) => p.category_name).filter(Boolean)),
      ].sort();
      $("categoryFilter").innerHTML =
        '<option value="">All categories</option>' +
        categories
          .map(
            (c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`,
          )
          .join("");
      if (categories.includes(selectedCategory))
        $("categoryFilter").value = selectedCategory;
      fillProductOptions();
      renderProducts();
    } catch (error) {
      $("inventoryTable").innerHTML =
        '<tr><td colspan="7" class="rf-empty">Could not load inventory.</td></tr>';
      notify(error.message);
    }
  }

  async function loadHistory() {
    $("historyTable").innerHTML =
      '<tr><td colspan="6" class="rf-empty">Loading history…</td></tr>';
    try {
      const data = await api("/api/owner/inventory/transactions?limit=50");
      state.transactions = data.rows || [];
      $("historyTable").innerHTML = state.transactions.length
        ? state.transactions
            .map((t) => {
              const incoming =
                /in|return/i.test(String(t.txn_type)) &&
                !/out/i.test(String(t.txn_type));
              const badge = incoming
                ? "in"
                : /out|sale/i.test(String(t.txn_type))
                  ? "outgoing"
                  : "neutral";
              return `<tr><td>${shortDate(t.txn_date)}</td>
          <td><div class="rf-item-name">${escapeHTML(t.product_name)}</div><div class="rf-item-sub">${escapeHTML(t.item_code)}</div></td>
          <td><span class="rf-pill ${badge}">${escapeHTML(t.txn_type)}</span></td>
          <td class="rf-num">${number(t.quantity)}</td><td>${escapeHTML(t.performed_by)}</td>
          <td>${escapeHTML(t.remarks)}</td></tr>`;
            })
            .join("")
        : '<tr><td colspan="6" class="rf-empty">No movements recorded yet.</td></tr>';
    } catch (error) {
      $("historyTable").innerHTML =
        '<tr><td colspan="6" class="rf-empty">Could not load movement history.</td></tr>';
      notify(error.message);
    }
  }

  function openAdjustment(productId = "") {
    if (!state.products.length)
      return notify("There are no products available to adjust.");
    $("adjustmentForm").reset();
    $("productSelect").value = String(productId || "");
    bootstrap.Modal.getOrCreateInstance($("adjustmentModal")).show();
  }

  async function saveAdjustment(event) {
    event.preventDefault();
    const button = $("saveAdjustmentBtn");
    const payload = {
      product_id: Number($("productSelect").value),
      direction: $("directionSelect").value,
      quantity: Number($("quantityInput").value),
      remarks: $("remarksInput").value.trim(),
    };
    if (
      !Number.isInteger(payload.quantity) ||
      payload.quantity <= 0 ||
      !payload.product_id
    ) {
      return notify(
        "Select a product and enter a positive whole-number quantity.",
      );
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const result = await api("/api/owner/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      bootstrap.Modal.getOrCreateInstance($("adjustmentModal")).hide();
      await Promise.all([loadInventory(), loadHistory()]);
      notify(
        `Stock updated successfully. New quantity: ${number(result.current_qty)}.`,
        true,
      );
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Save Adjustment";
    }
  }

  async function logout() {
    const button = $("logoutBtn");
    button.disabled = true;
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.replace("/frontend/index.html");
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("searchInput").addEventListener("input", renderProducts);
    $("categoryFilter").addEventListener("change", renderProducts);
    $("statusFilter").addEventListener("change", renderProducts);
    $("inventoryTable").addEventListener("click", (event) => {
      const btn = event.target.closest(".rf-adjust-row");
      if (btn) openAdjustment(btn.dataset.id);
    });
    $("adjustmentForm").addEventListener("submit", saveAdjustment);
    $("openAdjustmentBtn").addEventListener("click", () => openAdjustment());
    $("refreshBtn").addEventListener("click", () =>
      Promise.all([loadInventory(), loadHistory()]),
    );
    $("reloadHistoryBtn").addEventListener("click", loadHistory);
    $("logoutBtn").addEventListener("click", logout);
    try {
      const me = await api("/api/auth/me");
      if (me.user?.role !== "Owner") {
        window.location.replace("/frontend/staff-dashboard.html");
        return;
      }
      await Promise.all([loadInventory(), loadHistory()]);
    } catch (error) {
      notify(error.message);
    }
  });
})();
