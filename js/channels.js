// YouTube 채널 모니터 - 채널 관리 섹션 (버튼 이벤트 바인딩 수정)
console.log('channels.js 로딩 시작');

// ============================================================================
// 채널 관리 핵심 함수들
// ============================================================================
const CHANNELS_CONFIG = {
  PAGINATION_SIZE: 12, // 페이지당 채널 수 (수평 그리드용으로 증가)
};

// 모든 채널 가져오기
async function getAllChannels() {
  try {
    const channels = await idbAll('my_channels');
    console.log('채널 목록 조회:', channels.length + '개');
    return channels;
  } catch (e) {
    console.error('채널 목록 조회 실패:', e);
    return [];
  }
}

// 채널 삭제
async function deleteChannel(id) {
  try {
    console.log('채널 삭제 시작:', id);
    await idbDel('my_channels', id);
    await idbDel('insights', id);
    console.log('채널 삭제 완료:', id);
    // 삭제 후 새로고침 (최신 실행만 반영되도록 토큰 사용)
    refreshChannels();
  } catch (e) {
    console.error('채널 삭제 실패:', e);
    toast('채널 삭제 실패: ' + (e.message || e), 'error');
    throw e;
  }
}

// 채널 정렬
function sortChannels(list, mode) {
  console.log('채널 정렬:', mode);
  if (mode === 'videos') {
    list.sort((a, b) => parseInt(b.videoCount || '0') - parseInt(a.videoCount || '0'));
  } else if (mode === 'latest') {
    list.sort((a, b) => new Date(b.latestUploadDate || 0) - new Date(a.latestUploadDate || 0));
  } else {
    list.sort((a, b) => parseInt(b.subscriberCount || '0') - parseInt(a.subscriberCount || '0'));
  }
}

// 전일 구독자 수 가져오기
async function getYesterdaySubCount(ch) {
  try {
    const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
    const record = await idbGet('dailySubs', [ch.id, yesterday]);
    return record ? record.subCount : null;
  } catch (e) {
    console.error('전일 구독자 수 조회 실패:', e);
    return null;
  }
}

// 일일 구독자 스냅샷 업데이트
async function updateDailySubSnapshot(ch) {
  try {
    const today = moment().format('YYYY-MM-DD');
    const existing = await idbGet('dailySubs', [ch.id, today]);
    if (!existing) {
      await idbPut('dailySubs', {
        channelId: ch.id,
        date: today,
        subCount: parseInt(ch.subscriberCount || '0', 10)
      });
      console.log('일일 구독자 스냅샷 저장:', ch.title);
    }
  } catch (e) {
    console.error('일일 구독자 스냅샷 저장 실패:', e);
  }
}

// ============================================================================
// 채널 추가 기능
// ============================================================================

// 채널 ID로 추가
async function addChannelById(channelId) {
  if (!channelId) {
    toast('올바른 채널 ID가 아닙니다.', 'error');
    return false;
  }

  console.log('채널 추가 시작:', channelId);

  try {
    const existing = await idbGet('my_channels', channelId);
    if (existing) {
      toast('이미 등록된 채널입니다.', 'warning');
      return false;
    }

    const channelResponse = await yt('channels', {
      part: 'snippet,statistics,contentDetails',
      id: channelId
    });

    const channelData = channelResponse.items?.[0];
    if (!channelData) {
      throw new Error('채널을 찾을 수 없습니다.');
    }

    const uploads = channelData.contentDetails?.relatedPlaylists?.uploads || '';
    let latestUpload = channelData.snippet.publishedAt;

    // 최신 업로드 날짜 가져오기
    if (uploads) {
      try {
        const playlistResponse = await yt('playlistItems', {
          part: 'snippet',
          playlistId: uploads,
          maxResults: 1
        });
        if (playlistResponse.items && playlistResponse.items[0]) {
          latestUpload = playlistResponse.items[0].snippet.publishedAt || latestUpload;
        }
      } catch (e) {
        console.warn('최신 업로드 날짜 조회 실패:', e);
      }
    }

    // 썸네일 안전 선택 및 검증
    const th = channelData.snippet.thumbnails || {};
    let thumbnail = '';

    // 1차: API 제공 썸네일
    const apiThumbs = [th.high?.url, th.medium?.url, th.default?.url].filter(Boolean);
    if (apiThumbs.length > 0) {
      thumbnail = apiThumbs[0];
    }

    // 2차: 채널 ID 기반 대체 썸네일 시도
    if (!thumbnail) {
      const altThumbs = [
        `https://yt3.ggpht.com/ytc/${channelData.id}`,
        `https://yt3.ggpht.com/a/default-user=s240-c-k-c0x00ffffff-no-rj`
      ];
      thumbnail = altThumbs[0];
    }

    console.log(`채널 ${channelData.snippet.title} 썸네일:`, thumbnail);

    const data = {
      id: channelData.id,
      title: channelData.snippet.title,
      thumbnail, // 검증된 썸네일
      subscriberCount: channelData.statistics.subscriberCount || '0',
      videoCount: channelData.statistics.videoCount || '0',
      uploadsPlaylistId: uploads,
      latestUploadDate: latestUpload,
      country: channelData.snippet.country || '-'
    };

    await idbPut('my_channels', data);
    console.log('채널 추가 완료:', data.title);

    toast(`✅ ${data.title} 채널이 등록되었습니다.`, 'success');

    // 채널 목록 새로고침
    setTimeout(() => refreshChannels(), 50);

    return true;
  } catch (e) {
    console.error('채널 추가 실패:', e);
    toast('채널 추가 실패: ' + e.message, 'error');
    return false;
  }
}

