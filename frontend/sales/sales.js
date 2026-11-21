/* Shared API, authentication, and display helpers for the Sales/POS and Reservations pages. */
window.ModuleShared = (() => {
 const money = n => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n)||0);
 const escape = input => String(input??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date = value => value ? new Date(value).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}) : '—';
 async function api(path,options={}){
  const res=await fetch('/api/retail'+path,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  let body;try{body=await res.json()}catch{body={message:'Invalid response from server.'}}
  if(!res.ok||body.success===false){throw new Error(body.message||`Request failed (${res.status})`)}return body;
 }
 function toast(message,kind='success'){
  const el=document.getElementById('rfToast'); if(!el)return;
  el.className=`alert alert-${kind==='error'?'danger':'success'}`;el.textContent=message;el.hidden=false;
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,4700);
 }
 async function session(){
  document.body.style.visibility='hidden';
  try{
   const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}),data=await r.json();
   if(!r.ok||!data.success||!['Staff','Owner'].includes(data.user?.role))throw new Error('Session expired');
   document.querySelectorAll('[data-user-name]').forEach(el=>el.textContent=data.user.name||data.user.username);
   document.querySelectorAll('[data-user-role]').forEach(el=>el.textContent=data.user.role);
   // The sidebar, headings and dashboard link follow the server-confirmed role.
   // Never infer authorization from this UI: Flask endpoints must still check access.
   const role = data.user.role;
   document.body.dataset.role = role;
   document.querySelectorAll('[data-owner-only]').forEach(el=>el.classList.toggle('d-none', role !== 'Owner'));
   document.querySelectorAll('[data-workspace-label]').forEach(el=>el.textContent=role+' Workspace');
   document.querySelectorAll('[data-footer-role]').forEach(el=>el.textContent=role);
   const dash = document.querySelector('[data-link="dashboard"]');
   if (dash) dash.href = role === 'Owner' ? '/frontend/owner-dashboard.html' : '/frontend/staff-dashboard.html';
   const logout=document.getElementById('logoutBtn');if(logout)logout.addEventListener('click',async()=>{
    try{const res=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});if(!res.ok)throw Error('Logout failed');location.href='/frontend/index.html'}catch(e){toast(e.message,'error')}
   });
   document.body.style.visibility='visible';return data.user;
  }catch{location.replace('/frontend/index.html');throw Error('Login required')}
 }
 function commonNav(page){
  const dashboard=document.querySelector('[data-link="dashboard"]');
  if(dashboard) dashboard.href='/frontend/staff-dashboard.html';
  document.querySelectorAll('[data-link="sales"]').forEach(el=>el.href='/frontend/sales/sales.html');
  document.querySelectorAll('[data-link="reservations"]').forEach(el=>el.href='/frontend/reservations/reservations.html');
  document.querySelectorAll(`[data-link="${page}"]`).forEach(el=>el.classList.add('active'));
  document.querySelectorAll('[data-link="returns"]').forEach(el=>el.href='/frontend/returns/returns.html');
  document.querySelectorAll('[data-link="inventory"]').forEach(el=>el.href='/frontend/inventory/inventory.html');
 }
 return {money,escape,date,api,toast,session,commonNav};
})();


