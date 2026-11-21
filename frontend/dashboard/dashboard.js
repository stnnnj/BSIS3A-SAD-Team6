
/* ==========================================
   CCMC RETAILFLOW – SHARED DASHBOARD
   Staff + Owner Dashboard API Integration
   ========================================== */

"use strict";

// ==========================================
// CONFIGURATION AND ROLE-BASED STARTUP
// ==========================================

const STAFF_DASHBOARD_API = "/api/staff/dashboard";
const OWNER_DASHBOARD_API = "/api/owner/dashboard";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
});

const compactPesoFormatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    notation: "compact",
    maximumFractionDigits: 1
});

document.addEventListener("DOMContentLoaded", () => {
    const role = document.body.dataset.role;

    if (role === "Staff") {
        loadStaffDashboard();
    } else if (role === "Owner") {
        loadOwnerDashboard();
    }
});

// ==========================================
// SHARED API REQUEST HANDLING
// ==========================================

async function fetchDashboardData(url, render, showError) {
    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" }
        });

        if (response.status === 401) {
            window.location.replace("/frontend/index.html");
            return;
        }

        if (response.status === 403) {
            showError("You do not have permission to view this dashboard.");
            return;
        }

        if (!response.ok) {
            throw new Error(`Dashboard API error: ${response.status}`);
        }

        const result = await response.json();

        if (!result.success || !result.data) {
            throw new Error("Invalid dashboard response.");
        }

        render(result.data);

    } catch (error) {
        console.error("CCMC Dashboard:", error);

        showError(
            "Unable to load dashboard data. Please try refreshing the page."
        );
    }
}

// ==========================================
// STAFF DASHBOARD
// ==========================================

function loadStaffDashboard() {
    return fetchDashboardData(
        STAFF_DASHBOARD_API,
        renderStaffDashboard,
        showStaffDashboardError
    );
}

function renderStaffDashboard(data) {
    const summary = data.summary || {};

    setText("completedSales", formatNumber(summary.completed_sales));

    setText(
        "collectedAmount",
        summary.collected_amount == null
            ? "Data unavailable"
            : `${formatCurrency(summary.collected_amount)} collected today`
    );

    setText("openReservations", formatNumber(summary.open_reservations));

    setText(
        "expiringReservations",
        summary.expiring_reservations == null
            ? "Data unavailable"
            : `${formatNumber(summary.expiring_reservations)} expiring soon`
    );

    setText("unfinishedSales", formatNumber(summary.unfinished_sales));
    setText("lowStockProducts", formatNumber(summary.low_stock_products));

    renderStaffRecentSales(data.recent_sales);

    renderAlertList(
        document.getElementById("reservationAlerts"),
        data.reservation_alerts,
        "No expiring reservations."
    );

    renderAlertList(
        document.getElementById("inventoryAlerts"),
        data.inventory_alerts,
        "No low-stock alerts."
    );
}

// ==========================================
// STAFF RECENT SALES
// ==========================================

function renderStaffRecentSales(sales) {
    const tableBody = document.getElementById("recentSalesTable");

    if (!tableBody) return;

    tableBody.replaceChildren();

    if (!Array.isArray(sales) || sales.length === 0) {
        renderEmptyTable(tableBody, "No recent sales to display.", 5);
        return;
    }

    sales.forEach((sale) => {
        const row = document.createElement("tr");

        appendTextCells(row, [
            sale.reference_no ?? `#${sale.sale_id}`,
            formatTime(sale.created_at),
            formatCurrency(sale.total_amount),
            sale.status ?? "Unknown"
        ]);

        const actionCell = document.createElement("td");
        const actionLink = document.createElement("a");

        actionLink.className = "btn btn-outline-secondary btn-sm";
        actionLink.href = "/frontend/sales/sales.html";
        actionLink.textContent = "Open POS";

        actionCell.appendChild(actionLink);
        row.appendChild(actionCell);
        tableBody.appendChild(row);
    });
}

// ==========================================
// STAFF ERROR HANDLING
// ==========================================

function showStaffDashboardError(message) {
    setText("completedSales", "—");
    setText("collectedAmount", "Data unavailable");
    setText("openReservations", "—");
    setText("expiringReservations", "Data unavailable");
    setText("unfinishedSales", "—");
    setText("lowStockProducts", "—");

    setText("reservationAlerts", "Data unavailable.");
    setText("inventoryAlerts", "Data unavailable.");

    const tableBody = document.getElementById("recentSalesTable");

    if (tableBody) {
        tableBody.replaceChildren();
        renderEmptyTable(tableBody, message, 5);
    }
}

