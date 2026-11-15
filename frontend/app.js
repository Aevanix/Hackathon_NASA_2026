import { MODULES, MODULES_BY_ID } from './modules/catalog.js';
import { drawLaunch, drawLiveTelemetry, drawMissionAccess } from './modules/operations.js';

const savedDataMode=localStorage.getItem('astra.dataMode');
const ASTRA = { token: localStorage.getItem('astra.access') || '', refresh: localStorage.getItem('astra.refresh') || '', dataMode: savedDataMode==='mission'?'connected':['connected','simulation','research'].includes(savedDataMode)?savedDataMode:'simulation', user: null };
const state = { page: 'missions', selectedId: '', selectedMission: localStorage.getItem('astra.mission')||'', selectedSensorId: '', dashboard: null, profile: null, alerts: [], history: [], trends: null, environmental: [], equipment: [], sentinel: null, conversations: [], messages: [], conversationId: '', wellness: [], radiation: [], simulations: [], model: null, system: null, offline: false, feedStatus: 'connected', sensorFeeds: {}, pending: 0, chartMetric: 'heartRate', historyWindow: '24', historyFrom: '', historyTo: '', periodDays: 7, toastTimer: null };
const initialRoute = new URLSearchParams(location.search);
state.liveMonitor = initialRoute.get('view') === 'live';
state.liveRequestedAstronaut = initialRoute.get('astronaut') || '';
state.liveAccessDenied = false;
state.missions = [];
state.alertStatus = '';
state.launchPhase = '';
state.launchTimer = null;
if (state.liveMonitor) { state.page = 'health'; if (state.liveRequestedAstronaut) state.selectedId = state.liveRequestedAstronaut; }
const nav = MODULES.map((module) => [module.id, module.icon, module.label, module.group]);
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials = (name='Astra User') => name.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('');
const roleName = (role) => ({admin:'Mission administrator',medical_officer:'Medical officer',astronaut:'Astronaut'}[role]||role||'');
const niceDate = (value, options={month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) => value ? new Date(value).toLocaleString(undefined,options) : '—';
const niceNumber = (value,digits=1) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
const roleAllowsStaff = () => ['admin','medical_officer'].includes(ASTRA.user?.role);
const visibleCrew = () => {const crew=state.dashboard?.crew||[];return state.selectedMission?crew.filter(item=>item.missionId===state.selectedMission):crew;};
const selectedCrew = () => visibleCrew().find(item=>item.id===state.selectedId) || visibleCrew()[0] || null;
const apiCacheKey = (path) => `api:${ASTRA.dataMode}:${path}`;

let idbPromise;
function openIDB(){
  if(!('indexedDB' in window)) return Promise.resolve(null);
  if(!idbPromise) idbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('astra-local-v1',1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('cache'))db.createObjectStore('cache');if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'clientId'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return idbPromise;
}
async function idbGet(store,key){try{const db=await openIDB();if(!db)return null;return await new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);});}catch{return null;}}
async function idbPut(store,key,value){try{const db=await openIDB();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');if(store==='queue')tx.objectStore(store).put(value);else tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function idbDelete(store,key){try{const db=await openIDB();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
async function idbAll(store){try{const db=await openIDB();if(!db)return[];return await new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}catch{return[];}}
async function countQueue(){state.pending=(await idbAll('queue')).length;const el=$('[data-pending]');if(el)el.textContent=String(state.pending);}
async function cacheResult(path,data){await idbPut('cache',apiCacheKey(path),{data,savedAt:new Date().toISOString()});}
async function api(path,options={}){
  const method=options.method||'GET';const headers={'Content-Type':'application/json','X-ASTRA-DATA-MODE':ASTRA.dataMode,...(ASTRA.token?{Authorization:`Bearer ${ASTRA.token}`}:{})};
  try{
    let response=await fetch(path,{method,headers,body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(response.status===401&&ASTRA.refresh&&path!=='/api/auth/refresh'){
      const refreshed=await fetch('/api/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:ASTRA.refresh}),signal:AbortSignal.timeout(10000)});
      if(refreshed.ok){const session=await refreshed.json();setSession(session);headers.Authorization=`Bearer ${ASTRA.token}`;response=await fetch(path,{method,headers,body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',signal:AbortSignal.timeout(10000)});}
    }
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||`Request failed (${response.status}).`),{status:response.status,code:data.code});
    state.offline=false;
    if(method==='GET')await cacheResult(path,data);
    countQueue();return data;
  }catch(error){
    const networkFailure=error instanceof TypeError||!navigator.onLine;
    if(method==='GET'&&networkFailure){const cached=await idbGet('cache',apiCacheKey(path));if(cached){state.offline=true;return cached.data;}}
    if(options.queue&&method==='POST'&&networkFailure){const clientId=crypto.randomUUID(),item={clientId,type:options.queue,payload:options.body,createdAt:new Date().toISOString()};await idbPut('queue',clientId,item);state.offline=true;await countQueue();return {queued:true,clientId,offline:true};}
    throw error;
  }
}
function setSession(session){ASTRA.token=session.accessToken||ASTRA.token;ASTRA.refresh=session.refreshToken||ASTRA.refresh;ASTRA.user=session.user||ASTRA.user;localStorage.setItem('astra.access',ASTRA.token);localStorage.setItem('astra.refresh',ASTRA.refresh);}
function setDataMode(mode){ASTRA.dataMode=['connected','simulation','research'].includes(mode)?mode:mode==='mission'?'connected':'simulation';localStorage.setItem('astra.dataMode',ASTRA.dataMode);}
function clearSession(){ASTRA.token='';ASTRA.refresh='';ASTRA.user=null;localStorage.removeItem('astra.access');localStorage.removeItem('astra.refresh');}
function toast(message,type=''){const area=$('.toast-region');if(!area)return;const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;area.append(item);setTimeout(()=>item.remove(),3600);}
function badge(risk='NORMAL') {const cls=risk.includes('CRITICAL')?'critical':risk==='WARNING'?'warning':risk==='OBSERVATION'?'observation':'normal';return `<span class="badge ${cls}">${esc(risk)}</span>`;}
function stampChip(reading){if(!reading)return '<span class="badge stale">No data</span>';const stale=Date.now()-new Date(reading.recordedAt).getTime()>15*60_000;return `<span class="source-chip"><i class="status-dot ${stale?'amber':''}"></i>${stale?'STALE':'FRESH'} · ${reading.simulated?'SIMULATED':'RECORDED'}</span>`;}
function missionDay(crew=selectedCrew()){if(!crew?.missionStartDate)return 'MISSION DATE UNSET';const start=Date.parse(`${String(crew.missionStartDate).slice(0,10)}T00:00:00Z`);if(!Number.isFinite(start))return 'MISSION DATE UNSET';const day=Math.floor((Date.now()-start)/86400000)+1;return day>0?`${crew.missionDesignation} · FLIGHT DAY ${day}`:`${crew.missionDesignation} · PREFLIGHT`;}
const dataModeLabel=()=>({connected:'CONNECTED RECORDS',simulation:'SIMULATION DEMO',research:'RESEARCH DATASET'})[ASTRA.dataMode]||'SIMULATION DEMO';
function layout(){
  const groups={};for(const [id,icon,label,group] of nav){if(id==='health'&&!ASTRA.user?.astronautId&&ASTRA.user?.role==='astronaut')continue;if(ASTRA.user?.role==='astronaut'&&['crew','records','simulation','data','admin'].includes(id))continue;if(ASTRA.user?.role==='medical_officer'&&['admin'].includes(id))continue;(groups[group]||= []).push([id,icon,label]);}
  const links=Object.entries(groups).map(([group,items])=>`<div class="nav-group">${group}</div>${items.map(([id,icon,label])=>`<button class="nav-link ${state.page===id?'active':''}" data-page="${id}" title="${label}"><span class="nav-ico" aria-hidden="true">${icon}</span><span class="nav-text">${label}</span>${MODULES_BY_ID[id]?.state==='scaffold'?'<span class="muted" aria-label="planned data integration">·</span>':''}</button>`).join('')}`).join('');
  const title=nav.find(row=>row[0]===state.page)?.[2]||'Mission overview';
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">A</div><div class="brand-copy"><div class="brand-name">ASTRA</div><div class="brand-sub">MISSION HEALTH SYSTEM</div></div></div><nav>${links}</nav><div class="sidebar-foot"><div class="prototype-label">Prototype · imported records or labeled simulation<br>Not a certified medical device</div></div></aside><div class="main"><header class="topbar"><div class="top-left"><button class="mobile-menu" data-action="menu" aria-label="Toggle nav