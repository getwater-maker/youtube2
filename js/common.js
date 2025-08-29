// YouTube 채널 모니터 - 공통 필수 코드 (통합)
console.log('common.js 로딩 시작');

// ============================================================================
// 1) 전역 설정/상수
// ============================================================================

// moment.js 기본설정
try {
  if (typeof moment !== 'undefined') {
    moment.tz.setDefault('Asia/Seoul');
    moment.locale('ko');
    console.log('Moment.js 설정 완료');
  }
} catch (e) {
  console.warn('Moment 설정 경고:', e);
}

// 전역 설정
window.CONFIG = {
  // API
  API_BASE: 'https://www.googleapis.com/youtube/v3/',
  MAX_RESULTS: 50,
  TIMEOUT: 60000, // 60초
  // UI
  DEFAULT_THEME: 'dark',
  PAGINATION: {},
  // 기능별 기본값
	MAX_CHANNEL_MONITOR: 10,
	MAX_VIDEOS_MUTANT: 10,
	MAX_VIDEOS_LATEST: 10,
	MUTANT_THRESHOLD: 2.0,
	MIN_LONGFORM_DURATION: 181  // 롱폼 최소 길이 (초)
};

// 전역 상태
window.state = {
  currentMutantPeriod: '6m',
  currentLatestPeriod: '1m',
  currentView: 'home',
  currentPage: { channels: 1, mutant: 1, latest: 1 }
};

// API 키 보관
window.apiKeys = JSON.parse(localStorage.getItem('youtubeApiKeys') || '[]');
window.keyIdx = 0;

function setApiKeys(keys) {
  window.apiKeys = (keys || []).filter(Boolean);
  window.keyIdx = 0;
  localStorage.setItem('youtubeApiKeys', JSON.stringify(window.apiKeys));
  console.log('API 키 저장됨:', window.apiKeys.length, '개');
}
function nextKey() {
  if (!window.apiKeys || window.apiKeys.length < 2) return;
  window.keyIdx = (window.keyIdx + 1) % window.apiKeys.length;
  console.log('다음 API 키로 전환:', window.keyIdx);
}
function hasKeys() {
  return Array.isArray(window.apiKeys) && window.apiKeys.length > 0;
}
window.setApiKeys = setApiKeys;
window.nextKey = nextKey;
window.hasKeys = hasKeys;

// ============================================================================
// 2) IndexedDB (채널/스냅샷 등)
// ============================================================================
window.db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (window.db) return resolve(window.db);

    const req = indexedDB.open('myChannelDB', 5);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      window.db = db;

      if (!db.objectStoreNames.contains('settings')) {
		db.createObjectStore('settings', { keyPath: 'key' });
	  }

      if (!db.objectStoreNames.contains('insights')) {
        db.createObjectStore('insights', { keyPath: 'channelId' });
      }
      if (!db.objectStoreNames.contains('dailySubs')) {
        db.createObjectStore('dailySubs', { keyPath: ['channelId', 'date'] });
      }
      if (!db.objectStoreNames.contains('doneVideos')) {
        db.createObjectStore('doneVideos', { keyPath: ['channelId', 'videoId'] });
      }
    };

    req.onsuccess = (e) => { window.db = e.target.result; resolve(window.db); };
    req.onerror = (e) => reject(e);
  });
}

function idbAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const q = s.getAll();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    } catch (e) { reject(e); }
  }));
}
function idbGet(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const q = s.get(key);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    } catch (e) { reject(e); }
  }));
}
function idbPut(store, obj) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      const q = s.put(obj);
      q.onsuccess = () => resolve();
      q.onerror = () => reject(q.error);
      tx.onerror = () => reject(tx.error);
    } catch (e) { reject(e); }
  }));
}
function idbDel(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      const q = s.delete(key);
      q.onsuccess = () => resolve();
      q.onerror = () => reject(q.error);
    } catch (e) { reject(e); }
  }));
}

window.openDB = openDB;
window.idbAll = idbAll;
window.idbGet = idbGet;
window.idbPut = idbPut;
window.idbDel = idbDel;

// ============================================================================
// 3) DOM 유틸 / 토스트 / 모달 / 테마 / 드래그
// ============================================================================

// 전역 단축 선택자
function qs(selector, scope) {
  return (scope || document).querySelector(selector);
}
function qsa(selector, scope) {
  return Array.from((scope || document).querySelectorAll(selector));
}
window.qs = qs;
window.qsa = qsa;

function fmt(n) {
  if (n === null || n === undefined) return '0';
  const num = parseInt(String(n).replace(/,/g, ''), 10);
  if (isNaN(num)) return '0';
  return num.toLocaleString('ko-KR');
}
window.fmt = fmt;

// 텍스트 길이 제한 유틸
function truncateText(text, maxLength) {
  if (typeof text !== 'string') return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}
window.truncateText = truncateText;

