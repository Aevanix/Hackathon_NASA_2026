import { MODULES, MODULES_BY_ID } from './modules/catalog.js?v=4';
import { drawLaunch, drawLiveTelemetry, drawMissionAccess } from './modules/operations.js?v=5';
import { drawIntegrationPanel, drawResearchImportCard, drawResearchInteractive } from './modules/medical-data.js?v=1';

const savedDataMode=localStorage.getItem('astra.dataMode');
const ASTRA = { token: localStorage.getItem('astra.access') || '', refresh: localStorage.getItem('astra.refresh') || '', dataMode: savedDataMode==='mission'?'connected':['connected','simulation','research'].includes(savedDataMode)?savedDataMode:'simulation', user: null };
const state = { page: 'missions', selectedId: '', selectedMission: localStorage.getItem('astra.mission')||'', selectedSensorId: '', selectedTelemetryEquipment: '', dashboard: null, profile: null, alerts: [], history: [], trends: null, environmental: [], equipment: [], sentinel: null, conversations: [], messages: [], conversationId: '', wellness: [], radiation: [], simulations: [], model: null, system: null, offline: false, feedStatus: 'connected', sensorFeeds: {}, pending: 0, chartMetric: 'heartRate', historyWindow: '24', historyFrom: '', historyTo: '', periodDays: 7, toastTimer: null };
const initialRoute = new URLSearchParams(location.search);
state.liveMonitor = initialRoute.get('view') === 'live';
state.liveRequestedAstronaut = initialRoute.get('astronaut') || '';
state.liveAccessDenied = false;
state.missions = [];
state.researchMeasurements = { measurements: [] };
state.researchMetric = '';
state.integrations = [];
state.alertStatus = '';
state.launchPhase = '';
state.launchTimer = null;
if (state.liveMonitor) { state.page = 'health'; if (state.liveRequestedAstronaut) state.selectedId = state.liveRequestedAstronaut; }
const nav = MODULES.map((module) => [module.id, module.icon, module.label, module.group]);
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const initials = (name='Astra User') => name.split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('');
const roleName = (role) => ({admin:'Mission administrator',medical_officer:'Medical officer',astronaut:'Astronaut'}[role]||role||'');
const formatUTC = (value, options={month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) => { const date=new Date(value); return value&&Number.isFinite(date.getTime())?`${new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',...options}).format(date)} UTC`:'—'; };
const niceDate = (value, options={month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) => formatUTC(value,options);
const datetimeLocalUTC = (value=Date.now()) => new Date(value).toISOString().slice(0,16);
const datetimeUTCToISO = (value) => { if(!value)return undefined;const normalized=value.length===16?`${value}:00`:value;const date=new Date(`${normalized}Z`);if(!Number.isFinite(date.getTime()))throw new Error('Enter a valid UTC timestamp.');return date.toISOString(); };
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
function clearSession(){if(socket){const active=socket;socket=null;active.close();}clearTimeout(reconnectTimer);clearTimeout(dataRefreshTimer);liveRefreshQueued=false;ASTRA.token='';ASTRA.refresh='';ASTRA.user=null;localStorage.removeItem('astra.access');localStorage.removeItem('astra.refresh');}
function toast(message,type=''){const area=$('.toast-region');if(!area)return;const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;area.append(item);setTimeout(()=>item.remove(),3600);}
function badge(risk='NORMAL') {const cls=risk.includes('CRITICAL')?'critical':risk==='WARNING'?'warning':risk==='OBSERVATION'?'observation':'normal';return `<span class="badge ${cls}">${esc(risk)}</span>`;}
function stampChip(reading){if(!reading)return '<span class="badge stale">No data</span>';const stale=Date.now()-new Date(reading.recordedAt).getTime()>15*60_000;return `<span class="source-chip"><i class="status-dot ${stale?'amber':''}"></i>${stale?'STALE':'FRESH'} · ${reading.simulated?'SIMULATED':'RECORDED'}</span>`;}
function missionDay(crew=selectedCrew()){if(!crew?.missionStartDate)return 'MISSION DATE UNSET';const start=Date.parse(`${String(crew.missionStartDate).slice(0,10)}T00:00:00Z`);if(!Number.isFinite(start))return 'MISSION DATE UNSET';const day=Math.floor((Date.now()-start)/86400000)+1;return day>0?`${crew.missionDesignation} · FLIGHT DAY ${day}`:`${crew.missionDesignation} · PREFLIGHT`;}
const dataModeLabel=()=>({connected:'CONNECTED RECORDS',simulation:'SIMULATION DEMO',research:'RESEARCH DATASET'})[ASTRA.dataMode]||'SIMULATION DEMO';
function layout(){
  const groups={};for(const [id,icon,label,group] of nav){if(id==='health'&&!ASTRA.user?.astronautId&&ASTRA.user?.role==='astronaut')continue;if(ASTRA.user?.role==='astronaut'&&['crew','records','simulation','data','admin'].includes(id))continue;if(ASTRA.user?.role==='medical_officer'&&['admin'].includes(id))continue;(groups[group]||= []).push([id,icon,label]);}
  const links=Object.entries(groups).map(([group,items])=>`<div class="nav-group">${group}</div>${items.map(([id,icon,label])=>`<button class="nav-link ${state.page===id?'active':''}" data-page="${id}" title="${label}"><span class="nav-ico" aria-hidden="true">${icon}</span><span class="nav-text">${label}</span>${MODULES_BY_ID[id]?.state==='scaffold'?'<span class="muted" aria-label="planned data integration">·</span>':''}</button>`).join('')}`).join('');
  const title=nav.find(row=>row[0]===state.page)?.[2]||'Mission overview';
  const existingApp=$('#app');
  if(existingApp.querySelector('.app-shell')){
    reconcileMarkup(existingApp.querySelector('.sidebar nav'),links);
    existingApp.querySelector('.page-context').textContent=title;
    existingApp.querySelector('.mission-chip').textContent=missionDay();
    const modeControl=existingApp.querySelector('[data-change="data-mode"]');
    if(modeControl&&document.activeElement!==modeControl)modeControl.value=ASTRA.dataMode;
    const banner=existingApp.querySelector('[data-offline-banner]');
    banner.classList.toggle('visible',state.offline);
    banner.querySelector('span').textContent=`Offline mode · showing locally cached ${dataModeLabel().toLowerCase()}. New records are queued on this device.`;
    const pending=banner.querySelector('[data-pending]');if(pending)pending.textContent=state.pending;
    updateStatus();drawPage();return;
  }
  $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><img class="brand-icon" src="/astra-mark.png" alt="" /><div class="brand-copy"><div class="brand-name">ASTRA</div><div class="brand-sub">MISSION HEALTH SYSTEM</div></div></div><nav>${links}</nav><div class="sidebar-foot"><div class="prototype-label">Prototype · imported records or labeled simulation<br>Not a certified medical device</div></div></aside><div class="main"><header class="topbar"><div class="top-left"><button class="mobile-menu" data-action="menu" aria-label="Toggle navigation">☰</button><div class="page-context">${esc(title)}</div><span class="mission-chip">${esc(missionDay())}</span></div><div class="top-actions"><label class="mode-control"><span class="sr-only">Data view</span><select class="select-inline" data-change="data-mode" aria-label="Data view"><option value="simulation" ${ASTRA.dataMode==='simulation'?'selected':''}>Simulation</option><option value="connected" ${ASTRA.dataMode==='connected'?'selected':''}>Connected data</option><option value="research" ${ASTRA.dataMode==='research'?'selected':''}>Research & datasets</option></select></label><span class="status-chip" title="Application connectivity"><i class="status-dot ${state.offline||state.feedStatus!=='connected'?'amber':''}"></i><span data-connectivity>${state.offline?'OFFLINE CACHE':state.feedStatus==='connected'?'APP UPDATES ONLINE':'APP UPDATE CHANNEL OFFLINE'}</span></span><span class="current-user"><span class="avatar">${esc(initials(ASTRA.user?.name))}</span><span class="user-copy"><span class="user-name">${esc(ASTRA.user?.name)}</span><br><span class="user-role">${esc(roleName(ASTRA.user?.role))}</span></span></span><button class="icon-button" data-action="logout" title="Sign out">↗</button></div></header><main class="content"><div class="offline-banner ${state.offline?'visible':''}" data-offline-banner><span>Offline mode · showing locally cached ${esc(dataModeLabel().toLowerCase())}. New records are queued on this device.</span><span><b data-pending>${state.pending}</b> pending</span></div><div id="page-content"></div></main></div><div class="toast-region" aria-live="polite"></div><div id="modal-root"></div></div>`;
  drawPage();
}

function chartSvg(series,options={}){
  const width=options.width||900,height=options.height||360,pad={left:58,right:18,top:22,bottom:48},limit=options.maxPoints||320;
  const valid=value=>value.value!==null&&value.value!==undefined&&value.value!==''&&Number.isFinite(Number(value.value));
  const compact=series.map(item=>{
    const raw=item.values||[],finite=raw.map((value,index)=>({value,sourceIndex:index})).filter(point=>valid(point.value));
    let kept=finite;
    if(finite.length>limit){const bucketSize=Math.ceil(finite.length/(limit/2));kept=[];for(let start=0;start<finite.length;start+=bucketSize){const bucket=finite.slice(start,start+bucketSize);if(!bucket.length)continue;let low=bucket[0],high=bucket[0];for(const point of bucket){if(Number(point.value.value)<Number(low.value.value))low=point;if(Number(point.value.value)>Number(high.value.value))high=point;}kept.push(...(low.sourceIndex===high.sourceIndex?[low]:[low,high].sort((a,b)=>a.sourceIndex-b.sourceIndex)));}}
    const values=kept.map((point,index)=>({...point.value,sourceIndex:point.sourceIndex,breakBefore:index>0&&raw.slice(kept[index-1].sourceIndex+1,point.sourceIndex).some(value=>!valid(value))}));
    return {...item,values,total:Math.max(1,raw.length-1)};
  });
  const all=compact.flatMap(item=>item.values.map(value=>Number(value.value)));
  if(!all.length)return `<div class="empty">No numeric samples are available for this chart.</div>`;
  const sorted=[...all].sort((a,b)=>a-b),quantile=q=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*q))];let min=options.robustScale?quantile(.02):sorted[0],max=options.robustScale?quantile(.98):sorted.at(-1);
  if(min===max){const padValue=Math.max(Math.abs(min)*.06,.5);min-=padValue;max+=padValue;}else{const margin=(max-min)*(options.robustScale ? .24 : .12);min-=margin;max+=margin;}
  const times=compact.flatMap(item=>item.values.map(value=>Date.parse(value.timestamp||'')).filter(Number.isFinite)),minTime=times.length?Math.min(...times):0,maxTime=times.length?Math.max(...times):0;
  const xAt=(value,index,item)=>{const time=Date.parse(value.timestamp||'');if(Number.isFinite(time)&&maxTime>minTime)return pad.left+(time-minTime)*(width-pad.left-pad.right)/(maxTime-minTime);return pad.left+(value.sourceIndex??index)*(width-pad.left-pad.right)/item.total;};
  const yAt=value=>pad.top+(max-Math.min(max,Math.max(min,Number(value))))*(height-pad.top-pad.bottom)/(max-min);
  const lines=Array.from({length:5},(_,i)=>{const y=pad.top+i*(height-pad.top-pad.bottom)/4;return `<line class="chart-grid" x1="${pad.left}" x2="${width-pad.right}" y1="${y}" y2="${y}"/><text class="chart-label" x="2" y="${y+4}">${niceNumber(max-i*(max-min)/4,options.axisDigits??1)}</text>`}).join('');
  const draw=compact.map(item=>{let previous=null;const paths=[];for(const value of item.values){const command=`${!previous||value.breakBefore?'M':'L'} ${xAt(value,0,item).toFixed(1)} ${yAt(value.value).toFixed(1)}`;if(!previous||value.breakBefore)paths.push(command);else paths[paths.length-1]+=` ${command}`;previous=value;}return paths.map(d=>`<path d="${d}" class="${item.className||'line-blue'}" vector-effect="non-scaling-stroke"/>`).join('');}).join('');
  const pointMarkup=compact.map(item=>item.values.map((value,index)=>{const number=Number(value.value),label=`${value.label||'Sample'} · ${niceNumber(number,3)}${value.unit?` ${value.unit}`:''}${value.timestamp?` · ${formatUTC(value.timestamp,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:''}`,action=value.id!=null&&value.action?` data-action="${esc(value.action)}" data-id="${esc(value.id)}" role="button" tabindex="0" aria-label="Inspect ${esc(label)}"`:'',outlier=number<min||number>max;return `<circle class="chart-point${outlier?' chart-point-outlier':''}" cx="${xAt(value,index,item).toFixed(1)}" cy="${yAt(number).toFixed(1)}" r="${outlier?5:4}"${action}><title>${esc(label)}${outlier?' · outside plotted percentile range; value retained':''}</title></circle>`}).join('')).join('');
  const labelValues=compact[0]?.values||[],step=Math.max(1,Math.ceil(labelValues.length/5)),labels=labelValues.map((value,index)=>({value,index})).filter(({index})=>index===0||index===labelValues.length-1||index%step===0).map(({value,index})=>`<text class="chart-label" text-anchor="middle" x="${xAt(value,index,compact[0])}" y="${height-12}">${esc(value.label||'')}</text>`).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(options.ariaLabel||'Health measurement trend chart')}">${lines}${draw}${pointMarkup}${labels}</svg></div>`;
}
function pageHead(kicker,title,desc,actions=''){return `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="head-actions">${actions}</div></div>`;}
function selectCrew(){const crew=visibleCrew();return `<label class="field"><span class="muted">Astronaut</span><select class="select-inline" data-change="crew">${crew.map(c=>`<option value="${esc(c.id)}" ${c.id===state.selectedId?'selected':''}>${esc(c.name)} · ${esc(c.id)}</option>`).join('')}</select></label>`;}
function historyWindowLabel(){return state.historyWindow==='custom'?`${state.historyFrom} to ${state.historyTo}`:({1:'last hour',6:'last 6 hours',24:'last 24 hours',168:'last 7 days',720:'last 30 days'}[state.historyWindow]||'selected range');}
function historyControls(){const options=[['1','Last hour'],['6','Last 6 hours'],['24','Last 24 hours'],['168','Last 7 days'],['720','Last 30 days'],['custom','Custom dates']];return `<div class="history-controls"><label class="field"><span class="muted">History window</span><select class="select-inline" data-change="history-window">${options.map(([value,label])=>`<option value="${value}" ${state.historyWindow===value?'selected':''}>${label}</option>`).join('')}</select></label>${state.historyWindow==='custom'?`<label class="field"><span class="muted">From</span><input class="input" type="date" data-change="history-from" value="${esc(state.historyFrom)}"/></label><label class="field"><span class="muted">To</span><input class="input" type="date" data-change="history-to" value="${esc(state.historyTo)}"/></label><button class="btn small" data-action="history-custom-apply">Apply dates</button>`:''}<button class="btn small ghost" data-action="export-health-csv" ${state.history?.length?'':'disabled'}>Export CSV</button></div>`;}
function stat(label,value,meta,accent=''){return `<div class="card stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value ${accent}">${esc(value)}</div><div class="stat-meta">${esc(meta)}</div></div>`;}
function miniCrewCard(crew){const r=crew.latest;const risk=crew.activeAlerts? 'WARNING':'NORMAL';return `<article class="card crew-card"><div class="crew-top"><div><h3 class="crew-name">${esc(crew.name)}</h3><div class="crew-id">${esc(crew.id)} · ${esc(crew.missionDesignation)}</div></div>${badge(risk)}</div><div class="crew-vitals"><div class="vital-mini"><div class="vital-value">${niceNumber(r?.heartRate,0)} <small class="muted">bpm</small></div><div class="vital-name">HEART RATE</div></div><div class="vital-mini"><div class="vital-value">${niceNumber(r?.spo2,0)}<small class="muted">%</small></div><div class="vital-name">SpO₂</div></div><div class="vital-mini"><div class="vital-value">${niceNumber(r?.sleepDuration,1)}<small class="muted">h</small></div><div class="vital-name">LAST SLEEP</div></div></div><div class="crew-bottom"><span>${r?`${crew.stale?'Last record':'Recorded'} ${niceDate(r.recordedAt,{hour:'2-digit',minute:'2-digit'})}`:'No records in this data view'}</span><button class="link-button" data-action="open-health" data-id="${esc(crew.id)}">Health record →</button></div></article>`;}
function alertCards(items,limit=20){if(!items?.length)return `<div class="empty">No ${dataModeLabel().toLowerCase()} alerts are available in this view. ${ASTRA.dataMode==='connected'?'Import an authorised device or mission record.':ASTRA.dataMode==='research'?'Import a permitted research dataset or browse its source metadata.':'Run a labeled scenario in the simulation lab to demonstrate review flow.'}</div>`;return `<div class="alert-stack">${items.slice(0,limit).map(a=>`<article class="alert-item"><div class="alert-bar ${a.severity.includes('CRITICAL')?'critical':a.severity==='OBSERVATION'?'observation':''}"></div><div><div class="split"><button class="link-button alert-title" data-action="alert-detail" data-id="${esc(a.id)}">${esc(a.title)} ↗</button>${badge(a.severity)}</div><div class="alert-detail">${esc(a.astronautName||a.astronautId)} · ${esc(a.explanation)}</div><div class="alert-detail">${niceDate(a.createdAt)} · ${esc(a.category)} · ${esc(a.status)} · ${a.simulated?'SIMULATED':esc(a.dataClass||'connected')}</div></div><div class="head-actions">${roleAllowsStaff()&&a.status==='open'?`<button class="btn small" data-action="ack" data-id="${esc(a.id)}">Acknowledge</button>`:''}${roleAllowsStaff()&&a.status!=='resolved'?`<button class="btn small ghost" data-action="resolve" data-id="${esc(a.id)}">Resolve</button>`:''}</div></article>`).join('')}</div>`;}
function drawOverview(){
  const crew=visibleCrew(),alerts=state.dashboard?.openAlerts||[],sample=crew[0]?.latest,environment=state.environmental?.sensors||[],equipment=state.equipment?.equipment||[],observations=state.sentinel?.observations||[],sensorFeed=state.sensorFeeds[selectedCrew()?.id]||'connected';
  const hr=crew.map(c=>({label:c.name.split(' ')[0],value:c.latest?.heartRate}));const spo=crew.map(c=>({label:c.name.split(' ')[0],value:c.latest?.spo2}));
  return `${pageHead('MISSION CONTROL','Mission health overview','Crew status, incoming telemetry and review items for ORBITAL-7.',`<button class="btn" data-action="refresh">↻ Refresh data</button>${roleAllowsStaff()?'<button class="btn primary" data-page="simulation">Open simulation lab</button>':''}`)}
    <div class="grid stats-grid">${stat('CREW MONITORED',crew.length,'Astronauts in your authorised view','stat-accent')}${stat('OPEN ALERTS',alerts.filter(a=>a.status==='open').length,'Awaiting medical review',alerts.some(a=>a.severity.includes('CRITICAL'))?'':'')}${stat('LATEST HEART RATE',sample?`${niceNumber(sample.heartRate,0)} bpm`:'—',sample?niceDate(sample.recordedAt):'No stored telemetry')}${stat('SENSOR FEED',sensorFeed==='disconnected'?'INTERRUPTED':'AVAILABLE',`${dataModeLabel()} · source stream`,sensorFeed==='disconnected'?'':'stat-accent')}</div>
    <div class="grid dashboard-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Crew telemetry · latest readings</h2><div class="card-kicker">Readings are time stamped and labeled by source</div></div><span class="source-chip"><i class="status-dot"></i> ${dataModeLabel()}</span></div><div class="grid crew-grid">${crew.map(miniCrewCard).join('')||'<div class="empty">No astronaut profiles are assigned to this account.</div>'}</div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Health alerts</h2><div class="card-kicker">Review prompts, not diagnoses</div></div><button class="link-button" data-page="alerts">All alerts →</button></div>${alertCards(alerts,4)}</section>
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">Latest crew measurements</h2><div class="card-kicker">Current persisted values by astronaut</div></div><span class="quality">${esc(dataModeLabel())}</span></div>${chartSvg([{className:'line-blue',values:hr},{className:'line-green',values:spo}])}<div class="legend"><span><i></i>Heart rate (bpm)</span><span><i class="green"></i>SpO₂ (%)</span></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Mission systems</h2><div class="card-kicker">Application and stream status</div></div>${badge(state.feedStatus==='connected'&&sensorFeed!=='disconnected'?'NORMAL':'OBSERVATION')}</div><div class="checklist"><div class="check-item"><span>Local database</span><b class="check-good">● Connected</b></div><div class="check-item"><span>Application updates</span><b class="${state.feedStatus==='connected'?'check-good':'check-limited'}">${esc(state.feedStatus)}</b></div><div class="check-item"><span>Astronaut health feed</span><b class="${sensorFeed==='connected'?'check-good':'check-limited'}">${esc(sensorFeed)}</b></div><div class="check-item"><span>Simulation</span><b class="${state.dashboard?.simulation?'check-good':'muted'}">${state.dashboard?.simulation?'● Running':'○ Idle'}</b></div><div class="check-item"><span>Offline queue</span><b data-pending>${state.pending} pending</b></div></div><p class="footer-note">This application is a research prototype. Synthetic telemetry is not astronaut sensor data. Medical personnel remain responsible for decisions.</p></section>
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">Cabin environment</h2><div class="card-kicker">Selected astronaut · source values in ${esc(dataModeLabel().toLowerCase())}</div></div><button class="link-button" data-page="environment">Open environment →</button></div>${environment.slice(0,4).map(sensor=>{const reading=sensor.history?.at(-1);return `<div class="check-item"><span>${esc(sensor.metric)} · ${esc(sensor.status)}</span><b>${reading?`${niceNumber(reading.value,3)} ${esc(reading.unit)}`:'No sample'}</b></div>`}).join('')||'<div class="empty">No environmental data in this view.</div>'}</section>
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">Equipment status</h2><div class="card-kicker">Assigned records and last source update</div></div><button class="link-button" data-page="equipment">Open equipment →</button></div>${equipment.slice(0,4).map(device=>`<button class="check-item check-item-button" data-action="equipment-detail" data-id="${esc(device.id)}"><span>${esc(device.name)} · ${esc(device.status)}</span><b>${niceDate(device.lastSeenAt)}</b></button>`).join('')||'<div class="empty">No equipment records in this view.</div>'}</section>
    <section class="card"><div class="card-title-row"><div><h2 class="card-title">SENTINEL activity</h2><div class="card-kicker">Latest monitoring observations</div></div><button class="link-button" data-page="sentinel">Open SENTINEL →</button></div>${observations.slice(0,3).map(item=>`<button class="check-item check-item-button" data-action="sentinel-detail" data-id="${esc(item.id)}"><span>${esc(item.title)}</span><b>${niceDate(item.createdAt)}</b></button>`).join('')||'<div class="empty">No observations in this data view.</div>'}</section></div>`;
}
function drawCrew(){const crew=visibleCrew();return `${pageHead('CREW OPERATIONS','Crew roster','Browse authorised astronaut profiles and their most recent stored measurements.',roleAllowsStaff()&&ASTRA.user.role==='admin'?'<button class="btn primary" data-action="create-astronaut">＋ Add astronaut</button>':'')}
  <section class="card"><div class="card-title-row"><div><h2 class="card-title">Mission crew</h2><div class="card-kicker">${crew.length} profiles · ORBITAL-7</div></div><input class="input" data-u="u1" placeholder="Search crew" data-search="crew" /></div><div class="grid crew-grid" data-crew-grid>${crew.map(miniCrewCard).join('')||'<div class="empty">No crew are assigned to your account.</div>'}</div></section>`;}
