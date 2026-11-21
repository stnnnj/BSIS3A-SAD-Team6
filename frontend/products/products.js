"use strict";
// Each module owns its own JS. Shared dashboard CSS supplies all sidebar styling.
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = value => Number(value).toLocaleString('en-PH');
function notice(message, type='success') {
    $('notice').replaceChildren();
    if (!message) return;
    const box=document.createElement('div'); box.className=`alert alert-${type} mb-0`; box.textContent=message; $('notice').append(box);
}
async function api(path, method='GET', body) {
    const opts={method,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
    if (body !== undefined) {opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
    const response=await fetch(path,opts);
    if(response.status===401){location.replace('/frontend/index.html');throw new Error('Please sign in.');}
    if(response.status===403){throw new Error('Access denied. Owner access required.');}
    const data=await response.json().catch(()=>null);
    if(!response.ok || !data?.success) throw new Error(data?.message || `Request failed (${response.status}).`);
    return data;
}
async function authorize(){
    const data=await api('/api/auth/me');
    if(data.user?.role!=='Owner'){location.replace('/frontend/staff-dashboard.html');return false;}
    return true;
}
async function logout(){
    $('logoutBtn').disabled=true;
    try{await api('/api/auth/logout','POST');location.replace('/frontend/index.html');}
    catch(e){notice(e.message,'danger');$('logoutBtn').disabled=false;}
}
function formData(form){return Object.fromEntries(new FormData(form));}
function modal(id){return bootstrap.Modal.getOrCreateInstance($(id));}
function busy(button, action){
    if(button.disabled)return;
    button.disabled=true;
    return Promise.resolve().then(action).finally(()=>{button.disabled=false;});
}
function emptyTable(n,message){$('dataTable').innerHTML=`<tr><td colspan="${n}" class="rf-empty">${escapeHtml(message)}</td></tr>`;}
const URL='/api/owner/products';
const peso=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
let products=[],categories=[],suppliers=[],editing=null,ready=false,loading=false;
function options(id,items,key,label,placeholder){
    const el=$(id),old=el.value;
    el.replaceChildren(new Option(placeholder,''),...items.map(x=>new Option(x[label],String(x[key]))));
    if([...el.options].some(x=>x.value===old))el.value=old;
}
function render(){
    const q=$('searchInput').value.trim().toLowerCase(), cat=$('categoryFilter').value, sup=$('supplierFilter').value;
    const rows=products.filter(p=>[p.product_name,p.item_code,p.barcode,p.brand,p.size,p.color].some(v=>String(v??'').toLowerCase().includes(q))&&(!cat||String(p.category_id)===cat)&&(!sup||String(p.supplier_id)===sup));
    $('resultCount').textContent=`${rows.length} of ${products.length} products`;
    if(!rows.length){emptyTable(9,'No matching products found.');return;}
    $('dataTable').innerHTML=rows.map(p=>`<tr><td><div class="rf-mono">${escapeHtml(p.item_code)}</div><div class="rf-item-sub">${escapeHtml(p.barcode||'—')}</div></td><td><div class="rf-item-name">${escapeHtml(p.product_name)}</div><div class="rf-item-sub">${escapeHtml([p.brand,p.size,p.color].filter(Boolean).join(' · ')||'—')}</div></td><td>${escapeHtml(p.category_name)}</td><td>${escapeHtml(p.supplier_name)}</td><td>${peso.format(p.selling_price)}</td><td>${peso.format(p.cost_price)}</td><td><span class="rf-pill ${Number(p.current_qty)===0?'out':Number(p.current_qty)<=Number(p.min_stock_level)?'low':'ok'}">${count(p.current_qty)}</span></td><td>${count(p.min_stock_level)}</td><td><div class="rf-actions"><button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${Number(p.product_id)}">Edit</button><button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${Number(p.product_id)}" ${Number(p.current_qty)!==0?'disabled':''}>Delete</button></div></td></tr>`).join('');
}
async function load(){
    if(loading)return false;loading=true;$('refreshBtn').disabled=true;
    try{
        const d=await api(URL);products=d.products;categories=d.categories;suppliers=d.suppliers;
        options('categoryFilter',categories,'category_id','category_name','All categories'); options('supplierFilter',suppliers,'supplier_id','supplier_name','All suppliers');
        options('category_id',categories,'category_id','category_name','Select category');options('supplier_id',suppliers,'supplier_id','supplier_name','Select supplier');
        $('statProducts').textContent=count(products.length);$('statCategories').textContent=count(categories.length);$('statSuppliers').textContent=count(suppliers.length);$('statUnits').textContent=count(products.reduce((n,p)=>n+Number(p.current_qty),0));
        ready=true;render();return true;
    }catch(e){ready=false;notice(e.message,'danger');emptyTable(9,'Unable to load products. Refresh to retry.');$('resultCount').textContent='Unavailable';for(const id of ['statProducts','statCategories','statSuppliers','statUnits'])$(id).textContent='—';return false;}
    finally{loading=false;$('refreshBtn').disabled=false;}
}
function openProduct(p=null){
    if(!ready){notice('Product data has not loaded. Please check your connection and click Refresh.','warning');return;}
    if(!categories.length||!suppliers.length){notice('Add at least one category and supplier before creating products.','warning');return;}
    editing=p?.product_id??null;$('productModalForm').reset();$('productModalError').textContent='';$('productModalTitle').textContent=p?'Edit Product':'Add Product';
    if(p)for(const key of ['product_name','item_code','category_id','supplier_id','barcode','brand','size','color','min_stock_level','selling_price','cost_price'])$(key).value=p[key]??'';
    modal('productModal').show();
}
async function saveProduct(e){
    e.preventDefault();await busy($('productModalSave'),async()=>{try{const d=await api(editing===null?URL:`${URL}/${editing}`,editing===null?'POST':'PUT',formData(e.target));modal('productModal').hide();notice(d.message);await load();}catch(err){$('productModalError').textContent=err.message;}});
}
async function saveCategory(e){
    e.preventDefault();await busy($('categoryModalSave'),async()=>{try{const d=await api(`${URL}/categories`,'POST',formData(e.target));modal('categoryModal').hide();notice(d.message);await load();}catch(err){$('categoryModalError').textContent=err.message;}});
}
async function rowAction(e){
    const b=e.target.closest('button[data-action]');if(!b)return;
    const p=products.find(x=>String(x.product_id)===b.dataset.id);if(!p)return;
    if(b.dataset.action==='edit'){openProduct(p);return;}
    if(!window.confirm(`Delete unused product ${p.product_name}? Products with stock or transaction history cannot be deleted.`))return;
    await busy(b,async()=>{try{const d=await api(`${URL}/${p.product_id}`,'DELETE',{});notice(d.message);await load();}catch(err){notice(err.message,'danger');}});
}
document.addEventListener('DOMContentLoaded',async()=>{
    $('logoutBtn').addEventListener('click',logout);
    try{if(!await authorize())return;}catch(e){notice(e.message,'danger');return;}
    $('refreshBtn').addEventListener('click',()=>{notice('');load();});$('addBtn').addEventListener('click',()=>openProduct());
    $('addCategoryBtn').addEventListener('click',()=>{$('categoryModalForm').reset();$('categoryModalError').textContent='';modal('categoryModal').show();});
    $('productModalForm').addEventListener('submit',saveProduct);$('categoryModalForm').addEventListener('submit',saveCategory);
    $('dataTable').addEventListener('click',rowAction);for(const id of ['searchInput','categoryFilter','supplierFilter'])$(id).addEventListener('input',()=>{if(ready)render();});
    await load();
});