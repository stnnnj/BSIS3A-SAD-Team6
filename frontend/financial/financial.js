
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = value => '₱' + Math.abs(Number(value || 0)).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
  const signedMoney = value => (Number(value) < 0 ? '−' : '') + money(value);
  const emptyTotals = () => ({completed:0, originalCost:0, refundAmount:0, costReversal:0, netSales:0, netCogs:0, grossProfit:0});
  let rows = [];
  let totals = emptyTotals();
  let applied = {start:'', end:'', payment:'', category:''};
  let requestNumber = 0;

  const update = (id, value) => { $(id).textContent = value; };
  function showError(message) {
    const el = $('filterFeedback');
    el.textContent = message || '';
    el.classList.toggle('d-none', !message);
  }
  function setOptions(select, values, label) {
    const oldValue = select.value;
    select.replaceChildren(new Option(label, ''));
    values.forEach(v => select.add(new Option(v, v)));
    select.value = values.includes(oldValue) ? oldValue : '';
  }
  function draw() {
    update('completedSales', money(totals.completed));
    update('originalCogs', money(totals.originalCost));
    update('refundsMetric', money(totals.refundAmount));
    update('grossProfitMetric', signedMoney(totals.grossProfit));
    update('cogsDetail', `Return cost reversal: ${money(totals.costReversal)}`);
    update('refundDetail', rows.filter(r => r.kind === 'return').length + ' recorded return item(s)');
    update('profitDetail', `Net sales ${money(totals.netSales)} − net COGS ${money(totals.netCogs)}`);
    update('sumSales', money(totals.completed));
    update('sumRefunds', '−' + money(totals.refundAmount));
    update('sumNetSales', money(totals.netSales));
    update('sumCogs', money(totals.originalCost));
    update('sumReversal', '−' + money(totals.costReversal));
    update('sumNetCogs', money(totals.netCogs));
    update('sumProfit', signedMoney(totals.grossProfit));

    const tbody = $('reconBody'); tbody.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5; td.className = 'text-center text-muted py-4';
      td.textContent = 'No recorded transactions match these filters.';
      tr.appendChild(td); tbody.appendChild(tr);
    } else {
      rows.forEach(row => {
        const tr = document.createElement('tr');
        const cells = [`${row.source} · ${row.product}`, money(row.netPrice), money(row.cost), String(row.qty).replace('-', '−'), signedMoney(row.profit)];
        cells.forEach((value, i) => {
          const cell = document.createElement(i === 0 ? 'th' : 'td');
          cell.textContent = value;
          if (i === 0) cell.scope = 'row';
          tr.appendChild(cell);
        });
        tbody.appendChild(tr);
      });
    }
    update('reconFoot', `${rows.length} recorded line(s) · ${signedMoney(totals.grossProfit)} estimated gross profit`);
    update('reportPeriod', `Period: ${applied.start || 'Any'} to ${applied.end || 'Any'} · Payment: ${applied.payment || 'All payments'} · Category: ${applied.category || 'All categories'}`);
    const report = $('reportTotals'); report.replaceChildren();
    [
      ['Completed sales', money(totals.completed)],
      ['Merchandise refunds', '−' + money(totals.refundAmount)],
      ['Net sales', money(totals.netSales)],
      ['Original cost of goods', money(totals.originalCost)],
      ['Return cost reversal', '−' + money(totals.costReversal)],
      ['Net cost of goods', money(totals.netCogs)],
      ['Estimated gross profit', signedMoney(totals.grossProfit)]
    ].forEach(([label, value], i) => {
      const span = document.createElement('span'); span.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = value;
      if (i === 6) {span.className = 'grand'; strong.className = 'grand';}
      report.append(span, strong);
    });
  }

  async function filter(event) {
    if (event) event.preventDefault();
    const start = $('startDate').value;
    const end = $('endDate').value;
    if (start && end && start > end) {
      showError('The start date must not be later than the end date.'); return;
    }
    const params = new URLSearchParams();
    applied = {start, end, payment:$('paymentFilter').value, category:$('categoryFilter').value};
    if (start) params.set('start_date', start);
    if (end) params.set('end_date', end);
    if (applied.payment) params.set('payment', applied.payment);
    if (applied.category) params.set('category', applied.category);
    const id = ++requestNumber;
    showError('');
    try {
      const res = await fetch('/api/financial/summary?' + params, {credentials:'same-origin', cache:'no-store'});
      if (res.status === 401 || res.status === 403) {
        window.location.replace('/frontend/index.html'); return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Unable to load financial totals.');
      if (id !== requestNumber) return;
      rows = data.rows || [];
      totals = data.totals || emptyTotals();
      setOptions($('paymentFilter'), data.filters?.payments || [], 'All payments');
      setOptions($('categoryFilter'), data.filters?.categories || [], 'All categories');
      draw();
    } catch (error) {
      if (id !== requestNumber) return;
      rows = []; totals = emptyTotals(); draw();
      showError(error.message || 'Financial data could not be loaded. Please check the Flask backend.');
    }
  }

  function exportCsv() {
    const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const csvRows = [['Source', 'Product', 'Category', 'Payment', 'Date', 'Net price PHP', 'Unit cost PHP', 'Quantity', 'Gross profit PHP']];
    rows.forEach(r => csvRows.push([r.source, r.product, r.category, r.payment, r.date, Number(r.netPrice).toFixed(2), Number(r.cost).toFixed(2), r.qty, Number(r.profit).toFixed(2)]));
    csvRows.push([], ['Completed sales PHP', totals.completed], ['Merchandise refunds PHP', -totals.refundAmount], ['Net sales PHP', totals.netSales], ['Original COGS PHP', totals.originalCost], ['Return cost reversal PHP', -totals.costReversal], ['Net COGS PHP', totals.netCogs], ['Estimated gross profit PHP', totals.grossProfit]);
    const blob = new Blob(['\uFEFF', csvRows.map(r => r.map(quote).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = 'CCMC-Financial-Analytics.csv'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function logout() {
    try {
      const res = await fetch('/api/auth/logout', {method:'POST', credentials:'same-origin'});
      if (!res.ok) throw Error('Could not log out.');
      window.location.replace('/frontend/index.html');
    } catch (err) { showError(err.message); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('financialFilters').addEventListener('submit', filter);
    $('resetFilters').addEventListener('click', () => {$('financialFilters').reset(); filter();});
    $('viewReportBtn').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance($('reportModal')).show());
    $('exportCsvBtn').addEventListener('click', exportCsv);
    $('logoutBtn').addEventListener('click', logout);
    draw(); filter();
  });
})();
