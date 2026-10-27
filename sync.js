/* ===== Daylog shared core: helpers, local storage, GitHub sync =====
   Loaded by daylog.html and category.html.
   Data lives in the repo at data/daylog.json and is read/written through the GitHub API. */

const DL_VER='v5';
/* ----- helpers ----- */
const $=s=>document.querySelector(s), pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const hm=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseD=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const tmin=t=>{const[a,b]=t.split(':').map(Number);return a*60+b};
const fmt=m=>m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock=ms=>{const s=Math.max(0,Math.floor(ms/1000));return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`};
const catUrl=n=>'category.html?c='+encodeURIComponent(n);

/* other open tabs of this site (same device) share the same local data, so tell them to redraw */
const BC=window.BroadcastChannel?new BroadcastChannel('daylog'):null;
const tabs=()=>{try{BC&&BC.postMessage(1)}catch(e){}};

/* ----- local storage: IndexedDB for entries (works offline), localStorage for small things ----- */
let db;
const openDB=()=>new Promise((res,rej)=>{const r=indexedDB.open('daylog',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('entries',{keyPath:'id'});
  r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)});
const tx=(mode,f)=>new Promise((res,rej)=>{const t=db.transaction('entries',mode);const o=f(t.objectStore('entries'));
  t.oncomplete=()=>res(o&&o.result);t.onerror=()=>rej(t.error)});
const dbAllRaw=()=>tx('readonly',s=>s.getAll());                 // includes deleted markers (needed for sync)
const dbAll=async()=>(await dbAllRaw()).filter(e=>!e.del);
const dbPutNewer=l=>new Promise((res,rej)=>{let n=0;const t=db.transaction('entries','readwrite'),s=t.objectStore('entries'); // read+write in ONE transaction so a local edit made meanwhile is never overwritten
  l.forEach(e=>{const g=s.get(e.id);g.onsuccess=()=>{const o=g.result;if(!o||(e.u||0)>(o.u||0)){s.put(e);n++}}});
  t.oncomplete=()=>res(n>0);t.onerror=()=>rej(t.error)});
const dbPutRaw=l=>tx('readwrite',s=>{l.forEach(e=>s.put(e))});    // sync writes keep their own timestamps
const dbPut=e=>{const r=dbPutRaw([{...e,u:Date.now()}]);Sync.kick();tabs();return r};
const dbPutMany=l=>{const n=Date.now();const r=dbPutRaw(l.map(e=>({...e,u:n})));Sync.kick();tabs();return r};
const dbDel=id=>{const r=dbPutRaw([{id,del:true,u:Date.now()}]);Sync.kick();tabs();return r}; // marker, so deletes sync too

const PALETTE=['#2F6FED','#8B5CF6','#16A34A','#F59E0B','#E11D8F','#06B6D4','#EA580C','#64748B'];
let cats=JSON.parse(localStorage.getItem('dl-cats')||'null')||{Work:'#2F6FED',Study:'#8B5CF6',Health:'#16A34A',Personal:'#F59E0B',Other:'#64748B'};
let catDel=JSON.parse(localStorage.getItem('dl-catdel')||'{}'); // {name:{u,gone}}: remembers renamed/removed names so they don't come back from other devices
const saveCatDel=()=>localStorage.setItem('dl-catdel',JSON.stringify(catDel));
const col=n=>cats[n]||'#64748B';
const saveCats=()=>localStorage.setItem('dl-cats',JSON.stringify(cats));
function addCategory(name){
  name=(name||'').trim();if(!name)return'';
  if(!cats[name]){cats[name]=PALETTE[Object.keys(cats).length%8];saveCats();if(catDel[name]){catDel[name]={u:Date.now(),gone:false};saveCatDel()}Sync.kick()}
  return name;
}
/* Rename a category everywhere: its entries, a running timer, its colour. Returns an error string or ''. */
async function renameCategory(old,nw){
  nw=(nw||'').trim();
  if(!nw||nw===old)return'';
  Sync.touch(); // tells any sync running right now that local data changed, so it must not overwrite this rename
  if(cats[nw])return`A category named "${nw}" already exists.`;
  const now=Date.now(),list=(await dbAllRaw()).filter(e=>!e.del&&e.cat===old).map(e=>({...e,cat:nw,u:now}));
  if(list.length)await dbPutRaw(list);
  cats[nw]=cats[old]||PALETTE[Object.keys(cats).length%8];delete cats[old];saveCats();
  catDel[old]={u:now,gone:true};catDel[nw]={u:now,gone:false};saveCatDel();
  const r=activeRun();if(r&&r.cat===old)localStorage.setItem('dl-run',JSON.stringify({...r,cat:nw,u:now}));
  if(localStorage.getItem('dl-lastcat')===old)localStorage.setItem('dl-lastcat',nw);
  Sync.kick();tabs();return'';
}
/* The running timer is one shared record: {id,title,cat,t0,u} or {none:true,u} */
const getRun=()=>{try{return JSON.parse(localStorage.getItem('dl-run')||'null')}catch(e){return null}};
const setRun=r=>{localStorage.setItem('dl-run',JSON.stringify(r));Sync.kick()};
const activeRun=()=>{const r=getRun();return r&&!r.none&&r.t0?r:null};

/* ----- one-link device setup: open  .../daylog/#token=github_pat_xxx  once on a device ----- */
(()=>{const m=location.hash.match(/^#token=([^&]+)/);if(!m)return;
  let o={};try{o=JSON.parse(localStorage.getItem('dl-sync')||'{}')}catch(e){}
  o.token=decodeURIComponent(m[1]).trim();localStorage.setItem('dl-sync',JSON.stringify(o));
  history.replaceState(null,'',location.pathname+location.search)})();

/* ----- GitHub sync ----- */
const Sync=(()=>{
  let rev=0,etag=null,sha=null,remote=null,busy=false,again=false,kt=null,pt=null,st='off',msg='',last=0,pause=0;
  const dataL=[],statL=[];

  const cfg=()=>{
    let s={};try{s=JSON.parse(localStorage.getItem('dl-sync')||'{}')}catch(e){}
    const m=location.hostname.match(/^([^.]+)\.github\.io$/);
    return{owner:s.owner||(m?m[1]:''),repo:s.repo||(m?(location.pathname.split('/')[1]||''):''),
      branch:s.branch||'',path:s.path||'data/daylog.json',token:(s.token||'').trim()};
  };
  const save=o=>{localStorage.setItem('dl-sync',JSON.stringify(o));etag=null;sha=null;remote=null;pause=0;last=0};
  const set=(s,m)=>{st=s;msg=m||'';statL.forEach(f=>f(st,msg))};

  const b64d=b=>new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g,'')),c=>c.charCodeAt(0)));
  const b64e=s=>{const u=new TextEncoder().encode(s);let o='';for(let i=0;i<u.length;i+=8192)o+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(o)};
  const url=c=>`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  const hdr=(c,x)=>({Accept:'application/vnd.github+json',...(c.token?{Authorization:'Bearer '+c.token}:{}),...x});
  const fail=(r,what)=>{
    const e=new Error(r.status===401?'GitHub rejected the token. Make a new one.':
      r.status===403?(r.headers.get('x-ratelimit-remaining')==='0'?(pause=(+r.headers.get('x-ratelimit-reset')||0)*1000||Date.now()+36e5,'GitHub rate limit reached. Paste your access token (a token raises the limit from 60 to 5000 per hour). Retrying after '+new Date(pause).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.'):'Token lacks permission. It needs Contents: Read and write on this repo.'):
      r.status===404?'Repo or file not found (check owner and repo name, and that the token covers this repo).':
      r.status===409||r.status===422?'conflict':`GitHub error ${r.status}`);
    e.status=r.status;return e;
  };

  /* normalise so identical data always serialises identically (prevents sync loops) */
  const nEnt=e=>e.del?{id:e.id,del:true,u:e.u||0}:{id:e.id,title:e.title,date:e.date,start:e.start,end:e.end,mins:e.mins,cat:e.cat,u:e.u||0};
  const nRun=r=>!r?null:r.none?{none:true,u:r.u||0}:{id:r.id,title:r.title||'',cat:r.cat||'Other',t0:r.t0,u:r.u||0};
  const empty=()=>({entries:[],cats:{},catDel:{},run:null});
  const ser=d=>{
    const es=[...d.entries].map(nEnt).sort((a,b)=>a.id<b.id?-1:1);
    const cs=Object.fromEntries(Object.entries(d.cats).sort(([a],[b])=>a<b?-1:1));
    return '{\n"v":1,\n"cats":'+JSON.stringify(cs)+',\n"catDel":'+JSON.stringify(Object.fromEntries(Object.entries(d.catDel||{}).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>[k,{u:v.u||0,gone:!!v.gone}])))+',\n"run":'+JSON.stringify(nRun(d.run))+',\n"entries":[\n'+es.map(e=>JSON.stringify(e)).join(',\n')+'\n]\n}\n';
  };
  function parse(t){
    if(!t.trim())return empty();
    let j;try{j=JSON.parse(t)}catch(e){throw new Error('data/daylog.json is not valid JSON. Sync stopped so nothing gets overwritten.')}
    return{entries:Array.isArray(j.entries)?j.entries:[],cats:j.cats&&typeof j.cats==='object'?j.cats:{},catDel:j.catDel&&typeof j.catDel==='object'?j.catDel:{},run:j.run||null};
  }
  /* newest timestamp wins; on a tie the remote copy wins, so every device converges */
  function merge(a,b){
    const m=new Map();
    a.entries.forEach(e=>m.set(e.id,e));
    b.entries.forEach(e=>{const o=m.get(e.id);if(!o||(e.u||0)>(o.u||0))m.set(e.id,e)});
    const run=!a.run?b.run:!b.run?a.run:((b.run.u||0)>(a.run.u||0)?b.run:a.run);
    const cd={...(a.catDel||{})};
    Object.entries(b.catDel||{}).forEach(([k,v])=>{if(!cd[k]||(v.u||0)>(cd[k].u||0))cd[k]=v});
    const cs={};Object.entries({...b.cats,...a.cats}).forEach(([k,v])=>{if(!(cd[k]&&cd[k].gone))cs[k]=v});
    return{entries:[...m.values()],cats:cs,catDel:cd,run};
  }

  async function pull(c){
    const q=c.branch?'?ref='+encodeURIComponent(c.branch):'';
    const r=await fetch(url(c)+q,{headers:hdr(c,etag?{'If-None-Match':etag}:{}),cache:'no-store'});
    if(r.status===304)return{same:true};
    if(r.status===404){etag=null;sha=null;return{doc:empty()}}
    if(!r.ok)throw fail(r);
    const j=await r.json();etag=r.headers.get('ETag');sha=j.sha;
    let t=j.content?b64d(j.content):'';
    if(!j.content){const r2=await fetch(url(c)+q,{headers:hdr(c,{Accept:'application/vnd.github.raw+json'}),cache:'no-store'});if(!r2.ok)throw fail(r2);t=await r2.text()}
    return{doc:parse(t)};
  }
  async function push(c,doc){
    const body={message:'Daylog sync '+new Date().toISOString().slice(0,16).replace('T',' '),content:b64e(ser(doc))};
    if(sha)body.sha=sha;if(c.branch)body.branch=c.branch;
    const r=await fetch(url(c),{method:'PUT',headers:hdr(c,{'Content-Type':'application/json'}),body:JSON.stringify(body)});
    if(r.status===409||r.status===422)return false;
    if(!r.ok)throw fail(r);
    sha=(await r.json()).content.sha;etag=null;return true;
  }
  /* write merged remote data into the local stores, never overwriting something newer made meanwhile */
  async function apply(m,r0){
    let changed=false;
    const w=m.entries.map(nEnt);
    if(w.length&&await dbPutNewer(w))changed=true;
    if(rev!==r0)return changed; // you edited something while this sync ran: skip categories/timer now, the next pass redoes them
    if(JSON.stringify(m.catDel)!==JSON.stringify(catDel)){catDel=m.catDel;saveCatDel();}
    if(JSON.stringify(Object.entries(m.cats).sort())!==JSON.stringify(Object.entries(cats).sort())){
      Object.keys(cats).forEach(k=>{if(!(k in m.cats))delete cats[k]});Object.assign(cats,m.cats);saveCats();changed=true}
    const lr=getRun();
    if(m.run&&(!lr||(m.run.u||0)>(lr.u||0))){localStorage.setItem('dl-run',JSON.stringify(nRun(m.run)));changed=true}
    return changed;
  }
  async function localDoc(){return{entries:await dbAllRaw(),cats:{...cats},catDel:{...catDel},run:getRun()}}

  async function run(force){
    const c=cfg();
    if(!c.owner||!c.repo){set('off','Sync is not set up.');return}
    if(!navigator.onLine){set('err','Offline. Changes are kept on this device and sync later.');return}
    if(force!==true){ // background polls: never hammer GitHub
      if(Date.now()<pause)return;
      if(!c.token&&Date.now()-last<60000)return; // no token = 60 requests/hour, so check once a minute at most
    }
    if(busy){again=true;return}
    last=Date.now();
    busy=true;set('busy');let changed=false;
    try{
      for(let i=0;i<4;i++){
        const r0=rev;
        const f=await pull(c);
        if(!f.same)remote=f.doc;
        const local=await localDoc();
        if(rev!==r0)continue; // local edit during the download: start over with fresh data
        const merged=merge(remote||empty(),local);
        if(await apply(merged,r0))changed=true;
        if(rev!==r0)continue;
        if(c.token&&ser(merged)!==ser(remote||empty())){
          if(await push(c,merged)){remote=merged;break}
          etag=null;continue; // someone else saved first: pull again and retry
        }
        break;
      }
      set(c.token?'ok':'ro',c.token?'':'Read-only. Add a GitHub token to save from this device.');
    }catch(e){set('err',e.message||String(e))}
    finally{busy=false;if(changed){dataL.forEach(f=>f());tabs()}if(again){again=false;run()}}
  }
  const kick=()=>{rev++;clearTimeout(kt);kt=setTimeout(()=>run(true),900)};
  function start(ms){
    run(true);clearInterval(pt);pt=setInterval(()=>{if(document.visibilityState==='visible')run()},ms||6000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')run()});
    addEventListener('online',()=>run(true));
  }
  if(BC)BC.onmessage=()=>dataL.forEach(f=>f());
  return{cfg,save,kick,touch:()=>{rev++},start,run:()=>run(true),on:f=>dataL.push(f),onStatus:f=>{statL.push(f);f(st,msg)},state:()=>({st,msg})};
})();
