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
(()=>{'use strict';
const $=id=>document.getElementById(id),{api,money,escape:esc,date,toast}=ModuleShared;
const state={products:[],cart:[],reservations:[],filter:'All',selected:null,saving:false};const num=v=>Math.round((Number(v)||0)*100)/100;
const dateOnly=v=>v?String(v).slice(0,10):'—';
const total=()=>num(state.cart.reduce((s,i)=>s+i.price*i.qty,0));
// Never interpret an invalid amount as zero: 0 is valid only when explicitly entered.
const parseDeposit=value=>{
 const raw=String(value??'').trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
 const amount=Number(raw);
 return Number.isFinite(amount)&&amount<=99999999.99?Math.round(amount*100)/100:null;
};
const deposit=()=>parseDeposit($('resDeposit').value);
function depositError(){
 const raw=$('resDeposit').value.trim();
 if(!raw)return 'Enter a down payment amount. Use 0 for no deposit.';
 const amount=deposit();
 if(amount===null)return 'Enter a valid peso amount (no negatives, letters, or more than 2 decimal places).';
 if(amount>total())return 'Down payment cannot exceed the order total of '+money(total())+'.';
 return '';
}
function syncDepositUI(){
 const error=depositError(),amount=deposit();
 const input=$('resDeposit');
 input.classList.toggle('is-invalid',Boolean(error));
 input.setAttribute('aria-invalid',String(Boolean(error)));
 $('resDepositError').textContent=error;
 $('resDepositError').hidden=!error;
 $('resDepositDisplay').textContent=error?'—':'−'+money(amount);
 $('resBalance').textContent=error?'—':money(Math.max(0,num(total()-amount)));
 $('resSaveBtn').disabled=Boolean(error)||state.saving;
 return error;
}
function show(view){['reservationListView','reservationCreateView','reservationDetailsView'].forEach(id=>$(id).classList.toggle('rf-hidden',id!==view));scrollTo({top:0,behavior:'smooth'})}
function renderProducts(){ $('resProductRows').innerHTML=state.products.map(p=>`<tr><td>${esc(p.product_name)}<div class="rf-muted">${esc(p.item_code)}</div></td><td>${p.available_qty}</td><td>${money(p.selling_price)}</td><td><button data-add="${p.product_id}" class="btn btn-sm btn-outline-primary" ${p.available_qty<1?'disabled':''}>Add</button></td></tr>`).join('')||'<tr><td colspan="4" class="rf-empty">No matching products</td></tr>'}
async function loadProducts(){try{const d=await api('/products?q='+encodeURIComponent($('resProductSearch').value.trim()));state.products=d.products;renderProducts()}catch(e){toast(e.message,'error');$('resProductRows').innerHTML='<tr><td colspan="4" class="rf-empty">Unable to load products.</td></tr>'}}
function renderCart(){ $('resCartItems').innerHTML=state.cart.map((i,j)=>`<div class="d-flex justify-content-between align-items-center border-bottom py-2 gap-2"><div><strong>${esc(i.name)}</strong><div class="rf-muted">${money(i.price)} each</div><div class="rf-stepper mt-2"><button type="button" class="btn btn-sm btn-outline-secondary rf-qty-btn" data-qty="${j}" data-change="-1">−</button><output>${i.qty}</output><button type="button" class="btn btn-sm btn-outline-secondary rf-qty-btn" data-qty="${j}" data-change="1">+</button><button type="button" class="btn btn-link btn-sm rf-link ms-2" data-remove="${j}">Remove</button></div></div><strong>${money(i.qty*i.price)}</strong></div>`).join('')||'<p class="rf-empty">No reserved items yet.</p>';$('resOrderTotal').textContent=money(total());syncDepositUI();}
function newReservation(){state.cart=[];$('resCustomer').value='';$('resContact').value='';$('resDeposit').value='0';$('resDepositMethod').value='Cash';$('resDepositRef').value='';let d=new Date(Date.now()+2*86400000);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());$('resExpiry').value=d.toISOString().slice(0,10);$('resDepositRefBox').classList.add('rf-hidden');renderCart();show('reservationCreateView');loadProducts()}
function updateDep(){renderCart();$('resDepositRefBox').classList.toggle('rf-hidden',$('resDepositMethod').value!=='GCash')}
// A review is a snapshot of the validated form; changes cannot sneak in during submission.
let pendingReservation=null;
let saveReviewSubmitting=false;
function closeSaveReview(){
 if(saveReviewSubmitting)return;
 $('resSaveReviewModal').classList.add('rf-hidden');
 $('resSaveReviewModal').setAttribute('aria-hidden','true');
 document.body.classList.remove('rf-save-open');
 pendingReservation=null;
 $('resSaveReviewVerified').checked=false;
 $('resSaveBtn').focus();
}
function updateSaveReviewButton(){
 $('resSaveReviewSubmit').disabled=saveReviewSubmitting||!pendingReservation||(pendingReservation.down_payment>0&&!$('resSaveReviewVerified').checked);
}
function save(){
 if(state.saving||saveReviewSubmitting||pendingReservation)return;
 try{
  if(!state.cart.length)throw Error('Select at least one item.');
  if(!$('resCustomer').value.trim())throw Error('Customer name is required.');
  if(!$('resExpiry').value)throw Error('Choose the reservation expiration.');
  const error=syncDepositUI();
  if(error){$('resDeposit').focus();throw Error(error)}
  const amount=deposit(),method=$('resDepositMethod').value;
  if(method==='GCash'&&amount>0&&!$('resDepositRef').value.trim())throw Error('Enter the verified GCash deposit reference.');
  const cart=state.cart.map(i=>({product_id:i.id,quantity:i.qty,name:i.name,price:i.price}));
  pendingReservation={customer_name:$('resCustomer').value.trim(),contact_no:$('resContact').value.trim(),expiry_date:$('resExpiry').value,
   items:cart.map(({product_id,quantity})=>({product_id,quantity})),down_payment:amount,deposit_confirmed:amount>0,
   payment_method:method,gcash_reference:method==='GCash'?$('resDepositRef').value.trim():null};
  $('resSaveReviewCustomer').textContent=pendingReservation.customer_name;
  $('resSaveReviewExpiry').textContent=dateOnly(pendingReservation.expiry_date);
  $('resSaveReviewItemCount').textContent=String(cart.reduce((s,i)=>s+i.quantity,0))+' unit(s)';
  $('resSaveReviewMethod').textContent=method;
  $('resSaveReviewItems').replaceChildren(...cart.map(i=>{
   const row=document.createElement('div'),item=document.createElement('span'),cost=document.createElement('strong');
   item.textContent=i.quantity+' × '+i.name;cost.textContent=money(i.quantity*i.price);
   row.append(item,cost);return row;
  }));
  const sum=total();
  $('resSaveReviewTotal').textContent=money(sum);
  $('resSaveReviewDeposit').textContent='−'+money(amount);
  $('resSaveReviewBalance').textContent=money(num(sum-amount));
  $('resSaveReviewVerified').checked=false;
  $('resSaveReviewVerifyRow').hidden=amount===0;
  $('resSaveReviewNotice').textContent=amount>0
   ? 'The system does not collect payment. Verify the '+method+' deposit yourself before confirming. Only the amount and payment method are stored; a GCash reference is not saved. Inventory is held, not deducted.'
   : 'No deposit is being collected. Saving reserves the items (soft hold) without deducting on-hand inventory.';
  $('resSaveReviewError').hidden=true;
  updateSaveReviewButton();
  $('resSaveReviewModal').classList.remove('rf-hidden');
  $('resSaveReviewModal').setAttribute('aria-hidden','false');
  document.body.classList.add('rf-save-open');
  if(amount>0)$('resSaveReviewVerified').focus();else $('resSaveReviewSubmit').focus();
 }catch(e){toast(e.message,'error')}
}
async function completeSaveReview(){
 if(!pendingReservation||saveReviewSubmitting)return;
 if(pendingReservation.down_payment>0&&!$('resSaveReviewVerified').checked)return;
 const payload=JSON.stringify(pendingReservation);
 saveReviewSubmitting=true;state.saving=true;
 $('resSaveReviewError').hidden=true;
 $('resSaveReviewSubmit').textContent='Saving reservation…';
 $('resSaveReviewClose').disabled=true;
 $('resSaveReviewBack').disabled=true;
 $('resSaveReviewVerified').disabled=true;
 updateSaveReviewButton();syncDepositUI();
 try{
  const result=await api('/reservations',{method:'POST',body:payload});
  saveReviewSubmitting=false;
  closeSaveReview();
  toast('Reservation saved. Inventory hold created; on-hand unchanged.');
  await openReservation(result.order_id);
 }catch(e){
  $('resSaveReviewError').textContent=e.message;
  $('resSaveReviewError').hidden=false;
 }finally{
  saveReviewSubmitting=false;state.saving=false;
  $('resSaveReviewSubmit').textContent='Confirm & save reservation';
  $('resSaveReviewClose').disabled=false;
  $('resSaveReviewBack').disabled=false;
  $('resSaveReviewVerified').disabled=false;
  updateSaveReviewButton();syncDepositUI();
 }
}
async function loadReservations(){try{const d=await api('/reservations');state.reservations=d.reservations;renderReservations()}catch(e){toast(e.message,'error');$('reservationRows').innerHTML='<tr><td colspan="8" class="rf-empty">Unable to load reservations.</td></tr>'}}
function chip(status){return status==='Pending'?'warning':status==='Cancelled'?'danger':status==='Expired'?'neutral':''}
function renderReservations(){const q=$('reservationSearch').value.toLowerCase();const list=state.reservations.filter(r=>(state.filter==='All'||r.status===state.filter)&&(`${r.reference} ${r.customer_name} ${r.contact_no||''}`.toLowerCase().includes(q)));$('reservationRows').innerHTML=list.map(r=>`<tr><td><strong>${esc(r.reference)}</strong><div class="rf-muted">${esc(r.customer_name)}</div></td><td>${esc(r.contact_no||'—')}</td><td>${dateOnly(r.expiry_date)}</td><td>${money(r.total_amount)}</td><td>${money(r.down_payment)}</td><td>${money(r.balance_due)}</td><td><span class="rf-chip ${chip(r.status)}">${esc(r.status)}</span></td><td><button data-detail="${r.order_id}" class="btn btn-link btn-sm rf-link">Details</button></td></tr>`).join('')||'<tr><td colspan="8" class="rf-empty">No matching reservations.</td></tr>'}
async function openReservation(id){try{const d=await api('/reservations/'+id);state.selected=d.reservation;renderDetails();show('reservationDetailsView')}catch(e){toast(e.message,'error')}}
function balanceMethod(){return document.querySelector('input[name="resBalanceMethod"]:checked').value}
function updateBalanceMethod(){const cash=balanceMethod()==='Cash';$('resBalanceCashBox').classList.toggle('rf-hidden',!cash);$('resBalanceGCashBox').classList.toggle('rf-hidden',cash)}
function renderDetails(){const r=state.selected;$('resDetailTitle').textContent=r.reference+' · '+r.customer_name;$('resDetailMeta').textContent=(r.contact_no||'No contact')+' · Created '+date(r.order_date);$('resDetailStatus').textContent=r.status;$('resDetailStatus').className='rf-chip '+chip(r.status);$('resDetailItems').innerHTML=r.items.map(i=>`<tr><td>${esc(i.product_name)}</td><td>${i.quantity}</td><td>${money(i.unit_price)}</td><td>${money(i.quantity*i.unit_price)}</td></tr>`).join('');$('resDetailExpiry').textContent=dateOnly(r.expiry_date);$('resDetailTotal').textContent=money(r.total_amount);$('resDetailDeposit').textContent='−'+money(r.down_payment);$('resDetailBalance').textContent=money(r.balance_due);$('resDetailBanner').textContent=r.status==='Pending'?'Reservation saved · Awaiting balance. Reserved quantities are held, not deducted from on-hand inventory.':r.status==='Converted'?'Reservation converted to a completed sale. The deposit was applied once and stock was deducted once.':r.status==='Cancelled'?'Reservation cancelled. Its stock hold was released.':'Reservation expired. Its stock hold is no longer active.';
$('resConvertPanel').classList.toggle('rf-hidden',r.status!=='Pending');$('resCancelPanel').classList.toggle('rf-hidden',r.status!=='Pending');$('resConvertedReceipt').classList.toggle('rf-hidden',r.status!=='Converted');$('resBalanceCash').value=r.balance_due.toFixed(2);$('resBalanceRef').value='';$('resCancelReason').value='';$('resVerified').checked=false;$('resRefundConfirmed').checked=false;updateBalanceMethod();updateChange();if(r.status==='Converted'){$('resConvertedReceipt').innerHTML=`<h3 class="mb-2">Completed sale</h3><p class="rf-muted">Receipt: ${esc(r.sale_receipt||'See Sales history')}</p><div class="rf-summary-row"><span>Remaining balance</span><strong>${money(0)}</strong></div>`}}
function updateChange(){if(!state.selected)return;$('resBalanceChange').textContent=money(Math.max(0,num($('resBalanceCash').value)-Number(state.selected.balance_due)))}
// Preserve the exact reviewed payment details until final confirmation; do not charge money here.
let pendingConversion=null;
let conversionSubmitting=false;
function closeConvertReview(){
 if(conversionSubmitting)return;
 $('resConvertReviewModal').classList.add('rf-hidden');
 $('resConvertReviewModal').setAttribute('aria-hidden','true');
 document.body.classList.remove('rf-convert-open');
 pendingConversion=null;
 $('resConvertReviewVerified').checked=false;
 $('resConvertReviewSubmit').disabled=true;
 $('resConvertBtn').focus();
}
function updateConvertReviewButton(){
 $('resConvertReviewSubmit').disabled=conversionSubmitting||!pendingConversion||!$('resConvertReviewVerified').checked;
}
function convert(){
 if(conversionSubmitting||pendingConversion)return;
 const r=state.selected;
 try{
  if(!r||r.status!=='Pending')throw Error('Only a pending reservation can be converted.');
  const method=balanceMethod();
  const balance=Number(r.balance_due);
  if(!Number.isFinite(balance)||balance<0)throw Error('Invalid remaining balance. Refresh the reservation.');
  let cash=null,reference=null;
  if(method==='Cash'){
   const input=$('resBalanceCash').value.trim();
   if(!/^\d+(?:\.\d{1,2})?$/.test(input))throw Error('Enter a valid cash received amount (up to 2 decimal places).');
   cash=Number(input);
   if(!Number.isFinite(cash)||cash<balance)throw Error('Cash received must cover remaining balance.');
  }else if(method==='GCash'){
   reference=$('resBalanceRef').value.trim();
   if(balance>0&&!reference)throw Error('Enter the verified GCash transaction reference.');
  }else throw Error('Choose Cash or GCash.');
  pendingConversion={order_id:r.order_id,reference:r.reference,customer_name:r.customer_name,
   item_count:r.items.reduce((sum,item)=>sum+Number(item.quantity||0),0),total_amount:Number(r.total_amount),
   down_payment:Number(r.down_payment),balance_due:balance,method,cash_received:cash,gcash_reference:reference};
  const review=pendingConversion;
  $('resConvertReviewReference').textContent=review.reference;
  $('resConvertReviewCustomer').textContent=review.customer_name;
  $('resConvertReviewItems').textContent=review.item_count+' unit(s)';
  $('resConvertReviewTotal').textContent=money(review.total_amount);
  $('resConvertReviewDeposit').textContent='−'+money(review.down_payment);
  $('resConvertReviewBalance').textContent=money(review.balance_due);
  $('resConvertReviewMethod').textContent=review.method;
  const isCash=review.method==='Cash';
  $('resConvertReviewCashRow').hidden=!isCash;
  $('resConvertReviewChangeRow').hidden=!isCash;
  $('resConvertReviewGCashRow').hidden=isCash;
  $('resConvertReviewCash').textContent=isCash?money(review.cash_received):'';
  $('resConvertReviewChange').textContent=isCash?money(Math.max(0,num(review.cash_received-review.balance_due))):'';
  $('resConvertReviewGCash').textContent=!isCash?(review.gcash_reference||'No remaining balance'):'';
  $('resConvertReviewVerifyText').textContent=review.balance_due>0
   ? 'I confirm the remaining '+review.method+' payment has already been received or independently verified.'
   : 'I confirm that this reservation is fully paid and ready to be completed as a sale.';
  $('resConvertReviewVerified').checked=false;
  $('resConvertReviewError').hidden=true;
  updateConvertReviewButton();
  $('resConvertReviewModal').classList.remove('rf-hidden');
  $('resConvertReviewModal').setAttribute('aria-hidden','false');
  document.body.classList.add('rf-convert-open');
  $('resConvertReviewVerified').focus();
 }catch(e){toast(e.message,'error')}
}
async function completeConversion(){
 if(!pendingConversion||conversionSubmitting||!$('resConvertReviewVerified').checked)return;
 const review=pendingConversion;
 conversionSubmitting=true;
 $('resConvertBtn').disabled=true;
 $('resConvertReviewClose').disabled=true;
 $('resConvertReviewBack').disabled=true;
 $('resConvertReviewVerified').disabled=true;
 $('resConvertReviewSubmit').textContent='Completing sale…';
 $('resConvertReviewError').hidden=true;
 updateConvertReviewButton();
 let converted=false;
 try{
  const result=await api('/reservations/'+review.order_id+'/convert',{
   method:'POST',body:JSON.stringify({payment_method:review.method,cash_received:review.cash_received,gcash_reference:review.gcash_reference})
  });
  converted=true;
  conversionSubmitting=false;
  closeConvertReview();
  toast('Reservation converted. Receipt '+result.receipt_no+'.');
  try{await openReservation(review.order_id)}catch{ /* openReservation handles the notification */ }
 }catch(e){
  if(!converted){$('resConvertReviewError').textContent=e.message;$('resConvertReviewError').hidden=false;}
 }finally{
  conversionSubmitting=false;
  $('resConvertBtn').disabled=false;
  $('resConvertReviewClose').disabled=false;
  $('resConvertReviewBack').disabled=false;
  $('resConvertReviewVerified').disabled=false;
  $('resConvertReviewSubmit').textContent='Confirm & complete sale';
  updateConvertReviewButton();
 }
}

// Review form data before committing a cancellation; no refund is performed here.
let pendingCancellation=null;
let cancellationSaving=false;
function closeCancelModal(){
 if(cancellationSaving)return;
 const modal=$('resCancelModal');
 modal.classList.add('rf-hidden');modal.setAttribute('aria-hidden','true');
 document.body.classList.remove('rf-cancel-open');
 pendingCancellation=null;$('resConfirmCancel').focus();
}
function cancel(){
 const r=state.selected;
 try{
  if(!r||r.status!=='Pending')throw Error('Only a pending reservation can be cancelled.');
  const reason=$('resCancelReason').value.trim();
  if(!reason)throw Error('Enter the reason for cancellation.');
  if(!$('resVerified').checked)throw Error('Verify customer identity and deposit first.');
  if(Number(r.down_payment)>0&&!$('resRefundConfirmed').checked)throw Error('Confirm the deposit refund was completed outside this system first.');
  pendingCancellation={order_id:r.order_id,reference:r.reference,reason,refund_method:$('resRefundMethod').value,refund_confirmed:Number(r.down_payment)>0};
  $('resCancelModalReference').textContent=r.reference;
  $('resCancelModalCustomer').textContent=r.customer_name;
  $('resCancelModalTotal').textContent=money(r.total_amount);
  $('resCancelModalDeposit').textContent=money(r.down_payment);
  $('resCancelModalRefundMethod').textContent=pendingCancellation.refund_method;
  $('resCancelModalReason').textContent=reason;
  $('resCancelModalError').hidden=true;
  const modal=$('resCancelModal');
  modal.classList.remove('rf-hidden');modal.setAttribute('aria-hidden','false');
  document.body.classList.add('rf-cancel-open');
  $('resCancelModalProceed').focus();
 }catch(e){toast(e.message,'error')}
}
async function completeCancellation(){
 if(!pendingCancellation||cancellationSaving)return;
 const review=pendingCancellation;
 cancellationSaving=true;
 $('resCancelModalProceed').disabled=true;
 $('resCancelModalKeep').disabled=true;
 $('resCancelModalClose').disabled=true;
 $('resConfirmCancel').disabled=true;
 $('resCancelModalProceed').textContent='Cancelling…';
 $('resCancelModalError').hidden=true;
 try{
  await api('/reservations/'+review.order_id+'/cancel',{method:'POST',body:JSON.stringify({reason:review.reason,refund_method:review.refund_method,verified:true,refund_confirmed:review.refund_confirmed})});
  cancellationSaving=false;
  closeCancelModal();
  toast('Reservation cancelled. Stock hold released; refund details were not saved in this schema.');
  await openReservation(review.order_id);
 }catch(e){
  $('resCancelModalError').textContent=e.message;
  $('resCancelModalError').hidden=false;
 }finally{
  cancellationSaving=false;
  $('resCancelModalProceed').disabled=false;
  $('resCancelModalKeep').disabled=false;
  $('resCancelModalClose').disabled=false;
  $('resConfirmCancel').disabled=false;
  $('resCancelModalProceed').textContent='Yes, cancel reservation';
 }
}

document.addEventListener('DOMContentLoaded',async()=>{ModuleShared.commonNav('reservations');try{await ModuleShared.session()}catch{return}
$('viewReservationsBtn').onclick=async()=>{show('reservationListView');await loadReservations()};$('newReservationBtn').onclick=newReservation;$('resCancelCreate').onclick=()=>show('reservationListView');$('resDeposit').oninput=updateDep;$('resDepositMethod').onchange=updateDep;$('resSearchBtn').onclick=loadProducts;$('resProductSearch').onkeydown=e=>{if(e.key==='Enter')loadProducts()};$('resProductRows').onclick=e=>{const btn=e.target.closest('[data-add]');if(!btn)return;const p=state.products.find(v=>v.product_id===Number(btn.dataset.add));const i=state.cart.find(v=>v.id===p.product_id);if(i){if(i.qty>=p.available_qty)return toast('Not enough available stock.','error');i.qty++}else{state.cart.push({id:p.product_id,name:p.product_name,price:num(p.selling_price),qty:1,available:p.available_qty})}renderCart()};$('resCartItems').onclick=e=>{const btn=e.target.closest('[data-qty],[data-remove]');if(!btn)return;const index=Number(btn.dataset.qty??btn.dataset.remove);if(btn.dataset.remove!==undefined)state.cart.splice(index,1);else{const i=state.cart[index],q=i.qty+Number(btn.dataset.change);if(q>i.available)return toast('Not enough available stock.','error');if(q<1)state.cart.splice(index,1);else i.qty=q;}renderCart()};$('resSaveBtn').onclick=save;
$('resSaveReviewVerified').onchange=updateSaveReviewButton;
$('resSaveReviewSubmit').onclick=completeSaveReview;
$('resSaveReviewModal').addEventListener('click',e=>{if(e.target.closest('[data-save-dismiss]'))closeSaveReview()});
document.addEventListener('keydown',e=>{
 const modal=$('resSaveReviewModal');if(modal.classList.contains('rf-hidden'))return;
 if(e.key==='Escape'){e.preventDefault();closeSaveReview();return}
 if(e.key!=='Tab')return;
 const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(x=>x.offsetParent!==null);
 if(!focusable.length)return;
 const first=focusable[0],last=focusable[focusable.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});$('reservationSearch').oninput=renderReservations;$('resFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;$('resFilters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderReservations()};$('reservationRows').onclick=e=>{const b=e.target.closest('[data-detail]');if(b)openReservation(Number(b.dataset.detail))};document.querySelectorAll('input[name="resBalanceMethod"]').forEach(r=>r.onchange=updateBalanceMethod);$('resBalanceCash').oninput=updateChange;$('resConvertBtn').onclick=convert;
$('resConvertReviewVerified').onchange=updateConvertReviewButton;
$('resConvertReviewSubmit').onclick=completeConversion;
$('resConvertReviewModal').addEventListener('click',e=>{if(e.target.closest('[data-convert-close]'))closeConvertReview()});
document.addEventListener('keydown',e=>{
 const modal=$('resConvertReviewModal');if(modal.classList.contains('rf-hidden'))return;
 if(e.key==='Escape'){e.preventDefault();closeConvertReview();return}
 if(e.key!=='Tab')return;
 const focusable=[...modal.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(x=>x.offsetParent!==null);
 if(!focusable.length)return;
 const first=focusable[0],last=focusable[focusable.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
$('resConfirmCancel').onclick=cancel;
$('resCancelModalProceed').onclick=completeCancellation;
$('resCancelModal').addEventListener('click',e=>{if(e.target.closest('[data-cancel-close]'))closeCancelModal()});
document.addEventListener('keydown',e=>{
 const modal=$('resCancelModal');if(modal.classList.contains('rf-hidden'))return;
 if(e.key==='Escape'){e.preventDefault();closeCancelModal();return}
 if(e.key!=='Tab')return;
 const focusable=[...modal.querySelectorAll('button:not(:disabled)')];
 if(!focusable.length)return;
 const first=focusable[0],last=focusable[focusable.length-1];
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
await loadReservations()});
})();