function drawMissionSelection(){const crew=state.dashboard?.crew||[],missions=[...new Map(crew.map(c=>[c.missionId,{id:c.missionId,designation:c.missionDesignation,start:c.missionStartDate,duration:c.missionDurationDays,crew:crew.filter(x=>x.missionId===c.missionId)}])).values()];return `${pageHead('MISSION ACCESS','Select a mission','Choose an authorised mission workspace. Astronaut access remains limited to assigned records.',roleAllowsStaff()&&ASTRA.user?.role==='admin'?'<button class="btn primary" data-action="create-astronaut">＋ Add astronaut</button>':'')}<div class="grid mission-grid">${missions.map(m=>`<article class="card mission-card"><div class="eyebrow">${esc(m.id)}</div><h2>${esc(m.designation)}</h2><div class="checklist"><div class="check-item"><span>Mission day</span><b>${esc(missionDay(m.crew[0]))}</b></div><div class="check-item"><span>Start date</span><b>${esc(m.start)}</b></div><div class="check-item"><span>Planned duration</span><b>${esc(m.duration)} days</b></div><div class="check-item"><span>Authorised crew profiles</span><b>${m.crew.length}</b></div></div><div class="form-actions"><button class="btn primary" data-action="mission-select" data-id="${esc(m.id)}">Open mission crew →</button></div></article>`).join('')||'<div class="empty">No missions are assigned to this account.</div>'}</div><div class="notice" data-u="u2">Flight day is calculated from the mission start date stored in the profile. The current prototype does not infer launch, docking, EVA or landing phases without verified mission events.</div>`;}
function drawSentinel(){const monitor=state.sentinel?.monitor||{},observations=state.sentinel?.observations||[];const statusFilter=state.sentinelStatus||'',categoryFilter=state.sentinelCategory||'';const list=observations.filter(o=>(!statusFilter||o.status===statusFilter)&&(!categoryFilter||o.category===categoryFilter));return `${pageHead('AUTONOMOUS MONITORING','ASTRA SENTINEL','Background rules evaluate incoming measurements and data freshness independently of the conversational assistant.',`<button class="btn" data-action="refresh">↻ Refresh</button>`)}<div class="grid stats-grid">${stat('MONITOR',monitor.running?'RUNNING':'STOPPED',monitor.engine||'Background service',monitor.running?'stat-accent':'')}${stat('MONITOR CYCLES',monitor.ticks??0,monitor.lastRunAt?`Last check ${niceDate(monitor.lastRunAt)}`:'Awaiting first check')}${stat('OPEN OBSERVATIONS',observations.filter(o=>o.status==='open').length,'Across current data view')}${stat('LATEST OBSERVATION',observations[0]?niceDate(observations[0].createdAt):'None',observations[0]?.category||'No current items')}</div><section class="card"><div class="card-title-row"><div><h2 class="card-title">Observation queue</h2><div class="card-kicker">Each event includes evidence, source, quality, method and mission context</div></div><div class="head-actions"><select class="select-inline" data-change="sentinel-status"><option value="">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select><select class="select-inline" data-change="sentinel-category"><option value="">All domains</option><option value="cardiovascular">Cardiovascular</option><option value="respiratory">Respiratory</option><option value="sleep">Sleep</option><option value="data_quality">Data quality</option><option value="environment">Environment</option><option value="equipment">Equipment</option><option value="ml_anomaly">ML pattern</option></select></div></div>${list.length?`<div class="alert-stack">${list.map(o=>`<article class="alert-item"><div class="alert-bar ${o.severity.includes('CRITICAL')?'critical':o.severity==='OBSERVATION'?'observation':''}"></div><div><div class="split"><button class="link-button observation-title" data-action="sentinel-detail" data-id="${esc(o.id)}">${esc(o.title)} ↗</button>${badge(o.severity)}</div><div class="alert-detail">${esc(o.astronautName||o.astronautId||o.subjectId)} · ${esc(o.category)} · ${esc(o.status)}</div><div class="alert-detail">${niceDate(o.createdAt)} · ${esc(o.source)} · ${esc(o.dataQuality)} · ${o.simulated?'SIMULATED':esc(o.dataClass)}</div></div><div class="head-actions">${roleAllowsStaff()&&o.status==='open'?`<button class="btn small" data-action="sentinel-ack" data-id="${esc(o.id)}">Acknowledge</button>`:''}${roleAllowsStaff()&&o.status!=='resolved'?`<button class="btn small ghost" data-action="sentinel-resolve" data-id="${esc(o.id)}">Resolve</button>`:''}</div></article>`).join('')}</div>`:`<div class="empty">No observations match these filters in ${esc(dataModeLabel().toLowerCase())}. Sentinel runs deterministically on incoming readings; the timer also checks for stale demo streams.</div>`}</section><p class="footer-note">The background monitor does not depend on ASTRA ASSIST or an external language model. Synthetic model outputs are limited to simulation data.</p>`;}
function drawEnvironment(){const sensors=state.environmental?.sensors||[];let selected=sensors.find(s=>s.id===state.selectedSensorId)||sensors[0];if(selected&&!state.selectedSensorId)state.selectedSensorId=selected.id;const history=selected?.history||[],latest=history.at(-1),chart=history.map(r=>({id:r.id,action:'environment-sample',unit:r.unit,label:formatUTC(r.recordedAt,{hour:'2-digit',minute:'2-digit'}),timestamp:r.recordedAt,value:r.value}));return `${pageHead('MISSION ENVIRONMENT','Environmental monitoring','Cabin sensor records and source status. Thresholds require an approved mission configuration.',`${selectCrew()}${roleAllowsStaff()?'<button class="btn" data-action="environment-register">＋ Register sensor</button>':''}`)}<div class="grid stats-grid">${stat('SENSORS IN VIEW',sensors.length,`Current ${esc(dataModeLabel().toLowerCase())} scope`)}${stat('SELECTED SENSOR',selected?.metric||'—',selected?.location||'No sensor selected','stat-accent')}${stat('LATEST VALUE',latest?`${niceNumber(latest.value,3)} ${latest.unit}`:'—',latest?niceDate(latest.recordedAt):'No measurement')}${stat('DATA QUALITY',latest?.dataQuality||'Unavailable',latest?.source||'No source received')}</div>${sensors.length?`<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Sensor time series</h2><div class="card-kicker">Select a channel; points use received values and units</div></div><select class="select-inline" data-change="environment-sensor">${sensors.map(s=>`<option value="${esc(s.id)}" ${s.id===selected?.id?'selected':''}>${esc(s.metric)} · ${esc(s.location)}</option>`).join('')}</select></div>${chartSvg([{className:'line-blue',values:chart}])}<div class="legend"><span><i></i>${esc(selected?.metric||'Metric')} · ${esc(selected?.unit||'')}</span></div></section><section class="card"><h2 class="card-title">Sensor state</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>Status</span><b>${esc(selected?.status||'unknown')}</b></div><div class="check-item"><span>Last seen</span><b>${niceDate(selected?.lastSeenAt)}</b></div><div class="check-item"><span>Source</span><b>${esc(selected?.source||'Not supplied')}</b></div><div class="check-item"><span>Data class</span><b>${selected?.simulated?'SIMULATED':esc(selected?.dataClass||'unknown')}</b></div></div><p class="footer-note">Cabin pressure, humidity, temperature, oxygen and carbon-dioxide readings depend on sensor calibration and mission configuration. ASTRA shows the source values and statistical shifts without claiming spacecraft operating limits.</p></section><section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">Environmental channels</h2><div class="card-kicker">Click a sensor to inspect recent samples</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Channel</th><th>Location</th><th>Latest value</th><th>Last seen</th><th>Source</th><th></th></tr></thead><tbody>${sensors.map(s=>{const v=s.history?.at(-1);return `<tr><td>${esc(s.name)} · ${esc(s.metric)}</td><td>${esc(s.location)}</td><td>${v?`${niceNumber(v.value,3)} ${esc(v.unit)}`:'—'}</td><td>${niceDate(s.lastSeenAt)}</td><td>${esc(s.source)} · ${s.simulated?'SIMULATED':esc(s.dataClass)}</td><td><button class="btn small" data-action="environment-detail" data-id="${esc(s.id)}">Inspect</button></td></tr>`}).join('')}</tbody></table></div></section></div>`:emptyMeasurementMessage()}`;}
function drawEquipment(){
  const devices=state.equipment?.equipment||[],crew=visibleCrew().find(item=>item.id===state.selectedId)||selectedCrew(),metricNames=Object.fromEntries(Object.entries(HEALTH_METRICS).map(([key,value])=>[key,value.label]));
  const categoryNames={wearable:'Crew health wearable',cardiac_monitor:'Cardiac monitor',pulse_oximeter:'Pulse oximeter',respiratory_monitor:'Respiratory monitor',temperature_sensor:'Body-temperature sensor',exercise_equipment:'Exercise equipment',bone_densitometer:'Bone densitometer',immune_assay:'Immune assay analyzer'};
  return `${pageHead('MISSION EQUIPMENT','Equipment & wearables','Assigned device status, mapped signals, incoming telemetry and maintenance history.',`${selectCrew()}${roleAllowsStaff()?'<button class="btn" data-action="equipment-register">＋ Register equipment</button>':''}`)}<div class="grid stats-grid">${stat('ASSIGNED DEVICES',devices.length,crew?`Assigned to ${crew.name}`:'Current astronaut profile')}${stat('ATTENTION REQUIRED',devices.filter(d=>d.status!=='operational').length,'Status supplied by the source',devices.some(d=>d.status!=='operational')?'':'stat-accent')}${stat('LATEST DEVICE UPDATE',devices.some(d=>d.lastSeenAt)?niceDate(devices.map(d=>d.lastSeenAt).filter(Boolean).sort().at(-1)):'—','Displayed in UTC')}${stat('DATA VIEW',dataModeLabel(),devices.some(d=>d.simulated)?'Synthetic status labeled':'Imported / connected records','stat-accent')}</div><div class="grid equipment-grid">${devices.map(d=>{const battery=d.readings?.filter(r=>r.metric==='battery_percent').at(-1),temperature=d.readings?.filter(r=>r.metric==='temperature').at(-1),metrics=(d.signalProfile||[]).map(key=>metricNames[key]).filter(Boolean),assignment=(state.dashboard?.crew||[]).find(person=>person.id===d.astronautId);return `<article class="card equipment-card"><div class="card-title-row"><div><h2 class="card-title">${esc(d.name)}</h2><div class="card-kicker">${esc(categoryNames[d.category]||d.category)} · ${esc(d.serialNumber)}</div></div>${badge(d.status==='operational'?'NORMAL':d.status==='attention'?'WARNING':'OBSERVATION')}</div><div class="checklist"><div class="check-item"><span>Assigned astronaut</span><b>${esc(assignment?.name||d.astronautId||'Unassigned')}</b></div><div class="check-item"><span>Mapped health channels</span><b>${esc(metrics.join(', ')||d.studyDomain||'No vital-sign channels')}</b></div><div class="check-item"><span>Battery sample</span><b>${battery?`${niceNumber(battery.value,1)} ${esc(battery.unit)}`:'No sample'}</b></div><div class="check-item"><span>Device temperature</span><b>${temperature?`${niceNumber(temperature.value,1)} ${esc(temperature.unit)}`:'No sample'}</b></div><div class="check-item"><span>Last seen</span><b>${niceDate(d.lastSeenAt)}</b></div><div class="check-item"><span>Source / class</span><b>${esc(d.source)} · ${d.simulated?'SIMULATED':esc(d.dataClass)}</b></div></div><p class="hint">${esc(d.signalDescription||'Signal mapping unavailable.')}${d.maintenanceNote?` Maintenance: ${esc(d.maintenanceNote)}`:''}</p><div class="head-actions"><button class="btn small" data-action="equipment-detail" data-id="${esc(d.id)}">Inspect telemetry</button>${roleAllowsStaff()&&d.status==='operational'&&d.signalProfile?.length?`<button class="btn small primary" data-action="equipment-record-health" data-id="${esc(d.id)}">Record vital sample</button>`:''}${roleAllowsStaff()?`<button class="btn small" data-action="equipment-maintenance" data-id="${esc(d.id)}">Log maintenance</button>`:''}${roleAllowsStaff()?`<button class="btn small ghost" data-action="equipment-status" data-id="${esc(d.id)}" data-status="attention">Flag attention</button>`:''}</div></article>`}).join('')||emptyMeasurementMessage()}</div><div class="notice">Each health record is linked to its assigned astronaut and source device. Trend charts use only channels supported by that device. Raw ECG samples are shown only when a source actually supplies waveform data; no waveform is fabricated.</div>`;
}

function drawHealth(){const c=selectedCrew();if(!c)return `<div class="empty">No astronaut profile is available.</div>`;const r=c.latest||{};const base=state.trends?.baseline||{};const items=[['HEART RATE',r.heartRate,'bpm',base.heart_rate,0],['HEART VARIABILITY',r.hrv,'ms',base.hrv,1],['OXYGEN SATURATION',r.spo2,'%',base.spo2,1],['RESPIRATORY RATE',r.respiratoryRate,'/min',base.respiratory_rate,1],['BODY TEMPERATURE',r.temperature,'°C',base.temperature,2],['SLEEP DURATION',r.sleepDuration,'h',base.sleep_duration,1]];
  const chartValues=(state.history||[]).map(x=>({label:new Date(x.recordedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}),value:x[state.chartMetric]}));
  return `${pageHead('PERSONAL HEALTH RECORD','Health monitoring',`${c.name} · ${c.missionDesignation} · personal baseline comparisons`,selectCrew())}<div class="grid stats-grid">${items.slice(0,4).map(([label,value,unit,baseline,digits])=>`<div class="card"><div class="stat-label">${label}</div><div class="metric-row"><span class="metric-big">${niceNumber(value,digits)}</span><span class="metric-unit">${unit}</span></div><div class="baseline-note">Personal reference: ${niceNumber(baseline,digits)} ${unit}</div></div>`).join('')}</div><div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Measurement history</h2><div class="card-kicker">Stored values over the last 24 hours</div></div><select class="select-inline" data-change="metric"><option value="heartRate">Heart rate</option><option value="spo2">SpO₂</option><option value="hrv">HRV</option><option value="respiratoryRate">Respiratory rate</option></select></div>${chartSvg([{className:'line-blue',values:chartValues}])}<div class="legend"><span><i></i>${esc(state.chartMetric)} · persisted application data</span></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Measurement details</h2><div class="card-kicker">Latest sample and provenance</div></div>${stampChip(r)}</div><div class="grid section-grid">${items.map(([label,value,unit,baseline,digits])=>`<div class="card" data-u="u3"><div class="stat-label">${label}</div><div class="metric-row"><span class="metric-big" data-u="u4">${niceNumber(value,digits)}</span><span class="metric-unit">${unit}</span></div><div class="baseline-note">Reference ${niceNumber(baseline,digits)} ${unit}</div></div>`).join('')}</div><p class="footer-note">Recorded ${niceDate(r.recordedAt)} · Source: ${esc(r.source||'none')} · Data quality: ${esc(r.dataQuality||'unknown')}. Missing values are not inferred.</p></section><section class="span-2">${state.dashboard?.openAlerts?.length?`<div class="card"><div class="card-title-row"><h2 class="card-title">Recent review items</h2></div>${alertCards(state.dashboard.openAlerts.filter(a=>a.astronautId===c.id),8)}</div>`:''}</section></div>`;}