// ============================================================================
// 채널 목록 렌더링 (동시 실행 방지 토큰 방식)
// ============================================================================

// 최신 실행 토큰(가장 마지막으로 시작된 refresh만 DOM 적용)
window.__channelsRefreshToken = window.__channelsRefreshToken || 0;

// 채널 목록 새로고침
async function refreshChannels() {
  console.log('채널 목록 새로고침 시작');

  // 새 실행 토큰 발급
  const myToken = ++window.__channelsRefreshToken;

  try {
    const allChannels = await getAllChannels();

    // 일일 스냅샷 업데이트 (비차단)
    for (const ch of allChannels) {
      // 토큰이 변경되었다면 중단 (뒤에 시작한 실행이 있음)
      if (myToken !== window.__channelsRefreshToken) return;
      await updateDailySubSnapshot(ch);
    }

    // 정렬 방식 결정
    const sortSelect = qs('#sort-channels');
    const sortMode = sortSelect?.value || 'subscribers';
    sortChannels(allChannels, sortMode);

    // 채널 카운트 업데이트 (토큰 확인)
    if (myToken !== window.__channelsRefreshToken) return;
    const channelCountEl = qs('#channel-count');
    if (channelCountEl) {
      channelCountEl.textContent = allChannels.length.toString();
    }

    // 채널 리스트 컨테이너
    const wrap = qs('#channel-list');
    if (!wrap) {
      console.error('channel-list 요소를 찾을 수 없음');
      return;
    }

    // 비어있을 때
    if (!allChannels.length) {
      if (myToken !== window.__channelsRefreshToken) return;
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📺</div>
          <p class="muted">채널을 추가하여 시작하세요</p>
          <button class="btn btn-primary" onclick="openChannelAddModal()">첫 채널 추가하기</button>
        </div>
      `;
      return;
    }

    // 페이지네이션 적용
    const currentPage = window.state?.currentPage?.channels || 1;
    const startIndex = (currentPage - 1) * CHANNELS_CONFIG.PAGINATION_SIZE;
    const endIndex = startIndex + CHANNELS_CONFIG.PAGINATION_SIZE;
    const paginatedChannels = allChannels.slice(startIndex, endIndex);

    // ----------- 여기서부터 HTML을 모두 구성한 뒤 한 번에 교체 -----------
    let html = '';

    for (const ch of paginatedChannels) {
      // 토큰 변경되면 즉시 중단
      if (myToken !== window.__channelsRefreshToken) return;

      const yesterday = await getYesterdaySubCount(ch);
      const today = parseInt(ch.subscriberCount || '0', 10);
      const diff = yesterday == null ? null : today - yesterday;

      let diffStr = '';
      if (yesterday == null) {
        diffStr = '<span class="v neutral">(전일 정보 없음)</span>';
      } else if (diff > 0) {
        diffStr = `<span class="v positive">+${fmt(diff)}</span>`;
      } else if (diff < 0) {
        diffStr = `<span class="v negative">${fmt(diff)}</span>`;
      } else {
        diffStr = `<span class="v neutral">0</span>`;
      }

      // 개선된 썸네일 처리
      const chThumb = (ch.thumbnail || '').trim();
      const fallbackThumbs = [
        chThumb,
        `https://yt3.ggpht.com/ytc/${ch.id}`,
        `https://yt3.ggpht.com/a/default-user=s240-c-k-c0x00ffffff-no-rj`,
        'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIiIGhlaWdodD0iNzIiIHZpZXdCb3g9IjAgMCA3MiA3MiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjcyIiBoZWlnaHQ9IjcyIiByeD0iMzYiIGZpbGw9IiM0YTU1NjgiLz4KPHN2ZyB4PSIyNCIgeT0iMjQiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjZTRlNmVhIj4KPHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgM2MxLjY2IDAgMyAxLjM0IDMgM3MtMS4zNCAzLTMgMy0zLTEuMzQtMy0zIDEuMzQtMyAzLTN6bTAgMTQuMmMtMi41IDAtNC43MS0xLjI4LTYtMy4yLjAzLTEuOTkgNC0zLjA4IDYtMy4wOHM1Ljk3IDEuMDkgNiAzLjA4Yy0xLjI5IDEuOTItMy41IDMuMi02IDMuMnoiLz4KPC9zdmc+Cjwvc3ZnPg=='
      ].filter(Boolean);
      
      const safeThumb = fallbackThumbs[0];

      html += `
        <div class="channel-card">
          <a href="https://www.youtube.com/channel/${ch.id}" target="_blank" style="text-decoration: none;">
            <img src="${safeThumb}" alt="${ch.title}" 
                 onerror="
                   const fallbacks = ['${fallbackThumbs[1] || ''}', '${fallbackThumbs[2] || ''}', '${fallbackThumbs[3] || ''}'].filter(Boolean);
                   if (!this.dataset.fallbackIndex) this.dataset.fallbackIndex = '0';
                   const nextIndex = parseInt(this.dataset.fallbackIndex) + 1;
                   if (nextIndex < fallbacks.length) {
                     this.dataset.fallbackIndex = nextIndex;
                     this.src = fallbacks[nextIndex];
                   }
                 " 
                 class="channel-thumb">
          </a>

          <div class="channel-meta">
            <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
              <a href="https://www.youtube.com/channel/${ch.id}" target="_blank" style="text-decoration:none;color:inherit;">
                <h3>${ch.title}</h3>
              </a>
              <button class="btn btn-danger" onclick="deleteChannelById('${ch.id}')" title="채널 삭제">삭제</button>
            </div>

            <div class="row">
              <span>구독자: <strong>${fmt(ch.subscriberCount)}</strong></span>
              <span>영상수: <strong>${fmt(ch.videoCount)}</strong></span>
              <span>국가: <strong>${(ch.country || 'KR')}</strong></span>
            </div>
            
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;">
              <div style="background:var(--glass-bg);padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:13px;">
                <div style="font-weight:700;margin-bottom:4px;">전일대비</div>
                <div>${diffStr}</div>
              </div>
              <div style="font-size:12px;color:var(--muted);text-align:right;">
                최신 업로드:<br>${ch.latestUploadDate ? moment(ch.latestUploadDate).format('MM-DD') : '-'}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 렌더 직전 토큰 확인 후 한번에 교체
    if (myToken !== window.__channelsRefreshToken) return;
    wrap.innerHTML = html;

    // 페이지네이션 렌더링
    renderChannelsPagination(currentPage, allChannels.length);

  } catch (e) {
    console.error('채널 목록 새로고침 실패:', e);
    const wrap = qs('#channel-list');
    if (wrap) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <p class="muted">채널 목록을 불러오는 중 오류가 발생했습니다.</p>
        </div>
      `;
    }
  }
}

