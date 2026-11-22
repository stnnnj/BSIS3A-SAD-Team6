
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = value => '₱' + Number(value || 0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
  let currentOperatorName = '';
  const state = {sale:null, itemIndex:null, step:1, reviewed:null, completed:null, busy:false, historyVisible:false, completedReceipts:[]};
  const selectedItem = () => state.sale && state.itemIndex !== null ? state.sale.items[state.itemIndex] : null;
  const remaining = item => Math.max(0, item.sold - item.returned);
  const setText = (id, value) => { $(id).textContent = value === null || value === undefined ? '' : String(value); };
  const productLabel = item => `${item.code} · ${item.name}`;
  function alertMsg(message) {
    const el = $('returnAlert'); el.textContent = message || '';
    el.classList.toggle('d-none', !message);
    if (message) el.scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  function setStep(step) {
    state.step = step;
    state.historyVisible = false;
    $('returnStepper').classList.remove('d-none');
    $('returnsHistoryPanel').classList.add('d-none');
    $('returnsHistoryBtn').disabled = step === 2 || state.busy;
    $('returnsHistoryBtn').setAttribute('aria-pressed', 'false');
    [1,2,3].forEach(n => {
      $(`returnStep${n}`).classList.toggle('d-none', n !== step);
      const marker = $(`stepMarker${n}`);
      marker.classList.toggle('active', n === step);
      marker.classList.toggle('done', n < step);
      marker.querySelector('.step-circle').textContent = n < step ? '✓' : String(n);
      if (n === step) marker.setAttribute('aria-current', 'step'); else marker.removeAttribute('aria-current');
    });
    $('completeActions').classList.toggle('d-none', step !== 3);
    $('refreshReturnsBtn').disabled = step === 2 || state.busy;
    if (step === 1) {
      setText('returnHeading', 'Return / Refund');
      setText('returnSubtitle', 'Verify the original receipt and select items to return.');
    } else if (step === 2) {
      setText('returnHeading', 'Review return & refund');
      setText('returnSubtitle', `${state.sale.receipt_no} · ${state.sale.customer || 'Customer not specified'}`);
    } else {
      setText('returnHeading', 'Return recorded');
      setText('returnSubtitle', `${state.completed.reference} · ${state.completed.recorded_at} · ${currentOperatorName}`);
    }
    alertMsg('');
  }
  function openHistory() {
    if (state.busy || state.step === 2) return;
    state.historyVisible = true;
    $('returnStepper').classList.add('d-none');
    [1, 2, 3].forEach(n => $(`returnStep${n}`).classList.add('d-none'));
    $('returnsHistoryPanel').classList.remove('d-none');
    $('completeActions').classList.add('d-none');
    $('returnsHistoryBtn').disabled = true;
    $('returnsHistoryBtn').setAttribute('aria-pressed', 'true');
    setText('returnHeading', 'Returns history');
    setText('returnSubtitle', 'Review recorded refunds and their individual return receipts.');
    alertMsg('');
    loadReturnHistory();
  }
  function closeHistory() {
    setStep(state.step);
  }
  function showReturnReceipt(entry) {
    setText('returnReceiptRef', entry.reference || '—');
    setText('returnReceiptOriginal', entry.receipt_no || '—');
    setText('returnReceiptDate', entry.date || '—');
    setText('returnReceiptCustomer', entry.customer || 'Walk-in');
    setText('returnReceiptProduct', entry.product || '—');
    setText('returnReceiptQty', entry.quantity ?? '—');
    setText('returnReceiptReason', entry.reason || 'Not recorded');
    setText('returnReceiptNotes', entry.condition_notes || 'Not recorded');
    setText('returnReceiptMethod', entry.refund_method || 'Not recorded');
    setText('returnReceiptRestock', entry.restocked ? 'Yes' : 'No');
    setText('returnReceiptOperator', entry.processed_by ? `User ID ${entry.processed_by}` : 'Not recorded');
    setText('returnReceiptAmount', money(entry.refund_amount));
    window.bootstrap.Modal.getOrCreateInstance($('returnReceiptModal')).show();
  }
  function renderSale() {
    const sale = state.sale;
    const body = $('saleItemsBody'); body.replaceChildren();
    setText('saleMeta', sale ? `${new Date(sale.date).toLocaleString('en-PH')} · ${sale.customer || 'Customer not specified'} · Paid ${money(sale.paid)} ${sale.method}` : '');
    if (!sale || !sale.items.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td');
      td.colSpan = 5; td.className = 'text-muted text-center py-4';
      td.textContent = sale ? 'This receipt has no sale items.' : 'Search a completed receipt to view its items.';
      tr.appendChild(td); body.appendChild(tr);
    } else {
      sale.items.forEach((item, index) => {
        const tr = document.createElement('tr');
        const label = document.createElement('th'); label.scope = 'row'; label.textContent = productLabel(item);
        const sold = document.createElement('td'); sold.textContent = item.sold;
        const returned = document.createElement('td'); returned.textContent = item.returned;
        const net = document.createElement('td'); net.textContent = money(item.net);
        const selection = document.createElement('td');
        const field = document.createElement('div'); field.className = 'form-check';
        const input = document.createElement('input'); input.type = 'radio'; input.name = 'saleItem';
        input.className = 'form-check-input'; input.id = `saleItem${index}`;
        input.checked = state.itemIndex === index; input.disabled = remaining(item) === 0;
        input.addEventListener('change', () => {
          state.itemIndex = index; $('returnQuantity').value = '';
          updateSelection();
        });
        const text = document.createElement('label'); text.className = 'form-check-label';
        text.setAttribute('for', input.id); text.textContent = remaining(item) ? 'Select' : 'Fully returned';
        field.append(input, text); selection.appendChild(field);
        tr.append(label, sold, returned, net, selection); body.appendChild(tr);
      });
    }
    updateSelection();
  }
  function updateSelection() {
    const item = selectedItem();
    const max = item ? remaining(item) : 0;
    const qty = $('returnQuantity');
    qty.disabled = !max; qty.max = max ? String(max) : '';
    if (!max) qty.value = '';
    setText('maxQuantityLabel', max ? `max ${max}` : 'max —');
    Array.from($('returnForm').querySelectorAll('button[type="submit"]')).forEach(btn => {btn.disabled = !max;});
    $('returnReason').disabled = !max;
    $('conditionNotes').disabled = !max;
    $('restockCheck').disabled = !max;
    $('refundMethod').disabled = !max;
    updateSummary();
  }
  function updateSummary() {
    const item = selectedItem();
    const entered = $('returnQuantity').value;
    const qty = entered !== '' ? Number(entered) : 0;
    setText('originalUnit', item ? money(item.price) : '—');
    setText('discountUnit', item ? '−' + money(item.price - item.net) : '—');
    setText('netUnit', item ? money(item.net) : '—');
    setText('returnQuantitySummary', item && qty ? `× ${qty}` : '—');
    setText('refundAmount', item && Number.isInteger(qty) && qty > 0 ? money(item.net * qty) : '—');
    setText('restockLabel', item ? `Restock returned item · ${qty > 0 ? '+' + qty + ' ' : ''}${item.name}` : 'Restock returned item');
    setText('refundHelp', 'Refund amount uses the original receipt. Restock only resellable items.');
  }

  function showHistoryMessage(message) {
    const body = $('returnsHistoryBody');
    body.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 9;
    cell.className = 'text-center text-muted py-4';
    cell.textContent = message;
    row.appendChild(cell);
    body.appendChild(row);
  }
  function renderReturnHistory(entries) {
    const body = $('returnsHistoryBody');
    body.replaceChildren();
    setText('returnsHistoryCount', entries.length === 200
      ? 'Latest 200 returns shown'
      : `${entries.length} recorded return${entries.length === 1 ? '' : 's'}`);
    if (!entries.length) {
      showHistoryMessage('No returns have been recorded yet.');
      return;
    }
    for (const entry of entries) {
      const tr = document.createElement('tr');
      const values = [
        entry.reference,
        entry.receipt_no,
        entry.date,
        entry.product,
        entry.quantity,
        money(entry.refund_amount),
        entry.refund_method || '—',
        entry.restocked ? 'Yes' : 'No'
      ];
      values.forEach((value, index) => {
        const cell = document.createElement(index < 2 ? 'th' : 'td');
        if (index < 2) cell.scope = 'row';
        cell.textContent = value;
        tr.appendChild(cell);
      });
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-secondary btn-sm';
      button.textContent = 'Return receipt';
      button.setAttribute('aria-label', `View return receipt ${entry.reference}`);
      button.addEventListener('click', () => showReturnReceipt(entry));
      action.appendChild(button);
      tr.appendChild(action);
      body.appendChild(tr);
    }
  }
  async function loadReturnHistory() {
    setText('returnsHistoryCount', 'Loading history...');
    showHistoryMessage('Loading return history...');
    try {
      const res = await fetch('/api/returns/history', {
        credentials:'same-origin', cache:'no-store'
      });
      if (res.status === 401) { window.location.replace('/frontend/index.html'); return; }
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.history)) {
        throw Error(data.message || 'Unable to load return history.');
      }
      renderReturnHistory(data.history);
    } catch (error) {
      setText('returnsHistoryCount', 'Unable to load');
      showHistoryMessage('Unable to load return history. Click Refresh to try again.');
    }
  }
  function clearReturnDraft() {
    state.sale = null; state.itemIndex = null;
    state.reviewed = null; state.completed = null;
    $('receiptSearch').value = '';
    $('returnQuantity').value = '';
    $('returnReason').value = '';
    $('conditionNotes').value = '';
    $('refundMethod').value = '';
    $('restockCheck').checked = false;
    $('verifyCheck').checked = false;
    $('confirmRefundBtn').disabled = true;
    renderSale();
  }
  async function refreshReturns() {
    if (state.busy || (state.step === 2 && !state.historyVisible)) return;
    const button = $('refreshReturnsBtn');
    const stayInHistory = state.historyVisible;
    button.disabled = true;
    button.textContent = 'Refreshing...';
    clearReturnDraft();
    state.step = 1;
    if (!stayInHistory) setStep(1);
    try {
      await Promise.all([loadCompletedReceipts(), loadReturnHistory()]);
    } finally {
      button.textContent = '↻ Refresh';
      button.disabled = state.busy || state.step === 2;
    }
  }

  function showReceiptListMessage(message) {
    const body = $('completedReceiptsBody');
    body.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'text-center text-muted py-3';
    td.textContent = message;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  function renderCompletedReceipts() {
    const receipts = state.completedReceipts;
    setText('completedReceiptsCount', `${receipts.length} completed receipt${receipts.length === 1 ? '' : 's'}`);
    if (!receipts.length) {
      showReceiptListMessage('No completed receipts found.');
      return;
    }
    const body = $('completedReceiptsBody');
    body.replaceChildren();
    for (const sale of receipts) {
      const tr = document.createElement('tr');
      if (state.sale?.receipt_no === sale.receipt_no) tr.classList.add('table-active');
      const receipt = document.createElement('th');
      receipt.scope = 'row';
      receipt.textContent = sale.receipt_no;
      const date = document.createElement('td');
      const dateObj = new Date(sale.sale_date);
      date.textContent = Number.isNaN(dateObj.getTime()) ? '—' : dateObj.toLocaleString('en-PH', {dateStyle:'short',timeStyle:'short'});
      const customer = document.createElement('td');
      customer.textContent = sale.customer_name || 'Walk-in';
      const total = document.createElement('td');
      total.textContent = money(sale.total_amount);
      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-secondary btn-sm';
      button.textContent = 'View items';
      button.setAttribute('aria-label', `View items for receipt ${sale.receipt_no}`);
      button.addEventListener('click', () => {
        $('receiptSearch').value = sale.receipt_no;
        findReceipt();
      });
      action.appendChild(button);
      tr.append(receipt, date, customer, total, action);
      body.appendChild(tr);
    }
  }
  async function loadCompletedReceipts() {
    setText('completedReceiptsCount', 'Loading receipts...');
    showReceiptListMessage('Loading completed receipts...');
    try {
      // Reuse the actual Sales/POS API; no new backend or database columns.
      const res = await fetch('/api/retail/sales', {credentials:'same-origin', cache:'no-store'});
      if (res.status === 401) { window.location.replace('/frontend/index.html'); return; }
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.sales)) {
        throw Error(data.message || 'Could not load completed receipts.');
      }
      state.completedReceipts = data.sales.filter(s => s.status === 'Completed' && s.receipt_no);
      renderCompletedReceipts();
    } catch (err) {
      state.completedReceipts = [];
      setText('completedReceiptsCount', 'Unable to load');
      showReceiptListMessage('Completed receipts could not be loaded. You can still search by receipt number.');
      alertMsg(err.message);
    }
  }
  async function findReceipt() {
    const query = $('receiptSearch').value.trim();
    state.sale = null; state.itemIndex = null; state.reviewed = null;
    $('returnQuantity').value = '';
    renderSale(); alertMsg('');
    if (!query) {alertMsg('Enter a receipt number.'); return;}
    $('lookupBtn').disabled = true;
    try {
      const res = await fetch('/api/returns/receipt?receipt_no=' + encodeURIComponent(query), {credentials:'same-origin', cache:'no-store'});
      if (res.status === 401) {window.location.replace('/frontend/index.html'); return;}
      const data = await res.json();
      if (!res.ok || !data.success) throw Error(data.message || 'Receipt lookup failed.');
      state.sale = data.sale;
      $('receiptSearch').value = data.sale.receipt_no;
      $('returnReason').value = ''; $('conditionNotes').value = '';
      $('restockCheck').checked = false; $('refundMethod').value = '';
      renderSale();
      renderCompletedReceipts();
      if (!data.sale.items.some(item => remaining(item) > 0)) alertMsg('No available quantity remains for return on this receipt.');
    } catch (err) {
      state.sale = null; renderSale(); alertMsg(err.message);
    } finally { $('lookupBtn').disabled = false; }
  }
  function resetToStart() {
    clearReturnDraft();
    setStep(1);
    refreshReturns();
  }
  function getDraft() {
    const item = selectedItem();
    if (!state.sale || !item) throw Error('Search a receipt and select an item to return.');
    const qty = Number($('returnQuantity').value);
    if (!$('returnQuantity').value || !Number.isInteger(qty) || qty < 1 || qty > remaining(item))
      throw Error(`Enter a whole return quantity from 1 to ${remaining(item)}.`);
    if (!$('returnReason').value) throw Error('Choose a return reason.');
    if (!['Cash', 'GCash'].includes($('refundMethod').value)) throw Error('Choose the refund method.');
    if (item.net <= 0) throw Error('This item has no refundable amount on its receipt.');
    return {
      sale_item_id:item.sale_item_id, sale:state.sale.receipt_no, customer:state.sale.customer,
      code:item.code, name:item.name, qty, sold:item.sold, alreadyReturned:item.returned,
      price:item.price, net:item.net, refund:item.net * qty,
      reason:$('returnReason').value, condition:$('conditionNotes').value.trim(),
      restock:$('restockCheck').checked, method:$('refundMethod').value, currentStock:item.onHand,
      request_id:crypto.randomUUID()
    };
  }
  function reviewReturn(event) {
    event.preventDefault();
    try {state.reviewed = getDraft();} catch (e) {alertMsg(e.message); return;}
    const d = state.reviewed;
    setText('reviewProduct', `${d.code} · ${d.name}`);
    setText('reviewQty', d.qty); setText('reviewUnit', money(d.net)); setText('reviewAmount', money(d.refund));
    setText('reviewSale', d.sale); setText('reviewSold', `${d.sold} units`);
    setText('reviewReturned', `${d.alreadyReturned} units`);
    setText('reviewAfter', `${d.alreadyReturned + d.qty} of ${d.sold} returned`);
    setText('reviewReason', d.reason); setText('reviewCondition', d.condition || 'Not specified');
    setText('reviewMethod', d.method); setText('reviewNet', money(d.net));
    setText('reviewCount', d.qty); setText('reviewTotal', money(d.refund));
    setText('reviewRestockTitle', d.restock ? 'ⓘ  Restock selected' : 'ⓘ  No restock');
    setText('reviewStock', d.restock ? `${d.code}: ${d.currentStock} + ${d.qty} = ${d.currentStock + d.qty} on hand (subject to confirmation).` : `${d.code}: No on-hand stock change.`);
    setText('handlerName', currentOperatorName);
    $('verifyCheck').checked = false; $('confirmRefundBtn').disabled = true;
    $('confirmRefundBtn').textContent = d.restock ? 'Record refund & restock' : 'Record refund (no restock)';
    setStep(2);
  }
  async function confirmReturn() {
    if (state.busy) return;
    if (!state.reviewed || !$('verifyCheck').checked || state.step !== 2) {
      alertMsg('Verify the receipt, quantity and the already-issued refund before recording it.'); return;
    }
    state.busy = true; $('confirmRefundBtn').disabled = true;
    const d = state.reviewed;
    try {
      const res = await fetch('/api/returns', {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          receipt_no:d.sale, sale_item_id:d.sale_item_id, quantity:d.qty, reason:d.reason,
          condition_notes:d.condition, refund_method:d.method, restock:d.restock,
          verified:true, request_id:d.request_id
        })
      });
      if (res.status === 401) {window.location.replace('/frontend/index.html'); return;}
      const data = await res.json();
      if (!res.ok || !data.success) throw Error(data.message || 'Unable to record the return.');
      const result = data.result;
      state.completed = result;
      setText('completeBanner', `${money(result.refund_amount)} recorded · ${result.restocked ? `${result.quantity} unit(s) restocked` : 'no units restocked'}`);
      setText('completeProduct', `${result.product_code} · ${result.product_name}`);
      setText('completeQty', result.quantity); setText('completeUnit', money(result.net_unit));
      setText('completeRefund', money(result.refund_amount));
      setText('completeSale', result.receipt_no); setText('completeCustomer', result.customer || 'Not specified');
      setText('completeReturnRef', result.reference); setText('completeRefundRef', result.refund_reference);
      setText('completeMethod', result.refund_method); setText('completeReason', result.reason);
      setText('completeTotal', money(result.refund_amount));
      setText('completeStockProduct', `${result.product_code} · ${result.product_name}`);
      setText('completePreviousStock', result.previous_stock);
      setText('completeStockQty', result.restocked ? '+' + result.quantity : '0 (not restocked)');
      setText('completeNewStock', result.new_stock);
      setText('completeTransaction', result.inventory_txn_id ? `IT-${result.inventory_txn_id}` : 'None');
      setText('completeSource', `${result.reference} → ${result.receipt_no}`);
      setText('stockBadge', result.restocked ? 'Restocked' : 'Not restocked');
      setStep(3);
      await Promise.all([loadReturnHistory(), loadCompletedReceipts()]);
    } catch (err) { alertMsg(err.message); }
    finally {
      state.busy = false;
      $('confirmRefundBtn').disabled = !$('verifyCheck').checked;
      $('refreshReturnsBtn').disabled = state.step === 2;
    }
  }
  async function setupAuth() {
    try {
      const res = await fetch('/api/auth/me', {credentials:'same-origin', cache:'no-store'});
      if (!res.ok) {window.location.replace('/frontend/index.html'); return;}
      const data = await res.json();
      if (!data.success || !['Owner','Staff'].includes(data.user?.role)) {window.location.replace('/frontend/index.html'); return;}
      const role = data.user.role;
      currentOperatorName = data.user.name || data.user.username || '';
      document.body.dataset.role = role;
      setText('workspaceLabel', `${role} Workspace`);
      setText('userRoleLabel', role);
      document.querySelector('[data-nav="dashboard"]').href = role === 'Owner' ? '../owner-dashboard.html' : '../staff-dashboard.html';
      document.querySelector('[data-nav="returns"]').href = 'returns.html';
      document.querySelectorAll('[data-owner-only]').forEach(el => el.classList.toggle('d-none', role !== 'Owner'));
      return true;
    } catch (err) {alertMsg('Could not verify your login. Open this page through the Flask server.'); return false;}
  }
  async function logout() {
    try {
      const res = await fetch('/api/auth/logout', {method:'POST', credentials:'same-origin'});
      if (!res.ok) throw Error('Unable to log out.');
      window.location.replace('/frontend/index.html');
    } catch (err) {alertMsg(err.message);}
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('receiptSearch').value = ''; // Do not restore or guess a receipt on reload.
    renderSale(); setStep(1);
    $('lookupBtn').addEventListener('click', findReceipt);
    $('refreshReturnsBtn').addEventListener('click', refreshReturns);
    $('returnsHistoryBtn').addEventListener('click', openHistory);
    $('backToReturnsBtn').addEventListener('click', closeHistory);
    $('receiptSearch').addEventListener('keydown', e => {if (e.key === 'Enter') {e.preventDefault(); findReceipt();}});
    $('returnQuantity').addEventListener('input', updateSummary);
    $('restockCheck').addEventListener('change', updateSummary);
    $('returnForm').addEventListener('submit', reviewReturn);
    $('cancelEditBtn').addEventListener('click', resetToStart);
    $('cancelReviewBtn').addEventListener('click', resetToStart);
    $('backToEditBtn').addEventListener('click', () => {setStep(1); updateSummary();});
    $('verifyCheck').addEventListener('change', () => {$('confirmRefundBtn').disabled = !$('verifyCheck').checked;});
    $('confirmRefundBtn').addEventListener('click', confirmReturn);
    $('newReturnTop').addEventListener('click', resetToStart);
    $('newReturnBottom').addEventListener('click', resetToStart);
    $('printBtn').addEventListener('click', () => window.print());
    $('logoutBtn').addEventListener('click', logout);
    setupAuth().then(authenticated => { if (authenticated) refreshReturns(); });
  });
  window.addEventListener('pageshow', () => {
    // Also handle browser back/forward cache restores.
    if (!state.sale) $('receiptSearch').value = '';
  });
})();