// ==========================================
// OWNER DASHBOARD
// ==========================================

function loadOwnerDashboard() {
    return fetchDashboardData(
        OWNER_DASHBOARD_API,
        renderOwnerDashboard,
        showOwnerDashboardError
    );
}

function renderOwnerDashboard(data) {
    const summary = data.summary || {};

    setText(
        "totalSalesToday",
        formatCurrency(summary.total_sales_today)
    );

    setText(
        "netSalesToday",
        formatCurrency(summary.net_sales_today)
    );

    setText(
        "totalStock",
        formatNumber(summary.total_stock)
    );

    setText(
        "ownerLowStock",
        formatNumber(summary.low_stock_products)
    );

    setText(
        "grossProfitToday",
        formatCurrency(summary.gross_profit_today)
    );

    setText(
        "refundsToday",
        formatCurrency(summary.refunds_today)
    );

    renderOwnerRecentSales(data.recent_sales);

    renderAlertList(
        document.getElementById("ownerInventoryAlerts"),
        data.inventory_alerts,
        "No low-stock alerts."
    );

    renderSalesTrendChart(data.sales_trend);
}

// ==========================================
// OWNER RECENT SALES
// ==========================================

function renderOwnerRecentSales(sales) {
    const tableBody = document.getElementById("ownerRecentSales");

    if (!tableBody) return;

    tableBody.replaceChildren();

    if (!Array.isArray(sales) || sales.length === 0) {
        renderEmptyTable(tableBody, "No recent sales to display.", 4);
        return;
    }

    sales.forEach((sale) => {
        const row = document.createElement("tr");

        appendTextCells(row, [
            sale.receipt_no ?? sale.reference_no ?? `#${sale.sale_id}`,
            formatDate(sale.sale_date ?? sale.created_at),
            formatCurrency(sale.total_amount),
            sale.status ?? "Unknown"
        ]);

        tableBody.appendChild(row);
    });
}

// ==========================================
// OWNER SALES PERFORMANCE CHART
// ==========================================

function renderSalesTrendChart(trend) {
    const container = document.getElementById("salesTrendChart");

    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(trend) || trend.length === 0) {
        container.textContent = "No sales trend data available.";
        return;
    }

    const points = trend.slice(0, 7).map((item) => ({
        date: String(item.date ?? ""),
        amount: Number(item.total_sales)
    }));

    if (points.some((p) => !p.date || !Number.isFinite(p.amount))) {
        container.textContent = "Sales trend data is unavailable.";
        return;
    }

    points.sort((a, b) => a.date.localeCompare(b.date));

    const width = 700;
    const height = 260;

    const left = 70;
    const right = 20;
    const top = 24;
    const bottom = 52;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const maxValue = Math.max(
        1,
        ...points.map((p) => Math.max(0, p.amount))
    );

    const svg = svgElement("svg", {
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": "Sales totals over the last seven days",
        preserveAspectRatio: "xMidYMid meet"
    });

    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.maxHeight = "260px";

    svg.appendChild(
        svgElement(
            "title",
            {},
            "Sales performance for the last seven days"
        )
    );

    // ======================================
    // CHART GRADIENT
    // ======================================

    const defs = svgElement("defs");

    const gradient = svgElement("linearGradient", {
        id: "ownerSalesGradient",
        x1: "0%",
        y1: "0%",
        x2: "100%",
        y2: "0%"
    });

    gradient.appendChild(
        svgElement("stop", {
            offset: "0%",
            "stop-color": "#FFB703"
        })
    );

    gradient.appendChild(
        svgElement("stop", {
            offset: "100%",
            "stop-color": "#2A9D8F"
        })
    );

    defs.appendChild(gradient);
    svg.appendChild(defs);

    // ======================================
    // GRID LINES AND AMOUNT LABELS
    // ======================================

    for (let step = 0; step <= 4; step++) {
        const value = maxValue * (4 - step) / 4;
        const y = top + plotHeight * step / 4;

        svg.appendChild(
            svgElement("line", {
                x1: left,
                y1: y,
                x2: width - right,
                y2: y,
                stroke: "#DCE3EA",
                "stroke-width": "1"
            })
        );

        svg.appendChild(
            svgElement(
                "text",
                {
                    x: left - 10,
                    y: y + 4,
                    "text-anchor": "end",
                    fill: "#617083",
                    "font-size": "12"
                },
                compactPesoFormatter.format(value)
            )
        );
    }

    // ======================================
    // CHART POINTS AND DATES
    // ======================================

    const chartPoints = points.map((point, index) => {
        const x = left + (
            points.length === 1
                ? plotWidth / 2
                : plotWidth * index / (points.length - 1)
        );

        const y = top + plotHeight -
            Math.max(0, point.amount) / maxValue * plotHeight;

        svg.appendChild(
            svgElement(
                "text",
                {
                    x: x,
                    y: height - 16,
                    "text-anchor": "middle",
                    fill: "#617083",
                    "font-size": "12"
                },
                formatShortDate(point.date)
            )
        );

        return {
            x,
            y,
            amount: point.amount
        };
    });

    // ======================================
    // SALES TREND LINE
    // ======================================

    const pathData = chartPoints.map((p, index) =>
        `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`
    ).join(" ");

    svg.appendChild(
        svgElement("path", {
            d: pathData,
            fill: "none",
            stroke: "url(#ownerSalesGradient)",
            "stroke-width": "4",
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
        })
    );

    // ======================================
    // SALES DATA DOTS
    // ======================================

    chartPoints.forEach((point) => {
        const dot = svgElement("circle", {
            cx: point.x,
            cy: point.y,
            r: "5",
            fill: "#2A9D8F",
            stroke: "#FFFFFF",
            "stroke-width": "2"
        });

        dot.appendChild(
            svgElement("title", {}, formatCurrency(point.amount))
        );

        svg.appendChild(dot);
    });

    container.appendChild(svg);
}