// 채널 페이지네이션
function renderChannelsPagination(currentPage, totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / CHANNELS_CONFIG.PAGINATION_SIZE));
  const el = qs('#channel-pagination');
  if (!el) return;
  
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  
  const btn = (p, label = p, disabled = false, active = false) =>
    `<button class="btn btn-secondary ${active ? 'active' : ''}" onclick="changeChannelPage(${p})" ${disabled ? 'disabled' : ''} style="min-width:36px;">${label}</button>`;

  let html = '';
  html += btn(Math.max(1, currentPage - 1), '‹', currentPage === 1);
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  for (let p = start; p <= end; p++) html += btn(p, String(p), false, p === currentPage);
  html += btn(Math.min(totalPages, currentPage + 1), '›', currentPage === totalPages);

  el.innerHTML = html;
}

// ============================================================================
// 채널 썸네일 업데이트 함수
// ============================================================================
async function updateChannelThumbnails() {
  try {
    const channels = await getAllChannels();
    let updated = 0;
    
    for (const channel of channels) {
      if (!channel.thumbnail || channel.thumbnail === '') {
        console.log(`채널 ${channel.title} 썸네일 업데이트 시도`);
        
        try {
          const channelInfo = await window.yt('channels', {
            part: 'snippet',
            id: channel.id
          });
          
          const channelData = channelInfo.items?.[0];
          if (channelData) {
            const th = channelData.snippet.thumbnails || {};
            const newThumbnail = th.high?.url || th.medium?.url || th.default?.url || 
                               `https://yt3.ggpht.com/ytc/${channel.id}`;
            
            if (newThumbnail) {
              channel.thumbnail = newThumbnail;
              await idbPut('my_channels', channel);
              updated++;
              console.log(`채널 ${channel.title} 썸네일 업데이트 완료`);
            }
          }
        } catch (e) {
          console.error(`채널 ${channel.title} 썸네일 업데이트 실패:`, e);
        }
      }
    }
    
    if (updated > 0) {
      console.log(`${updated}개 채널 썸네일 업데이트 완료`);
      refreshChannels();
    }
  } catch (e) {
    console.error('채널 썸네일 일괄 업데이트 실패:', e);
  }
}

