/* eslint-disable no-console */
/**
 * main.js
 * 앱 오케스트레이션 및 초기화 (채널 관리 버튼 이벤트 바인딩 개선)
 * - 본 파일에서는 텍스트 문구 중 '썸네일' 표기를 사용합니다. (기존 '인네일' 오타 수정)
 */

(function () {
  'use strict';

  // ========= 공용 유틸 =========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts || false);

  // 전역 토스트(없으면 alert 폴백)
  function toast(msg, type = 'info') {
    try {
      const contId = 'toast-container';
      let cont = document.getElementById(contId);
      if (!cont) {
        cont = document.createElement('div');
        cont.id = contId;
        document.body.appendChild(cont);
      }
      const el = document.createElement('div');
      el.className = 'toast-message';
      el.textContent = msg;
      if (type === 'success') el.style.borderLeftColor = '#1db954';
      else if (type === 'error') el.style.borderLeftColor = '#c4302b';
      else if (type === 'warning') el.style.borderLeftColor = '#ffa502';
      cont.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = 'translateX(0)';
      });
      setTimeout(() => {
        el.style.transform = 'translateX(-100%)';
        setTimeout(() => el.remove(), 300);
      }, 3000);
    } catch {
      alert(msg);
    }
  }
  window.toast = window.toast || toast;

  // ========= 테마 =========
  function loadTheme() {
    try {
      const saved = localStorage.getItem('theme');
      const body = document.body;
      if (saved === 'light') {
        body.classList.add('light');
        body.classList.remove('dark');
      } else {
        body.classList.add('dark');
        body.classList.remove('light');
      }
    } catch (e) {
      console.warn('loadTheme error:', e);
    }
  }
  function toggleTheme() {
    try {
      const body = document.body;
      if (body.classList.contains('light')) {
        body.classList.remove('light');
        body.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        body.classList.remove('dark');
        body.classList.add('light');
        localStorage.setItem('theme', 'light');
      }
    } catch (e) {
      console.warn('toggleTheme error:', e);
    }
  }
  window.loadTheme = window.loadTheme || loadTheme;
  window.toggleTheme = window.toggleTheme || toggleTheme;

  function refreshThemeToggleLabel() {
    const btn = $('#btn-toggle-theme');
    if (!btn) return;
    const isLight = document.body.classList.contains('light');
    btn.textContent = isLight ? '다크 모드' : '라이트 모드';
  }

  function bindThemeToggle() {
    const btn = $('#btn-toggle-theme');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    on(btn, 'click', () => {
      try {
        window.toggleTheme();
      } catch (e) {
        console.warn('테마 토글 중 오류', e);
        document.body.classList.toggle('light');
        document.body.classList.toggle('dark');
      }
      refreshThemeToggleLabel();
    });
    refreshThemeToggleLabel();
  }

  // ========= 모달 =========
