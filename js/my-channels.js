// my-channels.js — "내 채널들" 통합 보드 (내 채널/구독 + 등록 채널 관리)
// - OAuth(팝업) 로그인 상태 표시/갱신
// - 등록 채널 관리(추가/삭제/정렬/검색/가져오기/내보내기)
// - "내 영상 관리" 섹션/버튼 연동
console.log('my-channels.js (통합 보드) 로딩');

(function(){
  'use strict';

  // ===== 유틸 =====
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const fmt = (n) => {
    const v = parseInt(n || 0, 10);
    return isNaN(v) ? '0' : v.toLocaleString('ko-KR');
  };
  const toast = (m,t) => { try{ window.toast(m,t||'info'); }catch{ alert(m); } };

  // ===== OAuth 연동 (oauth-manager.js 의 전역 함수 사용) =====
  function reflectLoginStatus() {
    const token = (window.getAccessToken && window.getAccessToken()) || null;
    const btnSignin  = $('#btn-oauth-signin');
    const btnSignout = $('#btn-oauth-signout');
    if (btnSignin)  btnSignin.style.display  = token ? 'none' : '';
    if (btnSignout) btnSignout.style.display = token ? '' : 'none';
    const status = $('#mych-status');
    if (status) status.textContent = token ? '로그인됨' : '로그인 필요';
  }

  async function initOAuthButtons(){
    const signIn = $('#btn-oauth-signin');
    const signOut= $('#btn-oauth-signout');

    if (signIn && !signIn.dataset.bound) {
      signIn.dataset.bound='1';
      signIn.addEventListener('click', async () => {
        try {
          await window.oauthSignIn?.('consent'); // oauth-manager.js
          reflectLoginStatus();
          await loadMyChannelAndSubs();
        } catch(e) {
          console.error(e);
          toast('로그인 실패', 'error');
        }
      });
    }
    if (signOut && !signOut.dataset.bound) {
      signOut.dataset.bound='1';
      signOut.addEventListener('click', async () => {
        try {
          window.oauthSignOut?.();
        } finally {
          reflectLoginStatus();
          clearOwnLists();
        }
      });
    }

    // 최초 상태 반영
    reflectLoginStatus();
  }

  // ===== 내 채널/구독 영역 =====
  function clearOwnLists(){
    const own = $('#my-channels-list'); if (own) own.innerHTML='';
    const subs= $('#my-subscriptions-list'); if (subs) subs.innerHTML='';
  }

  async function fetchMyChannel(){
    const j = await window.ytAuth('channels', {
      part: 'snippet,contentDetails,statistics',
      mine: true,
      maxResults: 50
    });
    const out=[];
    (j.items||[]).forEach(it=>{
      const uploads = it.contentDetails?.relatedPlaylists?.uploads || '';
      out.push({
        id: it.id,
        title: it.snippet?.title || '(제목 없음)',
        thumbnail: it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || 'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj',
        subscriberCount: parseInt(it.statistics?.subscriberCount || '0',10),
        videoCount: parseInt(it.statistics?.videoCount || '0',10),
        uploadsPlaylistId: uploads
      });
    });
    return out;
  }
  async function fetchMySubscriptions(){
    const ids=[]; let pageToken;
    while(true){
      const s = await window.ytAuth('subscriptions', {
        part:'snippet', mine:true, maxResults:50, ...(pageToken?{pageToken}:{})
      });
      (s.items||[]).forEach(it=>{
        const id = it.snippet?.resourceId?.channelId;
        if (id) ids.push(id);
      });
      if (!s.nextPageToken) break;
      pageToken = s.nextPageToken;
    }
    if (!ids.length) return [];
    const out=[];
    for (let i=0;i<ids.length;i+=50){
      const batch = ids.slice(i, i+50);
      const cj = await window.ytAuth('channels', {
        part:'snippet,statistics', id: batch.join(',')
      });
      (cj.items||[]).forEach(ch=>{
        out.push({
          id: ch.id,
          title: ch.snippet?.title || '(제목 없음)',
          thumbnail: ch.snippet?.thumbnails?.high?.url || ch.snippet?.thumbnails?.default?.url || 'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj',
          subscriberCount: parseInt(ch.statistics?.subscriberCount || '0',10)
        });
      });
    }
    return out;
  }

  function renderOwn(list){
    const wrap = $('#my-channels-list'); if (!wrap) return;
    if (!list.length){
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🙂</div>
          <p class="muted">로그인 후 <b>내 채널</b> 정보를 볼 수 있습니다.</p>
        </div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="section-header" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        <h4 style="margin:0;">내 채널</h4>
      </div>`;
    const grid = document.createElement('div');
    grid.className = 'channel-list horizontal-grid';
    list.forEach(ch=>{
      const el = document.createElement('div');
      el.className = 'channel-card';
      el.innerHTML = `
        <img class="channel-thumb" src="${ch.thumbnail}" alt="${ch.title}">
        <div class="channel-meta">
          <h3>${ch.title}</h3>
          <div class="row">
            <span>구독자 <strong>${fmt(ch.subscriberCount)}</strong></span>
            <span>영상 <strong>${fmt(ch.videoCount)}</strong></span>
          </div>
          <div class="latest">업로드 재생목록: ${ch.uploadsPlaylistId || '-'}</div>
        </div>
        <div class="channel-actions">
          <a class="btn btn-secondary" href="https://www.youtube.com/channel/${ch.id}" target="_blank">채널 열기</a>
        </div>`;
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
  }
  function renderSubs(list){
    const wrap = $('#my-subscriptions-list'); if (!wrap) return;
    if (!list.length){
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <div class="section-header" style="border-bottom:none;padding-bottom:0;margin-bottom:8px;">
        <h4 style="margin:0;">내 구독 (${list.length}개)</h4>
      </div>`;
    const grid = document.createElement('div');
    grid.className = 'channel-list horizontal-grid';
    list.forEach(ch=>{
      const el = document.createElement('div');
      el.className = 'channel-card';
      el.innerHTML = `
        <img class="channel-thumb" src="${ch.thumbnail}" alt="${ch.title}">
        <div class="channel-meta">
          <h3>${ch.title}</h3>
          <div class="row">
            <span>구독자 <strong>${fmt(ch.subscriberCount)}</strong></span>
          </div>
        </div>
        <div class="channel-actions">
          <a class="btn btn-secondary" href="https://www.youtube.com/channel/${ch.id}" target="_blank">채널 열기</a>
        </div>`;
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
  }

  async function loadMyChannelAndSubs(){
    const token = (window.getAccessToken && window.getAccessToken()) || null;
    if (!token){ clearOwnLists(); return; }
    try{
      $('#mych-status') && ($('#mych-status').textContent = '불러오는 중…');
      const [mine, subs] = await Promise.allSettled([fetchMyChannel(), fetchMySubscriptions()]);
      const mineList = mine.status==='fulfilled'? (mine.value||[]) : [];
      const subsList = subs.status==='fulfilled'? (subs.value||[]) : [];
      renderOwn(mineList);
      renderSubs(subsList);
      reflectLoginStatus();
    }catch(e){
      console.error(e);
      toast('내 채널/구독 불러오기 실패', 'error');
    }
  }

  // ===== 등록 채널 관리 보드 =====
  const MC_PAGE_SIZE = 12;
  let mcState = {
    sort: 'subscribers',
    search: '',
    page: 1,
    list: []
  };

  function sortChannels(list, mode){
    if (mode === 'videos') {
      list.sort((a,b)=>parseInt(b.videoCount||'0')-parseInt(a.videoCount||'0'));
    } else if (mode === 'latest') {
      list.sort((a,b)=>new Date(b.latestUploadDate||0)-new Date(a.latestUploadDate||0));
    } else {
      list.sort((a,b)=>parseInt(b.subscriberCount||'0')-parseInt(a.subscriberCount||'0'));
    }
  }

  async function mcLoadAll(){
    try{
      const all = await idbAll('my_channels');
      mcState.list = all;
      mcRender();
    }catch(e){
      console.error(e);
      toast('등록 채널 목록을 불러올 수 없습니다.', 'error');
    }
  }

  function mcRender(){
    const wrap = $('#mc-channel-list'); if (!wrap) return;
    const cnt  = $('#mc-channel-count');

    // 검색/정렬/페이지
    const q = (mcState.search||'').toLowerCase().trim();
    let arr = [...mcState.list];
    if (q) arr = arr.filter(ch => (ch.title||'').toLowerCase().includes(q));
    sortChannels(arr, mcState.sort);

    // 카운트
    if (cnt) cnt.textContent = String(arr.length);

    // 페이징
    const start = (mcState.page-1)*MC_PAGE_SIZE;
    const pageItems = arr.slice(start, start+MC_PAGE_SIZE);

    if (!arr.length){
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📺</div>
          <p class="muted">아직 등록된 채널이 없습니다.</p>
          <button class="btn btn-primary" onclick="document.getElementById('mc-btn-add').click()">첫 채널 추가하기</button>
        </div>`;
      $('#mc-pagination') && ($('#mc-pagination').innerHTML='');
      return;
    }

    // 리스트
    const html = pageItems.map(ch=>{
      const yesterday = ''; // 간단화: 필요 시 dailySubs 사용 가능
      const thumb = (ch.thumbnail||'').trim() || `https://yt3.ggpht.com/ytc/${ch.id}`;
      return `
      <div class="channel-card" data-id="${ch.id}">
        <img class="channel-thumb" src="${thumb}" alt="${ch.title}">
        <div class="channel-meta">
          <h3><a href="https://www.youtube.com/channel/${ch.id}" target="_blank">${ch.title}</a></h3>
          <div class="row">
            <span>구독자 <strong>${fmt(ch.subscriberCount)}</strong></span>
            <span>영상 <strong>${fmt(ch.videoCount)}</strong></span>
            <span>최근업로드 <strong>${(ch.latestUploadDate||'-').toString().slice(0,10)}</strong></span>
          </div>
          <div class="latest">${yesterday || ''}</div>
        </div>
        <div class="channel-actions">
          <button class="btn btn-secondary" data-open-ch="${ch.id}">채널 열기</button>
          <button class="btn btn-danger" data-del-ch="${ch.id}">삭제</button>
        </div>
      </div>`;
    }).join('');
    wrap.innerHTML = html;

    // 버튼 바인딩
    $$('#mc-channel-list [data-open-ch]').forEach(btn=>{
      btn.onclick = ()=> window.open(`https://www.youtube.com/channel/${btn.dataset.openCh}`, '_blank');
    });
    $$('#mc-channel-list [data-del-ch]').forEach(btn=>{
      btn.onclick = async ()=>{
        if (!confirm('이 채널을 삭제할까요?')) return;
        try{
          await idbDel('my_channels', btn.dataset.delCh);
          toast('삭제되었습니다.', 'success');
        }catch(e){ console.error(e); toast('삭제 실패', 'error'); }
        mcLoadAll();
      };
    });

    // 페이지네이션(간단)
    const totalPages = Math.max(1, Math.ceil(arr.length/MC_PAGE_SIZE));
    const p = $('#mc-pagination');
    if (p){
      let pg = '';
      for (let i=1;i<=totalPages;i++){
        pg += `<button class="btn btn-secondary" data-mc-page="${i}" style="margin-right:6px;${i===mcState.page?'background:var(--border);':''}">${i}</button>`;
      }
      p.innerHTML = pg;
      $$('#mc-pagination [data-mc-page]').forEach(b=>{
        b.onclick = ()=>{ mcState.page = parseInt(b.dataset.mcPage,10); mcRender(); };
      });
    }
  }

  function bindManageBoard(){
    const addBtn = $('#mc-btn-add');
    const expBtn = $('#mc-btn-export');
    const impBtn = $('#mc-btn-import');
    const impFile= $('#mc-file-import');
    const sortSel= $('#mc-sort');
    const search = $('#mc-search');

    addBtn && (addBtn.onclick = async ()=>{
      const channelId = prompt('추가할 채널 ID를 입력하세요 (예: UCxxxx...)');
      if (!channelId) return;
      try{
        // channels.js의 addChannelById 있으면 사용, 없으면 간단 실패 안내
        if (typeof window.addChannelById === 'function'){
          const ok = await window.addChannelById(channelId.trim());
          if (ok) mcLoadAll();
        }else{
          toast('addChannelById 함수를 찾을 수 없습니다. channels.js를 확인하세요.', 'error');
        }
      }catch(e){ console.error(e); toast('채널 추가 실패', 'error'); }
    });

    expBtn && (expBtn.onclick = async ()=>{
      try{
        const all = await idbAll('my_channels');
        const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `channels-export-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
        toast('내보내기 완료', 'success');
      }catch(e){ console.error(e); toast('내보내기 실패', 'error'); }
    });

    impBtn && (impBtn.onclick = ()=> impFile && impFile.click());
    impFile && (impFile.onchange = async (ev)=>{
      const f = ev.target.files?.[0];
      if (!f) return;
      try{
        const text = await f.text();
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('JSON 배열이 아닙니다.');
        for (const ch of arr) { await idbPut('my_channels', ch); }
        toast(`가져오기 완료 (${arr.length}개)`, 'success');
        mcLoadAll();
      }catch(e){ console.error(e); toast('가져오기 실패: '+e.message, 'error'); }
      ev.target.value = '';
    });

    sortSel && (sortSel.onchange = ()=>{ mcState.sort = sortSel.value; mcState.page=1; mcRender(); });
    search && (search.oninput  = ()=>{ mcState.search = search.value; mcState.page=1; mcRender(); });
  }

  // ===== “내 영상 관리 열기” 버튼 =====
  function bindOpenVideoManager(){
    const btn = $('#btn-open-video-manager');
    if (!btn || btn.dataset.bound==='1') return;
    btn.dataset.bound='1';
    btn.onclick = ()=>{
      // 섹션이 있으면 이동 (section-video-manager), 없으면 영상분석 탭으로 이동
      if (typeof window.showSection === 'function'){
        const target = document.getElementById('section-video-manager') ? 'video-manager' : 'videos';
        window.showSection(target);
      }else{
        toast('내 영상 관리/영상분석 섹션을 찾을 수 없습니다.', 'warning');
      }
    };
  }

  // ===== 초기화 =====
  document.addEventListener('DOMContentLoaded', () => {
    initOAuthButtons();
    loadMyChannelAndSubs();
    bindManageBoard();
    mcLoadAll();
    bindOpenVideoManager();

    // 섹션 전환 시 ‘내 채널들’ 들어오면 자동 새로고침
    const navBtn = document.getElementById('btn-my-channels');
    if (navBtn && !navBtn.dataset.bound) {
      navBtn.dataset.bound='1';
      navBtn.addEventListener('click', ()=>{
        setTimeout(()=>{ reflectLoginStatus(); loadMyChannelAndSubs(); mcLoadAll(); }, 50);
      });
    }
  });

})();