// ============================================================================
// 채널 내보내기/가져오기
// ============================================================================

// 채널 내보내기
async function exportChannels() {
  try {
    const channels = await getAllChannels();
    if (!channels.length) {
      toast('내보낼 채널이 없습니다.', 'warning');
      return;
    }
    
    const dataStr = JSON.stringify(channels, null, 2);
    const dataBlob = new Blob([dataStr], {type:'application/json'});
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `youtube-channels-${moment().format('YYYY-MM-DD')}.json`;
    link.click();
    
    toast(`${channels.length}개 채널을 내보냈습니다.`, 'success');
  } catch (e) {
    console.error('채널 내보내기 실패:', e);
    toast('내보내기 실패: ' + e.message, 'error');
  }
}

// 채널 가져오기
async function importChannelsFromFile(file) {
  try {
    const text = await file.text();
    const channels = JSON.parse(text);
    
    if (!Array.isArray(channels)) {
      throw new Error('올바른 채널 데이터가 아닙니다.');
    }
    
    let imported = 0;
    let skipped = 0;
    
    for (const ch of channels) {
      if (!ch.id || !ch.title) continue;
      
      const existing = await idbGet('my_channels', ch.id);
      if (existing) {
        skipped++;
        continue;
      }
      
      await idbPut('my_channels', ch);
      imported++;
    }
    
    if (imported > 0) {
      refreshChannels();
      toast(`${imported}개 채널을 가져왔습니다. (중복 ${skipped}개 제외)`, 'success');
    } else {
      toast('가져온 채널이 없습니다. (모두 중복)', 'warning');
    }
    
  } catch (e) {
    console.error('채널 가져오기 실패:', e);
    toast('가져오기 실패: ' + e.message, 'error');
  }
}

// ============================================================================
// 전역 함수들 (직접 HTML onclick에서 호출 가능)
// ============================================================================

// 채널 삭제 (전역 함수)
async function deleteChannelById(channelId) {
  if (!confirm('정말 삭제하시겠어요?')) return;
  try {
    await deleteChannel(channelId);
  } catch (e) {
    console.error('채널 삭제 실패:', e);
  }
}

// 채널 페이지 변경 (전역 함수)
function changeChannelPage(page) {
  if (!window.state) window.state = { currentPage: {} };
  window.state.currentPage.channels = page;
  refreshChannels();
}

// 채널 추가 모달 열기 (전역 함수)
function openChannelAddModal() {
  if (typeof window.openModal === 'function') {
    window.openModal('modal-add');
  } else {
    console.error('openModal 함수를 찾을 수 없습니다.');
  }
}

