/* COMMON (utils, API, storage, app wiring) */
moment.tz.setDefault('Asia/Seoul');
const API='https://www.googleapis.com/youtube/v3/';
let currentMutantPeriod='6m';

/* API 키 — youtubeApiKeys/apiKeys 호환 */
let apiKeys = JSON.parse(localStorage.getItem('youtubeApiKeys') || localStorage.getItem('apiKeys') || '[]');
if (!localStorage.getItem('youtubeApiKeys') && localStorage.getItem('apiKeys')) {
  localStorage.setItem('youtubeApiKeys', localStorage.getItem('apiKeys'));
}
let keyIdx=0;
function setApiKeys(keys){
  apiKeys = keys.filter(Boolean);
  keyIdx = 0;
  localStorage.setItem('youtubeApiKeys', JSON.stringify(apiKeys));
  localStorage.setItem('apiKeys', JSON.stringify(apiKeys));
}
function nextKey(){ if(apiKeys.length>1) keyIdx=(keyIdx+1)%apiKeys.length; }
function hasKeys(){ return apiKeys.length>0; }

/* IndexedDB */
let db=null;
function openDB(){ return new Promise((res,rej)=>{ if(db) return res(db); const r=indexedDB.open('myChannelDB',4);
  r.onupgradeneeded=e=>{ db=e.target.result;
    if(!db.objectStoreNames.contains('my_channels')) db.createObjectStore('my_channels',{keyPath:'id'});
    if(!db.objectStoreNames.contains('insights')) db.createObjectStore('insights',{keyPath:'channelId'});
    if(!db.objectStoreNames.contains('dailySubs')) db.createObjectStore('dailySubs',{keyPath:['channelId','date']});
    if(!db.objectStoreNames.contains('doneVideos')) db.createObjectStore('doneVideos',{keyPath:['channelId','videoId']});
  };
  r.onsuccess=e=>{ db=e.target.result; res(db); };
  r.onerror=e=>rej(e);
});}
function idbAll(store){ return openDB().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const s=tx.objectStore(store); const q=s.getAll(); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error);})); }
function idbGet(store,key){ return openDB().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(store,'readonly'); const s=tx.objectStore(store); const q=s.get(key); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error);})); }
function idbPut(store,obj){ return openDB().then(db=>new Promise((res,rej)=>{ try{ const tx=db.transaction(store,'readwrite'); const s=tx.objectStore(store); const q=s.put(obj); q.onsuccess=()=>res(); q.onerror=()=>rej(q.error); tx.onerror=()=>rej(tx.error);}catch(e){rej(e);} })); }
function idbDel(store,key){ return openDB().then(db=>new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); const s=tx.objectStore(store); const q=s.delete(key); q.onsuccess=()=>res(); q.onerror=()=>rej(q.error);})); }

/* 유틸 */
const qs=id=>document.getElementById(id);
const fmt=n=>{ const x=parseInt(n||'0',10); return isNaN(x)?'0':x.toLocaleString(); };
const seconds=iso=>moment.duration(iso).asSeconds();
const stopWords=new Set(['은','는','이','가','을','를','에','의','와','과','도','로','으로','the','a','an','of','to','in','on','for','and','or','but','with','about','into','에서','같은','뿐','위해','합니다','했다','하는','하기','진짜','무너졌다']);
function toast(msg,ms=1800){ const t=qs('toast'); if(!t) return; t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',ms); }
function showError(elementId, message){ const el=qs(elementId); if(el) el.innerHTML = `<div class="error-message">${message}</div>`; }
function showSuccess(elementId, message){ const el=qs(elementId); if(el) el.innerHTML = `<div class="success-message">${message}</div>`; }
function extractKeywords(text){
    const freq = new Map();
    if (!text) return [];
    text.replace(/[#"'.!?()/\-:;\[\]{}|<>~^%$@*&+=]/g,' ').split(/\s+/).forEach(w=>{
      w=w.trim().toLowerCase(); const hasKo=/[가-힣]/.test(w);
      if(!w) return;
      if((hasKo && w.length<2) || (!hasKo && w.length<3)) return;
      if(stopWords.has(w)) return;
      freq.set(w, (freq.get(w)||0)+1);
    });
    return [...freq.entries()].sort((a,b)=>b[1]-a[1]);
}

/* API 호출(순환키+타임아웃) */
async function yt(endpoint,params,attempt=0){
  if(!apiKeys.length) throw new Error('API 키가 설정되지 않았습니다. API 키를 먼저 입력해주세요.');
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort('timeout'),30000);
  const p=new URLSearchParams(params); p.set('key',apiKeys[keyIdx]);
  const url=API+endpoint+'?'+p.toString();
  try{
    const r=await fetch(url,{signal:ctrl.signal}); const data=await r.json(); clearTimeout(t);
    if(data.error){
      if(data.error.code===403 && /quota/i.test(data.error.message||'')) throw new Error('API 할당량이 초과되었습니다.');
      if(attempt<apiKeys.length-1){ nextKey(); return yt(endpoint,params,attempt+1); }
      throw new Error(data.error.message||'API 오류');
    }
    return data;
  }catch(e){
    clearTimeout(t);
    if(attempt<apiKeys.length-1){ nextKey(); return yt(endpoint,params,attempt+1); }
    throw e;
  }
}

