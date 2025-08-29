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

// 날짜 헬퍼
function fmtDate(d) {
  try {
    if (!d) return '';
    if (typeof d === 'string' || typeof d === 'number') d = new Date(d);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch (e) {
    return '';
  }
}
window.fmtDate = fmtDate;

// 간단 로거
function log(...args) {
  try { console.log('[YT]', ...args); } catch {}
}
function warn(...args) {
  try { console.warn('[YT]', ...args); } catch {}
}
function error(...args) {
  try { console.error('[YT]', ...args); } catch {}
}
window._log = log;
window._warn = warn;
window._error = error;

// 환경 감지
window.isProd = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

// ============================================================================
// 2) IndexedDB (채널/스냅샷 등)
// ============================================================================
window.db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (window.db) return resolve(window.db);

    // ★ 업그레이드: 버전 5 → 6 (my_channels 스토어 추가를 위해)
    const req = indexedDB.open('myChannelDB', 6);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      window.db = db;

      if (!db.objectStoreNames.contains('settings')) {
		db.createObjectStore('settings', { keyPath: 'key' });
	  }

      // 사용자 채널 저장용 스토어 (누락 방지)
      if (!db.objectStoreNames.contains('my_channels')) {
        db.createObjectStore('my_channels', { keyPath: 'id' });
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

    req.onsuccess = () => {
      window.db = req.result;
      resolve(window.db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn('IndexedDB upgrade blocked. 다른 탭을 닫거나 새로고침하세요.');
    };
  });
}

function idbAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  }));
}

function idbGet(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const req = s.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  }));
}

function idbPut(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      const req = s.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
// 3) 스토리지 헬퍼 (localStorage)
// ============================================================================
function saveJSON(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
}
function loadJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
window.saveJSON = saveJSON;
window.loadJSON = loadJSON;

// ============================================================================
// 4) API 키 관리 (YouTube / SerpAPI / OpenAI)
// ============================================================================
const KEY_STORE = 'settings';
const KEY_KEYS = {
  yt: 'apiKey.youtube',
  serp: 'apiKey.serp',
  openai: 'apiKey.openai',
};

async function getApiKeys() {
  const [yt, serp, openai] = await Promise.all([
    idbGet(KEY_STORE, KEY_KEYS.yt),
    idbGet(KEY_STORE, KEY_KEYS.serp),
    idbGet(KEY_STORE, KEY_KEYS.openai),
  ]);
  return {
    youtube: yt?.value || '',
    serpapi: serp?.value || '',
    openai: openai?.value || '',
  };
}

async function setApiKeys({ youtube, serpapi, openai }) {
  const writes = [];
  if (typeof youtube === 'string') {
    writes.push(idbPut(KEY_STORE, { key: KEY_KEYS.yt, value: youtube }));
  }
  if (typeof serpapi === 'string') {
    writes.push(idbPut(KEY_STORE, { key: KEY_KEYS.serp, value: serpapi }));
  }
  if (typeof openai === 'string') {
    writes.push(idbPut(KEY_STORE, { key: KEY_KEYS.openai, value: openai }));
  }
  await Promise.all(writes);
  console.log('API 키 저장 완료');
}

async function hasKeys(kind) {
  const keys = await getApiKeys();
  if (!kind) return !!(keys.youtube || keys.serpapi || keys.openai);
  if (kind === 'youtube') return !!keys.youtube;
  if (kind === 'serpapi') return !!keys.serpapi;
  if (kind === 'openai') return !!keys.openai;
  return false;
}

async function nextKey(kind, fallback = '') {
  const keys = await getApiKeys();
  if (kind === 'youtube') return keys.youtube || fallback;
  if (kind === 'serpapi') return keys.serpapi || fallback;
  if (kind === 'openai') return keys.openai || fallback;
  return fallback;
}
window.getApiKeys = getApiKeys;
window.setApiKeys = setApiKeys;
window.nextKey = nextKey;
window.hasKeys = hasKeys;

// ============================================================================
// 5) 간단 네트워크/지연 유틸
// ============================================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
window.sleep = sleep;

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
window.fetchJSON = fetchJSON;

// ============================================================================
// 6) DOM/모달/알림
// ============================================================================
function qs(selector, scope) {
  return (scope || document).querySelector(selector);
}
function qsa(selector, scope) {
  return Array.from((scope || document).querySelectorAll(selector));
}
window.qs = qs;
window.qsa = qsa;

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'none';
  document.body.classList.remove('modal-open');
}
window.openModal = openModal;
window.closeModal = closeModal;

function toast(msg, type = 'info', timeout = 2500) {
  try {
    let box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:9999;';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  } catch {}
}
window.toast = toast;

// ============================================================================
// 7) 포맷팅/숫자
// ============================================================================
function fmt(n) {
  if (n === null || n === undefined) return '0';
  const num = parseInt(String(n).replace(/,/g, ''), 10);
  if (isNaN(num)) return '0';
  return num.toLocaleString('ko-KR');
}
window.fmt = fmt;

// ============================================================================
// 8) URL/쿼리스트링
// ============================================================================
function getParam(name, url) {
  if (!url) url = location.href;
  name = name.replace(/[[\]]/g, '\\$&');
  const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}
window.getParam = getParam;

// ============================================================================
// 9) 페이지네이션 유틸 (선택)
// ============================================================================
function renderPager(el, page, pages, onChange) {
  if (!el) return;
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
window.renderPager = renderPager;

// ============================================================================
// 10) 간단 로딩 인디케이터
// ============================================================================
function setLoading(el, isLoading, text = '로딩중...') {
  if (!el) return;
  if (isLoading) {
    el.setAttribute('data-loading', '1');
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `<div class="spinner"></div><div class="loading-text">${text}</div>`;
    el.appendChild(overlay);
  } else {
    el.removeAttribute('data-loading');
    const overlay = el.querySelector('.loading-overlay');
    if (overlay) overlay.remove();
  }
}
window.setLoading = setLoading;

// ============================================================================
// 11) 홈으로 복귀 (모달 닫고 메인 보여주기)
// ============================================================================
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