function emptyMeasurementMessage(){return `<div class="empty"><b>No ${dataModeLabel().toLowerCase()} measurements for this astronaut.</b><br>${ASTRA.dataMode==='connected'?'This view contains authorised connected or uploaded records only. No sensor hardware is attached in this prototype.':ASTRA.dataMode==='research'?'This view contains uploaded research datasets only. Their study population and limitations must be reviewed.':'Start a scenario in the Simulation Lab to generate clearly labeled demonstration records.'}${roleAllowsStaff()?'<br><button class="btn small" data-u="u5" data-page="data">Open dataset import</button>':''}</div>`;}
function measurementRows(rows){if(!rows?.length)return emptyMeasurementMessage();return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded · UTC</th><th>Heart rate</th><th>SpO₂</th><th>Sleep</th><th>Equipment</th><th>Source</th><th></th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><td>${niceDate(r.recordedAt)}</td><td>${niceNumber(r.heartRate,0)} bpm</td><td>${niceNumber(r.spo2,1)}%</td><td>${niceNumber(r.sleepDuration,1)} h</td><td>${esc(assignedDeviceName(r))}</td><td>${esc(r.source||'Unknown')} · ${r.simulated?'SIM':'IMPORTED'}</td><td><button class="btn small" data-action="reading-detail" data-id="${esc(r.id)}">Inspect</button></td></tr>`).join('')}</tbody></table></div>`;}
function openReadingDetail(id){
  const pool=[...(state.history||[]),...(state.dashboard?.crew||[]).map(c=>c.latest).filter(Boolean)],r=pool.find(item=>String(item.id)===String(id));
  if(!r)return toast('That measurement is no longer in the current view. Refresh the page and try again.','error');
  const baseline=state.trends?.baseline||{},fieldMap=[['Heart rate','heartRate','heart_rate','bpm'],['Heart-rate variability','hrv','hrv','ms'],['Oxygen saturation','spo2','spo2','%'],['Respiratory rate','respiratoryRate','respiratory_rate','/min'],['Temperature','temperature','temperature','°C'],['Activity level','activityLevel','activity_level','index'],['Sleep duration','sleepDuration','sleep_duration','h']];
  const unitByMetric={heartRate:'bpm',spo2:'%',hrv:'ms',respiratoryRate:'/min',temperature:'°C',sleepDuration:'h',activityLevel:'index'},metric=state.chartMetric||'heartRate';
  const index=(state.history||[]).findIndex(item=>String(item.id)===String(r.id)),nearby=index<0?state.history||[]:(state.history||[]).slice(Math.max(0,index-4),index+5);
  const trend=nearby.map(item=>({id:item.id,action:'reading-detail',unit:unitByMetric[metric],label:formatUTC(item.recordedAt,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),timestamp:item.recordedAt,value:item[metric]}));
  const observations=(state.sentinel?.observations||[]).filter(item=>String(item.measurement?.readingId)===String(r.id));
  const details=[
    ['Astronaut',esc(r.astronautId||selectedCrew()?.id||'—')],
    ['Recorded at',esc(niceDate(r.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}))],
    ['Assigned equipment',esc(assignedDeviceName(r))],
    ['Source',esc(r.source||'Unknown')],
    ['Data class',r.simulated?'SIMULATED':esc(r.dataClass||'connected')],
    ['Data quality',esc(r.dataQuality||'Not supplied')]
  ].map(([label,value])=>`<div class="check-item"><span>${label}</span><b>${value}</b></div>`).join('');
  const fieldCards=fieldMap.map(([label,key,baseKey,unit])=>{
    const reference=baseline[baseKey]===undefined?'Unavailable in this view':`${niceNumber(baseline[baseKey],2)} ${unit}`;
    return `<div class="card" data-u="u6"><div class="stat-label">${esc(label)}</div><div class="metric-row"><span class="metric-big" data-u="u4">${niceNumber(r[key],2)}</span><span class="metric-unit">${esc(unit)}</span></div><div class="baseline-note">Personal reference: ${reference}</div></div>`;
  }).join('');
  const observationCards=observations.length?observations.map(item=>`<div class="check-item"><span>${esc(item.title)} · ${esc(item.severity)} · ${esc(item.status)}</span><button class="link-button" data-action="sentinel-detail" data-id="${esc(item.id)}">Inspect ↗</button></div>`).join(''):'<p class="hint">No observation is linked to this reading in the current data view.</p>';
  const html=`<div class="checklist">${details}</div><div class="divider"></div><div class="grid section-grid">${fieldCards}</div><section class="card" data-u="u5"><div class="card-title-row"><div><h3 class="card-title">Nearby history · ${esc(metric)}</h3><div class="card-kicker">Stored samples around the selected record; values remain source-labeled.</div></div></div>${chartSvg([{className:'line-blue',values:trend}])}<div class="legend"><span><i></i>${esc(metric)} · ${esc(unitByMetric[metric])}</span></div></section><section class="card" data-u="u5"><h3 class="card-title">Associated SENTINEL observations</h3>${observationCards}</section><p class="footer-note">Missing values stay blank. Data type, device context and measurement quality must be reviewed before operational interpretation.</p>`;
  openModal('Measurement detail',html);
}
const HEALTH_METRICS={heartRate:{label:'Heart rate',unit:'bpm',digits:0},hrv:{label:'Heart-rate variability',unit:'ms',digits:1},spo2:{label:'Oxygen saturation',unit:'%',digits:1},respiratoryRate:{label:'Respiratory rate',unit:'/min',digits:1},temperature:{label:'Body temperature',unit:'°C',digits:2},activityLevel:{label:'Activity level',unit:'index',digits:2},sleepDuration:{label:'Sleep duration',unit:'h',digits:1}};
function signalDevices(requiredMetrics=Object.keys(HEALTH_METRICS)){return (state.equipment?.equipment||[]).filter(device=>Array.isArray(device.signalProfile)&&device.signalProfile.some(metric=>requiredMetrics.includes(metric)));}
function telemetrySourceControl(requiredMetrics=Object.keys(HEALTH_METRICS)){const devices=signalDevices(requiredMetrics);if(state.selectedTelemetryEquipment!=='all'&&state.selectedTelemetryEquipment!=='unassigned'&&!devices.some(device=>device.id===state.selectedTelemetryEquipment))state.selectedTelemetryEquipment='all';return `<label class="field"><span class="muted">Signal source</span><select class="select-inline" data-change="telemetry-device" aria-label="Filter measurements by assigned equipment"><option value="all" ${state.selectedTelemetryEquipment==='all'?'selected':''}>All sources</option><option value="unassigned" ${state.selectedTelemetryEquipment==='unassigned'?'selected':''}>Unassigned records</option>${devices.map(device=>`<option value="${esc(device.id)}" ${device.id===state.selectedTelemetryEquipment?'selected':''}>${esc(device.name)} · ${esc(device.category)}</option>`).join('')}</select></label>`;}
function telemetryHistory(){const rows=state.history||[];if(state.selectedTelemetryEquipment==='unassigned')return rows.filter(row=>!row.equipmentId);if(state.selectedTelemetryEquipment&&state.selectedTelemetryEquipment!=='all')return rows.filter(row=>row.equipmentId===state.selectedTelemetryEquipment);return rows;}
function selectedTelemetryDevice(){return signalDevices().find(device=>device.id===state.selectedTelemetryEquipment)||null;}
function assignedDeviceName(record){return (state.equipment?.equipment||[]).find(device=>device.id===record?.equipmentId)?.name||'Unassigned';}
function drawHealthEnhanced(){
  const c=selectedCrew();if(!c)return '<div class="empty">No astronaut profile is available for this account.</div>';
  const device=selectedTelemetryDevice(),rows=telemetryHistory(),allowed=device?.signalProfile||Object.keys(HEALTH_METRICS),metrics=Object.entries(HEALTH_METRICS).filter(([key])=>allowed.includes(key));
  if(metrics.length&&!metrics.some(([key])=>key===state.chartMetric))state.chartMetric=metrics[0][0];
  const metric=state.chartMetric,definition=HEALTH_METRICS[metric]||HEALTH_METRICS.heartRate,base=state.trends?.baseline||{},latest=(state.selectedTelemetryEquipment==='all'||!state.selectedTelemetryEquipment)?(c.latest||rows.at(-1)||{}):(rows.at(-1)||{});
  const items=[['HEART RATE',latest.heartRate,'bpm',base.heart_rate,0],['HEART VARIABILITY',latest.hrv,'ms',base.hrv,1],['OXYGEN SATURATION',latest.spo2,'%',base.spo2,1],['RESPIRATORY RATE',latest.respiratoryRate,'/min',base.respiratory_rate,1],['BODY TEMPERATURE',latest.temperature,'°C',base.temperature,2],['SLEEP DURATION',latest.sleepDuration,'h',base.sleep_duration,1]];
  const chartValues=rows.map(row=>({id:row.id,action:'reading-detail',unit:definition.unit,label:formatUTC(row.recordedAt,{hour:'2-digit',minute:'2-digit'}),timestamp:row.recordedAt,value:row[metric]}));
  const baselineNote=base.heart_rate===undefined?'No approved astronaut-specific baseline is available in this data view.':`Reference source: ${state.trends?.baselineSource||'source not recorded'}`;
  const sourceDescription=device?`${device.name} · ${device.signalDescription||'Assigned source'}`:state.selectedTelemetryEquipment==='unassigned'?'Records without an assigned equipment source':'All sources · select one device for a device-specific trend';
  return `${pageHead('PERSONAL HEALTH RECORD','Health monitoring',`${c.name} · ${c.missionDesignation} · ${dataModeLabel()} view`,`${selectCrew()}${historyControls()}`)}<div class="grid stats-grid">${items.slice(0,4).map(([label,value,unit,baseline,digits])=>`<div class="card"><div class="stat-label">${label}</div><div class="metric-row"><span class="metric-big">${niceNumber(value,digits)}</span><span class="metric-unit">${unit}</span></div><div class="baseline-note">${base.heart_rate===undefined?'No approved reference':`Reference: ${niceNumber(baseline,digits)} ${unit}`}</div></div>`).join('')}</div><div class="grid section-grid"><section class="card"><div class="card-title-row chart-toolbar"><div><h2 class="card-title">Measurement history</h2><div class="card-kicker">${rows.length} records · ${esc(historyWindowLabel())} · ${esc(dataModeLabel())} · timestamps shown in UTC</div></div><div class="chart-controls">${telemetrySourceControl()}<label class="field"><span class="muted">Measurement</span><select class="select-inline" data-change="metric" aria-label="Chart measurement">${metrics.map(([key,info])=>`<option value="${key}" ${key===metric?'selected':''}>${esc(info.label)}</option>`).join('')}</select></label></div></div>${rows.length&&metrics.length?chartSvg([{className:'line-blue',values:chartValues}],{robustScale:true,maxPoints:320,axisDigits:definition.digits,ariaLabel:`${definition.label} time series`}):`<div class="empty">${metrics.length?'No samples from this source are available in the selected time window.':'This equipment has no mapped vital-sign channels.'}</div>`}<div class="legend"><span><i></i>${esc(definition.label)} (${esc(definition.unit)}) · ${esc(sourceDescription)}</span></div><p class="footer-note">This is a timestamped measurement trend, not a raw ECG waveform. ASTRA only plots values received for the selected equipment; missing samples remain gaps. Outlier points are retained and marked at the plot edge. Display time: UTC (UTC, UTC).</p></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Latest sample</h2><div class="card-kicker">Timestamp, source, quality and provenance</div></div>${stampChip(latest)}</div>${latest?.recordedAt?`<div class="checklist"><div class="check-item"><span>Recorded</span><b>${niceDate(latest.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</b></div><div class="check-item"><span>Source</span><b>${esc(latest.source||'Unknown')}</b></div><div class="check-item"><span>Equipment</span><b>${esc(assignedDeviceName(latest))}</b></div><div class="check-item"><span>Quality</span><b>${esc(latest.dataQuality||'Not provided')}</b></div><div class="check-item"><span>Reference</span><b>${esc(baselineNote)}</b></div></div><button class="btn small" data-action="reading-detail" data-id="${esc(latest.id)}">Inspect every field</button>`:emptyMeasurementMessage()}</section><section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">Individual measurements</h2><div class="card-kicker">Selected-source records; timestamps are normalized to UTC and displayed in UTC</div></div></div>${measurementRows(rows)}</section></div>`;
}
function drawClinicalModule(moduleId){
  const configs={
    cardiovascular:{title:'Cardiovascular monitoring',kicker:'CARDIOVASCULAR',summary:'Heart rate and heart-rate variability compared with this astronaut’s personal reference.',metrics:[['Heart rate','heartRate','heart_rate','bpm',0],['Heart-rate variability','hrv','hrv','ms',1]],primary:'heartRate',notes:'This trend is not an ECG waveform. Raw cardiac waveform points appear only when a compatible source sends them.'},
    respiratory:{title:'Respiratory monitoring',kicker:'RESPIRATORY',summary:'Oxygen saturation and respiratory rate from the latest persisted sample.',metrics:[['Oxygen saturation','spo2','spo2','%',1],['Respiratory rate','respiratoryRate','respiratory_rate','/min',1]],primary:'spo2',notes:'No CO₂ or breathing waveform sensor is connected. Confirm data quality before interpreting outliers.'},
    sleep:{title:'Sleep & fatigue monitoring',kicker:'SLEEP & RECOVERY',summary:'Recorded sleep duration against a personal reference and recent daily averages.',metrics:[['Sleep duration','sleepDuration','sleep_duration','h',1]],primary:'sleepDuration',notes:'Sleep stages, circadian phase and a validated fatigue assessment are not available from the current synthetic telemetry.'},
    activity:{title:'Activity & performance',kicker:'PHYSICAL ACTIVITY',summary:'Activity-level values and physical-activity trend. Missing measurements remain blank.',metrics:[['Activity level','activityLevel','activity_level','index',2]],primary:'activityLevel',notes:'The activity-level index is synthetic; exercise duration, movement sensors and physical-performance tests are not connected.'},
  };
  const config=configs[moduleId],crew=selectedCrew();if(!crew)return '<div class="empty">No astronaut profile is available.</div>';
  const supported=config.metrics.map(([,key])=>key),deviceChoices=signalDevices(supported),device=telemetrySourceControl(supported),selected=selectedTelemetryDevice();
  const metrics=config.metrics.filter(([,key])=>!selected||selected.signalProfile.includes(key));if(metrics.length&&!metrics.some(([,key])=>key===state.chartMetric))state.chartMetric=metrics[0][1];
  const metric=metrics.find(([,key])=>key===state.chartMetric)||metrics[0],history=telemetryHistory(),latest=(state.selectedTelemetryEquipment==='all'||!state.selectedTelemetryEquipment)?(crew.latest||history.at(-1)||{}):(history.at(-1)||{}),baseline=state.trends?.baseline||{};
  const values=metric?history.map(row=>({id:row.id,action:'reading-detail',unit:metric[3],label:formatUTC(row.recordedAt,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),timestamp:row.recordedAt,value:row[metric[1]]})):[];
  const metricSelect=`<label class="field"><span class="muted">Measurement</span><select class="select-inline" data-change="metric" aria-label="Chart measurement">${metrics.map(([label,key])=>`<option value="${key}" ${key===metric?.[1]?'selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
  return `${pageHead(config.kicker,config.title,`${crew.name} · ${config.summary}`,`${selectCrew()}${historyControls()}`)}<div class="grid stats-grid">${config.metrics.map(([label,current,reference,unit,digits])=>`<div class="card"><div class="stat-label">${esc(label)}</div><div class="metric-row"><span class="metric-big">${niceNumber(latest[current],digits)}</span><span class="metric-unit">${unit}</span></div><div class="baseline-note">Personal reference: ${niceNumber(baseline[reference],digits)} ${unit}</div></div>`).join('')}${stat('SAMPLE TIME',latest.recordedAt?niceDate(latest.recordedAt,{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—',latest.dataQuality?`Quality: ${latest.dataQuality}`:'No stored sample')}</div><div class="grid section-grid"><section class="card"><div class="card-title-row chart-toolbar"><div><h2 class="card-title">Recent history</h2><div class="card-kicker">${history.length} records · ${esc(historyWindowLabel())} · timestamps shown in UTC</div></div><div class="chart-controls">${device}${metricSelect}</div></div>${history.length&&metric?chartSvg([{className:'line-blue',values}],{robustScale:true,maxPoints:320,axisDigits:metric[4],ariaLabel:`${metric[0]} time series`}):`<div class="empty">${metrics.length?'No samples from this source are available in the selected time window.':'No assigned device supports this module’s measurements.'}</div>`}<div class="legend"><span><i></i>${esc(metric?.[0]||'No supported channel')} ${metric?`(${esc(metric[3])})`:''} · ${esc(selected?.name||'selected source')}</span></div><div class="notice">${esc(config.notes)} The chart uses timestamped received samples from the selected equipment. Missing values remain gaps; timestamps are displayed in UTC (UTC, UTC).</div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Data provenance</h2><div class="card-kicker">Source and quality indicators</div></div>${stampChip(latest)}</div><div class="checklist"><div class="check-item"><span>Source</span><b>${esc(latest.source||'No sample')}</b></div><div class="check-item"><span>Assigned equipment</span><b>${esc(selected?.name||'Not assigned / all sources')}</b></div><div class="check-item"><span>Quality</span><b>${esc(latest.dataQuality||'Unavailable')}</b></div><div class="check-item"><span>Data type</span><b class="${latest.simulated?'check-limited':'check-good'}">${latest.simulated?'SIMULATED':'IMPORTED'}</b></div><div class="check-item"><span>Reference source</span><b class="check-limited">${esc(state.trends?.baselineSource||'Not available')}</b></div></div><div class="notice">${esc(config.notes)}</div></section><section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">Individual sample details</h2><div class="card-kicker">Filtered to the selected equipment source</div></div></div>${measurementRows(history)}</section></div>`;
}
function drawClinicalInteractive(moduleId){let view=drawClinicalModule(moduleId);if(!state.trends?.baseline){view=view.replaceAll('Personal reference: —','No approved reference in this view').replace('Synthetic personal baseline','No calibrated mission baseline');}return view.replace(/<\/div>$/,`<section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">Individual sample details</h2><div class="card-kicker">Inspect timestamp, all received fields, quality flag and source</div></div></div>${measurementRows(state.history||[])}</section></div>`);}
function drawResearchScaffold(moduleId){
  const immune=moduleId==='immune';const title=immune?'Immune-health research':'Bone-health monitoring';const domain=immune?'immune response and infection signs':'bone density and musculoskeletal change';const research=immune?'NASA discusses altered immune-system responses and spaceflight health risks.':'NASA discusses spaceflight-induced bone changes and reduced cardiorespiratory and musculoskeletal fitness.';
  return `${pageHead('RESEARCH SCAFFOLD',title,`Dedicated module for ${domain}. The interface separates this research area from the live vital-sign modules.`)}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Data integration status</h2><div class="card-kicker">Module scaffold · no validated measurement feed connected</div></div><span class="badge observation">NOT MEASURED</span></div><div class="notice">${immune?'No immune assay, blood panel, biomarker or clinician-entered immune measurement is connected. Temperature and general wellness are not immune-function measurements.':'No bone-density scan, bone-turnover biomarker or validated musculoskeletal measurement is connected. Activity level is not a proxy for bone density.'}</div><div class="checklist" data-u="u2"><div class="check-item"><span>Research topic</span><b>${esc(domain)}</b></div><div class="check-item"><span>Supported measurement feed</span><b class="check-limited">Not available</b></div><div class="check-item"><span>Clinical risk score</span><b class="check-limited">Not implemented</b></div><div class="check-item"><span>Next integration</span><b>Approved research data mapping</b></div></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Research context</h2><div class="card-kicker">Source material informs module design</div></div></div><p class="hint">${esc(research)} ASTRA uses this source as research context only; it does not derive an individual health score or diagnosis from a general research page.</p><div class="divider"></div><a href="https://www.nasa.gov/hrp/risks/" target="_blank" rel="noopener">NASA Human Research Program · spaceflight risks ↗</a><p class="footer-note">Research notes are separate from astronaut measurements. A future integration should document study population, assay, unit, provenance, consent and limits before displaying imported data.</p></section></div>`;
}
function drawAlerts(){const all=state.alerts||[];return `${pageHead('MEDICAL REVIEW','Alert management','Acknowledge or resolve monitoring prompts. Critical items remain individual events.',roleAllowsStaff()?'<button class="btn" data-action="refresh">↻ Refresh</button>':'')}<div class="tabs"><button class="tab active" data-action="alert-filter" data-status="">All alerts</button><button class="tab" data-action="alert-filter" data-status="open">Open</button><button class="tab" data-action="alert-filter" data-status="acknowledged">Acknowledged</button><button class="tab" data-action="alert-filter" data-status="resolved">Resolved</button></div><section class="card">${alertCards(all,100)}</section><p class="footer-note">Medical alerts are review prompts. Technical sensor and connectivity alerts are labeled separately. An alert is not a diagnosis.</p>`;}
function drawTrends(){const values=(state.trends?.trends||[]).map(row=>({label:row.date.slice(5),value:row[state.chartMetric]}));const base=state.trends?.baseline||{};return `${pageHead('HEALTH ANALYTICS','Personal trends','Daily aggregates compared with the astronaut-specific synthetic reference.',selectCrew())}<section class="card"><div class="card-title-row"><div><h2 class="card-title">Trend analysis</h2><div class="card-kicker">${state.periodDays} day window · aggregate of persisted readings</div></div><div class="head-actions"><select class="select-inline" data-change="period"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select><select class="select-inline" data-change="metric"><option value="heartRate">Heart rate</option><option value="spo2">SpO₂</option><option value="hrv">HRV</option><option value="sleepDuration">Sleep</option><option value="activityLevel">Activity</option></select></div></div>${chartSvg([{className:'line-blue',values}])}<div class="legend"><span><i></i>Daily mean ${esc(state.chartMetric)}</span><span><i class="amber"></i>Personal reference: ${niceNumber(base[({heartRate:'heart_rate',spo2:'spo2',hrv:'hrv',sleepDuration:'sleep_duration',activityLevel:'activity_level'})[state.chartMetric]],1)}</span></div></section><section class="card" data-u="u2"><div class="card-title-row"><div><h2 class="card-title">Daily values</h2><div class="card-kicker">Missing fields remain blank rather than inferred</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Heart rate</th><th>SpO₂</th><th>HRV</th><th>Sleep</th><th>Samples</th></tr></thead><tbody>${(state.trends?.trends||[]).map(r=>`<tr><td>${esc(r.date)}</td><td>${niceNumber(r.heartRate,1)} bpm</td><td>${niceNumber(r.spo2,1)}%</td><td>${niceNumber(r.hrv,1)} ms</td><td>${niceNumber(r.sleepDuration,1)} h</td><td>${r.samples}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No measurements in this period.</td></tr>'}</tbody></table></div></section><p class="footer-note">The displayed baseline is a synthetic demonstration reference. Statistical comparisons support review and are not medical risk probabilities.</p>`;}
function drawAssistant(){const msgs=state.messages||[];return `${pageHead('RETRIEVAL ASSISTANT','Health intelligence assistant','Answers use authorised local health records and a small curated reference catalog. LLM provider is optional.', '')}<div class="grid section-grid"><section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">ASTRA assistant</h2><div class="card-kicker">${ASTRA.user.role==='astronaut'?'Your own health context':`Authorised astronaut: ${esc(selectedCrew()?.name||'')}`}</div></div>${ASTRA.user.role!=='astronaut'?selectCrew():''}</div><div class="chat" id="chat-log">${msgs.length?msgs.map(m=>`<div class="chat-msg ${m.role==='user'?'user':'assistant'}">${esc(m.content)}${m.sources?.length?`<div class="chat-source">Sources: ${m.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ')}</div>`:''}</div>`).join(''):'<div class="empty">Try “What is my current health status?” or “What does NASA OSDR contain?”</div>'}</div><form class="chat-compose" data-form="assistant"><input class="input" name="message" maxlength="1500" placeholder="Ask about current readings, alerts or approved research…" required /><button class="btn primary">Send</button></form><div class="hint" data-u="u7">Local retrieval works without a key. Set ASTRA_GEMINI_API_KEY and optional ASTRA_GEMINI_API_KEY_2 in the server .env, or configure another compatible provider. The key stays server-side. Answers cannot diagnose or prescribe.</div></section><section class="card"><h2 class="card-title">Research sources</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>NASA HRP</span><a href="https://www.nasa.gov/hrp/" target="_blank" rel="noopener">Open source ↗</a></div><div class="check-item"><span>NASA OSDR</span><a href="https://osdr.nasa.gov/" target="_blank" rel="noopener">Open source ↗</a></div><div class="check-item"><span>NASA GeneLab</span><a href="https://genelab.nasa.gov/" target="_blank" rel="noopener">Open source ↗</a></div><div class="check-item"><span>ESA exploration</span><a href="https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration" target="_blank" rel="noopener">Open source ↗</a></div><div class="check-item"><span>PhysioNet MIT-BIH</span><a href="https://physionet.org/content/mitdb/" target="_blank" rel="noopener">Open source ↗</a></div></div></section></div>`;}
function drawWellness(){const rows=state.wellness||[];return `${pageHead('VOLUNTARY SELF-ASSESSMENT','Crew wellness','Private self-reported mood, stress, fatigue and sleep satisfaction. Not a psychiatric diagnostic tool.',selectCrew())}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Daily check-in</h2><div class="card-kicker">Select 1 (low) to 5 (high) for each reflection</div></div></div><form data-form="wellness" class="form-grid"><div class="field"><label for="mood">Mood · 1 low, 5 positive</label><select class="select" id="mood" name="mood"><option value="3">3 · steady</option><option value="1">1 · low</option><option value="2">2 · below usual</option><option value="4">4 · good</option><option value="5">5 · very good</option></select></div><div class="field"><label for="stress">Stress · 1 low, 5 high</label><select class="select" id="stress" name="stress"><option value="2">2 · mild</option><option value="1">1 · low</option><option value="3">3 · moderate</option><option value="4">4 · high</option><option value="5">5 · very high</option></select></div><div class="field"><label for="fatigue">Fatigue · 1 low, 5 high</label><select class="select" id="fatigue" name="fatigue"><option value="2">2 · mild</option><option value="1">1 · low</option><option value="3">3 · moderate</option><option value="4">4 · high</option><option value="5">5 · very high</option></select></div><div class="field"><label for="satisfaction">Sleep satisfaction · 1 low, 5 high</label><select class="select" id="satisfaction" name="sleepSatisfaction"><option value="3">3 · fair</option><option value="1">1 · poor</option><option value="2">2 · low</option><option value="4">4 · good</option><option value="5">5 · excellent</option></select></div><div class="field span-2"><label for="wellness-notes">Optional note · visible to authorised medical staff</label><textarea class="textarea" id="wellness-notes" name="notes" maxlength="500" placeholder="Add context if you choose"></textarea></div><div class="form-actions span-2"><button class="btn primary">Save check-in</button></div></form></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Recent self-assessments</h2><div class="card-kicker">${rows.length} records available</div></div></div>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded</th><th>Mood</th><th>Stress</th><th>Fatigue</th><th>Sleep</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${niceDate(r.recorded_at)}</td><td>${r.mood}/5</td><td>${r.stress}/5</td><td>${r.fatigue}/5</td><td>${r.sleep_satisfaction}/5</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No wellness assessments have been recorded. Participation is voluntary.</div>'}</section></div><div class="notice" data-u="u2">Wellness values are self-reported. ASTRA does not infer a mental health condition from these answers.</div>`;}
function drawRadiation(){const rows=state.radiation||[],crew=state.dashboard?.crew||[],selected=rows.find(r=>r.astronaut_id===state.selectedId)||rows[0];const chart=rows.filter(r=>r.astronaut_id===state.selectedId).slice(0,30).reverse().map(r=>({label:new Date(r.recorded_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}),value:r.cumulative}));return `${pageHead('ENVIRONMENTAL MONITORING','Radiation exposure','Cumulative readings with explicit provenance. Thresholds require mission-specific medical policy.',selectCrew())}<div class="grid stats-grid">${stat('LATEST DOSE RATE',selected?`${niceNumber(selected.value,4)} ${selected.unit}`:'—',selected?selected.source:'No radiation data')}${stat('CUMULATIVE EXPOSURE',selected?`${niceNumber(selected.cumulative,3)} mSv`:'—','Reported cumulative total','stat-accent')}${stat('DATA SOURCE',selected?(selected.simulated?'SIMULATED':'IMPORTED'):'—','Synthetic values are clearly identified')}${stat('READINGS STORED',rows.filter(r=>r.astronaut_id===state.selectedId).length,'For selected astronaut')}</div><div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Cumulative exposure trend</h2><div class="card-kicker">Reported values · units as supplied</div></div></div>${chartSvg([{className:'line-amber',values:chart}])}<div class="legend"><span><i class="amber"></i>Cumulative exposure · mSv as supplied</span></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Recent readings</h2><div class="card-kicker">No disease predictions are made from these values</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Timestamp</th><th>Rate</th><th>Cumulative</th><th>Source</th></tr></thead><tbody>${rows.filter(r=>r.astronaut_id===state.selectedId).slice(0,8).map(r=>`<tr><td>${niceDate(r.recorded_at)}</td><td>${r.value} ${esc(r.unit)}</td><td>${r.cumulative} mSv</td><td>${r.simulated?'SIMULATED':esc(r.source)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No readings.</td></tr>'}</tbody></table></div></section></div>`;}
function drawReports(){const c=selectedCrew();return `${pageHead('MISSION DOCUMENTATION','Health reports','Export a role-scoped measurement summary with data provenance and model limitations.',selectCrew())}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Generate report</h2><div class="card-kicker">${esc(c?.name||'No astronaut selected')} · historical records and alerts</div></div></div><div class="form-grid"><div class="field"><label for="report-days">Reporting period</label><select class="select" id="report-days"><option value="1">Last 24 hours</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div><div class="field"><label for="report-include">Report contents</label><select class="select" id="report-include"><option>Measurements, trends, alerts</option></select></div></div><div class="form-actions"><button class="btn primary" data-action="download-report" data-format="pdf">↓ Download PDF</button><button class="btn" data-action="download-report" data-format="csv">↓ Download CSV</button></div><p class="footer-note">Reports identify synthetic readings and include measurements from the application database. PDF uses a structured, paginated medical-monitoring template. Vitals, bone and immune research observations, alerts, UTC timestamps and data provenance are included; wellness and radiation remain separate views.</p></section><section class="card"><h2 class="card-title">Report contents</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>Astronaut and mission details</span><b class="check-good">Included</b></div><div class="check-item"><span>Timestamped vitals, bone and immune measurements</span><b class="check-good">Included</b></div><div class="check-item"><span>Alert history and status</span><b class="check-good">Included</b></div><div class="check-item"><span>Model limitations and provenance</span><b class="check-good">Included</b></div><div class="check-item"><span>Offline generation</span><b class="check-limited">Needs API connection</b></div></div></section></div>`;}
function drawSimulation(){const c=selectedCrew(),sim=state.dashboard?.simulation,modeNotice=ASTRA.dataMode==='simulation'?'':`<div class="notice" data-u="u8">The simulator writes only to the Simulation data view. Switch views to run a clearly labeled demonstration. <button class="btn small" data-action="switch-simulation">Switch to Simulation</button></div>`,scenarios=[['normal','Normal mission activity'],['elevated_heart_rate','Elevated heart rate'],['reduced_spo2','Reduced oxygen saturation'],['sleep_deprivation','Sleep deprivation'],['reduced_activity','Reduced physical activity'],['multiple_abnormalities','Multiple abnormalities'],['sensor_malfunction','Sensor malfunction'],['respiratory_measurement_anomaly','Respiratory measurement anomaly'],['microgravity_adaptation','Microgravity adaptation · illustrative'],['exercise_activity','Exercise activity'],['environment_temperature_change','Cabin temperature shift'],['environment_co2_change','Cabin CO₂ reading shift'],['wearable_disconnection','Wearable disconnection'],['equipment_overheating','Equipment temperature shift'],['network_disconnection','Network disconnection'],['recovery','Recovery to baseline']];return `${pageHead('DEMONSTRATION MODE','Simulation lab','Repeatable synthetic telemetry scenarios. Every generated reading is marked SIMULATED.',selectCrew())}${modeNotice}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Scenario controls</h2><div class="card-kicker">${sim?`Session ${esc(sim.id)} · ${esc(sim.status)}`:'No active session'}</div></div>${sim?badge(sim.scenario==='normal'?'NORMAL':'OBSERVATION'):'<span class="source-chip">SIMULATED ONLY</span>'}</div><div class="form-grid"><div class="field span-2"><label for="scenario">Health scenario</label><select class="select" id="scenario">${scenarios.map(([id,label])=>`<option value="${id}" ${sim?.scenario===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="sim-speed">Playback speed</label><select class="select" id="sim-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></div><div class="field"><label for="sim-interval">Data interval</label><select class="select" id="sim-interval"><option value="2500">2.5 seconds</option><option value="5000">5 seconds</option><option value="10000">10 seconds</option></select></div></div><div class="form-actions"><button class="btn primary" data-action="sim-start" ${sim?'disabled':''}>▶ Start</button><button class="btn" data-action="sim-pause" ${sim?.status!=='running'?'disabled':''}>Ⅱ Pause</button><button class="btn" data-action="sim-resume" ${sim?.status!=='paused'?'disabled':''}>▶ Resume</button><button class="btn" data-action="sim-stop" ${!sim?'disabled':''}>■ Stop</button><button class="btn ghost" data-action="sim-reset" ${!sim?'disabled':''}>↻ Reset</button></div><div class="divider"></div><div class="field"><label>Change live scenario</label><div class="form-actions"><button class="btn" data-action="sim-scenario">Apply selected scenario</button><span class="hint">Use critical scenario to demonstrate alerting and model inference.</span></div></div><p class="footer-note">The simulator is a local deterministic workflow with randomized physiological jitter. It does not connect to a wearable or spacecraft sensor.</p></section><section class="card"><h2 class="card-title">Demonstration sequence</h2><div class="simulation-steps"><div class="step ${sim?'done':''}">01 · Normal data</div><div class="step ${sim&&sim.scenario!=='normal'?'current':''}">02 · Scenario change</div><div class="step ${state.dashboard?.openAlerts?.length?'done':''}">03 · ML & alert</div><div class="step ${state.dashboard?.openAlerts?.some(a=>a.status==='acknowledged')?'done':''}">04 · Medical review</div></div><div class="checklist"><div class="check-item"><span>Persistence</span><b class="check-good">SQLite</b></div><div class="check-item"><span>Streaming</span><b class="check-good">WebSocket</b></div><div class="check-item"><span>Anomaly model</span><b class="check-good">Isolation Forest</b></div><div class="check-item"><span>Clinical validity</span><b class="check-limited">Not established</b></div></div><div class="divider"></div><h3 class="card-title">Latest generated telemetry</h3><p class="hint">${sim?.scenario==='network_disconnection'?'Sensor feed stopped by selected scenario; last stored value is now stale over time.':c?.latest?`${c.latest.heartRate} bpm · ${c.latest.spo2}% SpO₂ · ${niceDate(c.latest.recordedAt)} · SIMULATED`: 'No values yet.'}</p></section><section class="span-2 card"><div class="card-title-row"><h2 class="card-title">Active alerts from demonstration</h2><button class="link-button" data-page="alerts">Review alerts →</button></div>${alertCards(state.dashboard?.openAlerts||[],8)}</section></div>`;}
function drawData(){return `${pageHead('DATA SOURCES','Dataset import','Validate CSV or JSON rows and record their source. Import is limited to authorised staff.', '')}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Import health dataset</h2><div class="card-kicker">CSV headings: heart_rate, hrv, spo2, respiratory_rate, temperature, activity_level, sleep_duration, recorded_at</div></div></div><form data-form="import" class="form-grid"><div class="field"><label for="import-astronaut">Astronaut</label><select class="select" id="import-astronaut" name="astronautId">${visibleCrew().map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`).join('')}</select></div><div class="field"><label for="import-file">CSV or JSON file</label><input class="input" id="import-file" type="file" accept=".csv,.json,text/csv,application/json" required /></div><div class="field"><label for="import-class">Record category</label><select class="select" id="import-class" name="dataClass"><option value="connected">Connected / uploaded record</option><option value="research">Research study dataset</option></select></div><div class="field"><label for="import-source">Source label</label><input class="input" id="import-source" name="source" value="Dataset import" maxlength="120" /></div><div class="form-actions span-2"><button class="btn primary">Validate and import</button></div></form><p class="footer-note">This importer preserves supplied units and timestamps. It does not assume all studies contain every variable, convert unknown units, or treat terrestrial MIT-BIH ECG data as astronaut-specific.</p></section><section class="card"><h2 class="card-title">Supported research catalogs</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>NASA OSDR</span><a href="https://osdr.nasa.gov/" target="_blank" rel="noopener">Browse ↗</a></div><div class="check-item"><span>NASA GeneLab</span><a href="https://genelab.nasa.gov/" target="_blank" rel="noopener">Browse ↗</a></div><div class="check-item"><span>NASA HRP</span><a href="https://www.nasa.gov/hrp/" target="_blank" rel="noopener">Browse ↗</a></div><div class="check-item"><span>PhysioNet</span><a href="https://physionet.org/" target="_blank" rel="noopener">Browse ↗</a></div></div><div class="notice" data-u="u2">Dataset catalog ingestion is manual in this local build: download a permitted CSV/JSON file and use the importer. External connectors and live dataset downloads are not configured.</div></section></div>`;}
function drawAdmin(){const sys=state.system||{},model=state.model||{};return `${pageHead('SYSTEM MANAGEMENT','Administration','Manage local model information, user accounts, missions and audit events.', '')}<div class="grid stats-grid">${stat('MODEL STATUS',model.status||'—',model.modelKind||'Isolation Forest','stat-accent')}${stat('TRAINING ROWS',model.trainingRows||'—','Synthetic reference telemetry')}${stat('KNOWLEDGE DOCS',sys.knowledgeDocuments??'—','Curated or manually ingested text')}${stat('WEBSOCKET CLIENTS',sys.websocketClients??'—','Connected streams')}</div><div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Anomaly model</h2><div class="card-kicker">${esc(model.version||'')}</div></div><button class="btn small" data-action="model-evaluation">Load evaluation</button></div><div class="checklist"><div class="check-item"><span>Algorithm</span><b>${esc(model.modelKind||'Isolation Forest')}</b></div><div class="check-item"><span>Features</span><b>${(model.features||[]).length}</b></div><div class="check-item"><span>Decision threshold</span><b>${niceNumber(model.threshold,2)}</b></div><div class="check-item"><span>Training data</span><b class="check-limited">Synthetic</b></div><div class="check-item"><span>Validation</span><b class="check-limited">Not clinical</b></div></div><pre id="evaluation-output" class="hint" data-u="u9"></pre></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">User accounts</h2><div class="card-kicker">Role-based access control</div></div><button class="btn small" data-action="create-user">＋ Add user</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Role</th><th>Account</th></tr></thead><tbody>${(state.users||[]).map(u=>`<tr><td>${esc(u.full_name)}<br><span class="muted">${esc(u.email)}</span></td><td>${esc(roleName(u.role))}</td><td>${u.active?'Active':'Disabled'}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Loading accounts…</td></tr>'}</tbody></table></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Missions</h2><div class="card-kicker">Mission records in local database</div></div><button class="btn small" data-action="create-mission">＋ Add mission</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Designation</th><th>Status</th><th>Start date</th></tr></thead><tbody>${(state.missions||[]).map(m=>`<tr><td>${esc(m.designation)}</td><td>${esc(m.status)}</td><td>${esc(m.start_date)}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Loading missions…</td></tr>'}</tbody></table></div></section><section class="card"><div class="card-title-row"><div><h2 class="card-title">Recent audit log</h2><div class="card-kicker">Access and administrative changes</div></div><button class="btn small" data-action="load-audit">Refresh</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Action</th><th>Account</th><th>Timestamp</th></tr></thead><tbody>${(state.audit||[]).slice(0,10).map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.user_id||'system')}</td><td>${niceDate(a.created_at)}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Load the latest audit events.</td></tr>'}</tbody></table></div></section></div>`;}
function drawDataEnhanced(){return `${pageHead('DATA SOURCES','Data import & integrations','Import timestamped measurements into a selected astronaut record. Select connected, research or simulation mode to view each source separately.', '')}<div class="grid section-grid"><section class="card"><div class="card-title-row"><div><h2 class="card-title">Import individual records</h2><div class="card-kicker">CSV or JSON · up to 5,000 rows · source and timestamp retained</div></div><span class="badge observation">${ASTRA.dataMode==='research'?'RESEARCH VIEW':ASTRA.dataMode==='connected'?'CONNECTED VIEW':'IMPORT AVAILABLE'}</span></div><form data-form="import" class="form-grid"><div class="field"><label for="import-astronaut">Astronaut</label><select class="select" id="import-astronaut" name="astronautId">${(state.dashboard?.crew||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===state.selectedId?'selected':''}>${esc(c.name)} · ${esc(c.id)}</option>`).join('')}</select></div><div class="field"><label for="import-device">Equipment assignment · optional</label><select class="select" id="import-device" name="equipmentId"><option value="">Use each row source or leave unassigned</option>${(state.equipment?.equipment||[]).map(device=>`<option value="${esc(device.id)}">${esc(device.name)} · ${esc(device.category)}</option>`).join('')}</select></div><div class="field"><label for="import-file">CSV or JSON file</label><input class="input" id="import-file" type="file" accept=".csv,.json,text/csv,application/json" required /></div><div class="field"><label for="import-class">Record category</label><select class="select" id="import-class" name="dataClass"><option value="connected">Connected / uploaded</option><option value="research">Research dataset</option></select></div><div class="field"><label for="import-source">Source label</label><input class="input" id="import-source" name="source" value="Dataset import" maxlength="120" /></div><div class="form-actions span-2"><button class="btn primary">Validate and import</button></div></form><p class="hint">CSV columns: heart_rate, hrv, spo2, respiratory_rate, temperature, activity_level, sleep_duration, recorded_at. Preserve original units and time zone in source files. Unknown units are not converted automatically.</p></section><section class="card"><h2 class="card-title">Research references</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>NASA OSDR research catalog</span><a href="https://osdr.nasa.gov/" target="_blank" rel="noopener">Browse ↗</a></div><div class="check-item"><span>NASA Standard Measures</span><a href="https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/" target="_blank" rel="noopener">Methods ↗</a></div><div class="check-item"><span>NASA HRP risk context</span><a href="https://www.nasa.gov/hrp/risks/" target="_blank" rel="noopener">Review ↗</a></div></div><p class="footer-note">OSDR contains research studies and metadata, not a real-time personal astronaut wearable feed. Inspect study population, measure definitions, time point, assay and reuse terms before importing.</p></section><section class="card span-2"><div class="card-title-row"><div><h2 class="card-title">Fitness and health app connections</h2><div class="card-kicker">Connection status is explicit. No external account or device is connected in this browser build.</div></div><span class="badge stale">NOT CONNECTED</span></div><div class="grid integration-grid"><article class="integration-card"><b>Apple HealthKit</b><p>Native iOS companion path for permitted health samples. Requires HealthKit capability and per-data-type user permission; a web page cannot read the phone’s HealthKit store directly.</p><a href="https://developer.apple.com/documentation/healthkit/configuring-healthkit-access" target="_blank" rel="noopener">Apple integration guide ↗</a></article><article class="integration-card"><b>Android Health Connect</b><p>Native Android companion path for timestamped heart-rate, sleep and activity records. Requires declared record permissions and user approval before sync.</p><a href="https://developer.android.com/health-and-fitness/health-connect" target="_blank" rel="noopener">Android integration guide ↗</a></article><article class="integration-card"><b>Garmin Health API</b><p>Partner API can provide all-day heart rate, sleep, respiration, steps and other summaries after developer program approval and individual consent.</p><a href="https://developer.garmin.com/gc-developer-program/health-api/" target="_blank" rel="noopener">Garmin program details ↗</a></article><article class="integration-card"><b>Fitbit</b><p>OAuth-authorized Web API access may provide heart-rate and activity records. ASTRA has no Fitbit client or account authorization.</p><a href="https://dev.fitbit.com/build/reference/web-api/" target="_blank" rel="noopener">Fitbit Web API docs ↗</a></article><article class="integration-card"><b>Oura</b><p>Oura API v2 provides scoped sleep, activity, readiness and heart-rate data. An API app and consent are required; no connector is configured.</p><a href="https://cloud.ouraring.com/v2/docs" target="_blank" rel="noopener">Oura API v2 docs ↗</a></article><article class="integration-card"><b>Samsung Health</b><p>Health Data SDK is a native Android path for selected records and user-permitted access. This web app has no Android companion.</p><a href="https://developer.samsung.com/health/data/guide/introduction.html" target="_blank" rel="noopener">Samsung SDK guide ↗</a></article><article class="integration-card"><b>WHOOP</b><p>OAuth scopes can expose recovery, sleep, cycle and workout summaries after application setup and user consent. No WHOOP client is configured.</p><a href="https://developer.whoop.com/api/" target="_blank" rel="noopener">WHOOP API docs ↗</a></article></div><div class="notice" data-u="u2">Current working path: authorised staff upload a CSV or JSON file; ASTRA validates allowed fields and timestamps, records the file source, marks the rows as imported, and keeps them separate from simulation data. Native app connections need their platform-specific mobile companion and consent flow.</div></section><section class="card span-2"><h2 class="card-title">Data review requirements</h2><div class="divider"></div><div class="grid section-grid"><div><b>Every point</b><p class="hint">Astronaut ID · variable · value · unit · recorded time with zone · source device/app · quality flag · import date.</p></div><div><b>Spaceflight context</b><p class="hint">Mission phase and elapsed day · personal reference source · exercise, sleep and schedule context when supplied. Missing fields remain missing.</p></div><div><b>Clinical caution</b><p class="hint">Imported measurements are not astronaut-specific thresholds. ASTRA disables its synthetic model and synthetic reference comparisons for imported records.</p></div><div><b>Privacy</b><p class="hint">Use consented, minimum-necessary records. Do not import another astronaut’s data into the wrong profile.</p></div></div></section></div>`;}
function drawSettings(){return `${pageHead('APPLICATION SETTINGS','System status & settings','Local-first operating mode and account session information.','<button class="btn" data-action="refresh">↻ Refresh status</button>')}<div class="grid section-grid"><section class="card"><h2 class="card-title">System readiness</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>Backend API</span><b class="check-good">Connected</b></div><div class="check-item"><span>SQLite persistence</span><b class="check-good">Active</b></div><div class="check-item"><span>Local model inference</span><b class="check-good">Isolation Forest ready</b></div><div class="check-item"><span>LLM provider</span><b class="${state.system?.llmConfigured?'check-good':'check-limited'}">${state.system?.llmConfigured?'Configured':'Optional / unavailable'}</b></div><div class="check-item"><span>Browser offline cache</span><b class="check-good">${'serviceWorker' in navigator?'Available':'Unavailable'}</b></div><div class="check-item"><span>Pending sync records</span><b data-pending>${state.pending}</b></div></div></section><section class="card"><h2 class="card-title">Active account</h2><div class="divider"></div><div class="checklist"><div class="check-item"><span>Name</span><b>${esc(ASTRA.user?.name)}</b></div><div class="check-item"><span>Role</span><b>${esc(roleName(ASTRA.user?.role))}</b></div><div class="check-item"><span>Session</span><b>Access token · 15 min</b></div><div class="check-item"><span>Offline record cache</span><b>IndexedDB on this browser</b></div><div class="check-item"><span>Selected data view</span><b>${esc(dataModeLabel())}</b></div></div><div class="form-actions"><button class="btn danger" data-action="logout">Sign out</button></div></section><section class="span-2 card"><h2 class="card-title">Prototype boundaries</h2><div class="divider"></div><p class="hint">ASTRA is a hackathon research prototype. It is not a certified medical device or flight-qualified onboard system. No actual spacecraft hardware is connected. Default readings and model training data are synthetic. Browser cached health records are stored in IndexedDB and are not encrypted by this prototype; use a trusted device and clear its site data when appropriate.</p><p class="hint">The demonstrator uses Node.js core modules, SQLite, local inference, lexical retrieval, and browser cache/sync. Imported mission records are isolated from simulation records; the synthetic anomaly model and sample baseline are not used to interpret mission-record mode.</p><div class="form-actions"><a class="btn" href="/docs" target="_blank">Open API reference</a><a class="btn" href="/api/openapi.json" target="_blank">Open OpenAPI JSON</a></div></section></div>`;}
function nodeIdentity(node){if(node?.nodeType!==1)return null;if(node.id)return `id:${node.id}`;if(node.hasAttribute('data-key'))return `key:${node.getAttribute('data-key')}`;if(node.hasAttribute('data-action')&&node.hasAttribute('data-id'))return `${node.getAttribute('data-action')}:${node.getAttribute('data-id')}`;return null;}
function sameNodeType(current,next){return current.nodeType===next.nodeType&&(current.nodeType!==1||current.tagName===next.tagName);}
function reconcileNode(current,next){
  if(!sameNodeType(current,next)){const replacement=next.cloneNode(true);current.replaceWith(replacement);return replacement;}
  if(current.nodeType===Node.TEXT_NODE||current.nodeType===Node.COMMENT_NODE){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return current;}
  const control=current.matches('input,select,textarea');
  const preserveValue=control&&(document.activeElement===current||current.closest('form')?.dataset.astraDirty==='true');
  const oldValue=control?current.value:null,oldChecked=control&&'checked'in current?current.checked:null;
  const selection=preserveValue&&typeof current.selectionStart==='number'?{start:current.selectionStart,end:current.selectionEnd,direction:current.selectionDirection}:null;
  const preserveOpen=current.tagName==='DETAILS'&&current.open;
  for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name)&&!(preserveValue&&['value','checked'].includes(attr.name))&&!(preserveOpen&&attr.name==='open'))current.removeAttribute(attr.name);
  for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value&&!(preserveValue&&['value','checked'].includes(attr.name))&&!(preserveOpen&&attr.name==='open'))current.setAttribute(attr.name,attr.value);
  reconcileChildren(current,next);
  if(preserveValue){
    if(current.tagName==='SELECT'){if([...current.options].some(option=>option.value===oldValue))current.value=oldValue;}
    else if(!(current.tagName==='INPUT'&&current.type==='file'))current.value=oldValue;
    if(oldChecked!==null)current.checked=oldChecked;
    if(selection)try{current.setSelectionRange(selection.start,selection.end,selection.direction);}catch{}
  }
  if(preserveOpen)current.open=true;
  return current;
}
function reconcileChildren(parent,nextParent){
  const desired=[...nextParent.childNodes];
  for(let index=0;index<desired.length;index++){
    const next=desired[index];let current=parent.childNodes[index];
    const key=nodeIdentity(next);
    if(key&&nodeIdentity(current)!==key){const match=[...parent.childNodes].slice(index+1).find(node=>nodeIdentity(node)===key);if(match){parent.insertBefore(match,current||null);current=match;}}
    if(!current)parent.appendChild(next.cloneNode(true));
    else if(sameNodeType(current,next))reconcileNode(current,next);
    else parent.replaceChild(next.cloneNode(true),current);
  }
  while(parent.childNodes.length>desired.length)parent.lastChild.remove();
}
function reconcileMarkup(target,markup){const template=document.createElement('template');template.innerHTML=markup;reconcileChildren(target,template.content);}
function reconcileStandalone(target,selector,markup,prepend=false){const template=document.createElement('template');template.innerHTML=markup.trim();const desired=template.content.firstElementChild;if(!desired)return null;const current=target.querySelector(selector);if(current)return reconcileNode(current,desired);target.insertBefore(desired,prepend?target.firstChild:null);return desired;}
const medicalCtx=()=>({ASTRA,state,selectedCrew,selectCrew,pageHead,stat,chartSvg,niceNumber});
function drawDataPagePlus(){return `${drawDataEnhanced()}<div class="grid section-grid">${drawResearchImportCard(medicalCtx())}</div>${drawResearchCatalog()}`;}
function drawAdminPlus(){return `${drawAdmin()}<div class="grid section-grid">${drawIntegrationPanel(medicalCtx())}</div>`;}
function drawPage(){clearTimeout(pendingLiveRenderTimer);pendingLiveRenderTimer=0;pendingLiveRender=false;const target=$('#page-content');if(!target)return;const painters={missions:drawMissionSelection,overview:drawOverview,crew:drawCrew,records:drawRecords,sentinel:drawSentinel,health:drawHealthEnhanced,cardiovascular:()=>drawClinicalInteractive('cardiovascular'),respiratory:()=>drawClinicalInteractive('respiratory'),sleep:()=>drawClinicalInteractive('sleep'),activity:()=>drawClinicalInteractive('activity'),immune:()=>drawResearchInteractive('immune',medicalCtx()),bone:()=>drawResearchInteractive('bone',medicalCtx()),alerts:drawAlerts,trends:drawTrends,assistant:drawAssistant,wellness:drawWellness,radiation:drawRadiation,environment:drawEnvironment,equipment:drawEquipment,reports:drawReports,simulation:drawSimulation,data:drawDataPagePlus,admin:drawAdminPlus,settings:drawSettings};reconcileMarkup(target,(painters[state.page]||drawOverview)());}

let pendingLiveRender=false,lastLiveRenderAt=0,pendingLiveRenderTimer=0;
const activeControlSelector='input,select,textarea,[contenteditable="true"]';
const liveRenderIntervalMs=700;
function flushPendingLiveRender(){
  if(!pendingLiveRender)return;
  const now=Date.now();
  const remaining=Math.max(0,liveRenderIntervalMs-(now-lastLiveRenderAt));
  if(remaining>0){if(!pendingLiveRenderTimer)pendingLiveRenderTimer=window.setTimeout(()=>{pendingLiveRenderTimer=0;flushPendingLiveRender();},remaining);return;}
  pendingLiveRender=false;lastLiveRenderAt=now;drawPage();
}
function renderLiveUpdate(){pendingLiveRender=true;flushPendingLiveRender();}
function markUserInteraction(event){if(['input','change'].includes(event.type)){const form=event.target.closest?.('form');if(form)form.dataset.astraDirty='true';}}
document.addEventListener('pointerdown',markUserInteraction,true);
document.addEventListener('keydown',markUserInteraction,true);
document.addEventListener('focusin',markUserInteraction,true);
document.addEventListener('input',markUserInteraction,true);
document.addEventListener('change',markUserInteraction,true);
document.addEventListener('focusout',()=>window.setTimeout(flushPendingLiveRender,120));

let dashboardRequestId=0;
async function refreshBase(){const requestId=++dashboardRequestId,data=await api('/api/dashboard');if(requestId!==dashboardRequestId)return;state.dashboard=data;if(!state.selectedMission||!data.crew.some(c=>c.missionId===state.selectedMission)){state.selectedMission=data.crew[0]?.missionId||'';localStorage.setItem('astra.mission',state.selectedMission);}if(!state.selectedId||!visibleCrew().some(c=>c.id===state.selectedId))state.selectedId=visibleCrew()[0]?.id||'';state.alerts=data.openAlerts||[];await countQueue();}
async function loadPageData(){
  const page=state.page,id=selectedCrew()?.id||ASTRA.user?.astronautId,mode=ASTRA.dataMode;
  const historyWindow=state.historyWindow,historyFrom=state.historyFrom,historyTo=state.historyTo,periodDays=state.periodDays;
  const stillCurrent=()=>page===state.page&&mode===ASTRA.dataMode&&id===(selectedCrew()?.id||ASTRA.user?.astronautId)&&(!['health','cardiovascular','respiratory','sleep','activity','trends'].includes(page)||(historyWindow===state.historyWindow&&historyFrom===state.historyFrom&&historyTo===state.historyTo&&periodDays===state.periodDays));
  if(!id){if(stillCurrent())state.profile=null;return stillCurrent();}
  if(page==='overview'){const [environmental,equipment,sentinel]=await Promise.all([api(`/api/environment?astronautId=${encodeURIComponent(id)}`),api(`/api/equipment?astronautId=${encodeURIComponent(id)}`),api(`/api/sentinel?astronautId=${encodeURIComponent(id)}`)]);if(!stillCurrent())return false;state.environmental=environmental;state.equipment=equipment;state.sentinel=sentinel;}
  if(page==='records'){const profile=await api(`/api/astronauts/${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.profile=profile;}
  if(['health','cardiovascular','respiratory','sleep','activity','trends'].includes(page)){
    const params=new URLSearchParams({limit:'2000'});
    if(historyWindow==='custom'){
      if(!historyFrom||!historyTo){if(stillCurrent())state.history=[];return stillCurrent();}
      const from=new Date(`${historyFrom}T00:00:00UTC`),to=new Date(`${historyTo}T00:00:00UTC`);to.setUTCDate(to.getUTCDate()+1);params.set('from',from.toISOString());params.set('to',to.toISOString());
    }else params.set('hours',historyWindow);
    const [history,trends,equipment]=await Promise.all([api(`/api/health/${encodeURIComponent(id)}/history?${params}`),api(`/api/health/${encodeURIComponent(id)}/trends?days=${periodDays}`),api(`/api/equipment?astronautId=${encodeURIComponent(id)}`)]);if(!stillCurrent())return false;state.history=history.readings||[];state.trends=trends;state.equipment=equipment;
  }
  if(page==='bone'||page==='immune'){const measurements=await api(`/api/research/measurements?astronautId=${encodeURIComponent(id)}&domain=${page}&days=365`);if(!stillCurrent())return false;state.researchMeasurements=measurements;}
  if(page==='data'){const equipment=await api(`/api/equipment?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.equipment=equipment;}
  if(page==='environment'){const environmental=await api(`/api/environment?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.environmental=environmental;}
  if(page==='equipment'){const equipment=await api(`/api/equipment?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.equipment=equipment;}
  if(page==='sentinel'){const sentinel=await api(`/api/sentinel?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.sentinel=sentinel;}
  if(page==='alerts'){const alerts=await api('/api/alerts');if(!stillCurrent())return false;state.alerts=alerts;}
  if(page==='wellness'){const wellness=await api(`/api/wellness?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.wellness=wellness;}
  if(page==='radiation'){const radiation=await api(`/api/radiation?astronautId=${encodeURIComponent(id)}`);if(!stillCurrent())return false;state.radiation=radiation;}
  if(page==='assistant'){const conversations=await api('/api/assistant/history');if(!stillCurrent())return false;state.conversations=conversations;}
  if(page==='simulation'){const simulations=await api('/api/simulation');if(!stillCurrent())return false;state.simulations=simulations;}
  if(page==='admin'){const [model,system,users,missions,integrations]=await Promise.all([api('/api/ml/model-status'),api('/api/admin/system'),api('/api/admin/users'),api('/api/admin/missions'),api('/api/admin/integrations')]);if(!stillCurrent())return false;state.model=model;state.system=system;state.users=users;state.missions=missions;state.integrations=integrations;}
  if(page==='settings'){const status=await api('/api/system/status');if(!stillCurrent())return false;state.model=status.model;state.system=status;}
  return stillCurrent();
}
async function navigate(page){if(!nav.some(x=>x[0]===page))return;document.querySelector('.sidebar')?.classList.remove('mobile-open');state.page=page;layout();try{await loadPageData();drawPage();}catch(error){toast(error.message,'error');}}
async function refreshAll(){const page=state.page,mode=ASTRA.dataMode;try{await refreshBase();if(page!==state.page||mode!==ASTRA.dataMode)return;await loadPageData();if(page!==state.page||mode!==ASTRA.dataMode)return;updateStatus();drawPage();}catch(error){if(error.status===401){clearSession();showLogin();return;}toast(error.message,'error');}}
function showLogin(error=''){
  $('#app').innerHTML=`<div class="login-page"><section class="login-hero"><div class="hero-content"><div class="hero-wordmark"><img class="brand-icon" src="/astra-mark.png" alt="" /><div><strong>ASTRA</strong><div class="brand-sub">AUTONOMOUS SPACEFLIGHT HEALTH</div></div></div><h1>Intelligent Health.<br><span>Autonomous Missions.</span><br>Safer Space Exploration.</h1><p>Local-first crew health monitoring, personal baselines and mission-support intelligence for long-duration exploration.</p><div class="hero-points"><span class="hero-point"><b>●</b> Persistent telemetry</span><span class="hero-point"><b>●</b> On-device anomaly model</span><span class="hero-point"><b>●</b> Offline-aware workflow</span></div></div></section><section class="login-panel"><div class="login-box"><div class="eyebrow">MISSION ACCESS PORTAL</div><h2>Welcome to ASTRA</h2><p>Sign in to your authorised mission workspace.</p>${error?`<div class="notice" data-u="u10">${esc(error)}</div>`:''}<form class="login-form" data-form="login"><div class="field"><label for="email">Email address</label><input class="input" id="email" name="email" type="email" autocomplete="username" placeholder="name@mission.local" required /></div><div class="field"><div class="split"><label for="password">Password</label><button class="link-button" type="button" data-action="forgot">Forgot password?</button></div><input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></div><div class="field"><label for="data-mode">Choose data view</label><select class="select" id="data-mode" name="dataMode"><option value="simulation" ${ASTRA.dataMode==='simulation'?'selected':''}>Simulated Mission Mode</option><option value="connected" ${ASTRA.dataMode==='connected'?'selected':''}>Connected Data Mode</option><option value="research" ${ASTRA.dataMode==='research'?'selected':''}>Research & Dataset Mode</option></select><span class="hint">Connected mode shows authorised imported/device records; Research mode shows study datasets; simulation is synthetic.</span></div><button class="btn primary" type="submit">Sign in to ASTRA&nbsp; →</button></form><div class="login-foot">Hackathon research prototype. Connected mode uses imported records; Research mode uses study datasets; Simulation is synthetic. No spacecraft sensor hardware is attached. Not a certified medical device. AI-assisted code and interface text; provenance: /provenance.json.</div></div></section><div class="toast-region"></div><div id="modal-root"></div></div>`;
}
async function signIn(email,password,mode='simulation'){setDataMode(mode);const session=await api('/api/auth/login',{method:'POST',body:{email,password}});setSession(session);await refreshBase();state.page='missions';layout();connectSocket();toast(`Signed in as ${roleName(ASTRA.user.role)} · ${dataModeLabel().toLowerCase()}.`,'success');}
async function logout(){try{await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:ASTRA.refresh})});}catch{}clearSession();if(socket){socket.close();socket=null;}showLogin();}
let socket,reconnectTimer,dataRefreshTimer,liveRefreshPromise=null,liveRefreshQueued=false;
async function refreshVisibleData(){
  if(!ASTRA.token||state.offline)return;
  if(liveRefreshPromise){liveRefreshQueued=true;return liveRefreshPromise;}
  liveRefreshPromise=(async()=>{
    let passes=0;
    do{
      liveRefreshQueued=false;
      const page=state.page,mode=ASTRA.dataMode,id=selectedCrew()?.id||ASTRA.user?.astronautId;
      try{
        await refreshBase();
        if(page!==state.page||mode!==ASTRA.dataMode||(id&&id!==(selectedCrew()?.id||ASTRA.user?.astronautId)))continue;
        const loaded=await loadPageData();
        if(loaded!==false&&page===state.page&&mode===ASTRA.dataMode&&(!id||id===(selectedCrew()?.id||ASTRA.user?.astronautId))){
          updateStatus();
          renderLiveUpdate();
        }
      }catch(error){
        if(error.status===401){clearSession();showLogin('Your session expired. Please sign in again.');return;}
        updateStatus();
      }
      passes++;
    }while(liveRefreshQueued&&passes<2&&ASTRA.token&&!state.offline);
  })().finally(()=>{liveRefreshPromise=null;if(liveRefreshQueued)scheduleLiveRefresh(180);});
  return liveRefreshPromise;
}
function scheduleLiveRefresh(delay=220){
  liveRefreshQueued=true;
  clearTimeout(dataRefreshTimer);
  dataRefreshTimer=window.setTimeout(()=>{dataRefreshTimer=null;refreshVisibleData();},delay);
}
async function connectSocket(){
  if(!ASTRA.token||!ASTRA.user)return;
  if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
  try{
    const grant=await api('/api/ws-ticket',{method:'POST',body:{}});
    if(!ASTRA.token)return;
    const stream=ASTRA.user.role==='astronaut'?`/ws/health/${encodeURIComponent(ASTRA.user.astronautId)}`:'/ws/mission-control';
    const wsUrl=`${location.protocol==='https:'?'wss':'ws'}://${location.host}${stream}?ticket=${encodeURIComponent(grant.ticket)}`;
    const activeSocket=new WebSocket(wsUrl);socket=activeSocket;
    activeSocket.onopen=()=>{if(socket!==activeSocket)return;state.feedStatus='connected';updateStatus();scheduleLiveRefresh(0);};
    activeSocket.onmessage=(event)=>{
      try{
        const payload=JSON.parse(event.data);
        if(payload.type==='telemetry.status'){
          state.sensorFeeds[payload.astronautId]=payload.status==='sensor_feed_disconnected'?'disconnected':'connected';
          if(state.page==='overview')renderLiveUpdate();
          toast(payload.status==='sensor_feed_disconnected'?'Telemetry scenario disconnected the sensor feed.':'Sensor feed restored.');
        }
        if(['health.reading','alert.created','sentinel.observation','environment.reading','equipment.reading','launch.phase'].includes(payload.type))scheduleLiveRefresh(180);
      }catch{}
    };
    activeSocket.onclose=()=>{if(socket!==activeSocket)return;socket=null;state.feedStatus='disconnected';updateStatus();if(ASTRA.token){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectSocket,3500);}};
    activeSocket.onerror=()=>activeSocket.close();
  }catch{state.feedStatus='disconnected';updateStatus();}
}
function updateStatus(){const chip=$('[data-connectivity]');if(chip)chip.textContent=state.offline?'OFFLINE CACHE':state.feedStatus==='connected'?'API ONLINE':'API DISCONNECTED';const dot=$('.status-chip .status-dot');if(dot)dot.className=`status-dot ${state.offline||state.feedStatus!=='connected'?'amber':''}`;const banner=$('[data-offline-banner]');if(banner)banner.classList.toggle('visible',state.offline);}
async function syncQueue(){if(!ASTRA.token||!navigator.onLine)return;const items=await idbAll('queue');if(!items.length)return;try{const result=await api('/api/sync',{method:'POST',body:{items}});for(const row of result.results||[])if(row.status==='synced')await idbDelete('queue',row.clientId);await countQueue();if(result.synced)toast(`${result.synced} offline record${result.synced===1?'':'s'} synchronised.`,'success');await refreshAll();}catch{}}
function exportHealthCsv(){const rows=state.history||[];if(!rows.length)return toast('No health samples are available in the selected window.','error');const columns=['astronautId','recordedAtUtc','equipmentId','equipmentName','heartRateBpm','hrvMs','spo2Percent','respiratoryRatePerMin','temperatureC','activityLevel','sleepDurationHours','source','dataQuality','simulated','dataClass'];const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;const csv=[columns.join(','),...rows.map(r=>[r.astronautId||selectedCrew()?.id,r.recordedAt,r.equipmentId,assignedDeviceName(r),r.heartRate,r.hrv,r.spo2,r.respiratoryRate,r.temperature,r.activityLevel,r.sleepDuration,r.source,r.dataQuality,r.simulated,r.dataClass].map(quote).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`astra-${selectedCrew()?.id||'astronaut'}-${state.historyWindow==='custom'?'custom':`${state.historyWindow}h`}-${ASTRA.dataMode}.csv`;anchor.click();URL.revokeObjectURL(url);toast(`Exported ${rows.length} health samples with source and provenance.`,'success');}
function downloadResearchTemplate(domain){const metrics=domain==='bone'?[['serum_ctx','ng/mL'],['serum_p1np','µg/L'],['lumbar_spine_bmd','g/cm²']]:domain==='immune'?[['absolute_lymphocyte_count','10^9/L'],['neutrophil_count','10^9/L'],['crp','mg/L'],['il6','pg/mL']]:null;if(!metrics)throw new Error('Unknown research template.');const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;const rows=[['metric','value','unit','recorded_at','instrument','source','data_quality','study_id','notes'],...metrics.map(([metric,unit])=>[metric,'',unit,'','','','','',''])];const blob=new Blob([rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`astra-${domain}-measurements-template.csv`;anchor.click();URL.revokeObjectURL(url);toast(`${domain} CSV template downloaded. Fill numeric values and ISO 8601 timestamps with a time-zone offset.`,'success');}async function downloadReport(format){const id=selectedCrew()?.id;if(!id)return toast('Select an astronaut first.','error');const days=Number($('#report-days')?.value||7);const hours=days*24;try{const response=await fetch(`/api/reports/${encodeURIComponent(id)}/${format}?hours=${hours}`,{headers:{Authorization:`Bearer ${ASTRA.token}`,'X-ASTRA-DATA-MODE':ASTRA.dataMode}});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Report download failed.');const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=`astra-${id.toLowerCase()}-${days}d-${ASTRA.dataMode}.${format}`;anchor.click();URL.revokeObjectURL(objectUrl);toast(`${format.toUpperCase()} report downloaded for ${dataModeLabel().toLowerCase()}.`,'success');}catch(error){toast(error.message,'error');}}
function openModal(title,body){$('#modal-root').innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="split"><h2>${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></div>${body}</section></div>`;}
function closeModal(){$('#modal-root').innerHTML='';window.setTimeout(flushPendingLiveRender,120);}
async function openAstronautForm(){const [missions,users]=await Promise.all([api('/api/admin/missions'),api('/api/admin/users')]);const officers=users.filter(user=>user.role==='medical_officer'&&user.active);if(!missions.length)throw new Error('Create a mission before adding an astronaut.');openModal('Create astronaut profile',`<form data-form="astronaut" class="form-grid"><div class="field span-2"><label for="astronaut-name">Astronaut name</label><input class="input" id="astronaut-name" name="name" required minlength="2" maxlength="100" autocomplete="off" /></div><div class="field span-2"><label for="astronaut-mission">Mission</label><select class="select" id="astronaut-mission" name="missionId" required>${missions.map(m=>`<option value="${esc(m.id)}" ${m.id===state.selectedMission?'selected':''}>${esc(m.designation)} · ${esc(m.status)} · ${esc(m.id)}</option>`).join('')}</select><span class="hint">Mission date and duration come from this mission record.</span></div><div class="field span-2"><label for="astronaut-medical-officer">Assigned medical officer</label><select class="select" id="astronaut-medical-officer" name="medicalOfficerId"><option value="">Unassigned</option>${officers.map(u=>`<option value="${esc(u.id)}">${esc(u.full_name)} · ${esc(u.email)}</option>`).join('')}</select></div><div class="form-actions span-2"><button class="btn primary" type="submit">Create astronaut profile</button><button class="btn ghost" type="button" data-action="close-modal">Cancel</button></div></form>`);}
function openUserForm(){openModal('Create user account',`<form data-form="user" class="form-grid"><div class="field"><label>Full name</label><input class="input" name="name" required /></div><div class="field"><label>Email</label><input class="input" name="email" type="email" required /></div><div class="field"><label>Role</label><select class="select" name="role"><option value="astronaut">Astronaut</option><option value="medical_officer">Medical officer</option><option value="admin">Administrator</option></select></div><div class="field"><label>Linked astronaut ID (optional)</label><input class="input" name="astronautId" /></div><div class="field span-2"><label>Initial password · at least 12 characters</label><input class="input" name="password" type="password" minlength="12" required /></div><div class="form-actions span-2"><button class="btn primary">Create account</button></div></form>`);}
function openMissionForm(){openModal('Create mission',`<form data-form="mission" class="form-grid"><div class="field span-2"><label>Mission designation</label><input class="input" name="designation" required /></div><div class="field"><label>Start date</label><input class="input" name="startDate" type="date" value="${new Date().toISOString().slice(0,10)}" required /></div><div class="field"><label>Duration · days</label><input class="input" name="durationDays" type="number" value="180" min="1" required /></div><div class="field"><label>Status</label><select class="select" name="status"><option>planned</option><option>active</option><option>completed</option></select></div><div class="form-actions span-2"><button class="btn primary">Save mission</button></div></form>`);}
function openIntegrationForm(){const missions=state.missions||[];if(!missions.length)throw new Error('Create a mission before adding an external feed.');openModal('Add external API feed',`<form data-form="integration" class="form-grid"><div class="field span-2"><label for="integration-name">Connection name</label><input class="input" id="integration-name" name="name" minlength="3" maxlength="100" placeholder="Crew wearable gateway" required /></div><div class="field span-2"><label for="integration-mission">Mission scope</label><select class="select" id="integration-mission" name="missionId" required>${missions.map(m=>`<option value="${esc(m.id)}" ${m.id===state.selectedMission?'selected':''}>${esc(m.designation)} · ${esc(m.id)}</option>`).join('')}</select></div><div class="field span-2"><span class="label">Data domains</span><label class="check-item"><input type="checkbox" name="domains" value="health" checked /> Health telemetry</label><label class="check-item"><input type="checkbox" name="domains" value="bone" /> Bone research</label><label class="check-item"><input type="checkbox" name="domains" value="immune" /> Immune research</label></div><div class="notice span-2">ASTRA will display a one-time mission-scoped API key after creation. Copy it into your approved upstream service’s secret store; it is never shown again.</div><div class="form-actions span-2"><button class="btn primary" type="submit">Issue integration key</button><button class="btn ghost" type="button" data-action="close-modal">Cancel</button></div></form>`);}function openRegistrationForm(){openModal('Request astronaut account',`<p class="footer-note">Self-registration is controlled by the local deployment and is disabled by default. When enabled, this creates an astronaut-role account. A mission administrator must link it to an astronaut profile before crew records are available.</p><form data-form="register" class="form-grid"><div class="field span-2"><label>Full name</label><input class="input" name="name" autocomplete="name" required minlength="2" maxlength="100" /></div><div class="field span-2"><label>Email address</label><input class="input" name="email" type="email" autocomplete="email" required maxlength="254" /></div><div class="field span-2"><label>Password · at least 12 characters</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="12" required /></div><div class="form-actions span-2"><button class="btn primary">Create account request</button></div></form>`);}

function openSentinelDetail(id){
  const item=(state.sentinel?.observations||[]).find(row=>row.id===id);if(!item)return toast('Observation is no longer in this view. Refresh and retry.','error');
  const row=(label,value)=>`<div class="check-item"><span>${esc(label)}</span><b>${esc(value||'Not supplied')}</b></div>`;
  const actions=(item.actions||[]).map(a=>`<div class="check-item"><span>${esc(a.action)} · ${niceDate(a.created_at)}</span><b>${esc(a.note||'No note')}</b></div>`).join('')||'<p class="hint">No review action recorded.</p>';
  openModal('SENTINEL observation',`<div class="checklist">${row('Observation ID',item.id)}${row('Affected record',item.astronautName||item.astronautId||`${item.subjectType} · ${item.subjectId}`)}${row('Mission',item.missionContext?.mission||item.missionId)}${row('Created',niceDate(item.createdAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}${row('Category / severity',`${item.category} · ${item.severity}`)}${row('Review status',item.status)}${row('Data source',item.source)}${row('Quality',item.dataQuality)}${row('Data class',item.simulated?'SIMULATED':item.dataClass)}${row('Detection method',item.detectionMethod)}</div><p class="notice" data-u="u5">${esc(item.explanation)}</p><h3 class="card-title" data-u="u11">Triggering measurement</h3><pre class="detail-json">${esc(JSON.stringify(item.measurement,null,2))}</pre><h3 class="card-title" data-u="u2">Baseline and mission context</h3><pre class="detail-json">${esc(JSON.stringify({baseline:item.baseline,mission:item.missionContext},null,2))}</pre><h3 class="card-title" data-u="u2">Review history</h3><div class="checklist">${actions}</div>`);
}

function openAlertDetail(id){const item=[...(state.alerts||[]),...(state.dashboard?.openAlerts||[])].find(row=>row.id===id);if(!item)return toast('Alert is no longer in this view. Refresh and retry.','error');openModal('Health review alert',`<div class="checklist"><div class="check-item"><span>Alert ID</span><b>${esc(item.id)}</b></div><div class="check-item"><span>Astronaut / category</span><b>${esc(item.astronautName||item.astronautId)} · ${esc(item.category)}</b></div><div class="check-item"><span>Severity / status</span><b>${esc(item.severity)} · ${esc(item.status)}</b></div><div class="check-item"><span>Created</span><b>${niceDate(item.createdAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</b></div><div class="check-item"><span>Data source / quality</span><b>${esc(item.measurement?.source||'ASTRA processing')} · ${esc(item.measurement?.data_quality||item.measurement?.dataQuality||'Not supplied')}</b></div><div class="check-item"><span>Data class</span><b>${item.simulated?'SIMULATED':esc(item.dataClass||'connected')}</b></div><div class="check-item"><span>Review history</span><b>${item.acknowledgedAt?`Acknowledged ${niceDate(item.acknowledgedAt)}`:'Not acknowledged'}${item.resolvedAt?` · Resolved ${niceDate(item.resolvedAt)}`:''}</b></div></div><p class="notice" data-u="u5">${esc(item.explanation)}</p><h3 class="card-title" data-u="u2">Measurement evidence</h3><pre class="detail-json">${esc(JSON.stringify(item.measurement,null,2))}</pre>${roleAllowsStaff()&&item.status==='open'?`<button class="btn small" data-u="u5" data-action="ack" data-id="${esc(item.id)}">Acknowledge alert</button>`:''}${roleAllowsStaff()&&item.status!=='resolved'?`<button class="btn small ghost" data-u="u5" data-action="resolve" data-id="${esc(item.id)}">Resolve alert</button>`:''}`);}

function openEnvironmentDetail(id){
  const sensor=(state.environmental?.sensors||[]).find(row=>row.id===id);if(!sensor)return toast('Sensor is no longer in this view. Refresh and retry.','error');
  const history=sensor.history||[],rows=history.slice(-20).reverse().map(r=>`<tr><td>${niceDate(r.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td><td>${niceNumber(r.value,3)} ${esc(r.unit)}</td><td>${esc(r.source)}</td><td>${esc(r.dataQuality)}</td><td>${r.simulated?'SIMULATED':esc(r.dataClass)}</td></tr>`).join('');
  openModal(`${sensor.name} · ${sensor.metric}`,`<div class="checklist"><div class="check-item"><span>Location</span><b>${esc(sensor.location)}</b></div><div class="check-item"><span>State / latest source time</span><b>${esc(sensor.status)} · ${niceDate(sensor.lastSeenAt)}</b></div><div class="check-item"><span>Declared unit</span><b>${esc(sensor.unit)}</b></div><div class="check-item"><span>Source / class</span><b>${esc(sensor.source)} · ${sensor.simulated?'SIMULATED':esc(sensor.dataClass)}</b></div></div><div class="table-wrap" data-u="u2"><table class="data-table"><thead><tr><th>Recorded</th><th>Value</th><th>Source</th><th>Quality</th><th>Class</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No readings in this data view.</td></tr>'}</tbody></table></div>${roleAllowsStaff()?`<button class="btn primary" data-u="u2" data-action="environment-add-sample" data-id="${esc(sensor.id)}">Record a sample</button>`:''}<p class="footer-note">ASTRA shows incoming source values and within-source trends; it does not apply a mission atmospheric safety limit.</p>`);
}

function openEnvironmentSample(id){
  const sensor=(state.environmental?.sensors||[]).find(s=>s.history?.some(r=>String(r.id)===String(id))),sample=sensor?.history?.find(r=>String(r.id)===String(id));
  if(!sample)return toast('Environmental sample is no longer available. Refresh and retry.','error');
  openModal('Environmental sample',`<div class="checklist"><div class="check-item"><span>Channel</span><b>${esc(sensor.name)} · ${esc(sensor.metric)}</b></div><div class="check-item"><span>Value</span><b>${niceNumber(sample.value,4)} ${esc(sample.unit)}</b></div><div class="check-item"><span>Recorded</span><b>${niceDate(sample.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</b></div><div class="check-item"><span>Source / quality</span><b>${esc(sample.source)} · ${esc(sample.dataQuality)}</b></div><div class="check-item"><span>Class</span><b>${sample.simulated?'SIMULATED':esc(sample.dataClass)}</b></div><div class="check-item"><span>Recent sensor history</span><b>${sensor.history.length} stored points</b></div></div>`);
}

function openEquipmentDetail(id){
  const device=(state.equipment?.equipment||[]).find(row=>row.id===id);if(!device)return toast('Equipment is no longer in this view. Refresh and retry.','error');
  const assignment=(state.dashboard?.crew||[]).find(person=>person.id===device.astronautId),channels=(device.signalProfile||[]).map(key=>HEALTH_METRICS[key]?.label||key).join(', ')||device.studyDomain||'No mapped vital-sign channel';
  const readings=(device.readings||[]).slice(-20).reverse().map(r=>`<tr><td>${niceDate(r.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td><td>${esc(r.metric)}</td><td>${niceNumber(r.value,3)} ${esc(r.unit)}</td><td>${esc(r.source)}</td><td>${esc(r.dataQuality)} · ${r.simulated?'SIMULATED':esc(r.dataClass)}</td></tr>`).join('');
  const healthReadings=(device.healthReadings||[]).slice(-20).reverse().map(r=>`<tr><td>${niceDate(r.recordedAt,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td><td>${niceNumber(r.heartRate,0)} bpm</td><td>${niceNumber(r.hrv,1)} ms</td><td>${niceNumber(r.spo2,1)}%</td><td>${niceNumber(r.respiratoryRate,1)} /min</td><td>${esc(r.source)} · ${esc(r.dataQuality)}</td><td><button class="btn small" data-action="reading-detail" data-id="${esc(r.id)}">Inspect</button></td></tr>`).join('');
  const maintenance=(device.maintenance||[]).map(m=>`<div class="check-item"><span>${esc(m.action)} · ${niceDate(m.created_at)}</span><b>${esc(m.note||'No note')}</b></div>`).join('')||'<p class="hint">No maintenance record.</p>';
  openModal(device.name,`<div class="checklist"><div class="check-item"><span>Assigned astronaut</span><b>${esc(assignment?.name||device.astronautId||'Unassigned')}</b></div><div class="check-item"><span>Equipment type / serial</span><b>${esc(device.category)} · ${esc(device.serialNumber)}</b></div><div class="check-item"><span>Health channels</span><b>${esc(channels)}</b></div><div class="check-item"><span>State / last seen</span><b>${esc(device.status)} · ${niceDate(device.lastSeenAt)}</b></div><div class="check-item"><span>Source / class</span><b>${esc(device.source)} · ${device.simulated?'SIMULATED':esc(device.dataClass)}</b></div><div class="check-item"><span>Source note</span><b>${esc(device.maintenanceNote||'Not supplied')}</b></div></div>${roleAllowsStaff()?`<div class="head-actions" data-u="u5">${device.status!=='operational'&&device.status!=='retired'?`<button class="btn small" data-action="equipment-status" data-id="${esc(device.id)}" data-status="operational">Mark operational</button>`:''}${device.status==='operational'?`<button class="btn small" data-action="equipment-status" data-id="${esc(device.id)}" data-status="attention">Flag attention</button><button class="btn small" data-action="equipment-status" data-id="${esc(device.id)}" data-status="disconnected">Mark disconnected</button>`:''}${device.status==='operational'&&device.signalProfile?.length?`<button class="btn small primary" data-action="equipment-record-health" data-id="${esc(device.id)}">Record vital sample</button>`:''}<button class="btn small" data-action="equipment-add-sample" data-id="${esc(device.id)}">Record battery / temperature</button></div>`:''}<h3 class="card-title" data-u="u11">Recent device readings</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded · UTC</th><th>Metric</th><th>Value</th><th>Source</th><th>Quality / class</th></tr></thead><tbody>${readings||'<tr><td colspan="5">No readings in this view.</td></tr>'}</tbody></table></div><h3 class="card-title">Health samples assigned to this device</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Recorded · UTC</th><th>Heart rate</th><th>HRV</th><th>SpO₂</th><th>Respiratory rate</th><th>Source / quality</th><th></th></tr></thead><tbody>${healthReadings||'<tr><td colspan="7">No assigned health samples in this data view.</td></tr>'}</tbody></table></div><h3 class="card-title" data-u="u2">Maintenance history</h3><div class="checklist">${maintenance}</div>${roleAllowsStaff()?`<button class="btn" data-u="u5" data-action="equipment-maintenance" data-id="${esc(device.id)}">Log maintenance</button>`:''}<p class="footer-note">Health samples are attached to this equipment ID and astronaut. Raw ECG is not available from a heart-rate summary device.</p>`);
}

function openEnvironmentalSensorForm(){const c=selectedCrew();if(!c)throw new Error('Select an astronaut first.');openModal('Register environmental sensor',`<form data-form="environment-sensor" class="form-grid"><input type="hidden" name="astronautId" value="${esc(c.id)}"/><div class="field span-2"><label>Sensor name</label><input class="input" name="name" required maxlength="100" placeholder="Cabin CO₂ sensor"/></div><div class="field"><label>Measurement</label><select class="select" name="metric"><option value="temperature">Temperature</option><option value="relative_humidity">Relative humidity</option><option value="cabin_pressure">Cabin pressure</option><option value="oxygen_partial_pressure">Oxygen partial pressure</option><option value="co2_partial_pressure">Carbon dioxide partial pressure</option><option value="air_quality_index">Air quality index</option></select></div><div class="field"><label>Unit</label><input class="input" name="unit" required placeholder="°C, kPa, % RH"/></div><div class="field"><label>Location</label><input class="input" name="location" value="Habitat cabin"/></div><div class="field"><label>Source label</label><input class="input" name="source" value="Manual / connected source" required/></div><p class="hint span-2">This registers a source record only; it does not connect spacecraft hardware. Data will be labeled for the current ${esc(dataModeLabel().toLowerCase())} view.</p><div class="form-actions span-2"><button class="btn primary">Register sensor</button></div></form>`);}

function openEquipmentForm(){
  const crew=visibleCrew();if(!crew.length)throw new Error('No astronaut is available in this mission scope.');
  const categories=[['wearable','Crew health wearable'],['cardiac_monitor','Cardiac monitor'],['pulse_oximeter','Pulse oximeter'],['respiratory_monitor','Respiratory monitor'],['temperature_sensor','Body-temperature sensor'],['exercise_equipment','Exercise equipment'],['bone_densitometer','Bone densitometer'],['immune_assay','Immune assay analyzer']];
  openModal('Register medical equipment',`<form data-form="equipment-register" class="form-grid"><div class="field span-2"><label for="equipment-astronaut">Assigned astronaut</label><select class="select" id="equipment-astronaut" name="astronautId" required>${crew.map(person=>`<option value="${esc(person.id)}" ${person.id===state.selectedId?'selected':''}>${esc(person.name)} · ${esc(person.id)}</option>`).join('')}</select></div><div class="field"><label>Equipment name</label><input class="input" name="name" required maxlength="120" placeholder="Crew health wearable"/></div><div class="field"><label>Medical equipment type</label><select class="select" name="category" required>${categories.map(([key,label])=>`<option value="${key}" ${key==='wearable'?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label>Serial or source ID</label><input class="input" name="serialNumber" required maxlength="100"/></div><div class="field"><label>Source label</label><input class="input" name="source" required value="Manual / connected source" maxlength="120"/></div><p class="hint span-2">Assignment is saved on the device record. The selected type defines accepted vital channels; bone and immune instruments are reserved for their research modules. Registration records metadata and does not connect physical hardware automatically.</p><div class="form-actions span-2"><button class="btn primary">Assign equipment</button></div></form>`);
}
function openEquipmentHealthForm(id){
  const device=(state.equipment?.equipment||[]).find(row=>row.id===id);if(!device)throw new Error('Select equipment first.');if(device.status!=='operational')throw new Error('Mark the device operational before recording a health sample.');
  const metrics=(device.signalProfile||[]).filter(key=>HEALTH_METRICS[key]);if(!metrics.length)throw new Error('This equipment type has no mapped health-sign channels.');
  openModal(`Record sample · ${device.name}`,`<form data-form="equipment-health-sample" class="form-grid"><input type="hidden" name="equipmentId" value="${esc(device.id)}"/><div class="field span-2"><label>Assigned astronaut</label><input class="input" value="${esc(selectedCrew()?.name||device.astronautId)} · ${esc(device.astronautId)}" disabled/></div>${metrics.map(key=>{const item=HEALTH_METRICS[key];return `<div class="field"><label>${esc(item.label)} · ${esc(item.unit)}</label><input class="input" name="${esc(key)}" type="number" step="any" inputmode="decimal" placeholder="Leave blank if not received"/></div>`}).join('')}<div class="field"><label>Data quality</label><select class="select" name="dataQuality"><option value="good">Good</option><option value="suspect">Suspect</option><option value="faulty">Faulty</option><option value="not_assessed">Not assessed</option></select></div><div class="field"><label>Recorded time · UTC</label><input class="input" name="recordedAt" type="datetime-local" required value="${datetimeLocalUTC()}"/></div><div class="field span-2"><label>Source label</label><input class="input" name="source" value="${esc(device.source)}" maxlength="120" required/></div><p class="hint span-2">Enter only values actually received from ${esc(device.name)}. Blank channels remain missing. The server validates assignment, device status, supported metrics, and measurement limits.</p><div class="form-actions span-2"><button class="btn primary">Save timestamped sample</button></div></form>`);
}

function openEnvironmentalSampleForm(id){const sensor=(state.environmental?.sensors||[]).find(row=>row.id===id);if(!sensor)throw new Error('Select an environmental sensor first.');openModal('Record environmental sample',`<form data-form="environment-sample" class="form-grid"><input type="hidden" name="sensorId" value="${esc(sensor.id)}"/><div class="field"><label>Metric</label><input class="input" value="${esc(sensor.metric)}" disabled/></div><div class="field"><label>Value · ${esc(sensor.unit)}</label><input class="input" name="value" type="number" step="any" required/></div><div class="field span-2"><label>Recorded time · UTC</label><input class="input" name="recordedAt" type="datetime-local" value="${datetimeLocalUTC()}"/></div><div class="field span-2"><label>Source</label><input class="input" name="source" value="${esc(sensor.source)}"/></div><div class="form-actions span-2"><button class="btn primary">Save sample</button></div></form>`);}

function openEquipmentSampleForm(id){const device=(state.equipment?.equipment||[]).find(row=>row.id===id);if(!device)throw new Error('Select equipment first.');openModal('Record equipment sample',`<form data-form="equipment-sample" class="form-grid"><input type="hidden" name="equipmentId" value="${esc(device.id)}"/><div class="field"><label>Measurement</label><select class="select" name="metric"><option value="battery_percent">Battery percent</option><option value="temperature">Temperature</option></select></div><div class="field"><label>Value</label><input class="input" name="value" type="number" step="any" required/></div><div class="field span-2"><label>Recorded time · UTC</label><input class="input" name="recordedAt" type="datetime-local" value="${datetimeLocalUTC()}"/></div><div class="field span-2"><label>Source</label><input class="input" name="source" value="${esc(device.source)}"/></div><div class="form-actions span-2"><button class="btn primary">Save sample</button></div></form>`);}

function openMaintenanceForm(id){openModal('Log equipment maintenance',`<form data-form="equipment-maintenance" class="form-grid"><input type="hidden" name="equipmentId" value="${esc(id)}"/><div class="field span-2"><label>Action</label><input class="input" name="action" required maxlength="120" placeholder="Inspection, calibration, battery replacement"/></div><div class="field span-2"><label>Notes</label><textarea class="input" name="note" rows="3" maxlength="500"></textarea></div><div class="form-actions span-2"><button class="btn primary">Save maintenance record</button></div></form>`);}

const RESEARCH_SOURCES=[
  {name:'NASA Spaceflight Standard Measures',kind:'Human-subject research measures',measures:'Actigraphy and light exposure, sleep and cognition, selected blood/saliva immune and biochemical measures, microbiome, sensorimotor and carotid assessments.',access:'Protocol-collected longitudinal measures; inspect mission/study records for availability and units.',limit:'Research observations are not a live personal health feed and do not define universal decision thresholds.',url:'https://www.nasa.gov/humans-in-space/spaceflight-standard-measures-characterizing-how-humans-adapt-in-space/'},
  {name:'NASA Open Science Data Repository (OSDR)',kind:'Public research dataset catalog',measures:'Spaceflight and analog biological/biomedical study metadata and downloadable files; variables depend on the selected study.',access:'Public catalog/API; individual records list dataset files, methods and terms.',limit:'Not a real-time astronaut monitoring API. Cohort, protocol, units and processing vary by study.',url:'https://osdr.nasa.gov/'},
  {name:'NASA GeneLab',kind:'Space biology research',measures:'Omics and related biological study data, depending on the experiment.',access:'Public study catalog and analysis resources.',limit:'Molecular research data are not interchangeable with wearable vitals or individual clinical assessments.',url:'https://genelab.nasa.gov/'},
  {name:'NASA Human Research Program',kind:'Research and risk context',measures:'Research topics include cardiovascular adaptation, sleep, behavioral health, immune changes, radiation, bone and musculoskeletal changes.',access:'Public risk and evidence summaries.',limit:'Program pages are context, not astronaut-specific measurement datasets or medical rules.',url:'https://www.nasa.gov/hrp/'},
  {name:'NASA-STD-3001 Volume 2 and ECLSS references',kind:'Human-system and environment standards',measures:'Human-system design requirements and environmental control context including atmosphere, ventilation, temperature, humidity and pressure.',access:'Public standards and NASA technical references; mission policy/configuration is required for operational limits.',limit:'ASTRA does not hard-code these standards as universal thresholds or control spacecraft systems.',url:'https://standards.nasa.gov/node/237'},
  {name:'PhysioNet MIT-BIH Arrhythmia Database',kind:'Terrestrial clinical ECG dataset',measures:'Annotated ambulatory ECG waveform samples and beat annotations.',access:'Public research access under the stated terms.',limit:'Clinical terrestrial cohort, not astronaut-specific; not bundled or used to claim astronaut ECG behavior.',url:'https://physionet.org/content/mitdb/'},
];
function drawResearchCatalog(){return `<section class="card research-catalog"><div class="card-title-row"><div><div class="eyebrow">RESEARCH & DATA CATALOG</div><h2 class="card-title">Sources, measurements and limits</h2><div class="card-kicker">Catalog metadata only. ASTRA does not claim these sources are live-connected or bundled datasets.</div></div></div><div class="grid catalog-grid">${RESEARCH_SOURCES.map(s=>`<article class="integration-card"><span class="badge">${esc(s.kind)}</span><h3>${esc(s.name)}</h3><p><b>Data:</b> ${esc(s.measures)}</p><p><b>Access:</b> ${esc(s.access)}</p><p><b>Limit:</b> ${esc(s.limit)}</p><a href="${esc(s.url)}" target="_blank" rel="noopener">Open primary source ↗</a></article>`).join('')}</div><p class="footer-note">Study datasets are not automatically calibrated for mission operations. Preserve study population, method, units, time zone and access terms when importing records.</p></section>`;}

document.addEventListener('click',async(event)=>{
  const page=event.target.closest('[data-page]');if(page){await navigate(page.dataset.page);return;}
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  try{
    if(action==='logout')return await logout();
    if(action==='refresh')return await refreshAll();
    if(action==='register'){openRegistrationForm();return;}
    if(action==='forgot'){openModal('Password recovery',`<form data-form="forgot" class="form-grid"><div class="field span-2"><label>Email address</label><input class="input" name="email" type="email" required /></div><div class="form-actions span-2"><button class="btn primary">Request reset</button></div><p class="hint span-2">Email delivery is not configured. In local development, a reset token is available only when ASTRA_ENABLE_DEV_RESET=true.</p></form>`);return;}
    if(action==='mission-select'){state.selectedMission=button.dataset.id;state.selectedId='';localStorage.setItem('astra.mission',state.selectedMission);toast(`Mission ${state.selectedMission} selected.`,'success');return navigate('crew');}
    if(action==='open-health'){state.selectedId=button.dataset.id;return navigate('health');}
    if(action==='reading-detail'){state.sentinel=await api(`/api/sentinel?astronautId=${encodeURIComponent(selectedCrew()?.id||ASTRA.user?.astronautId)}`);return openReadingDetail(button.dataset.id);}
    if(action==='alert-detail')return openAlertDetail(button.dataset.id);
    if(action==='history-custom-apply'){const from=$('[data-change="history-from"]')?.value||state.historyFrom,to=$('[data-change="history-to"]')?.value||state.historyTo;if(!from||!to||from>to)throw new Error('Choose a valid start date and end date.');state.historyFrom=from;state.historyTo=to;state.historyWindow='custom';await loadPageData();drawPage();return;}
    if(action==='export-health-csv')return exportHealthCsv();
    if(action==='sentinel-detail')return openSentinelDetail(button.dataset.id);
    if(action==='sentinel-ack'||action==='sentinel-resolve'){const verb=action==='sentinel-ack'?'acknowledge':'resolve';await api(`/api/sentinel/${encodeURIComponent(button.dataset.id)}/${verb}`,{method:'PUT',body:{note:`${roleName(ASTRA.user.role)} review`}});closeModal();toast(`SENTINEL observation ${verb}d.`,'success');return refreshAll();}
    if(action==='environment-detail')return openEnvironmentDetail(button.dataset.id);
    if(action==='environment-sample')return openEnvironmentSample(button.dataset.id);
    if(action==='environment-register')return openEnvironmentalSensorForm();
    if(action==='environment-add-sample')return openEnvironmentalSampleForm(button.dataset.id);
    if(action==='equipment-detail')return openEquipmentDetail(button.dataset.id);
    if(action==='equipment-register')return openEquipmentForm();
    if(action==='equipment-record-health')return openEquipmentHealthForm(button.dataset.id);
    if(action==='equipment-add-sample')return openEquipmentSampleForm(button.dataset.id);
    if(action==='equipment-maintenance')return openMaintenanceForm(button.dataset.id);
    if(action==='equipment-status'){await api(`/api/equipment/${encodeURIComponent(button.dataset.id)}/status`,{method:'PUT',body:{status:button.dataset.status}});closeModal();await refreshAll();toast(`Equipment status set to ${button.dataset.status}.`,'success');return;}
    if(action==='ack'||action==='resolve'){await api(`/api/alerts/${encodeURIComponent(button.dataset.id)}/${action==='ack'?'acknowledge':'resolve'}`,{method:'PUT',body:{note:''}});toast(action==='ack'?'Alert acknowledged.':'Alert resolved.','success');return refreshAll();}
    if(action==='alert-filter'){const filter=button.dataset.status;state.alerts=await api(`/api/alerts${filter?`?status=${filter}`:''}`);document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===button));return drawPage();}
    if(action==='download-report')return await downloadReport(button.dataset.format);
    if(action==='download-template')return downloadResearchTemplate(button.dataset.domain);
    if(action==='create-astronaut')return await openAstronautForm();
    if(action==='create-user')return openUserForm();
    if(action==='create-mission')return openMissionForm();
    if(action==='integration-create')return openIntegrationForm();
    if(action==='integration-revoke'){
      if(!window.confirm('Revoke this integration key now? Systems using it will stop receiving data.'))return;
      await api(`/api/admin/integrations/${encodeURIComponent(button.dataset.id)}/revoke`,{method:'PUT'});await loadPageData();drawPage();toast('Integration key revoked.','success');return;
    }
    if(action==='copy-integration-key'){
      const key=$('#issued-api-key')?.textContent;if(!key)throw new Error('No active key is displayed.');await navigator.clipboard.writeText(key);toast('Integration key copied. Store it securely; ASTRA will not show it again.','success');return;
    }
    if(action==='close-modal'){
      if(button.classList.contains('modal-backdrop')){
        if(event.target===button)closeModal();
      }else if(event.target===button){
        closeModal();
      }
      return;
    }
    if(action.startsWith('sim-')&&ASTRA.dataMode!=='simulation')throw new Error('Select Simulation data view before starting or changing a synthetic scenario.');
    if(action==='sim-start'){const c=selectedCrew();if(!c)throw new Error('Select an astronaut first.');await api('/api/simulation/start',{method:'POST',body:{astronautId:c.id,intervalMs:Number($('#sim-interval').value),speed:Number($('#sim-speed').value)}});await refreshAll();toast('Simulation started · synthetic data.','success');return;}
    if(action==='sim-pause'||action==='sim-resume'||action==='sim-stop'||action==='sim-reset'){const c=selectedCrew();await api(`/api/simulation/${action.slice(4)}`,{method:'POST',body:{astronautId:c.id}});await refreshAll();toast(`Simulation ${action.slice(4)}d.`,'success');return;}
    if(action==='sim-scenario'){const c=selectedCrew();await api('/api/simulation/scenario',{method:'POST',body:{astronautId:c.id,scenario:$('#scenario').value,intervalMs:Number($('#sim-interval').value),speed:Number($('#sim-speed').value)}});await refreshAll();toast('Scenario applied.','success');return;}
    if(action==='model-evaluation'){const result=await api('/api/ml/evaluation');const output=$('#evaluation-output');if(output)output.textContent=JSON.stringify(result,null,2);return;}
    if(action==='load-audit'){state.audit=await api('/api/admin/audit');drawPage();return;}
    if(action==='menu'){document.querySelector('.sidebar')?.classList.toggle('mobile-open');return;}
    if(action==='switch-simulation'){setDataMode('simulation');await refreshAll();toast('Simulation data view selected.','success');return;}
  }catch(error){toast(error.message,'error');}
});

document.addEventListener('change',async(event)=>{
  const target=event.target;if(target.matches('[data-change="crew"]')){state.selectedId=target.value;state.selectedTelemetryEquipment='all';await loadPageData();drawPage();}
  if(target.matches('#import-astronaut')){const select=$('#import-device');if(select){const result=await api(`/api/equipment?astronautId=${encodeURIComponent(target.value)}`);select.innerHTML=`<option value="">Use each row source or leave unassigned</option>${(result.equipment||[]).map(device=>`<option value="${esc(device.id)}">${esc(device.name)} · ${esc(device.category)}</option>`).join('')}`;}}
  if(target.matches('[data-change="data-mode"]')){setDataMode(target.value);await refreshAll();toast(`Showing ${dataModeLabel().toLowerCase()}.`,'success');}
  if(target.matches('[data-change="research-metric"]')){state.researchMetric=target.value;drawPage();}
  if(target.matches('#research-import-mission')){const astronautSelect=$('#research-import-astronaut'),options=[...astronautSelect.options];let first='';for(const option of options){option.hidden=option.dataset.mission!==target.value;if(!option.hidden&&!first)first=option.value;}if(!options.some(option=>option.value===astronautSelect.value&&!option.hidden))astronautSelect.value=first;}
  if(target.matches('[data-change="metric"]')){state.chartMetric=target.value;drawPage();}
  if(target.matches('[data-change="telemetry-device"]')){state.selectedTelemetryEquipment=target.value;drawPage();}
  if(target.matches('[data-change="period"]')){state.periodDays=Number(target.value);await loadPageData();drawPage();}
  if(target.matches('[data-change="history-window"]')){state.historyWindow=target.value;if(target.value==='custom'){state.history=[];drawPage();}else{state.historyFrom='';state.historyTo='';await loadPageData();drawPage();}}
  if(target.matches('[data-change="history-from"]'))state.historyFrom=target.value;
  if(target.matches('[data-change="history-to"]'))state.historyTo=target.value;
  if(target.matches('[data-change="environment-sensor"]')){state.selectedSensorId=target.value;drawPage();}
  if(target.matches('[data-change="sentinel-status"]')){state.sentinelStatus=target.value;drawPage();}
  if(target.matches('[data-change="sentinel-category"]')){state.sentinelCategory=target.value;drawPage();}
});
document.addEventListener('keydown',(event)=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.chart-point[data-action]')){event.preventDefault();event.target.click();}});
document.addEventListener('input',(event)=>{if(event.target.matches('[data-search="crew"]')){const query=event.target.value.toLowerCase();document.querySelectorAll('[data-crew-grid] .crew-card').forEach(card=>card.classList.toggle('hidden',!card.textContent.toLowerCase().includes(query)));}});

document.addEventListener('submit',async(event)=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();const kind=form.dataset.form,values=Object.fromEntries(new FormData(form).entries());
  try{
    if(kind==='login'){await signIn(values.email,values.password,values.dataMode);return;}
    if(kind==='register'){const result=await api('/api/auth/register',{method:'POST',body:values});closeModal();openModal('Account created',`<div class="notice">${esc(result.notice||'Your astronaut account was created. A mission administrator must link it to a crew profile before you can view mission records.')}</div><div class="form-actions" data-u="u2"><button class="btn primary" data-action="close-modal">Return to sign in</button></div>`);return;}
    if(kind==='assistant'){const message=values.message;state.messages.push({role:'user',content:message});drawPage();const result=await api('/api/assistant/chat',{method:'POST',body:{message,astronautId:selectedCrew()?.id,conversationId:state.conversationId||undefined}});state.conversationId=result.conversationId;state.messages.push({role:'assistant',content:result.answer,sources:result.sources});form.reset();delete form.dataset.astraDirty;drawPage();$('#chat-log')?.scrollTo(0,10000);return;}
    if(kind==='wellness'){const result=await api('/api/wellness',{method:'POST',body:{astronautId:selectedCrew()?.id,...values},queue:'wellness'});form.reset();delete form.dataset.astraDirty;await loadPageData();drawPage();toast(result.queued?'Wellness check-in queued for synchronisation.':'Wellness check-in saved.','success');return;}
    if(kind==='astronaut'){const created=await api('/api/astronauts',{method:'POST',body:values});closeModal();state.selectedMission=created.missionId;state.selectedId=created.id;localStorage.setItem('astra.mission',created.missionId);await refreshBase();state.page='crew';layout();toast(`${created.name} added to ${created.missionDesignation}.`,'success');return;}
    if(kind==='user'){await api('/api/admin/users',{method:'POST',body:values});closeModal();state.users=await api('/api/admin/users');drawPage();toast('User account created.','success');return;}
    if(kind==='mission'){await api('/api/admin/missions',{method:'POST',body:{...values,durationDays:Number(values.durationDays)}});closeModal();state.missions=await api('/api/admin/missions');drawPage();toast('Mission record created.','success');return;}
    if(kind==='integration'){
      const domains=[...form.querySelectorAll('input[name="domains"]:checked')].map(input=>input.value);if(!domains.length)throw new Error('Select at least one data domain.');
      const result=await api('/api/admin/integrations',{method:'POST',body:{name:values.name,missionId:values.missionId,domains}});state.integrations=await api('/api/admin/integrations');closeModal();
      openModal('External feed key created',`<div class="notice">This key is shown once. Copy it now and store it in the upstream service’s secret manager. ASTRA keeps only a hash.</div><code class="integration-key" id="issued-api-key">${esc(result.key)}</code><p class="hint">POST to <code>/api/integrations/ingest</code> with <code>Authorization: Bearer &lt;key&gt;</code>. Scope: ${esc(result.missionId)} · ${esc(result.domains.join(', '))}.</p><div class="form-actions"><button class="btn primary" data-action="copy-integration-key">Copy key</button><button class="btn ghost" data-action="close-modal">Done</button></div>`);drawPage();return;
    }
    if(kind==='forgot'){const result=await api('/api/auth/forgot-password',{method:'POST',body:values});closeModal();openModal('Password recovery response',`<div class="notice">${esc(result.message)}${result.developmentToken?`<br><br><b>Development reset token</b><br><code>${esc(result.developmentToken)}</code>`:''}</div><form data-form="reset" class="form-grid" data-u="u2"><div class="field span-2"><label>Reset token</label><input class="input" name="token" required /></div><div class="field span-2"><label>New password · at least 12 characters</label><input class="input" name="password" type="password" minlength="12" required /></div><div class="form-actions span-2"><button class="btn primary">Reset password</button></div></form>`);return;}
    if(kind==='reset'){const result=await api('/api/auth/reset-password',{method:'POST',body:values});closeModal();toast(result.reset?'Password reset. Sign in with your new password.':'Unable to reset password.','success');return;}
    if(kind==='environment-sensor'){await api('/api/environment/sensors',{method:'POST',body:{...values,simulated:ASTRA.dataMode==='simulation',dataClass:ASTRA.dataMode}});closeModal();await loadPageData();drawPage();toast(`Environmental source registered in ${dataModeLabel().toLowerCase()}.`,'success');return;}
    if(kind==='environment-sample'){const recordedAt=values.recordedAt?datetimeUTCToISO(values.recordedAt):undefined;await api('/api/environment/readings',{method:'POST',body:{sensorId:values.sensorId,value:Number(values.value),unit:state.environmental?.sensors?.find(s=>s.id===values.sensorId)?.unit,recordedAt,source:values.source,simulated:ASTRA.dataMode==='simulation',dataClass:ASTRA.dataMode}});closeModal();await loadPageData();drawPage();toast('Environmental sample saved with source and time.','success');return;}
    if(kind==='equipment-register'){await api('/api/equipment',{method:'POST',body:{...values,simulated:ASTRA.dataMode==='simulation',dataClass:ASTRA.dataMode}});closeModal();state.selectedId=values.astronautId;await loadPageData();drawPage();toast(`Equipment assigned to ${visibleCrew().find(person=>person.id===values.astronautId)?.name||values.astronautId}.`,'success');return;}
    if(kind==='equipment-health-sample'){
      if(ASTRA.dataMode==='research')throw new Error('Switch to Connected data or Simulation before recording an operational health sample.');
      const device=(state.equipment?.equipment||[]).find(row=>row.id===values.equipmentId);if(!device)throw new Error('The assigned equipment is no longer available.');
      const body={astronautId:device.astronautId,equipmentId:device.id,recordedAt:datetimeUTCToISO(values.recordedAt),source:values.source,dataQuality:values.dataQuality,simulated:ASTRA.dataMode==='simulation',dataClass:ASTRA.dataMode,allowSingle:true};let supplied=0;
      for(const metric of device.signalProfile||[]){if(!HEALTH_METRICS[metric])continue;const raw=values[metric];body[metric]=raw==null||raw.trim()===''?null:Number(raw);if(body[metric]!==null)supplied++;}
      if(!supplied)throw new Error('Enter at least one measurement actually received from this device.');
      await api('/api/health/readings',{method:'POST',body});closeModal();state.selectedTelemetryEquipment=device.id;await refreshBase();await loadPageData();drawPage();toast('Timestamped health sample recorded with astronaut and equipment provenance.','success');return;
    }
    if(kind==='equipment-sample'){const recordedAt=values.recordedAt?datetimeUTCToISO(values.recordedAt):undefined;const unit=values.metric==='battery_percent'?'%':'°C';await api('/api/equipment/readings',{method:'POST',body:{equipmentId:values.equipmentId,metric:values.metric,value:Number(values.value),unit,recordedAt,source:values.source,simulated:ASTRA.dataMode==='simulation',dataClass:ASTRA.dataMode}});closeModal();await loadPageData();drawPage();toast('Equipment sample saved with source and time.','success');return;}
    if(kind==='equipment-maintenance'){await api(`/api/equipment/${encodeURIComponent(values.equipmentId)}/maintenance`,{method:'POST',body:{action:values.action,note:values.note}});closeModal();await loadPageData();drawPage();toast('Maintenance history updated.','success');return;}
    if(kind==='research-import'){
      const file=$('#research-import-file').files[0];if(!file)throw new Error('Select a research dataset file.');const crewMember=(state.dashboard?.crew||[]).find(item=>item.id===values.astronautId);if(!crewMember||crewMember.missionId!==values.missionId)throw new Error('Choose an astronaut assigned to the selected mission.');
      const content=await file.text(),format=file.name.toLowerCase().endsWith('.json')?'json':'csv',body={astronautId:values.astronautId,missionId:values.missionId,datasetType:values.datasetType,format,dataClass:values.dataClass,source:values.source||file.name,instrument:`${values.instrumentCategory}: ${values.instrument||'instrument not specified'}`,studyId:values.studyId||''};
      if(format==='csv')body.content=content;else{const parsed=JSON.parse(content);body.records=Array.isArray(parsed)?parsed:parsed.records;}
      const result=await api('/api/data/import',{method:'POST',body});toast(`Imported ${result.accepted} of ${result.total} ${result.domain} records; ${result.rejected.length} rejected.`,'success');setDataMode(values.dataClass==='research'?'research':'connected');await refreshBase();state.selectedId=values.astronautId;await navigate(values.datasetType);return;
    }
    if(kind==='import'){const file=$('#import-file').files[0];if(!file)throw new Error('Select a dataset file.');const content=await file.text(),format=file.name.toLowerCase().endsWith('.json')?'json':'csv',body={astronautId:values.astronautId,equipmentId:values.equipmentId||undefined,format,dataClass:values.dataClass,source:values.source||file.name};if(format==='csv')body.content=content;else{const parsed=JSON.parse(content);body.records=Array.isArray(parsed)?parsed:parsed.records;}const result=await api('/api/data/import',{method:'POST',body});toast(`Imported ${result.accepted} of ${result.total} ${result.dataClass} rows; ${result.rejected.length} rejected.`,'success');setDataMode(values.dataClass==='research'?'research':'connected');await refreshBase();state.page='health';layout();await loadPageData();drawPage();return;}
  }catch(error){toast(error.message,'error');}
});

window.addEventListener('online',()=>{state.offline=false;updateStatus();syncQueue();connectSocket();scheduleLiveRefresh(0);});
window.addEventListener('offline',()=>{state.offline=true;updateStatus();toast('Network unavailable · switching to cached view.');});
window.addEventListener('focus',()=>{if(ASTRA.token)scheduleLiveRefresh(0);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ASTRA.token)scheduleLiveRefresh(0);});
async function boot(){
  showLogin(ASTRA.token?'Restoring your saved session…':'');
  countQueue();if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  if(!ASTRA.token)return;
  try{ASTRA.user=await api('/api/auth/me');await refreshBase();layout();connectSocket();await loadPageData();drawPage();}catch(error){if(error.status===401&&ASTRA.refresh){try{const session=await api('/api/auth/refresh',{method:'POST',body:{refreshToken:ASTRA.refresh}});setSession(session);await refreshBase();layout();connectSocket();}catch{clearSession();showLogin('Your session expired. Please sign in again.');}}else{clearSession();showLogin(error.message);}}
  setInterval(()=>{if(ASTRA.token&&!state.offline&&state.feedStatus!=='connected')scheduleLiveRefresh(0);},15000);
  setInterval(syncQueue,45000);
}
boot();

const baseRefreshBase = refreshBase;
refreshBase = async function () {
  await baseRefreshBase();
  if (!state.liveMonitor || !state.liveRequestedAstronaut) return;
  const requested = (state.dashboard?.crew || []).find((person) => person.id === state.liveRequestedAstronaut);
  state.liveAccessDenied = !requested;
  if (requested) {
    state.selectedId = requested.id;
    state.selectedMission = requested.missionId;
    localStorage.setItem('astra.mission', requested.missionId);
  }
};

const baseLoadPageData = loadPageData;
loadPageData = async function () {
  const page=state.page,mode=ASTRA.dataMode,id=selectedCrew()?.id||ASTRA.user?.astronautId;
  const stillCurrent=()=>page===state.page&&mode===ASTRA.dataMode&&(!id||id===(selectedCrew()?.id||ASTRA.user?.astronautId));
  if (state.liveAccessDenied) return false;
  if (page === 'missions' && ['admin','medical_officer'].includes(ASTRA.user?.role)) {
    const missions=await api('/api/admin/missions');
    if(!stillCurrent())return false;
    state.missions=missions;
  }
  const loaded=await baseLoadPageData();
  if(loaded===false||!stillCurrent())return false;
  if (page === 'launch') {
    if (id) {const environmental=await api('/api/environment?astronautId=' + encodeURIComponent(id));if(!stillCurrent())return false;state.environmental=environmental;}
  }
  if (state.liveMonitor && page === 'health') {
    if (id) {
      const [environmental,equipment,radiation] = await Promise.all([
        api('/api/environment?astronautId=' + encodeURIComponent(id)),
        api('/api/equipment?astronautId=' + encodeURIComponent(id)),
        api('/api/radiation?astronautId=' + encodeURIComponent(id)),
      ]);
      if(!stillCurrent())return false;
      state.environmental = environmental;
      state.equipment = equipment;
      state.radiation = radiation;
    }
  }
  return stillCurrent();
};

const baseSignIn = signIn;
signIn = async function (email, password, mode = 'simulation') {
  await baseSignIn(email, password, mode);
  if (initialRoute.get('view') === 'live') {
    state.liveMonitor = true;
    state.liveRequestedAstronaut = initialRoute.get('astronaut') || '';
    state.page = 'health';
  }
  await refreshBase();
  await loadPageData();
  drawPage();
};

const baseDrawPage = drawPage;
drawPage = function () {
  const target = $('#page-content');
  if (!target) return;
  if (state.liveAccessDenied) {
    reconcileMarkup(target,'<section class="card"><div class="eyebrow">ACCESS DENIED</div><h1>Astronaut record unavailable</h1><p class="muted">This account is not authorised to view the requested astronaut data.</p></section>');
    return;
  }
  if (state.page === 'launch') {
    reconcileMarkup(target,drawLaunch({
      crew: selectedCrew(),
      environmental: state.environmental,
      alerts: state.dashboard?.openAlerts || [],
      phase: state.launchPhase,
      role: ASTRA.user?.role || '',
      mode: ASTRA.dataMode,
      feedStatus: state.feedStatus,
      missionDay,
    }));
  } else if (state.page === 'missions' && ['admin','medical_officer'].includes(ASTRA.user?.role)) {
    reconcileMarkup(target,drawMissionAccess({
      missions: state.missions || [],
      crew: state.dashboard?.crew || [],
      isAdmin: ASTRA.user?.role === 'admin',
      missionDay,
    }));
  } else {
    baseDrawPage();
  }
  document.body.classList.toggle('live-monitor', Boolean(state.liveMonitor));
  const liveMonitorPage=state.liveMonitor&&state.page==='health';
  if(!liveMonitorPage){target.querySelector('.live-monitor-flag')?.remove();target.querySelector('.live-streams')?.remove();}
  if (state.page === 'health') {
    const crew = selectedCrew();
    const actions = target.querySelector('.page-head .head-actions');
    if (crew && actions && !actions.querySelector('[data-live-monitor-link]')) {
      const link = document.createElement('a');
      link.className = 'btn';
      link.dataset.liveMonitorLink = 'true';
      link.href = state.liveMonitor ? '/?astronaut=' + encodeURIComponent(crew.id) : '/?view=live&astronaut=' + encodeURIComponent(crew.id);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = state.liveMonitor ? 'Open full health record ↗' : 'Open live monitor ↗';
      actions.prepend(link);
    }
    if (state.liveMonitor) {
      reconcileStandalone(target,'.live-monitor-flag','<div class="live-monitor-flag"><i class="status-dot"></i> Live monitor · authorised scope · ' + esc(dataModeLabel()) + '</div>',true);
      reconcileStandalone(target,'.live-streams',drawLiveTelemetry({environmental:state.environmental,equipment:state.equipment,radiation:state.radiation||[]}));
    }
  }
};

drawAlerts = function () {
  const all = state.alerts || [];
  const status = state.alertStatus || '';
  const visible = status ? all.filter((alert) => alert.status === status) : all;
  const open = all.filter((alert) => alert.status === 'open');
  const critical = open.filter((alert) => alert.severity.includes('CRITICAL')).length;
  const warning = open.filter((alert) => alert.severity === 'WARNING').length;
  const tabs = [['','All alerts'],['open','Open'],['acknowledged','Acknowledged'],['resolved','Resolved']]
    .map(([value,label]) => '<button class="tab ' + (status === value ? 'active' : '') + '" data-action="alert-filter" data-status="' + value + '">' + label + '</button>').join('');
  return pageHead('MEDICAL REVIEW','Alert management','Live, source-labeled monitoring prompts with evidence and review history.',roleAllowsStaff()?'<button class="btn" data-action="refresh">↻ Refresh</button>':'')
    + '<div class="grid stats-grid">' + stat('OPEN ALERTS',open.length,'Awaiting review') + stat('CRITICAL REVIEW',critical,'Highest-priority review prompts',critical?'':'stat-accent') + stat('WARNINGS',warning,'Data quality or trend prompts') + stat('TOTAL RECORDS',all.length,'Across the selected data view') + '</div>'
    + '<div class="tabs">' + tabs + '</div><section class="card">' + alertCards(visible,100) + '</section>'
    + '<p class="footer-note">Alerts include source, timestamp, quality and evidence. Acknowledge records review; resolve them only after follow-up. Alerts are not diagnoses or mission clearance decisions.</p>';
};

document.addEventListener('click', (event) => {
  const filter = event.target.closest('[data-action="alert-filter"]');
  if (!filter) return;
  state.alertStatus = filter.dataset.status || '';
  event.preventDefault();
  event.stopImmediatePropagation();
  drawPage();
}, true);

let launchRunSequence = 0;
const launchSequencePhases = ['countdown','liftoff','ascent','stage-separation','orbit-insertion','on-orbit','entry','landing'];
function stopLaunchSequence() {
  launchRunSequence += 1;
  clearTimeout(state.launchTimer);
  state.launchTimer = null;
}
async function recordLaunchPhase(phase) {
  if (ASTRA.dataMode !== 'simulation') throw new Error('Switch to Simulated Mission Mode to record a launch rehearsal.');
  const astronautId = selectedCrew()?.id;
  if (!astronautId) throw new Error('Select an astronaut before running the launch rehearsal.');
  const result = await api('/api/simulation/launch-phase', { method:'POST', body:{ astronautId, phase } });
  state.launchPhase = result.phase;
  await refreshBase();
  await loadPageData();
  if (state.page === 'launch') drawPage();
  return result;
}
async function runLaunchSequence(runId, index = 0) {
  if (runId !== launchRunSequence) return;
  if (index >= launchSequencePhases.length) {
    state.launchTimer = null;
    toast('Launch rehearsal complete. Synthetic phase samples are available in the telemetry details.','success');
    return;
  }
  try {
    await recordLaunchPhase(launchSequencePhases[index]);
    if (runId === launchRunSequence) state.launchTimer = setTimeout(() => runLaunchSequence(runId,index+1),3500);
  } catch (error) {
    stopLaunchSequence();
    toast(error.message,'error');
  }
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'launch-stop') {
    stopLaunchSequence();
    toast('Launch rehearsal stopped.');
    return;
  }
  if (action === 'launch-sequence') {
    event.preventDefault();
    stopLaunchSequence();
    const runId = launchRunSequence;
    await runLaunchSequence(runId,0);
    return;
  }
  if (action === 'launch-phase') {
    event.preventDefault();
    stopLaunchSequence();
    try {
      const result = await recordLaunchPhase(button.dataset.phase);
      toast(result.phaseLabel + ' snapshot recorded as synthetic telemetry.','success');
    } catch (error) {
      toast(error.message,'error');
    }
  }
});

const baseConnectSocket = connectSocket;
const hookedSockets = new WeakSet();
connectSocket = async function () {
  await baseConnectSocket();
  if (!socket || hookedSockets.has(socket)) return;
  hookedSockets.add(socket);
  socket.addEventListener('message',(event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'alert.created' && payload.alert) {
        const alert = payload.alert;
        toast('New ' + alert.severity + ' alert · ' + alert.title,'error');
      }
      if (payload.type === 'launch.phase') {
        state.launchPhase = payload.phase;
        scheduleLiveRefresh(180);
      }
    } catch {}
  });
};

const baseShowLogin = showLogin;
showLogin = function (error = '') {
  baseShowLogin(error);
  const content = document.querySelector('.hero-content');
  if (!content || content.querySelector('.nasa-credit')) return;
  const credit = document.createElement('a');
  credit.className = 'nasa-credit';
  credit.href = 'https://www.nasa.gov/image-article/artemis-i-launch-3/';
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  credit.textContent = 'Artemis I · NASA / Joel Kowsky · View image source ↗';
  content.append(credit);
};
if (!ASTRA.token) showLogin();

openEnvironmentalSensorForm = function () {
  const crew = selectedCrew();
  if (!crew) throw new Error('Select an astronaut first.');
  const metrics = [
    ['temperature','Cabin temperature','°C'],['relative_humidity','Relative humidity','% RH'],
    ['cabin_pressure','Cabin pressure','kPa'],['oxygen_partial_pressure','Oxygen partial pressure','kPa'],
    ['co2_partial_pressure','Carbon dioxide partial pressure','kPa'],['air_quality_index','Air quality index','index'],
    ['acceleration_g','Vehicle acceleration','g'],['vibration_rms_g','Vehicle vibration RMS','g RMS'],
    ['vehicle_altitude_km','Vehicle altitude','km'],['vehicle_velocity_km_s','Vehicle velocity','km/s'],
    ['suit_pressure','Suit pressure','kPa'],['suit_temperature','Suit temperature','°C'],
    ['radiation_dose_rate','Radiation dose rate','mSv/h'],
  ];
  const options = metrics.map(([value,label]) => '<option value="' + esc(value) + '">' + esc(label) + '</option>').join('');
  openModal('Register environmental sensor','<form data-form="environment-sensor" class="form-grid"><input type="hidden" name="astronautId" value="' + esc(crew.id) + '"/><div class="field span-2"><label>Sensor name</label><input class="input" name="name" required maxlength="100" placeholder="Cabin CO₂ or suit monitor"/></div><div class="field"><label>Measurement</label><select class="select" name="metric">' + options + '</select></div><div class="field"><label>Unit</label><input class="input" name="unit" required placeholder="Choose the unit shown in the selected sensor specification"/></div><div class="field"><label>Location</label><input class="input" name="location" value="Habitat cabin"/></div><div class="field"><label>Source label</label><input class="input" name="source" value="Manual / connected source" required/></div><p class="hint span-2">Registration stores source metadata only. It does not connect spacecraft hardware. Data is labeled for the current ' + esc(dataModeLabel().toLowerCase()) + ' view.</p><div class="form-actions span-2"><button class="btn primary">Register sensor</button></div></form>');
};

// Keep the cached PWA shell useful when its local API server is not running.
const SERVER_UNREACHABLE_MESSAGE = 'ASTRA cannot reach its local server. Start it with Start-ASTRA.cmd, keep the server window open, then retry.';
const requestApiWithDiagnostics = api;
api = async function (path, options = {}) {
  try {
    return await requestApiWithDiagnostics(path, options);
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      const unavailable = new Error(SERVER_UNREACHABLE_MESSAGE);
      unavailable.code = 'server_unreachable';
      unavailable.cause = error;
      throw unavailable;
    }
    throw error;
  }
};

let loginHealthTimer = 0;
let loginHealthCheck = 0;
let loginInFlight = false;
function setLoginFeedback(message, isError = false) {
  const feedback = document.querySelector('[data-login-feedback]');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle('is-error', isError);
  feedback.setAttribute('role', isError ? 'alert' : 'status');
}
async function checkLoginServer() {
  const status = document.querySelector('[data-astra-server-status]');
  if (!status) return;
  const check = ++loginHealthCheck;
  status.dataset.state = 'checking';
  status.querySelector('[data-status-copy]').textContent = 'Checking ASTRA server…';
  try {
    const response = await fetch('/api/healthz', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (check !== loginHealthCheck || !status.isConnected) return;
    status.dataset.state = 'online';
    status.querySelector('[data-status-copy]').textContent = health.database
      ? 'ASTRA server online · local database ready'
      : 'ASTRA server online · database setup required';
    const staleNotice = document.querySelector('.login-box .notice[data-u="u10"]');
    if (staleNotice?.textContent.trim() === SERVER_UNREACHABLE_MESSAGE) staleNotice.remove();
    const staleFeedback = document.querySelector('[data-login-feedback]');
    if (staleFeedback?.textContent.trim() === SERVER_UNREACHABLE_MESSAGE) setLoginFeedback('');
  } catch {
    if (check !== loginHealthCheck || !status.isConnected) return;
    status.dataset.state = 'offline';
    status.querySelector('[data-status-copy]').textContent = 'ASTRA server unavailable · start Start-ASTRA.cmd';
  }
}
function attachLoginDiagnostics() {
  const box = document.querySelector('.login-box');
  if (!box) return;
  let feedback = box.querySelector('[data-login-feedback]');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.className = 'login-feedback';
    feedback.dataset.loginFeedback = '';
    feedback.hidden = true;
    box.querySelector('.login-form')?.before(feedback);
  }
  let status = box.querySelector('[data-astra-server-status]');
  if (!status) {
    status = document.createElement('div');
    status.className = 'server-status';
    status.dataset.astraServerStatus = '';
    status.dataset.state = 'checking';
    status.innerHTML = '<span class="server-status-dot" aria-hidden="true"></span><span data-status-copy>Checking ASTRA server…</span><button class="link-button" type="button" data-action="check-server">Retry</button>';
    box.querySelector('.login-form')?.before(status);
  }
  clearInterval(loginHealthTimer);
  void checkLoginServer();
  loginHealthTimer = window.setInterval(() => {
    if (!document.querySelector('[data-form="login"]')) { clearInterval(loginHealthTimer); return; }
    void checkLoginServer();
  }, 15000);
}

const showLoginWithStatus = showLogin;
showLogin = function (error = '') {
  showLoginWithStatus(error);
  attachLoginDiagnostics();
};

const signInWithDiagnostics = signIn;
signIn = async function (email, password, mode = 'simulation') {
  if (loginInFlight) return false;
  loginInFlight = true;
  const loginButton = document.querySelector('[data-form="login"] button[type="submit"]');
  if (loginButton) { loginButton.disabled = true; loginButton.textContent = 'Connecting to ASTRA…'; }
  setLoginFeedback('Signing in securely…');
  try {
    await signInWithDiagnostics(email, password, mode);
    clearInterval(loginHealthTimer);
    return true;
  } catch (error) {
    if (document.querySelector('[data-form="login"]')) setLoginFeedback(error.message || 'Sign-in failed. Check your details and retry.', true);
    else toast(error.message || 'The mission workspace did not finish loading. Retry the page.', 'error');
    if (error.code === 'server_unreachable') void checkLoginServer();
    return false;
  } finally {
    loginInFlight = false;
    if (loginButton?.isConnected) { loginButton.disabled = false; loginButton.textContent = 'Sign in to ASTRA  →'; }
  }
};

document.addEventListener('click', (event) => {
  const retry = event.target.closest('[data-action="check-server"]');
  if (!retry) return;
  event.preventDefault();
  void checkLoginServer();
});

if (!ASTRA.token) showLogin();