/* 채널 목록 내보내기/가져오기 */
async function exportChannels(){
  const list = await getAllChannels();
  const data = { version: 1, exportedAt: new Date().toISOString(), channels: list.map(c => ({ id: c.id, title: c.title })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'channels-export.json';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
  toast('채널 목록을 다운로드했습니다.');
}

async function importChannelsFromFile(file){
  try{
    const txt = await file.text();
    const parsed = JSON.parse(txt);
    let ids = [];
    if(Array.isArray(parsed)){
      ids = parsed.map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    }else if(parsed && Array.isArray(parsed.channels)){
      ids = parsed.channels.map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    }else{
      ids = Object.values(parsed).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    }
    ids = Array.from(new Set(ids));
    if(!ids.length){ toast('가져올 채널 ID가 없습니다.'); return; }

    const exist = await getAllChannels();
    const existIds = new Set(exist.map(c=>c.id));
    const toAdd = ids.filter(id => !existIds.has(id));

    let ok=0, fail=0;
    for(const id of toAdd){
      try{ await addChannelById(id); ok++; }catch(e){ console.error('채널 추가 실패', id, e); fail++; }
    }
    toast(`가져오기 완료: ${ok}개 추가${fail?`, 실패 ${fail}개`:''} (중복 제외)`);
    refreshAll('channels');
  }catch(e){
    console.error(e);
    toast('가져오는 중 오류가 발생했습니다.');
  }
}

/* 공통 초기화(테마/드래그/모달/버튼) */
function toggleTheme(){
  const body=document.body;
  const btn=qs('btn-toggle-theme');
  if(body.classList.contains('dark')){
    body.classList.remove('dark');
    body.classList.add('light');
    if(btn) btn.textContent='다크 모드';
    localStorage.setItem('theme','light');
  } else {
    body.classList.remove('light');
    body.classList.add('dark');
    if(btn) btn.textContent='라이트 모드';
    localStorage.setItem('theme','dark');
  }
}
function loadTheme(){
  const savedTheme=localStorage.getItem('theme')||'dark';
  document.body.classList.add(savedTheme);
  const btn=qs('btn-toggle-theme');
  if(btn) btn.textContent = savedTheme==='dark' ? '라이트 모드' : '다크 모드';
}
function initDrag(){
  const el=qs('main-content'); if(!el) return;
  const saved=localStorage.getItem('colOrder');
  if(saved){ saved.split(',').forEach(k=>{ const sec=el.querySelector(`[data-col="${k}"]`); if(sec) el.appendChild(sec); }); }
  Sortable.create(el,{animation:150,handle:'.col-head',onSort:()=>{const keys=[...el.children].map(n=>n.getAttribute('data-col')); localStorage.setItem('colOrder',keys.join(','));}});
}

/* 페이지 공통 init */
document.addEventListener('DOMContentLoaded',()=>{
  loadTheme();
  initDrag();
  const tbtn=qs('btn-toggle-theme'); if(tbtn) tbtn.onclick=toggleTheme;

  // 내보내기/가져오기
  const ex=qs('btn-export-channels'); if(ex) ex.onclick=exportChannels;
  const im=qs('btn-import-channels'); if(im) im.onclick=()=>qs('file-import-channels').click();
  const file=qs('file-import-channels'); if(file) file.onchange=(e)=>{ const f=e.target.files[0]; if(f) importChannelsFromFile(f); e.target.value=''; };

  // API 키 모달
  const apiBtn=qs('btn-api');
  if(apiBtn){
    apiBtn.onclick=()=>{ const box=qs('api-inputs'); if(box){ box.innerHTML=''; for(let i=0;i<5;i++){ box.insertAdjacentHTML('beforeend',`<input class="api-inp" placeholder="API Key ${i+1}" value="${apiKeys[i]||''}">`);} qs('api-test-result').textContent=''; } document.getElementById('modal-api').style.display='flex'; };
  }
  document.querySelectorAll('.close').forEach(x=>x.onclick=e=>{ const id=e.target.dataset.close; if(id) document.getElementById(id).style.display='none'; });

  const apiFileBtn=qs('api-file-btn'); if(apiFileBtn) apiFileBtn.onclick=()=>qs('api-file').click();
  const apiFile=qs('api-file');
  if(apiFile){
    apiFile.onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ const keys=r.result.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,5); const box=qs('api-inputs'); box.innerHTML=''; for(let i=0;i<5;i++){ box.insertAdjacentHTML('beforeend',`<input class="api-inp" placeholder="API Key ${i+1}" value="${keys[i]||''}">`);} qs('api-test-result').textContent='파일에서 불러왔습니다. [저장]을 눌러 반영하세요.'; }; r.readAsText(f); };
  }
  const apiSave=qs('api-save'); if(apiSave) apiSave.onclick=()=>{ const keys=[...document.querySelectorAll('.api-inp')].map(i=>i.value.trim()).filter(Boolean); setApiKeys(keys); toast('API 키가 저장되었습니다.'); qs('api-test-result').textContent=''; document.getElementById('modal-api').style.display='none'; refreshAll(); };
  const apiDl=qs('api-download'); if(apiDl) apiDl.onclick=()=>{ if(!apiKeys.length){ toast('저장된 키가 없습니다.'); return; } const blob=new Blob([apiKeys.join('\n')],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='api_keys.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const apiTest=qs('api-test'); if(apiTest) apiTest.onclick=async()=>{ const keys=[...document.querySelectorAll('.api-inp')].map(i=>i.value.trim()).filter(Boolean); const testKeys=keys.length?keys:apiKeys; if(!testKeys.length){ qs('api-test-result').innerHTML='<span class="test-bad">저장된 키가 없습니다.</span>'; return; } qs('api-test-result').textContent='API 키 테스트 중...'; let ok=false,lastErr=''; for(const k of testKeys){ try{ const u=`${API}channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${encodeURIComponent(k)}`; const r=await fetch(u); const j=await r.json(); if(!j.error){ ok=true; break; } lastErr=j.error.message||JSON.stringify(j.error); }catch(e){ lastErr=e.message||String(e); } } qs('api-test-result').innerHTML= ok? '<span class="test-ok">✓ API 키가 정상적으로 작동합니다!</span>' : `<span class="test-bad">✗ API 키 테스트 실패: ${lastErr}<br><small>Google Cloud Console에서 YouTube Data API v3 활성화 및 리퍼러 설정을 확인해주세요.</small></span>`; };

  // 탭/기간 버튼 공통 델리게이션
  document.addEventListener('click',e=>{
    if(e.target.classList.contains('tab')){
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tabpanel').forEach(p=>p.classList.remove('active'));
      e.target.classList.add('active'); document.getElementById(e.target.dataset.tab).classList.add('active');
    }
    if(e.target.dataset.period){
      document.querySelectorAll('[data-period]').forEach(b=>b.classList.remove('active'));
      e.target.classList.add('active'); currentMutantPeriod=e.target.dataset.period; refreshAll('mutant');
    }
  });

  // 채널 추가 모달
  const addBtn=qs('btn-add-channel'); if(addBtn) addBtn.onclick=()=>{ if(!hasKeys()){ toast('먼저 API 키를 설정해주세요.'); return; } document.getElementById('modal-add').style.display='flex'; };

  // 채널 분석 버튼 (모달에서 채널 선택 후 analysis.html로 이동)
  const analyzeBtn=qs('btn-analyze');
  if(analyzeBtn){
    analyzeBtn.onclick = openAnalyzeModal;
  }

  // 첫 화면 초기 렌더
  refreshAll();
});

/* ----- 섹션 간 공용: 채널 DB helpers ----- */
async function getAllChannels(){ return idbAll('my_channels'); }
async function deleteChannel(id){ await idbDel('my_channels',id); await idbDel('insights',id); }
function sortChannels(list,mode){
  if(mode==='videos') list.sort((a,b)=>parseInt(b.videoCount||'0')-parseInt(a.videoCount||'0'));
  else if(mode==='latest') list.sort((a,b)=>new Date(b.latestUploadDate||0)-new Date(a.latestUploadDate||0));
  else list.sort((a,b)=>parseInt(b.subscriberCount||'0')-parseInt(a.subscriberCount||'0'));
}
async function ensureUploadsAndLatest(ch){
  if(ch.uploadsPlaylistId && ch.latestUploadDate) return ch;
  const info=await yt('channels',{part:'contentDetails',id:ch.id});
  ch.uploadsPlaylistId=info.items?.[0]?.contentDetails?.relatedPlaylists?.uploads||'';
  if(ch.uploadsPlaylistId){
    const pl=await yt('playlistItems',{part:'snippet',playlistId:ch.uploadsPlaylistId,maxResults:1});
    if(pl.items && pl.items[0]) ch.latestUploadDate=pl.items[0].snippet.publishedAt;
  }
  await idbPut('my_channels',ch); return ch;
}
async function getYesterdaySubCount(ch){
  const y=moment().subtract(1,'day').format('YYYY-MM-DD');
  const rec=await idbGet('dailySubs',[ch.id,y]); return rec? rec.subCount:null;
}
async function updateDailySubSnapshot(ch){
  const today=moment().format('YYYY-MM-DD');
  const ex=await idbGet('dailySubs',[ch.id,today]);
  if(!ex) await idbPut('dailySubs',{channelId:ch.id,date:today,subCount:parseInt(ch.subscriberCount||'0',10)});
}

/* 공용: 비디오 렌더 & 정렬 */
function renderVideoList(videos,listId,kwId){
  const wrap=qs(listId);
  if(!wrap) return;
  if(!videos.length){ wrap.innerHTML='<p class="muted">표시할 영상이 없습니다.</p>'; if(kwId && qs(kwId)) qs(kwId).innerHTML=''; return; }
  wrap.innerHTML='';
  videos.forEach(v=>{
    const card=document.createElement('div'); card.className='video-card';
    card.innerHTML=`
      <a class="video-link" target="_blank" href="https://www.youtube.com/watch?v=${v.id}">
        <div class="thumb-wrap"><img class="thumb" src="${v.thumbnail}" alt=""></div>
        <div class="v-title">${v.title}</div>
        <div class="v-meta">
          <span>조회수: ${fmt(v.viewCount)}</span>
          <span>업로드: ${moment(v.publishedAt).format('YYYY-MM-DD')}</span>
          <span>구독자: ${fmt(v.__ch.subscriberCount)}</span>
          ${v.mutantIndex? `<span>돌연변이지수: <strong>${v.mutantIndex}</strong></span>`:''}
        </div>
        ${v.mutantIndex? `<div class="badge">${v.mutantIndex}</div>`:''}
      </a>
      <label style="display:block;padding:0 12px 12px"><input type="checkbox" data-done="${v.id}"/> 영상제작완료</label>`;
    idbGet('doneVideos',[v.__ch?.channelId||v.snippet?.channelId||'', v.id]).then(rec=>{ if(rec) { const cb=card.querySelector(`[data-done='${v.id}']`); if(cb) cb.checked=true; }});
    card.addEventListener('change', async (e)=>{
      if(e.target && e.target.matches(`[data-done='${v.id}']`)){
        if(e.target.checked){ await idbPut('doneVideos',{channelId:(v.__ch?.channelId||v.snippet?.channelId||''), videoId:v.id, done:true, ts:Date.now()}); }
        else { await idbDel('doneVideos',[v.__ch?.channelId||v.snippet?.channelId||'', v.id]); }
      }
    });
    wrap.appendChild(card);
  });
  if(kwId && qs(kwId)){
    const f=extractKeywords(videos.map(v=>v.title||'').join(' '));
    const top=f.slice(0,12);
    qs(kwId).innerHTML=top.map(([w,c])=>`<span class="kw">${w} ${c}회</span>`).join('');
  }
}
function sortVideoCards(list,mode){
  if(mode==='views') list.sort((a,b)=>b.viewCount-a.viewCount);
  else if(mode==='subscribers') list.sort((a,b)=>b.__ch.subscriberCount-a.__ch.subscriberCount);
  else if(mode==='latest') list.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  else list.sort((a,b)=>parseFloat(b.mutantIndex||0)-parseFloat(a.mutantIndex||0));
}

/* 전체 갱신 */
async function refreshAll(which){
  if(!hasKeys()){ toast('API 키를 설정해주세요.'); return; }
  if(!which || which==='channels') await refreshChannels();
  if(!which || which==='mutant') await refreshMutant();
  if(!which || which==='latest') await refreshLatest();
}

/* 분석 모달(선택 → analysis.html로 이동) */
async function openAnalyzeModal(){
  if(!hasKeys()){ toast('먼저 API 키를 설정해주세요.'); return; }
  const wrap = qs('analyze-channel-list');
  document.getElementById('modal-analyze').style.display='flex';
  const list = await getAllChannels();
  if(!wrap) return;
  if(list.length===0){ wrap.innerHTML = '<p class="muted">등록된 채널이 없습니다.</p>'; return; }
  wrap.innerHTML='';
  list.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'result-row';
    el.innerHTML = `
      <img class="r-avatar" src="${ch.thumbnail||''}" alt="${ch.title}">
      <div>
        <div class="r-title">${ch.title}</div>
        <div class="r-sub">구독자: ${fmt(ch.subscriberCount)}</div>
      </div>
      <button class="btn" data-go="${ch.id}">분석</button>`;
    el.onclick = () => { location.href = 'analysis.html?channelId=' + encodeURIComponent(ch.id); };
    el.querySelector('button').onclick = (e) => { e.stopPropagation(); location.href = 'analysis.html?channelId=' + encodeURIComponent(ch.id); };
    wrap.appendChild(el);
  });
}
