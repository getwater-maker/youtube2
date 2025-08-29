/**
 * oauth-manager.js
 * - Google Identity Services(GIS) OAuth2 토큰 발급/관리
 * - YouTube Data API v3 호출 유틸 (Bearer 토큰)
 * - Client ID는 파일에 하드코딩하지 않고, 입력창(모달)에서 받아 IndexedDB/LocalStorage에 저장
 *
 * 요구되는 HTML 요소(이미 index.html에 추가됨):
 *  - 상단 버튼:   #btn-oauth-settings
 *  - 모달:        #modal-oauth
 *  - 입력:        #oauth-client-id-input
 *  - 저장 버튼:   #oauth-client-id-save
 *
 * 외부 의존:
 *  - window.openModal / window.closeModal (main.js)
 *  - idbGet / idbPut (common.js; 'settings' 스토어 사용)
 *  - gsi client script: https://accounts.google.com/gsi/client (index.html에서 로드)
 */

(function () {
  'use strict';

  /* ===== 상수/키 ===== */
  const CID_KEY   = 'yt_client_id';     // Client ID 저장 키 (localStorage)
  const TOKEN_KEY = 'yt_oauth_v2';      // 액세스 토큰 저장 키 (localStorage)

  // 읽기(youtube.readonly) + 쓰기(youtube.force-ssl; 제목변경 등) 스코프
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl';
// [추가] GIS 로드 대기 (최대 10초)
function waitForGIS(maxMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve(true);
      if (Date.now() - started > maxMs) return reject(new Error('Google Identity Services 스크립트가 로드되지 않았습니다.'));
      setTimeout(poll, 100);
    })();
  });
}


  /* ===== 상태 ===== */
  let CLIENT_ID = '';         // 메모리 상의 Client ID
  let tokenClient = null;     // GIS Token Client
  let lastToken = null;       // { access_token, expires_at:number(ms), scope }

  /* ===== 유틸 ===== */
  const $ = (sel, root = document) => root.querySelector(sel);

  function now() { return Date.now(); }
  function safeJSON(v, fallback = null) {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  function toast(msg, type) {
    try { if (window.toast) return window.toast(msg, type || 'info'); } catch {}
    console.log('[Toast]', type || 'info', msg);
  }

  /* ===== Token 저장/로드 ===== */
  function setLocalToken(tok) {
    if (!tok || !tok.access_token) return;
    // expires_at(절대시간 ms) 보장
    const lifeSec = Number(tok.expires_in || tok.expires) || 3600;
    const expires_at = tok.expires_at || (now() + lifeSec * 1000 - 10_000); // 10초 여유
    const obj = { access_token: tok.access_token, scope: tok.scope || SCOPE, expires_at };
    lastToken = obj;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(obj)); } catch {}
    // gapi가 있다면 동기화
    try { gapi?.client?.setToken?.({ access_token: obj.access_token }); } catch {}
  }
  function getLocalToken() {
    if (lastToken) return lastToken;
    const obj = safeJSON(localStorage.getItem(TOKEN_KEY), null);
    if (obj && obj.access_token) {
      lastToken = obj;
      return obj;
    }
    return null;
  }
  function isExpired(tok) {
    if (!tok) return true;
    const exp = Number(tok.expires_at || 0);
    return !exp || exp - now() < 5_000; // 5초 이내면 만료로 간주
  }

  /* ===== Client ID ===== */
  function getClientIdSync() {
    if (CLIENT_ID) return CLIENT_ID;
    // localStorage 우선
    const cid = (localStorage.getItem(CID_KEY) || '').trim();
    if (cid) CLIENT_ID = cid;
    return CLIENT_ID || '';
  }

  function resolveClientId(interactiveIfMissing = false) {
    const cid = getClientIdSync();
    if (cid) return cid;

    if (interactiveIfMissing) {
      // 모달 열어서 입력 유도
      try {
        if (typeof window.openOAuthClientIdModal === 'function') {
          window.openOAuthClientIdModal();
        } else {
          toast('상단 "🔐 OAuth 설정" 버튼에서 Client ID를 저장해 주세요.', 'warning');
        }
      } catch {}
      throw new Error('Google OAuth Client ID가 필요합니다.');
    }
    return '';
  }

  /* ===== GIS 토큰 클라이언트 ===== */
  function ensureGisClient(interactiveIfMissing = false) {
    // Client ID 확인
    const cid = resolveClientId(interactiveIfMissing);
    // GIS 로드 확인
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      throw new Error('Google Identity Services 스크립트가 로드되지 않았습니다.');
    }
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPE,
        callback: () => {} // 실제 발급은 requestAccessToken에서 Promise로 래핑
      });
    } else {
      // Client ID가 바뀌었으면 재생성
      const tcAny = tokenClient;
      if (tcAny?.clientId && tcAny.clientId !== cid) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: SCOPE,
          callback: () => {}
        });
      }
    }
    return tokenClient;
  }

  async function requestAccessToken(prompt = 'consent') {
  // GIS 스크립트 로드 대기 (없으면 에러)
  await waitForGIS();
  return new Promise((resolve, reject) => {
    try {
      const tc = ensureGisClient(true);
      tc.callback = (resp) => {
        if (resp && resp.access_token) {
          setLocalToken(resp);
          resolve(resp);
        } else if (resp && resp.error) {
          reject(new Error(resp.error));
        } else {
          reject(new Error('Unknown token response'));
        }
      };
      tc.requestAccessToken({ prompt }); // 'consent' | 'none'
    } catch (e) {
      reject(e);
    }
  });
}


  /* ===== 공개 API: 로그인/로그아웃/토큰 ===== */
  async function oauthSignIn(promptMode = 'consent') {
    const tok = await requestAccessToken(promptMode);
    return tok;
  }

  function revokeAndClearToken() {
    try {
      const tok = getLocalToken();
      if (tok && tok.access_token && window.google?.accounts?.oauth2?.revoke) {
        window.google.accounts.oauth2.revoke(tok.access_token, () => console.log('[OAuth] token revoked'));
      }
    } catch (e) {
      console.warn('[OAuth] revoke error', e);
    }
    try { gapi?.client?.setToken?.(''); } catch {}
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    lastToken = null;
    console.log('[OAuth] cleared local token');
  }

  function oauthSignOut() {
    revokeAndClearToken();
    toast('로그아웃되었습니다.', 'info');
  }

  function getAccessToken() {
    const tok = getLocalToken();
    return tok?.access_token || '';
    // gapi.client.getToken()?.access_token 을 사용할 수도 있지만, 여기서는 로컬 캐시 우선
  }

  /* ===== YouTube API 호출 유틸 ===== */
  async function ensureValidToken() {
    let tok = getLocalToken();
    if (!tok || isExpired(tok)) {
      // 조용히 갱신 시도
      try {
        await requestAccessToken('none');
        tok = getLocalToken();
      } catch {
        // 동의 필요
        await requestAccessToken('consent');
        tok = getLocalToken();
      }
    }
    if (!tok || !tok.access_token) throw new Error('액세스 토큰을 발급받지 못했습니다.');
    return tok.access_token;
  }

  async function oauthFetch(url, options = {}) {
    const token = await ensureValidToken();

    const headers = new Headers(options.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');

    const res = await fetch(url, { ...options, headers });

    // 401이면 한 번 재시도 (silent refresh)
    if (res.status === 401) {
      try {
        await requestAccessToken('none');
        const token2 = getAccessToken();
        headers.set('Authorization', `Bearer ${token2}`);
        return await fetch(url, { ...options, headers });
      } catch {
        // 재시도 실패
      }
    }
    return res;
  }

  async function ytAuth(endpoint, params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      q.set(k, v === true ? 'true' : v === false ? 'false' : String(v));
    });
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${q.toString()}`;

    const res = await oauthFetch(url);

    if (!res.ok) {
      const text = await res.text();
      let reason = '', message = text;
      try {
        const j = JSON.parse(text);
        message = j?.error?.message || message;
        reason  = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
      } catch {}

      console.error('YouTube API 오류', { status: res.status, reason, message, endpoint, params });

      // 사용자 안내
      if (/youtubeSignupRequired/i.test(reason)) {
        toast('이 Google 계정에는 아직 유튜브 채널이 없습니다. 먼저 YouTube에서 채널을 만든 뒤 다시 시도해 주세요.', 'warning');
      } else if (/insufficientPermissions/i.test(reason)) {
        toast('권한 부족입니다. 로그인 시 스코프(읽기/쓰기)를 허용해 주세요.', 'warning');
      } else if (/accessNotConfigured|SERVICE_DISABLED/i.test(message)) {
        toast('이 프로젝트에서 YouTube Data API v3가 비활성화되어 있습니다. GCP에서 Enable 후 잠시 뒤 다시 시도하세요.', 'error');
      } else if (/quotaExceeded/i.test(reason)) {
        toast('YouTube API 쿼터를 초과했습니다. 잠시 후 다시 시도해 주세요.', 'warning');
      } else if (res.status === 403) {
        toast('요청이 거부되었습니다(403). 권한/프로젝트 설정/동의화면을 점검해 주세요.', 'error');
      } else {
        toast(`요청 실패: ${message}`, 'error');
      }

      throw new Error(`YouTube API 오류(${res.status} ${reason}): ${message}`);
    }

    return res.json();
  }

  /* ===== OAuth Client ID 입력 모달 연동 ===== */
  function openOAuthClientIdModal() {
    try {
      const input = $('#oauth-client-id-input');
      if (input) {
        const saved = localStorage.getItem(CID_KEY) || '';
        input.value = saved;
        input.placeholder = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com';
      }
      if (window.openModal) window.openModal('modal-oauth');
    } catch (e) {
      console.error('OAuth 모달 열기 오류:', e);
    }
  }

  async function bindOAuthClientIdUI() {
    try {
      // IndexedDB → LocalStorage 동기화 (최초 1회)
      let saved = localStorage.getItem(CID_KEY) || '';
      try {
        if (window.idbGet) {
          const rec = await idbGet('settings', 'oauth_client_id');
          if (rec && rec.value) saved = rec.value;
        }
      } catch (e) { console.warn('IDB read error', e); }

      if (saved) {
        localStorage.setItem(CID_KEY, saved);
        if (!CLIENT_ID) CLIENT_ID = saved;
        const input = $('#oauth-client-id-input');
        if (input) input.value = saved;
      }

      // 열기 버튼
      const openBtn = $('#btn-oauth-settings');
      if (openBtn && openBtn.dataset.bound !== '1') {
        openBtn.dataset.bound = '1';
        openBtn.addEventListener('click', () => openOAuthClientIdModal());
      }

      // 저장 버튼
      const saveBtn = $('#oauth-client-id-save');
      if (saveBtn && saveBtn.dataset.bound !== '1') {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', async () => {
          const v = ($('#oauth-client-id-input')?.value || '').trim();
          if (!v) { alert('Client ID를 입력하세요.'); return; }
          try {
            // 1) LocalStorage (동기 사용)
            localStorage.setItem(CID_KEY, v);
            // 2) IndexedDB (PC에 영구 저장)
            if (window.idbPut) await idbPut('settings', { key: 'oauth_client_id', value: v });
            CLIENT_ID = v;

            // 저장 직후 토큰 폐기(다시 로그인 필요)
            revokeAndClearToken();
            toast('Client ID 저장 완료. 다시 로그인해 주세요.', 'success');
            window.closeModal && window.closeModal('modal-oauth');
          } catch (e) {
            console.error('Client ID 저장 실패:', e);
            alert('저장 실패: ' + e.message);
          }
        });
      }
    } catch (e) {
      console.error('OAuth 설정 바인딩 오류:', e);
    }
  }

  /* ===== 전역 노출 ===== */
  window.oauthSignIn        = window.oauthSignIn        || oauthSignIn;
  window.oauthSignOut       = window.oauthSignOut       || oauthSignOut;
  window.getAccessToken     = window.getAccessToken     || getAccessToken;
  window.oauthFetch         = window.oauthFetch         || oauthFetch;
  window.ytAuth             = window.ytAuth             || ytAuth;
  window.openOAuthClientIdModal = window.openOAuthClientIdModal || openOAuthClientIdModal;
  window.revokeAndClearToken = window.revokeAndClearToken || revokeAndClearToken;

  document.addEventListener('DOMContentLoaded', bindOAuthClientIdUI);
})();