// ★ 키워드 추출 유틸 (전역)
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  // 간단한 한국어/영문/숫자 토큰 추출
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  // 불용어(간단 버전)
  const stop = new Set(['the','and','for','with','from','this','that','are','was','were','you','your','video','official','full','live','ep','mv','티저','공식','영상','완전','최신','오늘','어제','보기','무료','채널','영상']);
  const counted = new Map();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    counted.set(t, (counted.get(t) || 0) + 1);
  }
  // 상위 10개만 반환
  return [...counted.entries()].sort((a,b) => b[1]-a[1]).slice(0,10).map(([w])=>w);
}
window.extractKeywords = extractKeywords;

function toast(msg, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(420px,90vw)';
    document.body.appendChild(container);
  }
  const typeCfg = {
    success: { icon: '✅', color: '#1db954' },
    error: { icon: '❌', color: '#c4302b' },
    warning: { icon: '⚠️', color: '#ffa502' },
    info: { icon: 'ℹ️', color: '#667eea' }
  };
  const cfg = typeCfg[type] || typeCfg.info;
  const el = document.createElement('div');
  el.className = 'toast-message';
  el.style.cssText =
    `display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:10px;background:var(--card);color:var(--text);` +
    `border-left:6px solid ${cfg.color};box-shadow:0 6px 24px rgba(0,0,0,.25);transform:translateX(-16px);opacity:.98`;
  el.innerHTML = `<span>${cfg.icon}</span><span style="white-space:pre-line">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.transform = 'translateX(0)'; }, 10);
  const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
  el.onclick = remove;
  setTimeout(remove, duration);
}
window.toast = toast;

// 모달
function openModal(id) { 
  const m = qs('#' + id); 
  if (m) {
    m.style.display = 'flex';
    m.classList.add('show'); // 추가
  }
}
function closeModal(id) { 
  const m = qs('#' + id); 
  if (m) {
    m.style.display = 'none'; 
    m.classList.remove('show'); // 추가
  }
}
window.openModal = openModal;
window.closeModal = closeModal;

// 테마
function loadTheme() {
  const saved = localStorage.getItem('theme') || window.CONFIG.DEFAULT_THEME || 'dark';
  document.body.classList.remove('dark', 'light');
  document.body.classList.add(saved);
  const btn = qs('#btn-toggle-theme');
  if (btn) btn.textContent = saved === 'dark' ? '라이트 모드' : '다크 모드';
}
function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  loadTheme();
}
window.loadTheme = loadTheme;
window.toggleTheme = toggleTheme;

// 컬럼 드래그(헤더 잡고 이동) - 새로운 레이아웃에서는 사용하지 않음
function initDrag() {
  // 새로운 섹션 기반 레이아웃에서는 드래그 기능 비활성화
  console.log('드래그 기능은 새로운 레이아웃에서 비활성화됨');
}
window.initDrag = initDrag;

// ============================================================================
// 4) API 키 모달 (입력칸 생성 + 내보내기/가져오기와 연동)
// ============================================================================
function openApiModal() {
  try {
    const wrap = qs('#api-inputs');
    if (!wrap) { openModal('modal-api'); return; }

    // 입력줄 5개 렌더 (각 줄: input + 상태표시)
    wrap.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const key = window.apiKeys[i] || '';
      const row = document.createElement('div');
      row.className = 'api-row';
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'api-inp';
      input.placeholder = `API Key ${i + 1}`;
      input.value = key;
      input.style.cssText =
        'flex:1;padding:12px 14px;border:2px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);' +
        'font-family:Menlo,monospace;font-size:13px;';
      const status = document.createElement('span');
      status.className = 'api-status';
      status.style.cssText = 'min-width:120px;text-align:right;font-size:12px;opacity:.85;';
      row.appendChild(input);
      row.appendChild(status);
      wrap.appendChild(row);
    }

    const result = qs('#api-test-result');
    if (result) result.innerHTML = '';

    openModal('modal-api');
  } catch (e) {
    console.error('API 모달 렌더 오류:', e);
    openModal('modal-api');
  }
}
window.openApiModal = openApiModal;

// ============================================================================
// 5) YouTube API 호출 유틸
// ============================================================================
async function yt(endpoint, params, attempt = 0) {
  if (!hasKeys()) throw new Error('API 키가 설정되지 않았습니다.');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), window.CONFIG.TIMEOUT || 60000);

  const p = new URLSearchParams(params || {});
  p.set('key', window.apiKeys[window.keyIdx] || '');

  const url = window.CONFIG.API_BASE + endpoint + '?' + p.toString();

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    clearTimeout(timeout);

    if (data && data.error) {
      // 쿼터/권한 오류 등
      if (attempt < (window.apiKeys.length - 1)) {
        window.nextKey();
        return yt(endpoint, params, attempt + 1);
      }
      const msg = (data.error.message || 'API 오류') + (data.error.code ? ` (code ${data.error.code})` : '');
      throw new Error(msg);
    }
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (attempt < (window.apiKeys.length - 1)) {
      window.nextKey();
      return yt(endpoint, params, attempt + 1);
    }
    throw e;
  }
}
window.yt = yt;

// ISO8601 PT#H#M#S → seconds
function seconds(iso) {
  try { return Math.round(moment.duration(iso).asSeconds()); }
  catch { return 0; }
}
window.seconds = seconds;

// ============================================================================
// 6) 채널 ID 추출 유틸
// ============================================================================
async function extractChannelId(input) {
  const trimmed = input.trim();
  
  // 이미 채널 ID 형태인 경우 (UC로 시작하는 22자리)
  if (/^UC[A-Za-z0-9_-]{22}$/.test(trimmed)) {
    return trimmed;
  }
  
  // @핸들 형태인 경우
  if (trimmed.startsWith('@')) {
    try {
      const handle = trimmed.slice(1);
      const searchRes = await yt('search', {
        part: 'snippet',
        type: 'channel',
        q: handle,
        maxResults: 1
      });
      
      if (searchRes.items && searchRes.items[0]) {
        return searchRes.items[0].id.channelId;
      }
    } catch (e) {
      console.error('핸들 검색 실패:', e);
    }
    throw new Error('핸들을 통한 채널을 찾을 수 없습니다.');
  }
  
  // URL 형태인 경우
  if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
    // 채널 URL 패턴들
    const patterns = [
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/@([a-zA-Z0-9_-]+)/,
      /youtube\.com\/([a-zA-Z0-9_-]+)$/
    ];
    
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const identifier = match[1];
        
        // 이미 채널 ID 형태라면 바로 반환
        if (/^UC[A-Za-z0-9_-]{22}$/.test(identifier)) {
          return identifier;
        }
        
        // @ 핸들인 경우
        if (trimmed.includes('@')) {
          try {
            const searchRes = await yt('search', {
              part: 'snippet',
              type: 'channel',
              q: identifier,
              maxResults: 1
            });
            
            if (searchRes.items && searchRes.items[0]) {
              return searchRes.items[0].id.channelId;
            }
          } catch (e) {
            console.error('핸들 검색 실패:', e);
          }
        }
        
        // 사용자명이나 커스텀 URL인 경우, 검색으로 시도
        try {
          const searchRes = await yt('search', {
            part: 'snippet',
            type: 'channel',
            q: identifier,
            maxResults: 1
          });
          
          if (searchRes.items && searchRes.items[0]) {
            return searchRes.items[0].id.channelId;
          }
        } catch (e) {
          console.error('채널 검색 실패:', e);
        }
        break;
      }
    }
    
    // 비디오 URL에서 채널 추출
    const videoIdMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (videoIdMatch) {
      try {
        const videoId = videoIdMatch[1];
        const videoRes = await yt('videos', {
          part: 'snippet',
          id: videoId
        });
        
        if (videoRes.items && videoRes.items[0]) {
          return videoRes.items[0].snippet.channelId;
        }
      } catch (e) {
        console.error('비디오에서 채널 추출 실패:', e);
      }
    }
  }
  
  // 일반 텍스트인 경우 검색으로 시도
  try {
    const searchRes = await yt('search', {
      part: 'snippet',
      type: 'channel',
      q: trimmed,
      maxResults: 1
    });
    
    if (searchRes.items && searchRes.items[0]) {
      return searchRes.items[0].id.channelId;
    }
  } catch (e) {
    console.error('일반 검색 실패:', e);
  }
  
  throw new Error('채널을 찾을 수 없습니다.');
}
window.extractChannelId = extractChannelId;

// 섹션별 간단 페이지네이션 렌더
function renderPagination({ containerId, total, page, size, onChange }) {
  const el = qs('#' + containerId);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) { el.innerHTML = ''; return; }

  const btn = (p, label = p, disabled = false, active = false) =>
    `<button class="btn btn-secondary ${active ? 'active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''} style="min-width:36px;">${label}</button>`;

  let html = '';
  html += btn(Math.max(1, page - 1), '‹', page === 1);
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  for (let p = start; p <= end; p++) html += btn(p, String(p), false, p === page);
  html += btn(Math.min(pages, page + 1), '›', page === pages);

  el.innerHTML = html;
  qsa('button[data-page]', el).forEach(b => {
    b.addEventListener('click', () => {
      const p = parseInt(b.getAttribute('data-page'), 10);
      if (typeof onChange === 'function') onChange(p);
    });
  });
}
window.renderPagination = renderPagination;

// 홈 화면으로 복귀(분석 화면 닫기)
function showHome() {
  const analysis = qs('#analysis-section');
  if (analysis) analysis.remove();
  const main = qs('#main-content');
  if (main) main.style.display = '';
  if (window.state) window.state.currentView = 'home';
  
  // 네비게이션도 채널관리로 복귀
  if (window.showSection) {
    window.showSection('channels');
  }
}
window.showHome = showHome;

console.log('common.js 로딩 완료');