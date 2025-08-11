/* js/common.js - 공통 유틸, API, IndexedDB, 섹션 공용 함수 등 */

moment.tz.setDefault('Asia/Seoul');
const API = 'https://www.googleapis.com/youtube/v3/';
let currentMutantPeriod = '6m';

/* API 키 관리 */
let apiKeys = JSON.parse(localStorage.getItem('youtubeApiKeys') || localStorage.getItem('apiKeys') || '[]');
if (!localStorage.getItem('youtubeApiKeys') && localStorage.getItem('apiKeys')) {
  localStorage.setItem('youtubeApiKeys', localStorage.getItem('apiKeys'));
}
let keyIdx = 0;

function setApiKeys(keys) {
  apiKeys = keys.filter(Boolean);
  keyIdx = 0;
  localStorage.setItem('youtubeApiKeys', JSON.stringify(apiKeys));
  localStorage.setItem('apiKeys', JSON.stringify(apiKeys));
}

function nextKey() {
  if (apiKeys.length > 1) keyIdx = (keyIdx + 1) % apiKeys.length;
}

function hasKeys() {
  return apiKeys.length > 0;
}

/* IndexedDB */
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('myChannelDB', 4);
    r.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains('my_channels')) db.createObjectStore('my_channels', {
        keyPath: 'id'
      });
      if (!db.objectStoreNames.contains('insights')) db.createObjectStore('insights', {
        keyPath: 'channelId'
      });
      if (!db.objectStoreNames.contains('dailySubs')) db.createObjectStore('dailySubs', {
        keyPath: ['channelId', 'date']
      });
      if (!db.objectStoreNames.contains('doneVideos')) db.createObjectStore('doneVideos', {
        keyPath: ['channelId', 'videoId']
      });
    };
    r.onsuccess = e => {
      db = e.target.result;
      res(db);
    };
    r.onerror = e => rej(e);
  });
}

function idbAll(store) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const q = s.getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
}

function idbGet(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const s = tx.objectStore(store);
    const q = s.get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
}

function idbPut(store, obj) {
  return openDB().then(db => new Promise((res, rej) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      const q = s.put(obj);
      q.onsuccess = () => res();
      q.onerror = () => rej(q.error);
      tx.onerror = () => rej(tx.error);
    } catch (e) {
      rej(e);
    }
  }));
}

function idbDel(store, key) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const q = s.delete(key);
    q.onsuccess = () => res();
    q.onerror = () => rej(q.error);
  }));
}

