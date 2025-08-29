/* ===== video-manager.js (전역 버전 / index.html 섹션용) ===== */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 상수 / 상태
  // ─────────────────────────────────────────────────────────────
  const YT_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest';
  const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
  const CID_KEY = 'yt_client_id';

  let gapiInited = false;
  let gisReady = false;
  let tokenClient = null;

  // 캐시
  let videosCache = []; // [{id, snippet, statistics, thumb}]
  const $$ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  function setText(sel, text) {
    const el = $$(sel);
    if (el) el.textContent = text || '';
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }
  function toast(msg, type) {
    try {
      if (typeof window.toast === 'function') return window.toast(msg, type || 'info');
    } catch {}
    alert(msg);
  }

  // ─────────────────────────────────────────────────────────────
  // 초기화
  // ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // 날짜 기본값: 이번 달 1일 ~ 오늘
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const startInput = $$('#vm-date-start');
    const endInput = $$('#vm-date-end');
    if (endInput) endInput.value = `${yyyy}-${mm}-${dd}`;
    if (startInput) startInput.value = `${yyyy}-${mm}-01`;

    // 클라이언트 ID 채우기
    const savedCid = localStorage.getItem(CID_KEY) || '';
    if ($$('#vm-client-id') && savedCid) $$('#vm-client-id').value = savedCid;

    // 프리셋 UI
    if (window.TitlePresets) window.TitlePresets.renderPresetUI();

    // 버튼 바인딩
    bindButtons();

    // gapi/gis 준비
    prepareGapi();
    prepareGis();

    // 섹션 버튼은 navigation.js가 처리하지만, 혹시를 위해 안전 바인딩
    const btnNav = $$('#btn-video-manager');
    on(btnNav, 'click', () => {
      if (typeof window.showSection === 'function') {
        window.showSection('video-manager');
      } else {
        // 폴백 표시
        const sections = document.querySelectorAll('.section');
        sections.forEach((s) => (s.style.display = 'none'));
        const t = $$('#section-video-manager');
        if (t) t.style.display = 'block';
      }
    });
  });

  function bindButtons() {
    on($$('#vm-btn-signin'), 'click', signIn);
    on($$('#vm-btn-signout'), 'click', signOut);
    on($$('#vm-btn-fetch'), 'click', fetchVideosFlow);
    on($$('#vm-btn-bulk-retitle'), 'click', bulkRetitleFlow);

    on($$('#vm-btn-presets-save'), 'click', () => {
      const raw = ($$('#vm-preset-input')?.value || '').split('\n');
      const saved = window.TitlePresets.savePresets(raw);
      window.TitlePresets.renderPresetUI();
      toast(`프리셋 ${saved.length}개 저장됨`, 'success');
    });
    on($$('#vm-btn-presets-clear'), 'click', () => {
      window.TitlePresets.clearPresets();
      window.TitlePresets.renderPresetUI();
      if ($$('#vm-preset-input')) $$('#vm-preset-input').value = '';
      toast('프리셋을 모두 삭제했습니다.', 'warning');
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Google API / GIS
  // ─────────────────────────────────────────────────────────────
  function prepareGapi() {
    if (gapiInited) return;
    // api.js가 이미 로드되어 있음
    try {
      gapi.load('client', async () => {
        try {
          await gapi.client.init({ discoveryDocs: [YT_DISCOVERY] });
          gapiInited = true;
          console.log('[gapi] client init ok');
        } catch (e) {
          console.error('[gapi] init error', e);
        }
      });
    } catch (e) {
      console.warn('gapi not available yet. will retry when signIn pressed.');
    }
  }

  function prepareGis() {
    if (window.google?.accounts?.oauth2) {
      gisReady = true;
      return;
    }
    // 스크립트는 index.html에 async로 추가됨. 로그인 버튼 누를 때까지 대기
  }

  function getClientId() {
    const cid = ($$('#vm-client-id')?.value || '').trim();
    if (cid) localStorage.setItem(CID_KEY, cid);
    return cid || localStorage.getItem(CID_KEY) || '';
  }

  async function ensureReady() {
    // gapi 준비 대기
    for (let i = 0; i < 20 && !gapiInited; i++) {
      await delay(150);
    }
    if (!gapiInited) throw new Error('Google API 초기화가 완료되지 않았습니다.');
    // gis 준비 대기
    for (let i = 0; i < 20 && !gisReady; i++) {
      if (window.google?.accounts?.oauth2) gisReady = true;
      else await delay(150);
    }
    if (!gisReady) throw new Error('Google Identity가 준비되지 않았습니다.');
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function signIn() {
    try {
      await ensureReady();
      const CLIENT_ID = getClientId();
      if (!CLIENT_ID) {
        toast('OAuth 클라이언트 ID를 입력해 주세요.', 'warning');
        return;
      }
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: YT_SCOPE,
          callback: (resp) => {
            if (resp?.error) {
              console.error(resp);
              setText('#vm-status', '로그인 실패');
              toast('로그인 실패', 'error');
              return;
            }
            gapi.client.setToken(resp);
            setText('#vm-status', '로그인 완료');
            toast('로그인 완료', 'success');
          },
        });
      }
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      console.error(e);
      toast('로그인 중 오류가 발생했습니다.', 'error');
    }
  }

  function signOut() {
    try {
      gapi.client.setToken('');
    } catch {}
    setText('#vm-status', '로그아웃됨');
    toast('로그아웃되었습니다.', 'info');
  }

  // ─────────────────────────────────────────────────────────────
  // YouTube Data API
  // ─────────────────────────────────────────────────────────────
  async function fetchMyVideosByDate(publishedAfterISO, publishedBeforeISO, pageToken = null) {
    // 1) 내 영상 ID를 기간으로 검색
    const searchResp = await gapi.client.youtube.search.list({
      part: 'id',
      forMine: true,
      type: 'video',
      maxResults: 50,
      order: 'date',
      publishedAfter: publishedAfterISO,
      publishedBefore: publishedBeforeISO,
      pageToken: pageToken || undefined,
    });

    const ids = (searchResp.result.items || [])
      .map((it) => it.id && it.id.videoId)
      .filter(Boolean);

    if (ids.length === 0) {
      return { videos: [], nextPageToken: searchResp.result.nextPageToken || null };
    }

    // 2) 상세 정보
    const detailResp = await gapi.client.youtube.videos.list({
      part: 'snippet,statistics',
      id: ids.join(','),
      maxResults: 50,
    });

    const videos = (detailResp.result.items || []).map((v) => ({
      id: v.id,
      snippet: v.snippet,
      statistics: v.statistics || {},
      thumb:
        v.snippet?.thumbnails?.medium?.url ||
        v.snippet?.thumbnails?.default?.url ||
        '',
    }));

    return { videos, nextPageToken: searchResp.result.nextPageToken || null };
  }

  function renderVideos(videos, lowViewThreshold) {
    const tbody = $$('#vm-video-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    videos.forEach((v) => {
      const tr = document.createElement('tr');

      // 선택
      const tdSel = document.createElement('td');
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.dataset.vid = v.id;
      tdSel.appendChild(chk);

      // 영상
      const tdVideo = document.createElement('td');
      tdVideo.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <img class="thumbnail" src="${v.thumb}" alt="" style="width:120px;height:68px;object-fit:cover;border-radius:10px;border:1px solid var(--border);">
          <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">열기</a>
        </div>
      `;

      // 제목/설명/태그
      const tdTitle = document.createElement('td');
      tdTitle.innerHTML = `
        <div><strong>${escapeHtml(v.snippet?.title || '')}</strong></div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(v.snippet?.description || '').slice(0, 120)}</div>
        <div class="muted" style="margin-top:6px;">태그: ${
          Array.isArray(v.snippet?.tags) && v.snippet.tags.length
            ? v.snippet.tags.slice(0, 5).map(escapeHtml).join(', ')
            : '-'
        }</div>
      `;

      // 조회수
      const views = Number(v.statistics?.viewCount || 0);
      const tdViews = document.createElement('td');
      tdViews.textContent = views.toLocaleString('ko-KR');

      // 발행
      const tdPub = document.createElement('td');
      const pub = v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null;
      tdPub.innerHTML = pub
        ? `${pub.toLocaleDateString()}<div class="muted">${pub.toLocaleTimeString()}</div>`
        : '-';

      // 작업
      const tdActions = document.createElement('td');
      const btnQuick = document.createElement('button');
      btnQuick.className = 'btn ' + (views <= lowViewThreshold ? 'btn-danger' : 'btn-secondary');
      btnQuick.textContent = '빠른 제목바꾸기 (다음 프리셋)';
      btnQuick.addEventListener('click', async () => {
        await quickRetitle(v);
      });
      tdActions.appendChild(btnQuick);

      tr.appendChild(tdSel);
      tr.appendChild(tdVideo);
      tr.appendChild(tdTitle);
      tr.appendChild(tdViews);
      tr.appendChild(tdPub);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  async function quickRetitle(v) {
    const presets = window.TitlePresets.loadPresets();
    const next = window.TitlePresets.nextPreset(presets);
    if (!next) {
      toast('프리셋이 없습니다. 먼저 프리셋을 저장해 주세요.', 'warning');
      return;
    }

    const snip = v.snippet || {};
    const payload = {
      id: v.id,
      snippet: {
        categoryId: snip.categoryId || '22', // People & Blogs 기본값
        title: next,
        description: snip.description || '',
        defaultLanguage: snip.defaultLanguage,
        defaultAudioLanguage: snip.defaultAudioLanguage,
        tags: snip.tags || [],
      },
    };

    try {
      const res = await gapi.client.youtube.videos.update({
        part: 'snippet',
        resource: payload,
      });
      if (res?.result) {
        toast(`제목 변경 완료: "${next}"`, 'success');
        v.snippet.title = next;
        renderVideos(videosCache, Number($$('#vm-low-views')?.value || 0));
      }
    } catch (e) {
      console.error(e);
      toast('제목 변경 중 오류가 발생했습니다.', 'error');
    }
  }

  async function bulkRetitleFlow() {
    const tbody = $$('#vm-video-tbody');
    if (!tbody) return;

    const checks = Array.from(tbody.querySelectorAll('input[type="checkbox"]:checked'));
    if (!checks.length) {
      toast('일괄 변경할 영상을 선택해 주세요.', 'warning');
      return;
    }

    const presets = window.TitlePresets.loadPresets();
    if (!presets.length) {
      toast('프리셋이 없습니다. 먼저 프리셋을 저장해 주세요.', 'warning');
      return;
    }

    setText('#vm-status', `변경 중... (총 ${checks.length}개)`);
    for (const c of checks) {
      const vid = c.dataset.vid;
      const v = videosCache.find((x) => x.id === vid);
      if (!v) continue;

      const title = window.TitlePresets.nextPreset(presets);
      if (!title) break;

      const snip = v.snippet || {};
      const payload = {
        id: v.id,
        snippet: {
          categoryId: snip.categoryId || '22',
          title: title,
          description: snip.description || '',
          defaultLanguage: snip.defaultLanguage,
          defaultAudioLanguage: snip.defaultAudioLanguage,
          tags: snip.tags || [],
        },
      };

      try {
        await gapi.client.youtube.videos.update({ part: 'snippet', resource: payload });
        v.snippet.title = title;
      } catch (e) {
        console.error(e);
      }
    }
    setText('#vm-status', '완료');
    renderVideos(videosCache, Number($$('#vm-low-views')?.value || 0));
  }

  async function fetchVideosFlow() {
    try {
      setText('#vm-status', '불러오는 중...');
      const start = $$('#vm-date-start')?.value;
      const end = $$('#vm-date-end')?.value;
      const low = Number($$('#vm-low-views')?.value || 0);

      if (!start || !end) {
        toast('시작일과 종료일을 선택해 주세요.', 'warning');
        return;
      }

      // 날짜를 ISO로 변환 (하루의 시작/끝)
      const startISO = new Date(`${start}T00:00:00Z`).toISOString();
      const endISO = new Date(`${end}T23:59:59Z`).toISOString();

      let all = [];
      let token = null;
      do {
        const { videos, nextPageToken } = await fetchMyVideosByDate(startISO, endISO, token);
        all = all.concat(videos);
        token = nextPageToken;
      } while (token && all.length < 200); // 과도 호출 방지 상한

      videosCache = all;
      renderVideos(all, low);
      setText('#vm-status', `가져온 영상: ${all.length}개`);
      toast(`가져온 영상: ${all.length}개`, 'success');
    } catch (e) {
      console.error(e);
      setText('#vm-status', '오류가 발생했습니다.');
      toast('불러오는 중 오류가 발생했습니다. 콘솔을 확인해 주세요.', 'error');
    }
  }

  // 전역 노출(필요 시 콘솔 호출용)
  window.YTVideoManager = {
    fetchVideosFlow,
    bulkRetitleFlow,
    quickRetitle,
  };
})();