// 채널 검색 및 추가 (전역 함수) - 사용자 확인 절차 추가
async function searchAndAddChannel() {
  const input = document.getElementById('url-input');
  const result = document.getElementById('url-result');
  
  if (!input || !result) {
    console.error('필요한 DOM 요소를 찾을 수 없습니다.');
    return;
  }

  const query = input.value.trim();
  if (!query) {
    toast('검색어를 입력해주세요.', 'warning');
    return;
  }

  try {
    result.innerHTML = '<p class="muted">검색 중...</p>';

    // API 키 확인
    if (!window.hasKeys || !window.hasKeys()) {
      throw new Error('먼저 API 키를 설정해주세요.');
    }

    // 직접 채널 ID나 URL인지 먼저 확인
    const isDirectId = /^UC[A-Za-z0-9_-]{22}$/.test(query);
    const isUrl = query.includes('youtube.com') || query.includes('youtu.be');
    const isHandle = query.startsWith('@');

    if (isDirectId || isUrl) {
      // 직접 ID나 URL인 경우 바로 추가
      let channelId;
      if (typeof window.extractChannelId === 'function') {
        channelId = await window.extractChannelId(query);
      } else {
        throw new Error('채널 검색 기능이 준비되지 않았습니다.');
      }

      const success = await addChannelById(channelId);
      if (success) {
        if (typeof window.closeModal === 'function') {
          window.closeModal('modal-add');
        }
        input.value = '';
        result.innerHTML = '';
      }
    } else {
      // 채널명 검색인 경우 검색 결과 표시
      await showChannelSearchResults(query, result, input);
    }

  } catch (e) {
    console.error('채널 검색/추가 실패:', e);
    result.innerHTML = `<p style="color: var(--brand);">${e.message}</p>`;
    toast('채널 검색 실패: ' + e.message, 'error');
  }
}

