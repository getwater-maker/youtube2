// my-channels.js — "내 채널들" 통합 보드 (OAuth + 영상 관리 + 채널 관리)
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
  
  // ===== 상태 관리 =====
  let videosCache = []; // 불러온 영상 목록
  let myChannelsData = []; // 내 채널 데이터
  let subscriptionsData = []; // 구독 채널 데이터

  // ===== OAuth 연동 (oauth-manager.js 의 전역 함수 사용) =====
  function reflectLoginStatus() {
    const token = (window.getAccessToken && window.getAccessToken()) || null;
    const btnSignin  = $('#btn-oauth-signin');
    const btnSignout = $('#btn-oauth-signout');
    if (btnSignin)  btnSignin.style.display  = token ? 'none' : '';
    if (btnSignout) btnSignout.style.display = token ? '' : 'none';
    const status = $('#mych-status');
    if (status) status.textContent = token ? '로그인됨' : '로그인 필요';
    
    // 영상 관리 섹션 표시/숨김
    const videoSection = $('#video-management-section');
    if (videoSection) videoSection.style.display = token ? 'block' : 'none';
  }

  async function initOAuthButtons(){
    const signIn = $('#btn-oauth-signin');
    const signOut= $('#btn-oauth-signout');

    if (signIn && !signIn.dataset.bound) {
      signIn.dataset.bound='1';
      signIn.addEventListener('click', async () => {
        try {
          await window.oauthSignIn?.('consent');
          reflectLoginStatus();
          await loadMyChannelAndSubs();
          initializeDateInputs();
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
          reflectLoginStatus();
          clearAllData();
        } catch(e) {
          console.error(e);
          toast('로그아웃 실패', 'error');
        }
      });
    }
  }

  // ===== 내 채널/구독 데이터 로드 =====
  async function fetchMyChannel(){
    const res = await window.ytAuth('channels', {part:'snippet,statistics,contentDetails', mine:true});
    return (res.items||[]).map(ch=>({
      id: ch.id,
      title: ch.snippet?.title || '(제목 없음)',
      thumbnail: ch.snippet?.thumbnails?.high?.url || ch.snippet?.thumbnails?.default?.url || '',
      subscriberCount: parseInt(ch.statistics?.subscriberCount || '0',10),
      videoCount: parseInt(ch.statistics?.videoCount || '0',10),
      uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads
    }));
  }

  async function fetchMySubscriptions(){
    let ids = [];
    let pageToken = null;
    for(let i=0; i<10; i++){
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
          thumbnail: ch.snippet?.thumbnails?.high?.url || ch.snippet?.thumbnails?.default?.url || '',
          subscriberCount: parseInt(ch.statistics?.subscriberCount || '0',10)
        });
      });
    }
    return out;
  }

  function renderMyChannels(list){
    const wrap = $('#my-channels-list'); 
    if (!wrap) return;
    
    myChannelsData = list;
    
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
        <h4 style="margin:0;">내 채널 (${list.length}개)</h4>
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
          <button class="btn btn-primary" onclick="loadChannelVideos('${ch.id}')">영상 불러오기</button>
        </div>`;
      grid.appendChild(el);
    });
    wrap.appendChild(grid);
  }

  function renderSubscriptions(list){
    const wrap = $('#my-subscriptions-list'); 
    if (!wrap) return;
    
    subscriptionsData = list;
    
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
    list.slice(0, 10).forEach(ch=>{ // 상위 10개만 표시
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
    if (!token){ 
      renderMyChannels([]);
      renderSubscriptions([]);
      return; 
    }
    
    try{
      $('#mych-status') && ($('#mych-status').textContent = '불러오는 중…');
      const [mine, subs] = await Promise.allSettled([fetchMyChannel(), fetchMySubscriptions()]);
      const mineList = mine.status==='fulfilled'? (mine.value||[]) : [];
      const subsList = subs.status==='fulfilled'? (subs.value||[]) : [];
      renderMyChannels(mineList);
      renderSubscriptions(subsList);
      reflectLoginStatus();
    }catch(e){
      console.error(e);
      toast('내 채널/구독 불러오기 실패', 'error');
    }
  }

  // ===== 영상 관리 기능 =====
  function initializeDateInputs() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    
    const startInput = $('#video-date-start');
    const endInput = $('#video-date-end');
    
    if (endInput && !endInput.value) endInput.value = `${yyyy}-${mm}-${dd}`;
    if (startInput && !startInput.value) startInput.value = `${yyyy}-${mm}-01`;
  }

  async function fetchMyVideosByDate(publishedAfter, publishedBefore, pageToken = null) {
    // 내 영상 검색
    const searchResp = await window.ytAuth('search', {
      part: 'id',
      forMine: true,
      type: 'video',
      maxResults: 50,
      order: 'date',
      publishedAfter: publishedAfter,
      publishedBefore: publishedBefore,
      ...(pageToken ? {pageToken} : {})
    });

    const videoIds = (searchResp.items || [])
      .map(item => item.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      return { videos: [], nextPageToken: searchResp.nextPageToken || null };
    }

    // 영상 상세 정보
    const detailResp = await window.ytAuth('videos', {
      part: 'snippet,statistics',
      id: videoIds.join(','),
      maxResults: 50
    });

    const videos = (detailResp.items || []).map(video => ({
      id: video.id,
      snippet: video.snippet,
      statistics: video.statistics || {},
      thumbnail: video.snippet?.thumbnails?.medium?.url || 
                video.snippet?.thumbnails?.default?.url || ''
    }));

    return { videos, nextPageToken: searchResp.nextPageToken || null };
  }

  function renderVideoList(videos) {
    const tbody = $('#video-table-body');
    if (!tbody) return;
    
    if (!videos.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center muted">영상이 없습니다.</td></tr>';
      return;
    }
    
    tbody.innerHTML = '';
    videos.forEach(video => {
      const tr = document.createElement('tr');
      const views = parseInt(video.statistics?.viewCount || 0);
      const publishedAt = new Date(video.snippet?.publishedAt);
      
      tr.innerHTML = `
        <td><input type="checkbox" class="video-checkbox" data-video-id="${video.id}" /></td>
        <td>
          <img src="${video.thumbnail}" alt="썸네일" style="width: 120px; height: 68px; object-fit: cover; border-radius: 8px;" />
        </td>
        <td>
          <div style="max-width: 300px;">
            <strong>${escapeHtml(video.snippet?.title || '')}</strong>
            <div class="muted" style="font-size: 12px; margin-top: 4px;">
              ${escapeHtml((video.snippet?.description || '').slice(0, 100))}${video.snippet?.description?.length > 100 ? '...' : ''}
            </div>
            <div class="muted" style="font-size: 11px; margin-top: 4px;">
              태그: ${Array.isArray(video.snippet?.tags) ? video.snippet.tags.slice(0, 3).join(', ') : '없음'}
            </div>
          </div>
        </td>
        <td>${fmt(views)}</td>
        <td>${publishedAt.toLocaleDateString()}</td>
        <td>
          <div style="display: flex; gap: 4px; flex-direction: column;">
            <button class="btn btn-sm btn-primary" onclick="quickTitleEdit('${video.id}')">빠른 제목 수정</button>
            <button class="btn btn-sm btn-secondary" onclick="editVideoDetails('${video.id}')">상세 수정</button>
            <a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" class="btn btn-sm btn-info">보기</a>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== 제목 프리셋 관리 =====
  function initializePresetSystem() {
    if (window.TitlePresets) {
      window.TitlePresets.renderPresetUI();
    }
    
    const saveBtn = $('#btn-save-presets');
    const clearBtn = $('#btn-clear-presets');
    const input = $('#preset-input');
    
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.onclick = () => {
        if (!window.TitlePresets) return;
        const raw = (input?.value || '').split('\n');
        const saved = window.TitlePresets.savePresets(raw);
        window.TitlePresets.renderPresetUI();
        toast(`프리셋 ${saved.length}개 저장됨`, 'success');
      };
    }
    
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = '1';
      clearBtn.onclick = () => {
        if (!window.TitlePresets) return;
        window.TitlePresets.clearPresets();
        window.TitlePresets.renderPresetUI();
        if (input) input.value = '';
        toast('프리셋을 모두 삭제했습니다.', 'warning');
      };
    }
  }

  // ===== 이벤트 바인딩 =====
  function bindVideoManagementEvents() {
    // 영상 불러오기 버튼
    const fetchBtn = $('#btn-fetch-videos');
    if (fetchBtn && !fetchBtn.dataset.bound) {
      fetchBtn.dataset.bound = '1';
      fetchBtn.onclick = fetchVideosFlow;
    }
    
    // 일괄 제목 수정 버튼
    const bulkBtn = $('#btn-bulk-title-edit');
    if (bulkBtn && !bulkBtn.dataset.bound) {
      bulkBtn.dataset.bound = '1';
      bulkBtn.onclick = bulkTitleEditFlow;
    }
    
    // 전체 선택 체크박스
    const selectAllBtn = $('#select-all-videos');
    if (selectAllBtn && !selectAllBtn.dataset.bound) {
      selectAllBtn.dataset.bound = '1';
      selectAllBtn.onchange = (e) => {
        const checkboxes = $$('.video-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
      };
    }
  }

  async function fetchVideosFlow() {
    try {
      const startDate = $('#video-date-start')?.value;
      const endDate = $('#video-date-end')?.value;
      const minViews = parseInt($('#video-min-views')?.value || '0');
      
      if (!startDate || !endDate) {
        toast('시작일과 종료일을 선택해주세요.', 'warning');
        return;
      }
      
      $('#video-status').textContent = '영상을 불러오는 중...';
      
      const startISO = new Date(`${startDate}T00:00:00Z`).toISOString();
      const endISO = new Date(`${endDate}T23:59:59Z`).toISOString();
      
      let allVideos = [];
      let pageToken = null;
      
      do {
        const { videos, nextPageToken } = await fetchMyVideosByDate(startISO, endISO, pageToken);
        allVideos = allVideos.concat(videos);
        pageToken = nextPageToken;
      } while (pageToken && allVideos.length < 200); // 최대 200개 제한
      
      // 조회수 필터링
      if (minViews > 0) {
        allVideos = allVideos.filter(v => parseInt(v.statistics?.viewCount || 0) >= minViews);
      }
      
      // 정렬
      const sortType = $('#video-sort')?.value || 'date';
      if (sortType === 'views') {
        allVideos.sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0));
      } else if (sortType === 'title') {
        allVideos.sort((a, b) => (a.snippet?.title || '').localeCompare(b.snippet?.title || ''));
      }
      
      videosCache = allVideos;
      renderVideoList(allVideos);
      
      $('#video-status').textContent = `총 ${allVideos.length}개의 영상을 불러왔습니다.`;
      toast(`${allVideos.length}개의 영상을 불러왔습니다.`, 'success');
      
    } catch (error) {
      console.error('영상 불러오기 실패:', error);
      $('#video-status').textContent = '영상 불러오기 실패';
      toast('영상을 불러오는 중 오류가 발생했습니다.', 'error');
    }
  }

  async function bulkTitleEditFlow() {
    const checkedBoxes = $$('.video-checkbox:checked');
    
    if (checkedBoxes.length === 0) {
      toast('수정할 영상을 선택해주세요.', 'warning');
      return;
    }
    
    if (!window.TitlePresets) {
      toast('제목 프리셋 시스템을 찾을 수 없습니다.', 'error');
      return;
    }
    
    const presets = window.TitlePresets.loadPresets();
    if (presets.length === 0) {
      toast('먼저 제목 프리셋을 저장해주세요.', 'warning');
      return;
    }
    
    if (!confirm(`선택된 ${checkedBoxes.length}개 영상의 제목을 프리셋으로 변경하시겠습니까?`)) {
      return;
    }
    
    $('#video-status').textContent = `제목 변경 중... (${checkedBoxes.length}개)`;
    
    let successCount = 0;
    for (const checkbox of checkedBoxes) {
      const videoId = checkbox.dataset.videoId;
      const video = videosCache.find(v => v.id === videoId);
      if (!video) continue;
      
      const newTitle = window.TitlePresets.nextPreset(presets);
      if (!newTitle) break;
      
      try {
        await updateVideoTitle(videoId, newTitle, video.snippet);
        // 캐시 업데이트
        video.snippet.title = newTitle;
        successCount++;
      } catch (error) {
        console.error(`영상 ${videoId} 제목 변경 실패:`, error);
      }
    }
    
    renderVideoList(videosCache);
    $('#video-status').textContent = `제목 변경 완료: ${successCount}/${checkedBoxes.length}개 성공`;
    toast(`${successCount}개 영상의 제목이 변경되었습니다.`, 'success');
  }

  async function updateVideoTitle(videoId, newTitle, currentSnippet) {
    const payload = {
      id: videoId,
      snippet: {
        ...currentSnippet,
        title: newTitle,
        categoryId: currentSnippet.categoryId || '22'
      }
    };
    
    return await window.ytAuth('videos', payload, 'PUT', 'snippet');
  }

  // ===== 전역 함수들 =====
  window.quickTitleEdit = async function(videoId) {
    const video = videosCache.find(v => v.id === videoId);
    if (!video) return;
    
    if (!window.TitlePresets) {
      toast('제목 프리셋 시스템을 찾을 수 없습니다.', 'error');
      return;
    }
    
    const presets = window.TitlePresets.loadPresets();
    const nextTitle = window.TitlePresets.nextPreset(presets);
    
    if (!nextTitle) {
      toast('먼저 제목 프리셋을 저장해주세요.', 'warning');
      return;
    }
    
    try {
      await updateVideoTitle(videoId, nextTitle, video.snippet);
      video.snippet.title = nextTitle;
      renderVideoList(videosCache);
      toast(`제목이 변경되었습니다: "${nextTitle}"`, 'success');
    } catch (error) {
      console.error('제목 변경 실패:', error);
      toast('제목 변경 중 오류가 발생했습니다.', 'error');
    }
  };

  window.editVideoDetails = function(videoId) {
    const video = videosCache.find(v => v.id === videoId);
    if (!video) return;
    
    const newTitle = prompt('새 제목을 입력하세요:', video.snippet?.title || '');
    if (!newTitle || newTitle.trim() === '') return;
    
    updateVideoTitle(videoId, newTitle.trim(), video.snippet).then(() => {
      video.snippet.title = newTitle.trim();
      renderVideoList(videosCache);
      toast('제목이 변경되었습니다.', 'success');
    }).catch(error => {
      console.error('제목 변경 실패:', error);
      toast('제목 변경 중 오류가 발생했습니다.', 'error');
    });
  };

  window.loadChannelVideos = function(channelId) {
    // 해당 채널의 영상들로 필터링하는 기능 (추후 구현 가능)
    toast('채널별 영상 필터링은 추후 구현 예정입니다.', 'info');
  };

  function clearAllData() {
    videosCache = [];
    myChannelsData = [];
    subscriptionsData = [];
    renderVideoList([]);
    renderMyChannels([]);
    renderSubscriptions([]);
    $('#video-status').textContent = '영상을 불러오려면 위의 조건을 설정하고 "📥 영상 불러오기"를 클릭하세요.';
  }

  // ===== 전역 노출 함수 =====
  window.initializeMyChannels = function() {
    reflectLoginStatus();
    loadMyChannelAndSubs();
    initializeDateInputs();
    initializePresetSystem();
    bindVideoManagementEvents();
  };

  // ===== 초기화 =====
  document.addEventListener('DOMContentLoaded', () => {
    initOAuthButtons();
    initializeMyChannels();
    
    // 섹션 전환 시 '내 채널들' 들어오면 자동 새로고침
    const navBtn = document.getElementById('btn-my-channels');
    if (navBtn && !navBtn.dataset.bound) {
      navBtn.dataset.bound='1';
      navBtn.addEventListener('click', () => {
        setTimeout(() => { 
          reflectLoginStatus(); 
          loadMyChannelAndSubs(); 
          initializeMyChannels();
        }, 50);
      });
    }
  });

})();