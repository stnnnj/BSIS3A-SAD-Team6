/* CCMC RetailFlow owner module UI. No mock records: all rows come from Flask. */
(() => {
'use strict';
const module = document.body.dataset.module;
const root = document.getElementById('moduleRoot');
const notice = document.getElementById('notice');
const newBtn = document.getElementById('newBtn');
const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('recordModal'));
const form = document.getElementById('recordForm');
let rows = [], products = [], cart = [], editId = null;
const fields = {
 products:[['item_code','Item Code','text',true],['product_name','Product Name','text',true],['barcode','Barcode','text'],['brand','Brand','text'],['size','Size','text'],['color','Color','text'],['category_id','Category ID','number',true],['supplier_id','Supplier ID','number',true],['selling_price','Selling Price','number',true],['cost_price','Cost Price','number',true],['min_stock_level','Minimum Stock Level','number']],
 suppliers:[['supplier_name','Supplier Name','text',true],['contact_no','Contact Number','text']],
 reservations:[['customer_name','Customer Name','text',true],['contact_no','Contact Number','text'],['expiry_date','Expiry Date','date',true],['down_payment','Down Payment','number',true],['payment_method','Payment Method','select:Cash|GCash',true],['fulfillment','Fulfillment','text'],['product_id','Product ID','number',true],['quantity','Quantity','number',true]],
 returns:[['sale_item_id','Original Sale Item ID','number',true],['quantity','Return Quantity','number',true],['refund_amount','Refund Amount','number',true],['customer_name','Customer Name','text'],['reason','Reason','text'],['restock','Return to Stock','checkbox']],
 inventory:[['product_id','Product ID','number',true],['quantity','Stock Change (+ In / - Out)','number',true],['remarks','Reason / Remarks','text']],
 sales:[['customer_name','Customer Name','text'],['payment_method','Payment Method','select:Cash|GCash',true],['discount_type','Discount Type','select:None|Senior|PWD'],['discount_id_no','Discount ID Number','text'],['discount_amount','Discount Amount (₱)','number'],['product_id','Product ID','number',true],['quantity','Quantity','number',true]]
};
const titles={dashboard:'Dashboard',sales:'Sales / POS',reservations:'Reservations',returns:'Returns & Refunds',inventory:'Inventory',products:'Products',suppliers:'Suppliers',financial:'Financial Analytics',reports:'Reports',users:'User Accounts'};
const money=v=>'₱'+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,method='GET',body)=>{
 const response=await fetch('/api/owner/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.status===401){location.href='/frontend/index.html';throw Error('Session expired.');}
 const result=await response.json().catch(()=>({message:'Unexpected server response.'}));
 if(!response.ok||result.success===false)throw Error(result.message||'Request failed.');return result;
};
function alertMsg(message,ok=false){notice.innerHTML=`<div class="alert alert-${ok?'success':'danger'} alert-dismissible fade show">${esc(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;}
function table(data,cols,actions=false){if(!data.length)return '<div class="surface p-5 text-center text-secondary">No records yet. Add a record or check the database connection.</div>';
 return `<div class="surface p-3"><div class="d-flex gap-2 justify-content-between align-items-center mb-3 flex-wrap"><strong>${data.length} records</strong><input class="form-control search-box" id="tableSearch" placeholder="Search records…" aria-label="Search records"></div><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>${cols.map(c=>`<th>${esc(c[1])}</th>`).join('')}${actions?'<th>Action</th>':''}</tr></thead><tbody>${data.map((r,i)=>`<tr>${cols.map(([k])=>`<td>${esc(k.includes('price')||k.includes('amount')||k.includes('cost')||k==='total_sales'||k==='estimated_profit'?money(r[k]):r[k])}</td>`).join('')}${actions?`<td><button class="btn btn-sm btn-outline-primary edit-row" data-row="${i}">Edit</button></td>`:''}</tr>`).join('')}</tbody></table></div></div>`;
}
function wireTable(){document.getElementById('tableSearch')?.addEventListener('input',e=>{const term=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(term));});document.querySelectorAll('.edit-row').forEach(btn=>btn.addEventListener('click',()=>openForm(rows[Number(btn.dataset.row)])));}
function cards(stats){const defs=[['Sales Today',money(stats.sales_today)],['Completed Sales',stats.sales_count],['Total Products',stats.products],['Low Stock Items',stats.low_stock],['Active Reservations',stats.reservations],['Recorded Returns',stats.returns]];return `<div class="row g-3 mb-4">${defs.map(([label,value])=>`<div class="col-sm-6 col-xl-4"><div class="surface stat-card"><div class="stat-label">${label}</div><div class="stat-number">${esc(value)}</div></div></div>`).join('')}</div>`;}
const columns={sales:[['receipt_no','Receipt'],['sale_date','Date'],['customer_name','Customer'],['payment_method','Payment'],['total_amount','Total'],['status','Status']],reservations:[['order_id','Order ID'],['customer_name','Customer'],['contact_no','Contact'],['expiry_date','Expiry'],['down_payment','Down Payment'],['status','Status']],returns:[['return_id','Return ID'],['original_receipt_no','Receipt'],['product_name','Product'],['quantity','Qty'],['refund_amount','Refund'],['return_date','Date']],inventory:[['product_id','ID'],['item_code','Item Code'],['product_name','Product'],['category_name','Category'],['current_qty','On Hand'],['min_stock_level','Min. Stock']],products:[['product_id','ID'],['item_code','Item Code'],['product_name','Product'],['brand','Brand'],['selling_price','Price'],['current_qty','Stock']],suppliers:[['supplier_id','ID'],['supplier_name','Supplier'],['contact_no','Contact']],financial:[['period','Date'],['sales_count','Sales'],['gross_sales','Gross Sales'],['cost','Cost'],['estimated_profit','Estimated Profit*']],reports:[['period','Date'],['sales_count','Sales'],['total_sales','Sales Total']],users:[['user_id','ID'],['name','Name'],['username','Username'],['role','Role'],['is_active','Active']]};
async function load(){notice.innerHTML='';root.innerHTML='<div class="surface p-4">Loading live records…</div>';try{
 if(module==='dashboard'){const r=await api('dashboard');root.innerHTML=cards(r.stats)+'<h5 class="fw-bold mb-3">Recent Transactions</h5>'+table(r.recent,columns.sales);wireTable();return;}
 const r=await api(module);rows=r.rows;
 root.innerHTML=(module==='financial'?'<p class="text-secondary small">* Estimated profit excludes returns, operating expenses, and some discounts; use for reference only.</p>':'')+table(rows,columns[module],['products','suppliers','users'].includes(module));wireTable();
 if(module==='inventory')root.insertAdjacentHTML('beforeend','<div class="mt-3"><button class="btn btn-outline-primary" id="showLog">View Inventory Transactions</button><div id="logArea" class="mt-3"></div></div>');
 document.getElementById('showLog')?.addEventListener('click',async()=>{try{const x=await api('inventory-log');document.getElementById('logArea').innerHTML=table(x.rows,[['txn_date','Date'],['product_name','Product'],['txn_type','Type'],['quantity','Quantity'],['remarks','Remarks']]);}catch(e){alertMsg(e.message)}});
 if(module==='sales'){const x=await api('products');products=x.rows;root.insertAdjacentHTML('afterbegin','<p class="text-secondary">Select “New Sale” to create a checkout. Sales and stock are committed together.</p>');}
 }catch(e){root.innerHTML='<div class="surface p-4 text-secondary">No live data available. Check your Flask server and TiDB connection.</div>';alertMsg(e.message);}}
function formMarkup(def,record){return `<div class="row g-3">${def.map(([key,label,type,required])=>`<div class="col-md-6"><label class="form-label" for="f_${key}">${esc(label)}</label>${type.startsWith('select:')?`<select class="form-select" name="${key}" id="f_${key}" ${required?'required':''}>${type.slice(7).split('|').map(o=>`<option value="${esc(o)}" ${record?.[key]===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:type==='checkbox'?`<div><input class="form-check-input" type="checkbox" name="${key}" id="f_${key}"></div>`:`<input class="form-control" id="f_${key}" name="${key}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(record?.[key]??'')}" ${required?'required':''}>`}</div>`).join('')}</div>`;}
function openForm(record=null){editId=record?(record.product_id||record.supplier_id||record.user_id):null;const def=module==='users'?[['name','Name','text'],['role','Role','select:Owner|Staff'],['is_active','Active','select:1|0']]:fields[module];if(!def)return;
 document.getElementById('modalTitle').textContent=(record?'Edit ':'New ')+titles[module];document.getElementById('formFields').innerHTML=formMarkup(def,record);
 if(module==='sales'&&!record)document.getElementById('formFields').insertAdjacentHTML('beforeend','<p class="small text-secondary mt-3">One product per checkout in this quick-entry form. The backend supports multiple cart items.</p>');modal.show();}
form.addEventListener('submit',async e=>{e.preventDefault();const btn=document.getElementById('saveBtn');const data=Object.fromEntries(new FormData(form).entries());if(module==='returns')data.restock=document.getElementById('f_restock').checked;
 try{btn.disabled=true;btn.textContent='Saving…';let path=module,method=editId?'PATCH':'POST';
 if(editId)path+='/'+editId;
 else if(module==='inventory')path+='/adjust';
 else if(module==='sales'){path+='/checkout';data.items=[{product_id:data.product_id,quantity:data.quantity}];delete data.product_id;delete data.quantity;}
 else if(module==='reservations'){path+='/create';data.items=[{product_id:data.product_id,quantity:data.quantity}];delete data.product_id;delete data.quantity;}
 else if(module==='returns')path+='/create';
 const result=await api(path,method,data);modal.hide();await load();alertMsg(result.receipt_no?`Sale completed. Receipt ${result.receipt_no} · ${money(result.total)}`:'Record saved successfully.',true);
 }catch(err){alertMsg(err.message)}finally{btn.disabled=false;btn.textContent='Save';}});
newBtn.hidden=!fields[module];newBtn.textContent=({sales:'+ New Sale',inventory:'+ Adjust Stock',returns:'+ Record Return',reservations:'+ New Reservation',products:'+ Add Product',suppliers:'+ Add Supplier'})[module]||'+ New Record';
newBtn.addEventListener('click',()=>openForm());document.getElementById('refreshBtn').addEventListener('click',load);
document.getElementById('logoutBtn').addEventListener('click',async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});location.href='/frontend/index.html';}catch(e){alertMsg('Logout failed. Please retry.')}});
load();
})();
