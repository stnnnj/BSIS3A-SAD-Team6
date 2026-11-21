/* ================================================================
   CCMC RetailFlow — OWNER REPORTS
   Bootstrap 5 user interface + live Flask report endpoints.
   Kept separate from the other modules, by design.
   ================================================================ */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const formatter = new Intl.NumberFormat("en-PH");
  const moneyFormatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
  const escapeHTML = (value) =>
    String(value ?? "—").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  const REPORTS = Object.freeze({
    sales: {
      title: "Sales Transactions",
      columns: [
        ["date", "Date / Time", "datetime"],
        ["receipt_no", "Receipt No."],
        ["customer_name", "Customer"],
        ["payment_method", "Payment"],
        ["status", "Status", "status"],
        ["total_amount", "Amount", "money"],
      ],
    },
    reservations: {
      title: "Reservations",
      columns: [
        ["date", "Date / Time", "datetime"],
        ["order_id", "Order ID"],
        ["customer_name", "Customer"],
        ["expiry_date", "Expiry", "date"],
        ["down_payment", "Down Payment", "money"],
        ["payment_method", "Payment"],
        ["status", "Status", "status"],
      ],
    },
    returns: {
      title: "Returns & Refunds",
      columns: [
        ["date", "Date", "date"],
        ["original_receipt_no", "Receipt No."],
        ["product_name", "Product"],
        ["quantity", "Quantity", "number"],
        ["refund_amount", "Refund Amount", "money"],
        ["reason", "Reason"],
      ],
    },
    inventory: {
      title: "Inventory Movements",
      columns: [
        ["date", "Date / Time", "datetime"],
        ["item_code", "Item Code"],
        ["product_name", "Product"],
        ["txn_type", "Movement", "status"],
        ["quantity", "Quantity", "number"],
        ["performed_by", "Recorded By"],
        ["remarks", "Remarks"],
      ],
    },
    "low-stock": {
      title: "Low Stock Items",
      columns: [
        ["item_code", "Item Code"],
        ["product_name", "Product"],
        ["category_name", "Category"],
        ["current_qty", "On Hand", "number"],
        ["min_stock_level", "Minimum", "number"],
        ["status", "Status", "status"],
      ],
    },
  });

  const state = { rows: [], type: "sales", truncated: false, loading: false };

  function localISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formattedDate(value, includeTime = true) {
    if (!value) return "—";
    const text = String(value).replace("T", " ");
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return escapeHTML(text.slice(0, includeTime ? 16 : 10));
    }
    return escapeHTML(text);
  }

  function statusHTML(value) {
    const status = String(value ?? "Unknown");
    const lower = status.toLowerCase();
    let tone = "neutral";
    if (
      /^(completed|in stock|fulfilled|active)$/.test(lower) ||
      /manual in|stock in|return/.test(lower)
    )
      tone = "ok";
    if (/pending|reserved|low stock|unfinished/.test(lower)) tone = "low";
    if (/void|cancel|out of stock|manual out|stock out|sale/.test(lower))
      tone = "out";
    return `<span class="rf-pill ${tone}">${escapeHTML(status)}</span>`;
  }

  function cellHTML(value, kind) {
    if (kind === "money")
      return `<span class="rf-num">${escapeHTML(moneyFormatter.format(Number(value || 0)))}</span>`;
    if (kind === "number")
      return `<span class="rf-num">${formatter.format(Number(value || 0))}</span>`;
    if (kind === "datetime") return formattedDate(value, true);
    if (kind === "date") return formattedDate(value, false);
    if (kind === "status") return statusHTML(value);
    return escapeHTML(value);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...options,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The server returned an unexpected response.");
    }
    if (response.status === 401) {
      window.location.replace("/frontend/index.html");
      throw new Error("Your login session has expired.");
    }
    if (response.status === 403) {
      window.location.replace("/frontend/staff-dashboard.html");
      throw new Error("This page is for Owner accounts only.");
    }
    if (!response.ok || !payload.success)
      throw new Error(payload.message || "Request failed.");
    return payload;
  }

  function notify(message, success = false) {
    $("notice").innerHTML =
      `<div class="alert ${success ? "alert-success" : "alert-danger"} mb-0" role="alert">${escapeHTML(message)}</div>`;
  }

  function clearNotice() {
    $("notice").replaceChildren();
  }

  function readFilters() {
    const from = $("startDate").value;
    const to = $("endDate").value;
    if (!from || !to || from > to)
      throw new Error("Choose a valid From and To date.");
    // Normalize date-only input to UTC for comparison, without changing its displayed value.
    const dayCount = Math.round(
      (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
        86400000,
    );
    if (!Number.isFinite(dayCount) || dayCount > 366)
      throw new Error("The date range cannot exceed 367 calendar days.");
    return { from, to, type: $("reportType").value };
  }

  function setBusy(busy) {
    state.loading = busy;
    $("generateBtn").disabled = busy;
    $("refreshBtn").disabled = busy;
    $("exportBtn").disabled =
      busy || state.truncated || state.rows.length === 0;
    $("generateBtn").textContent = busy ? "Loading…" : "Generate";
  }

  function renderSummary(stats) {
    $("statSales").textContent = formatter.format(
      Number(stats.completed_sales || 0),
    );
    $("statGross").textContent = moneyFormatter.format(
      Number(stats.gross_sales || 0),
    );
    $("statRefunds").textContent = moneyFormatter.format(
      Number(stats.recorded_refunds || 0),
    );
    $("statMovements").textContent = formatter.format(
      Number(stats.inventory_movements || 0),
    );
  }

  function renderTrend(trend) {
    const chart = $("salesTrend");
    if (!Array.isArray(trend) || trend.length === 0) {
      chart.innerHTML =
        '<p class="rf-chart-empty">No completed sales recorded in this date range.</p>';
      return;
    }
    const maximum = Math.max(
      1,
      ...trend.map((item) => Number(item.total_sales || 0)),
    );
    chart.innerHTML = trend
      .map((item, index) => {
        const amount = Number(item.total_sales || 0);
        const height = Math.max(5, (amount / maximum) * 100);
        const date = String(item.day || "").slice(5, 10);
        const label = `${String(item.day)}: ${moneyFormatter.format(amount)}, ${Number(item.sales_count || 0)} sale(s)`;
        return `<div class="rf-bar-slot" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">
        <span class="rf-bar-amount">${escapeHTML(moneyFormatter.format(amount))}</span>
        <div class="rf-bar" style="height:${height.toFixed(2)}px; animation-delay:${index * 38}ms"></div>
        <span class="rf-bar-date">${escapeHTML(date)}</span>
      </div>`;
      })
      .join("");
  }

  function filteredRows() {
    const phrase = $("searchInput").value.toLowerCase().trim();
    if (!phrase) return state.rows;
    return state.rows.filter((record) =>
      Object.values(record).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(phrase),
      ),
    );
  }

  function renderTable() {
    const config = REPORTS[state.type];
    const rows = filteredRows();
    $("reportHeading").textContent = config.title;
    $("resultCount").textContent =
      `${formatter.format(rows.length)} of ${formatter.format(state.rows.length)} records`;
    $("reportHead").innerHTML =
      `<tr>${config.columns.map(([, title]) => `<th scope="col">${escapeHTML(title)}</th>`).join("")}</tr>`;
    $("reportBody").innerHTML = rows.length
      ? rows
          .map(
            (record) =>
              `<tr>${config.columns.map(([key, , kind]) => `<td>${cellHTML(record[key], kind)}</td>`).join("")}</tr>`,
          )
          .join("")
      : `<tr><td class="rf-empty" colspan="${config.columns.length}">No records match the current filters.</td></tr>`;
    $("exportBtn").disabled =
      state.loading || state.truncated || rows.length === 0;
  }

  function setTypeUI() {
    const isCurrentStock = $("reportType").value === "low-stock";
    for (const id of ["startDate", "endDate"]) $(id).disabled = isCurrentStock;
    $("filterNote").textContent = isCurrentStock
      ? "Low Stock Items shows CURRENT stock levels; the date range still applies to the summary cards and sales activity."
      : "Dates include both the first and last day. Search filters the displayed report and CSV export.";
  }

  async function generate() {
    clearNotice();
    let selection;
    try {
      selection = readFilters();
    } catch (error) {
      notify(error.message);
      return;
    }
    state.type = selection.type;
    state.rows = [];
    state.truncated = false;
    setBusy(true);
    $("reportBody").innerHTML =
      '<tr><td class="rf-empty">Loading report…</td></tr>';
    $("salesTrend").textContent = "Loading activity…";
    const query = new URLSearchParams({
      from: selection.from,
      to: selection.to,
    });
    try {
      const [summary, report] = await Promise.all([
        api(`/api/owner/reports/summary?${query}`),
        api(`/api/owner/reports/data?${new URLSearchParams({ ...selection })}`),
      ]);
      state.rows = report.rows || [];
      state.truncated = Boolean(report.truncated);
      renderSummary(summary.stats || {});
      renderTrend(summary.trend || []);
      $("truncationNotice").hidden = !state.truncated;
      renderTable();
      if (state.truncated)
        notify(
          "This report exceeds 5,000 records. Narrow the date range before exporting the complete report.",
        );
    } catch (error) {
      state.rows = [];
      $("reportBody").innerHTML =
        '<tr><td class="rf-empty">Unable to load the requested report.</td></tr>';
      $("salesTrend").innerHTML =
        '<p class="rf-chart-empty">Activity data is unavailable.</p>';
      $("truncationNotice").hidden = true;
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  function csvSafe(value) {
    // Neutralize spreadsheet formulas, then quote/escape all cells.
    let text = String(value ?? "");
    if (
      /^[\s\u0000-\u001f]*[=+@\-]/.test(text) &&
      !/^-?\d+(?:\.\d+)?$/.test(text.trim())
    ) {
      text = "'" + text;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    if (state.loading || state.truncated)
      return notify("Please load a complete report before exporting.");
    const rows = filteredRows();
    if (!rows.length) return notify("There are no records to export.");
    const columns = REPORTS[state.type].columns;
    const csv = [
      columns.map(([, title]) => csvSafe(title)).join(","),
      ...rows.map((record) =>
        columns.map(([key]) => csvSafe(record[key])).join(","),
      ),
    ].join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `CCMC_${state.type}_${$("startDate").value}_to_${$("endDate").value}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    notify(`Exported ${formatter.format(rows.length)} row(s) to CSV.`, true);
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
    const today = new Date();
    const thirtyDaysAgo = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 29,
    );
    $("startDate").value = localISODate(thirtyDaysAgo);
    $("endDate").value = localISODate(today);
    $("reportForm").addEventListener("submit", (event) => {
      event.preventDefault();
      generate();
    });
    $("reportType").addEventListener("change", setTypeUI);
    $("searchInput").addEventListener("input", renderTable);
    $("refreshBtn").addEventListener("click", generate);
    $("exportBtn").addEventListener("click", exportCSV);
    $("logoutBtn").addEventListener("click", logout);
    setTypeUI();
    setBusy(true);
    try {
      const me = await api("/api/auth/me");
      if (me.user?.role !== "Owner") {
        window.location.replace("/frontend/staff-dashboard.html");
        return;
      }
      await generate();
    } catch (error) {
      setBusy(false);
      notify(error.message);
    }
  });
})();
