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
const URL='/api/owner/suppliers';let suppliers=[],editing=null,ready=false,loading=false;
function render(){
    const q=$('searchInput').value.trim().toLowerCase(),f=$('linkFilter').value;
    const rows=suppliers.filter(s=>[s.supplier_name,s.contact_no,s.supplier_id].some(v=>String(v??'').toLowerCase().includes(q))&&(!f||(f==='linked'?Number(s.product_count)>0:Number(s.product_count)===0)));
    $('resultCount').textContent=`${rows.length} of ${suppliers.length} suppliers`;
    if(!rows.length){emptyTable(5,'No matching suppliers found.');return;}
    $('dataTable').innerHTML=rows.map(s=>`<tr><td class="rf-mono">#${Number(s.supplier_id)}</td><td class="rf-item-name">${escapeHtml(s.supplier_name)}</td><td>${escapeHtml(s.contact_no||'—')}</td><td><button class="btn btn-sm btn-outline-secondary" data-action="view" data-id="${Number(s.supplier_id)}">${count(s.product_count)} products</button></td><td><div class="rf-actions"><button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${Number(s.supplier_id)}">Edit</button><button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${Number(s.supplier_id)}" ${Number(s.product_count)>0?'disabled':''}>Delete</button></div></td></tr>`).join('');
}
async function load(){
    if(loading)return false;loading=true;$('refreshBtn').disabled=true;
    try{const d=await api(URL);suppliers=d.suppliers;ready=true;
        $('statSuppliers').textContent=count(suppliers.length);$('statLinked').textContent=count(suppliers.filter(s=>Number(s.product_count)>0).length);$('statProducts').textContent=count(suppliers.reduce((n,s)=>n+Number(s.product_count),0));$('statContacts').textContent=count(suppliers.filter(s=>s.contact_no).length);render();return true;
    }catch(e){ready=false;notice(e.message,'danger');emptyTable(5,'Unable to load suppliers. Refresh to retry.');$('resultCount').textContent='Unavailable';for(const id of ['statSuppliers','statLinked','statProducts','statContacts'])$(id).textContent='—';return false;}
    finally{loading=false;$('refreshBtn').disabled=false;}
}
function openSupplier(s=null){editing=s?.supplier_id??null;$('supplierModalForm').reset();$('supplierModalError').textContent='';$('supplierModalTitle').textContent=s?'Edit Supplier':'Add Supplier';if(s){$('supplier_name').value=s.supplier_name;$('contact_no').value=s.contact_no??'';}modal('supplierModal').show();}
async function save(e){e.preventDefault();await busy($('supplierModalSave'),async()=>{try{const d=await api(editing===null?URL:`${URL}/${editing}`,editing===null?'POST':'PUT',formData(e.target));modal('supplierModal').hide();notice(d.message);await load();}catch(err){$('supplierModalError').textContent=err.message;}});}
async function view(s){
    $('linkedModalTitle').textContent=`Products — ${s.supplier_name}`;$('linkedModalError').textContent='';$('linkedList').textContent='Loading…';modal('linkedModal').show();
    try{const d=await api(`${URL}/${s.supplier_id}/products`);$('linkedList').innerHTML=d.products.length?d.products.map(p=>`<div class="list-group-item px-0"><div class="d-flex justify-content-between gap-2"><strong>${escapeHtml(p.product_name)}</strong><span>${count(p.current_qty)} units</span></div><small class="text-secondary">${escapeHtml(p.item_code)}</small></div>`).join(''):'No products assigned.';}catch(e){$('linkedList').textContent='';$('linkedModalError').textContent=e.message;}
}
async function rowAction(e){const b=e.target.closest('button[data-action]');if(!b)return;const s=suppliers.find(x=>String(x.supplier_id)===b.dataset.id);if(!s)return;if(b.dataset.action==='edit'){openSupplier(s);return;}if(b.dataset.action==='view'){await view(s);return;}if(!window.confirm(`Delete ${s.supplier_name}? Only suppliers without linked products can be deleted.`))return;await busy(b,async()=>{try{const d=await api(`${URL}/${s.supplier_id}`,'DELETE',{});notice(d.message);await load();}catch(err){notice(err.message,'danger');}});}
document.addEventListener('DOMContentLoaded',async()=>{
    $('logoutBtn').addEventListener('click',logout);try{if(!await authorize())return;}catch(e){notice(e.message,'danger');return;}
    $('refreshBtn').addEventListener('click',()=>{notice('');load();});$('addBtn').addEventListener('click',()=>openSupplier());$('supplierModalForm').addEventListener('submit',save);$('dataTable').addEventListener('click',rowAction);for(const id of ['searchInput','linkFilter'])$(id).addEventListener('input',()=>{if(ready)render();});await load();
});