// ==========================================
// OWNER ERROR HANDLING
// ==========================================

function showOwnerDashboardError(message) {
    setText("totalSalesToday", "—");
    setText("netSalesToday", "—");
    setText("totalStock", "—");
    setText("ownerLowStock", "—");
    setText("grossProfitToday", "—");
    setText("refundsToday", "—");

    setText("ownerInventoryAlerts", "Data unavailable.");
    setText("salesTrendChart", message);

    const tableBody = document.getElementById("ownerRecentSales");

    if (tableBody) {
        tableBody.replaceChildren();
        renderEmptyTable(tableBody, message, 4);
    }
}

// ==========================================
// SHARED RENDERING HELPERS
// ==========================================

function appendTextCells(row, values) {
    values.forEach((value) => {
        const cell = document.createElement("td");

        cell.textContent =
            value == null ? "—" : String(value);

        row.appendChild(cell);
    });
}

function renderAlertList(container, alerts, emptyMessage) {
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(alerts) || alerts.length === 0) {
        container.textContent = emptyMessage;
        return;
    }

    const list = document.createElement("ul");
    list.className = "list-unstyled mb-0";

    alerts.forEach((alert) => {
        const item = document.createElement("li");
        item.className = "mb-2";

        item.textContent = typeof alert === "string"
            ? alert
            : alert?.message ?? "Attention required.";

        list.appendChild(item);
    });

    container.appendChild(list);
}

function renderEmptyTable(tableBody, message, colSpan) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = colSpan;
    cell.className = "text-center text-secondary py-4";
    cell.textContent = message;

    row.appendChild(cell);
    tableBody.appendChild(row);
}

function setText(elementId, value) {
    const element = document.getElementById(elementId);

    if (element) {
        element.textContent = value;
    }
}

// ==========================================
// FORMATTING HELPERS
// ==========================================

function formatNumber(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number.toLocaleString("en-PH")
        : "—";
}

function formatCurrency(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? pesoFormatter.format(number)
        : "—";
}

function formatTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatDate(value) {
    if (!value) return "—";

    const str = String(value);

    const date = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(str)
            ? `${str}T00:00:00`
            : str
    );

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatShortDate(value) {
    if (!value) return "—";

    const str = String(value);

    const date = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(str)
            ? `${str}T00:00:00`
            : str
    );

    if (Number.isNaN(date.getTime())) {
        return str;
    }

    return date.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric"
    });
}

// ==========================================
// SVG HELPER FOR OWNER CHART
// ==========================================

function svgElement(tag, attributes = {}, text = null) {
    const element = document.createElementNS(
        "http://www.w3.org/2000/svg",
        tag
    );

    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
    });

    if (text !== null) {
        element.textContent = String(text);
    }

    return element;
}