/* 유틸 */
const qs = id => document.getElementById(id);
const fmt = n => {
  const x = parseInt(n || '0', 10);
  return isNaN(x) ? '0' : x.toLocaleString();
};
const seconds = iso => moment.duration(iso).asSeconds();
const stopWords = new Set(['은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '로', '으로', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'with', 'about', 'into', '에서', '같은', '뿐', '위해', '합니다', '했다', '하는', '하기', '진짜', '무너졌다']);

function toast(msg, ms = 1800) {
  const t = qs('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', ms);
}

function showError(elementId, message) {
  const el = qs(elementId);
  if (el) el.innerHTML = `<div class="error-message">${message}</div>`;
}

function showSuccess(elementId, message) {
  const el = qs(elementId);
  if (el) el.innerHTML = `<div class="success-message">${message}</div>`;
}

/* 키워드 추출 - 1회 등장 키워드 제외 */
function extractKeywords(text) {
  const freq = new Map();
  if (!text) return [];
  text.replace(/[#"'.!?()/\-:;\[\]{}|<>~^%$@*&+=]/g, ' ').split(/\s+/).forEach(w => {
    w = w.trim().toLowerCase();
    const hasKo = /[가-힣]/.test(w);
    if (!w) return;
    if ((hasKo && w.length < 2) || (!hasKo && w.length < 3)) return;
    if (stopWords.has(w)) return;
    freq.set(w, (freq.get(w) || 0) + 1);
  });
  return [...freq.entries()]
    .filter(([word, count]) => count > 1)
    .sort((a, b) => b[1] - a[1]);
}

/* API 호출 (키 순환, 타임아웃) */
async function yt(endpoint, params, attempt = 0) {
  if (!apiKeys.length) throw new Error('API 키가 설정되지 않았습니다. API 키를 먼저 입력해주세요.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), 30000);
  const p = new URLSearchParams(params);
  p.set('key', apiKeys[keyIdx]);
  const url = API + endpoint + '?' + p.toString();
  try {
    const r = await fetch(url, {
      signal: ctrl.signal
    });
    const data = await r.json();
    clearTimeout(t);
    if (data.error) {
      if (data.error.code === 403 && /quota/i.test(data.error.message || '')) throw new Error('API 할당량이 초과되었습니다.');
      if (attempt < apiKeys.length - 1) {
        nextKey();
        return yt(endpoint, params, attempt + 1);
      }
      throw new Error(data.error.message || 'API 오류');
    }
    return data;
  } catch (e) {
    clearTimeout(t);
    if (attempt < apiKeys.length - 1) {
      nextKey();
      return yt(endpoint, params, attempt + 1);
    }
    throw e;
  }
}

/* 채널 목록 내보내기/가져오기 */
async function exportChannels() {
  const list = await getAllChannels();
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    channels: list.map(c => ({
      id: c.id,
      title: c.title
    }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
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

async function importChannelsFromFile(file) {
  try {
    const txt = await file.text();
    const parsed = JSON.parse(txt);
    let ids = [];
    if (Array.isArray(parsed)) {
      ids = parsed.map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    } else if (parsed && Array.isArray(parsed.channels)) {
      ids = parsed.channels.map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    } else {
      ids = Object.values(parsed).map(x => (typeof x === 'string' ? x : x.id)).filter(Boolean);
    }
    ids = Array.from(new Set(ids));
    if (!ids.length) {
      toast('가져올 채널 ID가 없습니다.');
      return;
    }

    const exist = await getAllChannels();
    const existIds = new Set(exist.map(c => c.id));
    const toAdd = ids.filter(id => !existIds.has(id));

    let ok = 0,
      fail = 0;
    for (const id of toAdd) {
      try {
        await addChannelById(id);
        ok++;
      } catch (e) {
        console.error('채널 추가 실패', id, e);
        fail++;
      }
    }
    toast(`가져오기 완료: ${ok}개 추가${fail?`, 실패 ${fail}개`:''} (중복 제외)`);
    refreshAll('channels');
  } catch (e) {
    console.error(e);
    toast('가져오는 중 오류가 발생했습니다.');
  }
}

/* 테마 토글 */
function toggleTheme() {
  const body = document.body;
  const btn = qs('btn-toggle-theme');
  if (body.classList.contains('dark')) {
    body.classList.remove('dark');
    body.classList.add('light');
    if (btn) btn.textContent = '다크 모드';
    localStorage.setItem('theme', 'light');
  } else {
    body.classList.remove('light');
    body.classList.add('dark');
    if (btn) btn.textContent = '라이트 모드';
    localStorage.setItem('theme', 'dark');
  }
}

function loadTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(savedTheme);
  const btn = qs('btn-toggle-theme');
  if (btn) btn.textContent = savedTheme === 'light' ? '다크 모드' : '라이트 모드';
}

/* 채널 관련 함수들 */
async function getAllChannels() {
  return idbAll('my_channels');
}

async function addChannelById(id) {
  if (!id) throw new Error('채널 ID가 필요합니다.');
  if (!hasKeys()) throw new Error('API 키가 설정되지 않았습니다.');
  const ch = await yt('channels', {
    part: 'snippet,statistics,contentDetails',
    id
  });
  if (!ch.items || !ch.items.length) throw new Error('채널을 찾을 수 없습니다.');
  const c = ch.items[0];
  const obj = {
    id: c.id,
    title: c.snippet.title,
    description: c.snippet.description,
    thumbnails: c.snippet.thumbnails,
    subscriberCount: parseInt(c.statistics.subscriberCount || '0'),
    videoCount: parseInt(c.statistics.videoCount || '0'),
    uploadsPlaylistId: c.contentDetails.relatedPlaylists.uploads,
    createdAt: c.snippet.publishedAt
  };
  await idbPut('my_channels', obj);
  toast(`채널 [${obj.title}] 추가 완료`);
}

async function deleteChannel(id) {
  await idbDel('my_channels', id);
  toast('채널이 삭제되었습니다.');
}

/* 영상 리스트 렌더링 - 썸네일 포함, 3줄 레이아웃 */
function renderVideoList(videos, listId, kwId) {
  const wrap = qs(listId);
  if (!wrap) return;
  if (!videos.length) {
    wrap.innerHTML = '<p class="muted">표시할 영상이 없습니다.</p>';
    if (kwId && qs(kwId)) qs(kwId).innerHTML = '';
    return;
  }
  wrap.innerHTML = '';
  videos.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <a class="video-link" target="_blank" href="https://www.youtube.com/watch?v=${v.id}">
        <div class="thumb-wrap">
          <img class="thumb" src="${v.thumbnail || (v.snippet?.thumbnails?.medium?.url) || ''}" alt="썸네일">
        </div>
        <div class="v-title">${v.title}</div>
<div class="v-meta first-line">
  <span class="channel-name">${v.__ch?.title || (v.snippet?.channelTitle) || '알 수 없음'}</span>
  <span class="subscriber-count">구독자: ${fmt(v.__ch?.subscriberCount)}</span>
  <span class="view-count">조회수: ${fmt(v.viewCount)}</span>
</div>

        <div class="v-meta second-line">
          <span class="upload-date">업로드: ${moment(v.publishedAt).format('YYYY-MM-DD')}</span>
          <label class="done-label">
            <input type="checkbox" data-done="${v.id}"/> 영상제작완료
          </label>
        </div>
        <div class="v-meta third-line">
          ${v.mutantIndex ? `<div class="badge">${v.mutantIndex}</div>` : ''}
        </div>
      </a>
    `;
    idbGet('doneVideos', [v.__ch?.channelId || v.snippet?.channelId || '', v.id]).then(rec => {
      if (rec) {
        const cb = card.querySelector(`[data-done='${v.id}']`);
        if (cb) cb.checked = true;
      }
    });
    card.addEventListener('change', async (e) => {
      if (e.target && e.target.matches(`[data-done='${v.id}']`)) {
        if (e.target.checked) {
          await idbPut('doneVideos', {
            channelId: (v.__ch?.channelId || v.snippet?.channelId || ''),
            videoId: v.id,
            done: true,
            ts: Date.now()
          });
        } else {
          await idbDel('doneVideos', [v.__ch?.channelId || v.snippet?.channelId || '', v.id]);
        }
      }
    });
    wrap.appendChild(card);
  });
  if (kwId && qs(kwId)) {
    const f = extractKeywords(videos.map(v => v.title || '').join(' '));
    const top = f.slice(0, 12);
    qs(kwId).innerHTML = top.map(([w, c]) => `<span class="kw">${w} ${c}회</span>`).join('');
  }
}

/* 키워드 분석 섹션 렌더링 */
function renderKeywordSection(videos, containerId) {
  const container = qs(containerId);
  if (!container) return;
  if (!videos.length) {
    container.innerHTML = '<p class="muted">키워드가 없습니다.</p>';
    return;
  }
  const allTitles = videos.map(v => v.title || '').join(' ');
  const keywords = extractKeywords(allTitles).slice(0, 12);
  container.innerHTML = keywords.map(([w, c]) => `<span class="kw">${w} ${c}회</span>`).join('');
}

/* 영상 정렬 함수 (예시) */
function sortVideos(videos, criteria) {
  if (!videos) return [];
  return videos.slice().sort((a, b) => {
    switch (criteria) {
      case 'views':
        return (b.viewCount || 0) - (a.viewCount || 0);
      case 'subscribers':
        return (b.__ch?.subscriberCount || 0) - (a.__ch?.subscriberCount || 0);
      case 'latest':
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      case 'mutantIndex':
        return (b.mutantIndex || 0) - (a.mutantIndex || 0);
      case 'videos':
        return (b.__ch?.videoCount || 0) - (a.__ch?.videoCount || 0);
      default:
        return 0;
    }
  });
}

/* 각 섹션 리프레시 함수 (스텁, 실제 구현 필요) */
async function refreshChannels() { /* 채널 목록 새로고침 로직 */ }
async function refreshMutant() { /* 돌연변이 영상 새로고침 로직 */ }
async function refreshLatest() { /* 최신 영상 새로고침 로직 */ }

/* 전체 갱신 함수 */
async function refreshAll(which) {
  if (!hasKeys()) {
    toast('API 키를 설정해주세요.');
    return;
  }
  if (!which || which === 'channels') await refreshChannels();
  if (!which || which === 'mutant') await refreshMutant();
  if (!which || which === 'latest') await refreshLatest();

  // 키워드 분석 통합: 돌연변이 영상 + 최신 영상 합산
  const mutantVideos = await getMutantVideos(); // 함수 내 돌연변이 영상 리스트 반환
  const latestVideos = await getLatestVideos(); // 최신 영상 리스트 반환
  renderKeywordSection(mutantVideos.concat(latestVideos), 'keyword-list');
}

/* 유틸: API 키 테스트, 에러 처리, 기타 공통 함수 작성 가능 */
function getMutantVideos() {
  return [];
} // 임시 함수
function getLatestVideos() {
  return [];
} // 임시 함수


// -------------------------------------------------------------
// 페이지 초기화 및 이벤트 리스너
// -------------------------------------------------------------

/**
 * 모달 열기/닫기 함수
 */
function showModal(id) {
  const modal = qs(id);
  if (modal) {
    modal.style.display = 'block';
  }
}

function hideModal(id) {
  const modal = qs(id);
  if (modal) {
    modal.style.display = 'none';
  }
}

function setupModal() {
  // 모달 닫기 버튼 이벤트 리스너
  document.querySelectorAll('.modal .close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = e.target.getAttribute('data-close');
      hideModal(modalId);
    });
  });

  // 모달 외부 클릭 시 닫기
  window.addEventListener('click', (e) => {
    document.querySelectorAll('.modal').forEach(modal => {
      if (e.target === modal) {
        hideModal(modal.id);
      }
    });
  });
}

/**
 * 페이지 로드 후 이벤트 리스너 등록
 */
document.addEventListener('DOMContentLoaded', () => {
  // 테마 로드
  loadTheme();

  // 버튼 이벤트 리스너 등록
  qs('btn-toggle-theme')?.addEventListener('click', toggleTheme);
  qs('btn-api')?.addEventListener('click', () => showModal('modal-api'));
  qs('btn-add-channel')?.addEventListener('click', () => showModal('modal-add'));
  qs('btn-analyze')?.addEventListener('click', () => showModal('modal-analyze'));

  // 모달 관련 설정
  setupModal();

  // 파일 가져오기 버튼과 실제 input 연결
  qs('btn-import-channels')?.addEventListener('click', () => {
    qs('file-import-channels').click();
  });
  qs('file-import-channels')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importChannelsFromFile(file);
    }
  });

  // 내보내기 버튼 이벤트 리스너
  qs('btn-export-channels')?.addEventListener('click', exportChannels);

  // API 키 모달 내부 버튼 이벤트 리스너
  qs('api-file-btn')?.addEventListener('click', () => {
    qs('api-file').click();
  });
  // ... (다른 API 모달 버튼 로직 추가 필요)

  // 채널 추가 모달 탭 이벤트 리스너
  document.querySelectorAll('#modal-add .tabs .tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetTab = e.target.getAttribute('data-tab');
      // 모든 탭 비활성화
      document.querySelectorAll('#modal-add .tabs .tab').forEach(t => t.classList.remove('active'));
      // 클릭한 탭 활성화
      e.target.classList.add('active');
      // 모든 패널 숨기기
      document.querySelectorAll('#modal-add .tabpanel').forEach(p => p.style.display = 'none');
      // 해당 패널 보이기
      qs(targetTab).style.display = 'block';
    });
  });

  // 초기 페이지 로드 시 전체 데이터 새로고침
  refreshAll();
});
