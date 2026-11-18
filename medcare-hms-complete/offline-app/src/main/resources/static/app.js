const $=s=>document.querySelector(s),F=['name','dob','blood','phone','status','notes'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,rows=[],log=[],forced=false,busy=false;

// ---- IndexedDB: the local copy that works with no network ----
const opn=()=>new Promise((ok,no)=>{const r=indexedDB.open('ward-notes',1);r.onupgradeneeded=()=>r.result.createObjectStore('p',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const tx=(m,fn)=>new Promise((ok,no)=>{const t=db.transaction('p',m),r=fn(t.objectStore('p'));t.oncomplete=()=>ok(r.result);t.onerror=()=>no(t.error)});
const getAll=()=>tx('readonly',s=>s.getAll()),put=r=>tx('readwrite',s=>s.put(r));
const pick=r=>Object.fromEntries(F.map(f=>[f,r[f]??'']));
const store=(r,dirty=false)=>put({...r,...pick(r),base:pick(r),dirty}); // base = last server copy, used for field-level merge

// ---- UI ----
function badge(on){$('#st').textContent=on?'● Online':'● Offline';$('#strip').className=on?'on':'off'}
async function refresh(){
  rows=await getAll();const q=$('#q').value.toLowerCase();
  const vis=rows.filter(r=>!r.deleted&&(r.name+' '+r.phone).toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  $('#tb').innerHTML=vis.map(r=>`<tr><td>${esc(r.name)}${r.dirty?'<span class="tag">pending</span>':''}</td><td>${esc(r.dob)}</td><td>${esc(r.blood)}</td><td>${esc(r.phone)}</td><td>${esc(r.status)}</td><td><button data-e="${r.id}">Edit</button> <button data-d="${r.id}">Delete</button></td></tr>`).join('')||'<tr><td colspan="6">No patients yet. Add the first one.</td></tr>';
  $('#pend').textContent=rows.filter(r=>r.dirty).length+' pending';
  $('#log').innerHTML=log.map(l=>`<li>${esc(l)}</li>`).join('')||'<li>None. Edits from other devices merge automatically.</li>';
}

// ---- Sync: push local changes, pull everyone else's ----
async function ping(){if(forced)return false;try{return(await fetch('/api/health',{cache:'no-store'})).ok}catch{return false}}
async function sync(){
  if(busy)return;busy=true;
  try{
    const on=await ping();badge(on);if(!on)return;
    const cur=await getAll();
    const changes=cur.filter(r=>r.dirty).map(r=>{const b=r.base||{},fields={};F.forEach(f=>{if((r[f]??'')!==(b[f]??''))fields[f]=r[f]});return{id:r.id,base:b,fields,deleted:!!r.deleted,clientTime:r.editedAt||Date.now()}});
    const res=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes,since:+localStorage.cursor||0})});
    if(!res.ok)throw new Error('sync failed');
    const d=await res.json(),sent=new Set(d.results.map(x=>x.id)),local=new Map(cur.map(r=>[r.id,r]));
    for(const x of d.results){await store(x.record);for(const c of x.conflicts)log.unshift(`${x.record.name}, ${c.field}: you wrote "${c.yours??''}", another device wrote "${c.theirs??''}". Kept ${c.kept==='yours'?'yours':'theirs'}.`)}
    for(const u of d.updates){const l=local.get(u.id);if(!(l&&l.dirty&&!sent.has(u.id)))await store(u)}
    localStorage.cursor=d.cursor;
  }catch(e){badge(false)}finally{busy=false;await refresh()}
}
const regBg=async()=>{try{await(await navigator.serviceWorker.ready).sync.register('sync-patients')}catch{}};

// ---- Events ----
$('#add').onclick=()=>{const f=$('#f');f.reset();f.elements.pid.value='';$('#dlg').showModal()};
$('#f').onsubmit=async e=>{
  const f=e.target;if(e.submitter&&e.submitter.value==='cancel')return;
  const v=Object.fromEntries(F.map(k=>[k,f.elements[k].value.trim()])),old=rows.find(r=>r.id===f.elements.pid.value);
  await put({...(old||{id:crypto.randomUUID(),base:{},rev:0}),...v,dirty:true,deleted:false,editedAt:Date.now()});
  await refresh();sync();regBg();
};
$('#tb').onclick=async e=>{
  const t=e.target,id=t.dataset.e||t.dataset.d;if(!id)return;const r=rows.find(x=>x.id===id);
  if(t.dataset.e){const f=$('#f');f.elements.pid.value=id;F.forEach(k=>f.elements[k].value=r[k]??'');$('#dlg').showModal()}
  else if(confirm('Delete '+r.name+'?')){await put({...r,deleted:true,dirty:true,editedAt:Date.now()});await refresh();sync();regBg()}
};
$('#q').oninput=refresh;$('#sync').onclick=sync;
$('#off').onchange=e=>{forced=e.target.checked;sync()};

(async()=>{
  db=await opn();await refresh();
  if('serviceWorker' in navigator){await navigator.serviceWorker.register('/sw.js');navigator.serviceWorker.onmessage=()=>sync()}
  addEventListener('online',sync);addEventListener('offline',()=>badge(false));
  setInterval(sync,10000);sync();
})();
