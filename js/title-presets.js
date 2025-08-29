/* ===== title-presets.js (전역 버전) ===== */
(function () {
  'use strict';

  const PRESET_STORAGE_KEY = 'yt_title_presets_v1';
  const CURSOR_KEY = 'yt_title_presets_cursor_v1';

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function savePresets(presets) {
    const clean = (presets || [])
      .map((s) => (s || '').trim())
      .filter(Boolean);
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function clearPresets() {
    localStorage.setItem(PRESET_STORAGE_KEY, '[]');
    localStorage.setItem(CURSOR_KEY, '0');
  }

  function nextPreset(presets) {
    const list = Array.isArray(presets) && presets.length ? presets : loadPresets();
    if (!list.length) return null;
    let idx = Number(localStorage.getItem(CURSOR_KEY) || 0);
    const title = list[idx % list.length];
    localStorage.setItem(CURSOR_KEY, String((idx + 1) % list.length));
    return title;
  }

  // UI 헬퍼 (영상관리 섹션 전용)
  function renderPresetUI(root) {
    const presets = loadPresets();
    const cnt = (root || document).querySelector('#vm-preset-count');
    const input = (root || document).querySelector('#vm-preset-input');
    const box = (root || document).querySelector('#vm-preset-preview');

    if (cnt) cnt.textContent = String(presets.length);
    if (box) {
      box.innerHTML = '';
      presets.forEach((t, i) => {
        const div = document.createElement('div');
        div.className = 'pill';
        div.style.cssText =
          'border-radius:999px;border:1px dashed var(--border);padding:6px 10px;font-size:12px;color:var(--text);';
        div.textContent = `${i + 1}. ${t}`;
        box.appendChild(div);
      });
    }
    if (input && !input.value.trim() && presets.length) {
      input.value = presets.join('\n');
    }
  }

  // 전역 노출
  window.TitlePresets = {
    loadPresets,
    savePresets,
    clearPresets,
    nextPreset,
    renderPresetUI,
  };
})();