function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.style.display = 'flex';
  m.classList.add('show'); // 이 줄 추가
}
function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.style.display = 'none';
  m.classList.remove('show'); // 이 줄 추가
}
  window.openModal = window.openModal || openModal;
  window.closeModal = window.closeModal || closeModal;

  function bindModalCloseButtons() {
    $$('.close[data-close]').forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      on(btn, 'click', () => {
        const id = btn.getAttribute('data-close');
        if (id) window.closeModal(id);
      });
    });
    $$('.modal').forEach((m) => {
      if (m.dataset.bound === '1') return;
      m.dataset.bound = '1';
      on(m, 'click', (e) => {
        if (e.target === m) {
          window.closeModal(m.id);
        }
      });
    });
  }

  // ========= API 키 모달 =========
  function setApiKeys(keys) {
  try {
    const arr = (keys || []).filter(Boolean);
    window.apiKeys = arr;
    // 표준 키 + 레거시 키 모두에 저장 (호환성 유지)
    localStorage.setItem('youtube_api_keys', JSON.stringify(arr));
    localStorage.setItem('youtubeApiKeys', JSON.stringify(arr));
  } catch (e) {
    console.warn('API 키 저장 실패', e);
  }
}

  function getApiKeys() {
  try {
    // 표준 키 → 없으면 레거시 키 → 표준 키로 동기화
    let v = JSON.parse(localStorage.getItem('youtube_api_keys') || '[]');
    if (!Array.isArray(v) || v.length === 0) {
      const legacy = JSON.parse(localStorage.getItem('youtubeApiKeys') || '[]');
      if (Array.isArray(legacy) && legacy.length) {
        v = legacy;
        localStorage.setItem('youtube_api_keys', JSON.stringify(v)); // 표준화
      }
    }
    window.apiKeys = v;
    return v;
  } catch {
    return [];
  }
}

  window.setApiKeys = window.setApiKeys || setApiKeys;
  window.getApiKeys = window.getApiKeys || getApiKeys;

  function renderApiInputs() {
    const wrap = $('#api-inputs');
    if (!wrap) return;
    const keys = window.getApiKeys();
    const list = (keys.length ? keys : ['']).slice(0, 5);
    wrap.innerHTML = list
      .map(
        (val, i) => `
        <div class="input-group">
          <input type="text" class="api-inp" placeholder="YouTube API Key #${i + 1}" value="${(val || '').replace(/"/g, '&quot;')}"/>
        </div>
      `
      )
      .join('');
  }

  function openApiModal() {
    renderApiInputs();
    window.openModal('modal-api');
  }
  window.openApiModal = window.openApiModal || openApiModal;

  function bindApiModalButtons() {
    const openBtn = $('#btn-api');
    if (openBtn && openBtn.dataset.bound !== '1') {
      openBtn.dataset.bound = '1';
      on(openBtn, 'click', () => window.openApiModal());
    }

	const saveBtn = $('#api-save');
	if (saveBtn && saveBtn.dataset.bound !== '1') {
	  saveBtn.dataset.bound = '1';
	  on(saveBtn, 'click', () => {
		// 입력칸에서 키 수집 + 저장
		const keys = $$('.api-inp').map(inp => (inp.value || '').trim()).filter(Boolean);
		window.setApiKeys(keys);
		// 안내
		const cnt = (keys || []).length;
		toast(cnt ? `API 키 ${cnt}개 저장되었습니다.` : 'API 키를 모두 비웠습니다.', 'success');
		// ✅ 저장 후 모달 닫기
		if (typeof window.closeModal === 'function') window.closeModal('modal-api');
	  });
	}


	const testBtn = $('#api-test');
	if (testBtn && testBtn.dataset.bound !== '1') {
	  testBtn.dataset.bound = '1';
	  on(testBtn, 'click', async () => {
		const resultEl = $('#api-test-result');
		try {
		  if (resultEl) resultEl.textContent = '테스트 중...';

		  // 1) 입력칸의 값을 우선 사용(저장 안 해도 테스트 가능)
		  let keys = $$('.api-inp').map(inp => (inp.value || '').trim()).filter(Boolean);
		  // 2) 없다면 저장된 키 사용
		  if (!keys.length) keys = window.getApiKeys();

		  if (!keys.length) {
			if (resultEl) resultEl.textContent = '입력/저장된 API 키가 없습니다.';
			toast('먼저 키를 입력하거나 저장해 주세요.', 'warning');
			return;
		  }

		  const key = keys[0];
		  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=test&key=${encodeURIComponent(key)}`;
		  const res = await fetch(url);
		  if (!res.ok) throw new Error(`HTTP ${res.status}`);

		  if (resultEl) resultEl.textContent = '성공! 키가 유효합니다.';
		  toast('API 키 유효성 테스트 성공', 'success');
		} catch (e) {
		  console.error(e);
		  if (resultEl) resultEl.textContent = '실패: 키가 올바르지 않거나 네트워크 오류가 있습니다.';
		  toast('API 테스트 실패', 'error');
		}
	  });
	}



    const exportBtn = $('#api-export');
    if (exportBtn && exportBtn.dataset.bound !== '1') {
      exportBtn.dataset.bound = '1';
      on(exportBtn, 'click', () => {
        try {
          const keys = window.getApiKeys();
          const blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'youtube-api-keys.json';
          a.click();
          URL.revokeObjectURL(url);
          toast('API 키를 내보냈습니다.', 'success');
        } catch (e) {
          console.error(e);
          toast('API 키 내보내기 실패', 'error');
        }
      });
    }

    const importBtn = $('#api-import-btn');
    const importFile = $('#api-import-file');
    if (importBtn && importFile && importBtn.dataset.bound !== '1') {
      importBtn.dataset.bound = '1';
      on(importBtn, 'click', () => importFile.click());
      on(importFile, 'change', async () => {
        try {
          const file = importFile.files && importFile.files[0];
          if (!file) return;
          const text = await file.text();
          let keys = JSON.parse(text);
          if (!Array.isArray(keys)) keys = [String(keys || '').trim()];
          keys = keys.filter(Boolean);
          window.setApiKeys(keys);
          toast('API 키를 가져왔습니다.', 'success');
          window.openApiModal();
        } catch (e) {
          console.error(e);
          toast('API 키 가져오기 실패', 'error');
        } finally {
          importFile.value = '';
        }
      });
    }
  }

  // ========= 네비게이션/섹션 초기화 =========
  function initializeNavigation() {
    try {
      if (typeof window.initNavigation === 'function') {
        window.initNavigation();
        return;
      }
      // 간단 폴백: 버튼 클릭 시 섹션 토글
      const sections = $$('.section[data-section]');
      const navButtons = $$('.nav-section');
      function showSection(name) {
        sections.forEach((s) => {
          const match = s.getAttribute('data-section') === name;
          s.style.display = match ? '' : 'none';
        });
        navButtons.forEach((b) => {
          b.classList.toggle('active', b.id === `btn-${name}`);
        });
      }
      navButtons.forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        const data = btn.classList.contains('nav-section') ? btn.id.replace('btn-', '') : '';
        on(btn, 'click', () => data && showSection(data));
      });
    } catch (e) {
      console.warn('initializeNavigation fallback error:', e);
    }
  }
  window.initializeNavigation = window.initializeNavigation || initializeNavigation;

  function initializeTextSplitter() {
    try {
      if (typeof window.initTextSplitter === 'function') {
        window.initTextSplitter();
        return;
      }
      // 간단 폴백: 글자수 카운트 + 버튼 연결
      const src = $('#source-text');
      const withSpaces = $('#count-with-spaces');
      const withoutSpaces = $('#count-without-spaces');
      const btnProcess = $('#btn-process-text');
      const btnClear = $('#btn-clear-text');
      const chunksWrap = $('#text-chunks');
      const emptyState = $('#empty-chunks-state');

      if (src) {
        on(src, 'input', () => {
          const t = src.value || '';
          if (withSpaces) withSpaces.textContent = String(t.length);
          if (withoutSpaces) withoutSpaces.textContent = String(t.replace(/\s+/g, '').length);
        });
      }

      if (btnClear) {
        on(btnClear, 'click', () => {
          if (src) src.value = '';
          if (withSpaces) withSpaces.textContent = '0';
          if (withoutSpaces) withoutSpaces.textContent = '0';
          if (chunksWrap && emptyState) {
            chunksWrap.innerHTML = '';
            chunksWrap.appendChild(emptyState);
            emptyState.style.display = '';
          }
        });
      }

      if (btnProcess) {
        on(btnProcess, 'click', () => {
          if (!src || !chunksWrap) return;
          const raw = (src.value || '')
            .replace(/^\s*[-*]{3,}\s*$/gm, '')
            .replace(/^\s*\*\s*/gm, '')
            .replace(/^(##?)(\s*)/gm, '씰씰$2');

          // 씰씰 ~ 다음 씰씰 사이를 덩어리로 묶어 10,000자 기준으로 분할
          const parts = raw.split(/^씰씰.*$/gm);
          const cleaned = parts.map((s) => s.trim()).filter(Boolean);

          const MAX = 10000;
          const result = [];
          let current = '';
          for (const seg of cleaned) {
            if ((current + '\n\n' + seg).length > MAX) {
              if (current) result.push(current.trim());
              current = seg;
            } else {
              current = current ? current + '\n\n' + seg : seg;
            }
          }
          if (current) result.push(current.trim());

          chunksWrap.innerHTML = '';
          if (!result.length && emptyState) {
            chunksWrap.appendChild(emptyState);
            emptyState.style.display = '';
          } else {
            result.forEach((txt, i) => {
              const card = document.createElement('div');
              card.className = 'text-chunk';
              card.innerHTML = `
                <div style="padding:12px 12px 0;font-weight:700">분할 ${i + 1}</div>
                <pre style="white-space:pre-wrap;padding:12px;margin:0">${txt.replace(/</g, '&lt;')}</pre>
              `;
              chunksWrap.appendChild(card);
            });
          }
          toast(`분할 완료: ${result.length}개`, 'success');
        });
      }
    } catch (e) {
      console.warn('initializeTextSplitter fallback error:', e);
    }
  }
  window.initializeTextSplitter = window.initializeTextSplitter || initializeTextSplitter;

// ⚠️ 재귀 방지: 폴백 함수 이름을 분리합니다.
function initializeMyChannelsFallback() {
  try {
    // 폴백: 안내만 표시
    const content = $('#my-channels-content');
    if (content) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <p class="muted">Google 로그인 후 내 채널/구독을 불러오세요.</p>
        </div>
      `;
    }
  } catch (e) {
    console.warn('initializeMyChannels fallback error:', e);
  }
}

// 이미 my-channels.js가 전역 함수(window.initializeMyChannels)를 정의했다면 그대로 사용하고,
// 없을 때만 폴백을 주입합니다. (재귀 없음)
if (typeof window.initializeMyChannels !== 'function') {
  window.initializeMyChannels = initializeMyChannelsFallback;
}


  // ========= OAuth 매니저(토큰 팝업) =========
  async function initOAuthManager() {
    try {
      if (typeof window.setupOAuth === 'function') {
        await window.setupOAuth();
      }
    } catch (e) {
      console.warn('OAuth 초기화 경고:', e);
    }
  }
  window.initOAuthManager = window.initOAuthManager || initOAuthManager;

  // ========= 비디오/채널 관련 헬퍼 =========
  // (여기서는 안내 문구에서 '썸네일' 표기만 사용합니다.)
  function copyImageToClipboard(url) {
    // 구현은 videos.js에서 담당. 여기서는 존재 확인/안내만.
    try {
      if (typeof window.copyImageToClipboard === 'function') {
        return window.copyImageToClipboard(url);
      } else {
        toast('이미지 복사 기능이 준비되지 않았습니다.', 'warning');
      }
    } catch (e) {
      console.warn('이미지 복사 실패', e);
      toast('이미지 복사 실패', 'error');
    }
  }
  window.copyImageToClipboard = window.copyImageToClipboard || copyImageToClipboard;

  // ========= 진단 =========
  function diagnoseApp() {
    const info = {
      moment: typeof window.moment,
      Chart: typeof window.Chart,
      Sortable: typeof window.Sortable,
      yt: typeof window.yt,
      getAllChannels: typeof window.getAllChannels,
      refreshVideos: typeof window.refreshVideos,
      extractChannelId: typeof window.extractChannelId,
      openAnalyzeModal: typeof window.openAnalyzeModal,
      initializeMyChannels: typeof window.initializeMyChannels,
    };
    console.log('진단 리포트:', info);
    return info;
  }
  window.diagnoseApp = window.diagnoseApp || diagnoseApp;

  // ========= 바인딩 =========
  function bindCommonButtons() {
    const analyzeBtn = $('#btn-analyze');
    if (analyzeBtn && analyzeBtn.dataset.bound !== '1') {
      analyzeBtn.dataset.bound = '1';
      on(analyzeBtn, 'click', () => {
        if (typeof window.openAnalyzeModal === 'function') {
          window.openAnalyzeModal();
        } else {
          toast('분석 모달이 준비되지 않았습니다.', 'warning');
        }
      });
    }

    const txtSplitBtn = $('#btn-text-splitter');
    if (txtSplitBtn && txtSplitBtn.dataset.bound !== '1') {
      txtSplitBtn.dataset.bound = '1';
      on(txtSplitBtn, 'click', () => {
        // 네비게이션을 통해 텍스트 분할 섹션으로 이동
        const navBtn = $('#btn-text-splitter');
        if (navBtn && navBtn.classList.contains('nav-section')) {
          navBtn.click();
        } else {
          // 폴백: 직접 섹션 보여주기
          const sections = $$('.section[data-section]');
          sections.forEach((s) => {
            s.style.display = s.getAttribute('data-section') === 'text-splitter' ? '' : 'none';
          });
        }
      });
    }

    // ⚠️ 채널 관리 관련 버튼들은 channels.js에서 직접 처리하므로 여기서는 제거
    // channels.js의 initializeChannelsEvents()가 담당
  }

  // ========= 초기화 =========
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      console.log('main.js 초기화 시작');
      
      // 테마 초기화
      window.loadTheme();
      bindThemeToggle();

      // 모달/버튼
      bindModalCloseButtons();
      bindApiModalButtons();
      bindCommonButtons();

      // OAuth → 각 섹션 초기화
      await window.initOAuthManager();
      window.initializeNavigation();
      window.initializeMyChannels();
      window.initializeTextSplitter();

      console.log('main.js 초기화 완료');
    } catch (e) {
      console.error('main.js 초기화 중 오류:', e);
      toast('초기화 중 오류가 발생했습니다.', 'error');
    }
  });

  // 디버그: 썸네일 관련 문구(오타 수정 반영)
  console.log('참고: 화면 안내에서 "썸네일" 표기를 사용합니다.');

})();