/* Module behavior */
(() => {'use strict';
const $=id=>document.getElementById(id), {api,money,escape:esc,date,toast}=ModuleShared;
const state={products:[],cart:[],draftId:null,discountRate:null,sales:[],saleFilter:'All',step:0};
const num=v=>Math.round((Number(v)||0)*100)/100; const total=()=>num(state.cart.reduce((s,i)=>s+i.price*i.qty,0));
const discount=()=> $('discountType').value==='None'?0:num(total()*(state.discountRate??0));const due=()=>num(total()-discount());
const paymentMethod=()=>document.querySelector('input[name="paymentMethod"]:checked').value;
const items=()=>state.cart.map(i=>({product_id:i.id,quantity:i.qty}));
function showStep(n){state.step=n;$('checkoutView').classList.remove('rf-hidden');$('historyView').classList.add('rf-hidden'); ['saleItemsStep','saleDiscountStep','salePaymentStep','saleReceiptStep'].forEach((id,i)=>$(id).classList.toggle('rf-hidden',n!==i));
[...$('saleSteps').children].forEach((el,i)=>{el.className=i===n?'current':(i<n?'done':'')});scrollTo({top:0,behavior:'smooth'});}
function renderProducts(){
  // Read products from the real Products table through /api/retail/products.
  // The POS lists only items that can currently be sold; out-of-stock products
  // remain in the database and can be managed in the Owner's Products module.
  const sellable = state.products.filter(p =>
    Number.isFinite(Number(p.available_qty)) && Number(p.available_qty) > 0
  );
  const rows = sellable.map(p =>
    `<tr><td>${esc(p.product_name)}</td><td>${esc(p.item_code)}</td><td>${Number(p.available_qty)}</td><td>${money(p.selling_price)}</td><td><button type="button" class="btn btn-sm btn-outline-primary" data-add="${esc(p.product_id)}">Add</button></td></tr>`
  ).join('');
  $('productRows').innerHTML = rows ||
    '<tr><td colspan="5" class="rf-empty">No products available for sale yet.</td></tr>';
}
async function loadProducts(){
  const search=$('productSearch').value.trim();
  $('productRows').innerHTML='<tr><td colspan="5" class="rf-empty">Loading products...</td></tr>';
  try {
    const data=await api('/products?q='+encodeURIComponent(search));
    if(!Array.isArray(data.products))throw new Error('The products API did not return a product list.');
    state.products=data.products;
    renderProducts();
    return true;
  }catch(e){
    state.products=[];
    $('productRows').innerHTML=`<tr><td colspan="5" class="rf-empty">Unable to load products: ${esc(e.message)} <button type="button" class="btn btn-outline-primary btn-sm ms-2" data-retry-products="true">Retry</button></td></tr>`;
    toast('Products could not load. Add is unavailable until the backend responds successfully.','error');
    return false;
  }
}
function addProduct(productId){
  const p=state.products.find(x=>String(x.product_id)===String(productId));
  if(!p)return toast('Product is unavailable. Click Search to refresh the list.','error');
  const available=Number(p.available_qty);
  if(!Number.isInteger(available)||available<=0)return toast('This product has no available stock.','error');
  const price=Number(p.selling_price);
  if(!Number.isFinite(price)||price<0)return toast('This product has an invalid selling price.','error');
  const id=Number(p.product_id);
  if(!Number.isInteger(id)||id<=0)return toast('Invalid product ID. Refresh the product list.','error');
  const existing=state.cart.find(i=>Number(i.id)===id);
  if(existing){
    if(existing.qty>=available)return toast('Not enough available stock.','error');
    existing.qty+=1;
    existing.available=available;
  }else{
    state.cart.push({id,name:p.product_name,code:p.item_code,price:num(price),qty:1,available});
  }
  renderCart();
  toast(`${p.product_name} added to the cart.`);
}
function renderCart(){let sumQty=0;const arr=state.cart.map((i,index)=>{sumQty+=i.qty;return `<div class="d-flex justify-content-between align-items-start gap-2 py-2 border-bottom"><div class="flex-grow-1"><strong>${esc(i.name)}</strong><div class="rf-muted">${esc(i.code)} · ${money(i.price)} each</div><div class="rf-stepper mt-2"><button type="button" class="btn btn-sm btn-outline-secondary rf-qty-btn" data-qty="${index}" data-change="-1" aria-label="Decrease quantity">−</button><output>${i.qty}</output><button type="button" class="btn btn-sm btn-outline-secondary rf-qty-btn" data-qty="${index}" data-change="1" aria-label="Increase quantity">+</button><button type="button" class="btn btn-link btn-sm rf-link ms-2" data-remove="${index}">Remove</button></div></div><strong>${money(i.qty*i.price)}</strong></div>`}).join('');$('cartItems').innerHTML=arr||'<p class="rf-empty">Your cart is empty.</p>';$('cartQty').textContent=`${sumQty} units`;$('cartSubtotal').textContent=money(total());$('cartTotal').textContent=money(total());$('cartStatus').textContent=state.draftId?'Saved draft':'Unfinished';}
function renderDiscount(){const rate=state.discountRate;const type=$('discountType').value;if(rate==null&&type!=='None'){$('discountRule').textContent='The backend has no approved discount rate configured. Select No discount, or ask your backend team to configure an approved rule.'}else{$('discountRule').textContent=type==='None'?'No discount selected.':`Configured discount: ${(rate*100).toFixed(2)}% of this sale subtotal. Eligibility must be verified by staff.`}
$('discountItems').innerHTML=state.cart.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty*i.price)}</td></tr>`).join('');$('discountSubtotal').textContent=money(total());$('discountAmount').textContent='−'+money(discount());$('discountTotal').textContent=money(due());}
function renderPayment(){ updateMethod();$('paymentItems').innerHTML=state.cart.map(i=>`<div class="rf-summary-row"><span>${esc(i.name)} × ${i.qty}</span><strong>${money(i.price*i.qty)}</strong></div>`).join('');$('paymentSubtotal').textContent=money(total());$('paymentDiscount').textContent='−'+money(discount());$('paymentTotal').textContent=money(due());$('cashReceived').value=due().toFixed(2);updateChange();}
function updateChange(){const change=Math.max(0,num($('cashReceived').value)-due());$('cashChange').textContent=money(change);}
function updateMethod(){const cash=paymentMethod()==='Cash';$('cashFields').classList.toggle('rf-hidden',!cash);$('gcashFields').classList.toggle('rf-hidden',cash)}
function clearCart(){state.cart=[];state.draftId=null;$('discountType').value='None';$('discountId').value='';$('customerName').value='';$('gcashReference').value='';renderCart();showStep(0);}
async function startNewSale(){
  clearCart();
  $('productSearch').value = '';
  $('productSearch').focus();
  const loaded = await loadProducts();
  if (loaded) {
    toast(state.products.some(p => Number(p.available_qty) > 0)
      ? 'New sale ready. Choose a product and click Add.'
      : 'New sale ready. No in-stock products yet. Add stock through Products, then click Search.');
  }
}
async function saveDraft(){if(!state.cart.length)return toast('Add at least one product.','error');try{const r=await api('/sales/draft',{method:'POST',body:JSON.stringify({draft_id:state.draftId,items:items()})});state.draftId=r.sale_id;toast('Unfinished sale saved. No stock deducted.');renderCart()}catch(e){toast(e.message,'error')}}
async function voidDraft(){if(!state.draftId)return toast('Only a saved unfinished sale can be voided.','error');if(!confirm('Void this unfinished sale? It will not affect inventory.'))return;try{await api('/sales/void/'+state.draftId,{method:'POST'});clearCart();toast('Draft voided.') }catch(e){toast(e.message,'error')}}
function validateDiscount(){const t=$('discountType').value;if(t!=='None'){if(state.discountRate===null)throw Error('Approved discount rate is not configured by the backend.');if(!$('discountId').value.trim()||!$('customerName').value.trim())throw Error('Customer name and Senior/PWD ID are required.')} }
async function checkout(){try{validateDiscount();const method=paymentMethod();if(method==='Cash'&&num($('cashReceived').value)<due())throw Error('Cash received must cover the amount due.');if(method==='GCash'&&!$('gcashReference').value.trim())throw Error('Enter the verified GCash transaction reference.');if(!confirm('Confirm you have received the payment and complete this sale?'))return;
$('confirmPaymentBtn').disabled=true;const data=await api('/sales/checkout',{method:'POST',body:JSON.stringify({draft_id:state.draftId,items:items(),customer_name:$('customerName').value.trim(),discount_type:$('discountType').value,discount_id_no:$('discountId').value.trim(),payment_method:method,cash_received:method==='Cash'?num($('cashReceived').value):null,gcash_reference:method==='GCash'?$('gcashReference').value.trim():null})});renderReceipt(data.sale,{method,cash:method==='Cash'?num($('cashReceived').value):null,change:method==='Cash'?num(num($('cashReceived').value)-Number(data.sale.total_amount)):null});showStep(3);toast('Sale completed and stock deducted.');}
catch(e){toast(e.message,'error')}finally{$('confirmPaymentBtn').disabled=false}}
function renderReceipt(sale,tender=null){const products=sale.items||[];$('receiptContent').innerHTML=`<div class="rf-card-title"><h3>CCMC Store · Receipt</h3><span class="rf-chip">Completed</span></div><p class="rf-muted">${esc(sale.receipt_no)} · ${date(sale.sale_date)} · ${esc(sale.customer_name||'Walk-in')}</p><div class="rf-table-wrap"><table class="rf-table"><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${products.map(p=>`<tr><td>${esc(p.product_name)}</td><td>${p.quantity}</td><td>${money(p.unit_price)}</td><td>${money(p.unit_price*p.quantity)}</td></tr>`).join('')}</tbody></table></div><div class="rf-summary-row"><span>Subtotal</span><strong>${money(sale.subtotal)}</strong></div><div class="rf-summary-row"><span>Discount</span><strong>−${money(sale.discount_amount)}</strong></div><div class="rf-total"><span>Total paid</span><strong>${money(sale.total_amount)}</strong></div><div class="rf-summary-row"><span>Payment method</span><strong>${esc(sale.payment_method)}</strong></div>${tender?.method==='Cash'?`<div class="rf-summary-row"><span>Tendered (not saved)</span><strong>${money(tender.cash)}</strong></div><div class="rf-summary-row"><span>Change (not saved)</span><strong>${money(tender.change)}</strong></div>`:''}`;}
async function loadHistory(){try{const d=await api('/sales');state.sales=d.sales;renderHistory()}catch(e){toast(e.message,'error');$('historyRows').innerHTML='<tr><td colspan="7" class="rf-empty">Unable to load sales history.</td></tr>'}}
function renderHistory(){const q=$('historySearch').value.toLowerCase();const sales=state.sales.filter(s=>(state.saleFilter==='All'||s.status===state.saleFilter)&&(`${s.receipt_no} ${s.customer_name||''}`.toLowerCase().includes(q)));$('historyRows').innerHTML=sales.map(s=>`<tr><td>${esc(s.receipt_no)}</td><td>${date(s.sale_date)}</td><td>${esc(s.customer_name||'Walk-in')}</td><td>${money(s.total_amount)}</td><td>${esc(s.payment_method)}</td><td><span class="rf-chip ${s.status==='Unfinished'?'warning':s.status==='Voided'?'danger':''}">${esc(s.status)}</span></td><td>${s.status==='Unfinished'?`<button type="button" class="btn btn-link btn-sm rf-link" data-resume="${s.sale_id}">Resume</button>`:s.status==='Completed'?`<button type="button" class="btn btn-link btn-sm rf-link" data-receipt="${s.sale_id}">Receipt</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="rf-empty">No matching sales.</td></tr>'}
async function openSale(id,mode){try{const d=await api('/sales/'+id);if(mode==='receipt'){renderReceipt(d.sale);showStep(3);return;}state.cart=d.sale.items.map(i=>({id:i.product_id,code:i.item_code,name:i.product_name,qty:i.quantity,price:num(i.unit_price),available:Math.max(i.quantity,Number(i.available_qty||0))}));state.draftId=d.sale.sale_id;$('discountType').value=d.sale.discount_type||'None';$('customerName').value=d.sale.customer_name||'';$('discountId').value=d.sale.discount_id_no||'';renderCart();showStep(0)}catch(e){toast(e.message,'error')}}
document.addEventListener('DOMContentLoaded',async()=>{ModuleShared.commonNav('sales');try{await ModuleShared.session()}catch{return} $('productRows').addEventListener('click',e=>{const retry=e.target.closest('[data-retry-products]');if(retry){loadProducts();return;}const b=e.target.closest('[data-add]');if(!b||b.disabled)return;addProduct(b.dataset.add)});
$('cartItems').addEventListener('click',e=>{const b=e.target.closest('[data-qty],[data-remove]');if(!b)return;const index=Number(b.dataset.qty??b.dataset.remove);if(b.dataset.remove!==undefined)state.cart.splice(index,1);else{const i=state.cart[index];const q=i.qty+Number(b.dataset.change);if(q>i.available)return toast('Not enough available stock.','error');if(q<1)state.cart.splice(index,1);else i.qty=q}renderCart()});
$('searchProductsBtn').onclick=loadProducts;$('productSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadProducts()});$('saveDraftBtn').onclick=saveDraft;$('voidDraftBtn').onclick=voidDraft;$('toDiscountBtn').onclick=()=>{if(!state.cart.length)return toast('Add items to the cart first.','error');renderDiscount();showStep(1)};$('backToCartBtn').onclick=()=>showStep(0);$('discountType').onchange=renderDiscount;$('toPaymentBtn').onclick=()=>{try{validateDiscount();renderPayment();showStep(2)}catch(e){toast(e.message,'error')}};$('cashReceived').oninput=updateChange;document.querySelectorAll('input[name="paymentMethod"]').forEach(i=>i.onchange=updateMethod);$('backToDiscountBtn').onclick=()=>showStep(1);$('confirmPaymentBtn').onclick=checkout;$('newSaleBtn').onclick=startNewSale;$('receiptNewSaleBtn').onclick=startNewSale;$('printReceiptBtn').onclick=()=>window.print();$('salesHistoryBtn').onclick=async()=>{$('checkoutView').classList.add('rf-hidden');$('historyView').classList.remove('rf-hidden');await loadHistory()};$('closeHistoryBtn').onclick=()=>showStep(0);$('saleFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.saleFilter=b.dataset.filter;$('saleFilters').querySelectorAll('button').forEach(btn=>btn.classList.toggle('active',btn===b));renderHistory()};$('historySearch').oninput=renderHistory;$('historyRows').onclick=e=>{const b=e.target.closest('[data-resume],[data-receipt]');if(b)openSale(Number(b.dataset.resume??b.dataset.receipt),b.dataset.receipt?'receipt':'resume')};
try{const d=await api('/config');state.discountRate=d.approved_discount_rate==null?null:Number(d.approved_discount_rate)}catch(e){toast(e.message,'error')}await loadProducts();renderCart();showStep(0);});
})();