// 채널 검색 결과 표시 함수
async function showChannelSearchResults(query, resultContainer, inputElement) {
  try {
    // YouTube Search API로 채널 검색
    const searchResponse = await window.yt('search', {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults: 10 // 상위 10개 결과
    });

    const channels = searchResponse.items || [];
    
    if (channels.length === 0) {
      resultContainer.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--muted);">검색 결과가 없습니다.</p>
          <p style="font-size: 12px; color: var(--muted);">다른 검색어를 시도해보세요.</p>
        </div>
      `;
      return;
    }

    // 채널 상세 정보 가져오기
    const channelIds = channels.map(ch => ch.id.channelId).join(',');
    const detailsResponse = await window.yt('channels', {
      part: 'snippet,statistics',
      id: channelIds
    });

    const detailedChannels = detailsResponse.items || [];

    // 검색 결과 HTML 생성
    let html = `
      <div style="margin-top: 16px;">
        <h4 style="margin: 0 0 12px 0; color: var(--text); font-size: 14px;">
          🔍 "${query}" 검색 결과 (${detailedChannels.length}개)
        </h4>
        <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px;">
    `;

    detailedChannels.forEach((channel, index) => {
      const thumbnail = channel.snippet.thumbnails?.medium?.url || 
                       channel.snippet.thumbnails?.default?.url ||
                       'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj';
      
      const title = channel.snippet.title || '(제목 없음)';
      const description = channel.snippet.description || '';
      const subscriberCount = parseInt(channel.statistics?.subscriberCount || '0', 10);
      const videoCount = parseInt(channel.statistics?.videoCount || '0', 10);
      const country = channel.snippet.country || '';

      html += `
        <div class="search-result-item" style="
          display: flex;
          gap: 12px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          transition: background 0.2s;
        " onmouseover="this.style.background='var(--glass-bg)'" 
           onmouseout="this.style.background=''" 
           onclick="confirmAndAddChannel('${channel.id}', '${title.replace(/'/g, "\\'")}')">
          
          <img src="${thumbnail}" alt="${title}" 
               style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; flex-shrink: 0;"
               onerror="this.src='https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj'">
          
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; margin-bottom: 4px; color: var(--text);">
              ${title}
            </div>
            
            <div style="display: flex; gap: 16px; margin-bottom: 6px; font-size: 12px; color: var(--muted);">
              <span>구독자: ${fmt(subscriberCount)}</span>
              <span>영상: ${fmt(videoCount)}</span>
              ${country ? `<span>국가: ${country}</span>` : ''}
            </div>
            
            ${description ? `
              <div style="font-size: 11px; color: var(--muted); line-height: 1.3; max-height: 32px; overflow: hidden;">
                ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}
              </div>
            ` : ''}
            
            <div style="margin-top: 6px;">
              <span style="
                background: var(--brand); 
                color: white; 
                padding: 2px 6px; 
                border-radius: 4px; 
                font-size: 10px; 
                font-weight: 600;
              ">클릭하여 추가</span>
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
        <div style="padding: 12px; text-align: center; font-size: 12px; color: var(--muted);">
          원하는 채널을 클릭하여 추가하세요. 정확한 채널인지 확인 후 선택해주세요.
        </div>
      </div>
    `;

    resultContainer.innerHTML = html;

  } catch (e) {
    console.error('채널 검색 결과 표시 실패:', e);
    resultContainer.innerHTML = `<p style="color: var(--brand);">검색 중 오류가 발생했습니다: ${e.message}</p>`;
  }
}

// 채널 추가 확인 및 실행
async function confirmAndAddChannel(channelId, channelTitle) {
  try {
    const confirmed = confirm(`"${channelTitle}" 채널을 추가하시겠습니까?\n\n채널 ID: ${channelId}`);
    
    if (!confirmed) {
      return;
    }

    const success = await addChannelById(channelId);
    if (success) {
      if (typeof window.closeModal === 'function') {
        window.closeModal('modal-add');
      }
      
      // 입력창과 결과창 초기화
      const input = document.getElementById('url-input');
      const result = document.getElementById('url-result');
      if (input) input.value = '';
      if (result) result.innerHTML = '';
    }

  } catch (e) {
    console.error('채널 추가 확인 실패:', e);
    toast('채널 추가 실패: ' + e.message, 'error');
  }
}

// ============================================================================
// 이벤트 바인딩 초기화
// ============================================================================
function initializeChannelsEvents() {
  console.log('채널 관리 이벤트 초기화 시작');

  // 채널 추가 버튼
  const addBtn = document.getElementById('btn-add-channel');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', openChannelAddModal);
    console.log('채널 추가 버튼 바인딩 완료');
  }

  // 내보내기 버튼
  const exportBtn = document.getElementById('btn-export-channels');
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = '1';
    exportBtn.addEventListener('click', exportChannels);
    console.log('내보내기 버튼 바인딩 완료');
  }

  // 가져오기 버튼
  const importBtn = document.getElementById('btn-import-channels');
  const importFile = document.getElementById('file-import-channels');
  if (importBtn && importFile && !importBtn.dataset.bound) {
    importBtn.dataset.bound = '1';
    importBtn.addEventListener('click', () => importFile.click());
    
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      try {
        await importChannelsFromFile(file);
      } catch (e) {
        console.error('파일 가져오기 실패:', e);
      } finally {
        importFile.value = '';
      }
    });
    console.log('가져오기 버튼 바인딩 완료');
  }

  // 정렬 선택 변경
  const sortSelect = document.getElementById('sort-channels');
  if (sortSelect && !sortSelect.dataset.bound) {
    sortSelect.dataset.bound = '1';
    sortSelect.addEventListener('change', refreshChannels);
    console.log('정렬 선택 바인딩 완료');
  }

  // 모달 내 검색 버튼
  const searchBtn = document.getElementById('btn-url-add');
  if (searchBtn && !searchBtn.dataset.bound) {
    searchBtn.dataset.bound = '1';
    searchBtn.addEventListener('click', searchAndAddChannel);
    console.log('검색 버튼 바인딩 완료');
  }

  // Enter 키로 검색
  const urlInput = document.getElementById('url-input');
  if (urlInput && !urlInput.dataset.bound) {
    urlInput.dataset.bound = '1';
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchAndAddChannel();
      }
    });
    console.log('검색 입력 키보드 이벤트 바인딩 완료');
  }

  console.log('채널 관리 이벤트 초기화 완료');
}

// ============================================================================
// 전역 노출 및 초기화
// ============================================================================

// 전역 노출(다른 파일에서 사용)
window.getAllChannels = getAllChannels;
window.deleteChannel = deleteChannel;
window.refreshChannels = refreshChannels;
window.addChannelById = addChannelById;
window.exportChannels = exportChannels;
window.importChannelsFromFile = importChannelsFromFile;
window.updateChannelThumbnails = updateChannelThumbnails;

// 전역 함수들 (HTML에서 직접 호출)
window.deleteChannelById = deleteChannelById;
window.changeChannelPage = changeChannelPage;
window.openChannelAddModal = openChannelAddModal;
window.searchAndAddChannel = searchAndAddChannel;
window.confirmAndAddChannel = confirmAndAddChannel; // 새로 추가

// DOM 로드 완료 후 이벤트 바인딩
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChannelsEvents);
} else {
  // 이미 로드된 경우 즉시 실행
  setTimeout(initializeChannelsEvents, 100);
}

// 앱 시작 시 자동 썸네일 업데이트 (5초 후)
setTimeout(() => {
  if (window.updateChannelThumbnails) {
    window.updateChannelThumbnails();
  }
}, 5000);

console.log('channels.js 로딩 완료');