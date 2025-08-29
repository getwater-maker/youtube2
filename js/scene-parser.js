/**
 * scene-parser.js — 2섹션(좌=대화, 우=이미지프롬프트) 레이아웃 + JSON 저장
 *
 * 섹션 구성
 *  - 좌측 "대본 입력창": 대본 입력창 + 카드(무제한)
 *  - 우측 "이미지 프롬프트 섹션": 프롬프트 입력창 + 표
 *
 * 파싱 규칙(공통)
 *  - 줄 시작이 '#' 인 줄 삭제
 *  - 하이픈만 있는 구분선(---, ---- …) 삭제
 *  - 위 삭제로 생긴 빈 줄은 1줄만 유지
 *  - 카드 분할은 문장 경계 기준으로 무제한
 *  - 작은따옴표(')는 인용부호로 취급하지 않음 (woman's 보호)
 *
 * 저장(JSON)
 * {
 *   version: 1,
 *   exported_at: "YYYY-MM-DD",
 *   count: N,
 *   items: [{ id:"001", prompt:"...", suggested_filenames:["001.jpg","001.png"] }, ...]
 * }
 */

(function () {
  'use strict';

  /* ===== 설정 ===== */
  const READ_SPEED_CPM = 360;
  const CARD_LIMIT     = 10000;
  const INPUT_H        = 360;  // 두 입력창 동일 높이
  const CARD_H         = 220;
  let SP_REMOVE_WORDS = []; 


  /* ===== 유틸 ===== */
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const pad2 = n => String(n).padStart(2,'0');
  const pad3 = n => String(n).padStart(3,'0');

  const fmtDuration = (chars) => {
    const s = Math.floor((chars / READ_SPEED_CPM) * 60);
    return `[ ${pad2(Math.floor(s/3600))}시 ${pad2(Math.floor((s%3600)/60))}분 ${pad2(s%60)}초 ]`;
  };
  const today = () => {
    const d = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  const downloadFile = (filename, data, mime='application/json;charset=utf-8') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  };
  const showToast = (msg, type) => {
    try { if (typeof window.toast === 'function') return window.toast(msg, type||'info'); } catch(_) {}
    console.log('[Toast]', type||'info', msg);
  };
  
  // 공용 헬퍼: 액션바(.section-actions) 안전 획득
function getActionsEl() {
  const sec = document.getElementById('section-scene-parser');
  return sec ? sec.querySelector('.section-header .section-actions') : null;
}

// 파일명 생성 유틸
function getUploadMonthDay() {
  const el = document.getElementById('scene-date');
  let d;
  try {
    d = (el && el.value) ? new Date(el.value) : new Date();
    if (Number.isNaN(d.getTime())) d = new Date();
  } catch { d = new Date(); }
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${mm}-${dd}`;
}
function getNowHMS() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mi}:${ss}`;
}
function getFirstSentenceForFilename(sceneText) {
  // 첫 줄의 비어있지 않은 문장
  let first = (String(sceneText||'').split(/\r?\n/).find(l => l.trim().length>0) || 'untitled').trim();
  // 파일명 불가 문자 제거 및 공백 정리
  first = first.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (first.length > 10) first = first.slice(0, 10) + '...';
  return first || 'untitled';
}



  
// ===== IndexedDB (최근 31일 대본/프롬프트 저장) =====
const SP_DB_NAME = 'sceneParserDB';
const SP_DB_STORE = 'drafts';
const SP_DB_VER = 1;
const SP_RETENTION_DAYS = 31;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SP_DB_NAME, SP_DB_VER);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SP_DB_STORE)) {
        const store = db.createObjectStore(SP_DB_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraftToDB(sceneText, promptText) {
  const db = await openDB();
  const tx = db.transaction(SP_DB_STORE, 'readwrite');
  const store = tx.objectStore(SP_DB_STORE);
  const now = Date.now();
  const rec = {
    ts: now,
    date: new Date(now).toISOString().slice(0,19).replace('T',' '), // YYYY-MM-DD HH:MM:SS
    sceneText: String(sceneText||''),
    promptText: String(promptText||''),
    version: 1
  };
  store.add(rec);
await new Promise((res, rej) => {
  tx.oncomplete = res;
  tx.onerror = () => rej(tx.error);
});
db.close();

  await purgeOldDrafts();
  return rec;
}

async function purgeOldDrafts() {
  const db = await openDB();
  const tx = db.transaction(SP_DB_STORE, 'readwrite');
  const store = tx.objectStore(SP_DB_STORE);
  const idx = store.index('ts');
  const cutoff = Date.now() - SP_RETENTION_DAYS * 86400000;
  const range = IDBKeyRange.upperBound(cutoff);
  const toDelete = [];
  idx.openCursor(range).onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) { toDelete.push(cursor.primaryKey); cursor.continue(); }
  };
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  if (toDelete.length) {
    const tx2 = (await openDB()).transaction(SP_DB_STORE, 'readwrite');
    const st2 = tx2.objectStore(SP_DB_STORE);
    toDelete.forEach(k => st2.delete(k));
    await new Promise((res) => { tx2.oncomplete = res; tx2.onerror = res; });
  }
  db.close?.();
}

async function getRecentDrafts(limit=31) {
  const db = await openDB();
  const tx = db.transaction(SP_DB_STORE, 'readonly');
  const store = tx.objectStore(SP_DB_STORE);
  const idx = store.index('ts');
  const items = [];
  idx.openCursor(null, 'prev').onsuccess = (e) => {
    const cur = e.target.result;
    if (cur && items.length < limit) { items.push(cur.value); cur.continue(); }
  };
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  db.close?.();
  return items;
}

async function getDraftById(id) {
  const db = await openDB();
  const tx = db.transaction(SP_DB_STORE, 'readonly');
  const store = tx.objectStore(SP_DB_STORE);
  const val = await new Promise((res) => {
    const r = store.get(Number(id));
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  db.close?.();
  return val;
}
  
  // ▼▼▼ 여기 추가 (getDraftById 아래) ▼▼▼
async function deleteDraftById(id) {
  if (!id) return false;
  const db = await openDB();
  const tx = db.transaction(SP_DB_STORE, 'readwrite');
  const st = tx.objectStore(SP_DB_STORE);
  st.delete(Number(id));
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  db.close?.();
  return true;
}
// ▲▲▲ 여기까지 추가 ▲▲▲

  
  function buildRemoveRegex() {
  if (!Array.isArray(SP_REMOVE_WORDS) || !SP_REMOVE_WORDS.length) return null;
  const parts = SP_REMOVE_WORDS
    .map(w => String(w||'').trim())
    .filter(Boolean)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // 정규식 이스케이프
  if (!parts.length) return null;
  return new RegExp(parts.join('|'), 'gi'); // 대소문자 무시, 전체 치환
}


  /* ===== 복사 버튼 ===== */
function ensureCopyStyles() {
  if (document.getElementById('sp-copy-style')) return;
  const st = document.createElement('style');
  st.id = 'sp-copy-style';
  st.textContent = `
    .sp-btn-copy { padding:6px 12px; border-radius:8px; font-weight:700; cursor:pointer; border:1px solid transparent; }
    .sp-btn-red   { background:#c4302b; border-color:#c4302b; color:#fff; }
    .sp-btn-green { background:#16a34a; border-color:#16a34a; color:#fff; }
  
  /* 요약 프리뷰 칩 (한 줄 줄임표) */
      .sp-preview-chip{
        display:inline-block; max-width:380px; margin-right:8px; padding:6px 10px;
        border-radius:8px; border:1px dashed var(--border); color:var(--text);
        font-size:12px; vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        background:var(--glass-bg);
      }
      @media (max-width: 768px){ .sp-preview-chip{ max-width:240px; } }

  `;
  document.head.appendChild(st);
}

function wireCopyToggle(btn, getText) {
  // 스타일(버튼/칩) 보장
  ensureCopyStyles();
  btn.classList.add('sp-btn-copy', 'sp-btn-red');

  // 1) 전체 텍스트 확보
  let fullText = '';
  try {
    fullText = typeof getText === 'function' ? (getText() || '') : '';
  } catch { fullText = ''; }

  // 2) 버튼이 들어있는 셀(또는 부모) 기준으로
  //    이미 화면에 길게 렌더된 프롬프트를 "요약"으로 바꾸고, 전체는 숨김/보관
  const cell = btn.closest('td, .cell, .sp-cell') || btn.parentNode;
  if (cell) {
    // (a) 길게 노출된 후보 요소 찾기
    const longTextEl =
      cell.querySelector('[data-sp-role="prompt-full"]') ||
      Array.from(cell.childNodes).find(n => {
        // 텍스트노드 또는 텍스트 덩어리 div/p 등
        if (n.nodeType === 3) return String(n.textContent || '').trim().length > 40;
        if (n.nodeType === 1) {
          const t = String(n.textContent || '').trim();
          // 버튼/칩/아이콘이 아닌 일반 텍스트 블록만
          const tag = n.tagName;
          const isTextBlock = /^(DIV|P|SPAN)$/.test(tag);
          const isControl   = n.classList?.contains('sp-btn-copy') || n === btn;
          return !isControl && isTextBlock && t.length > 40;
        }
        return false;
      });

    // (b) longTextEl이 있으면 그 내용을 전체 텍스트로 사용
    if (longTextEl) {
      const content = String(longTextEl.textContent || '').trim();
      if (content.length > 0) {
        fullText = content;
      }
      // 화면에서는 요약(줄임표)만 보이게 처리
      //  - 기존 요소는 숨기고(접근성 위해 title 부여)
      //  - 대신 칩 형태의 요약 프리뷰를 버튼 앞에 추가
      longTextEl.style.display = 'none';
      longTextEl.setAttribute('aria-hidden', 'true');
      longTextEl.title = content;

      const shortText = content.length > 60 ? (content.slice(0, 60) + ' ...') : content;
      const chip = document.createElement('span');
      chip.className = 'sp-preview-chip';
      chip.textContent = shortText;
      chip.title = content; // 마우스 오버 시 전체 미리보기
      if (!btn.previousElementSibling || !btn.previousElementSibling.classList?.contains('sp-preview-chip')) {
        cell.insertBefore(chip, btn);
      }
    } else {
      // longTextEl이 없으면 버튼 앞에 요약 칩만 생성
      const shortText = fullText.length > 60 ? (fullText.slice(0, 60) + ' ...') : fullText;
      if (shortText) {
        const chip = document.createElement('span');
        chip.className = 'sp-preview-chip';
        chip.textContent = shortText;
        chip.title = fullText;
        if (!btn.previousElementSibling || !btn.previousElementSibling.classList?.contains('sp-preview-chip')) {
          cell.insertBefore(chip, btn);
        }
      }
    }
  }

  // 3) 버튼 라벨/툴팁 고정 (화면엔 ‘복사’만 보이도록)
  btn.textContent = '복사';
  btn.title = '전체 프롬프트 복사';

  // 4) 클릭 시 전체 텍스트 복사
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(fullText || ''); } catch {}
    btn.classList.toggle('sp-btn-red');
    btn.classList.toggle('sp-btn-green');
  });
}




  /* ===== 정리/보조 ===== */
  function sanitizeLines(text) {
    const lines = String(text||'').replace(/\r\n/g,'\n').split('\n');
    const out = [];
    for (const ln of lines) {
      if (/^\s*#/.test(ln) || /^\s*-{3,}\s*$/.test(ln)) {
        if (out.length===0 || out[out.length-1] !== '') out.push('');
      } else out.push(ln);
    }
    return out.join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
  }
  function clipTextBeforeImagePrompt(fullText) {
    const t = String(fullText || '');
    const re = /^[ \t]*##[ \t]*🎨[ \t]*이미지[ \t]*프롬프트.*$/m;
    const m  = re.exec(t);
    if (m) return t.slice(0, m.index);
    return t;
  }
  function normalizeForSceneBlocks(text) {
    if (!text) return '';
    let t = String(text);

    // [장면 n: ...] → [장면 n]
    t = t.replace(/\[\s*장면\s*(\d{1,3})\s*:[^\]\n]*\]/gi, (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);
    // [장면 n: ...  (닫힘 누락)] → [장면 n]
    t = t.replace(/\[\s*장면\s*(\d{1,3})\s*:[^\n]*/gi,    (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);
    // [장면 n] → [장면 n]
    t = t.replace(/\[\s*장면\s*(\d{1,3})\s*\]/gi,         (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);

    // **장면 n** 또는 **장면 n:** → [장면 n]  (굵게 머리표기를 허용)
    t = t.replace(/\*\*\s*장면\s*(\d{1,3})\s*\*\*/gi,     (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);
    t = t.replace(/\*\*\s*장면\s*(\d{1,3})\s*:\s*\*\*/gi, (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);

    // ### [장면n] 패턴 추가 지원
    t = t.replace(/###\s*\[\s*장면\s*(\d{1,3})\s*\][^\n]*/gi, (_, n) => `[장면 ${pad3(parseInt(n,10))}]`);

    // "## 1장." 같은 챕터 라인은 제거(빈 줄 유지)
    const lines = t.replace(/\r\n/g,'\n').split('\n');
    const out = [];
    for (const ln of lines) {
      if (/^##\s*\d+\s*장\./i.test(ln)) {
        if (out.length===0 || out[out.length-1] !== '') out.push('');
      } else out.push(ln);
    }
    return out.join('\n').replace(/\n{3,}/g,'\n\n');
  }

  /* ===== 씬 블록 / 프롬프트 추출 ===== */
function parseSceneBlocks(text) {
  const t = normalizeForSceneBlocks(text||'');
  const lines = t.replace(/\r\n/g,'\n').split('\n');

  // 🔧 FIX: ']' 또는 ':' 둘 다 허용
  const headerRe = /\[\s*장면\s*(\d{1,3})\s*(?:\]|:)/i;

  let cur=null, started=false;
  const blocks=[];
  for (const ln of lines) {
    const m = ln.match(headerRe);
    if (m) {
      started = true;
      if (cur) blocks.push(cur);
      cur = { label:`장면 ${pad3(parseInt(m[1],10))}`, body:[] };
      const suffix = ln.slice(ln.indexOf(m[0])+m[0].length).trim();
      if (suffix) cur.body.push(suffix);
    } else if (started && cur) {
      // 제목 다음 빈 줄 1개까진 스킵, 이후 본문
      if (ln.trim().length > 0 || cur.body.length > 0) {
        cur.body.push(ln);
      }
    }
  }
  if (cur) blocks.push(cur);

  // ❌ REMOVE: 아래 fallback은 '전체' 같은 가짜 행을 만들 수 있어 삭제
  // if (!blocks.length && (t || '').trim()) {
  //   blocks.push({ label:'-', body: t.split('\n') });
  // }

  return blocks
    .map(b => ({ label:b.label, body:(Array.isArray(b.body)?b.body.join('\n'):b.body).trim() }))
    .filter(b => b.body.length > 0);
}


  // 작은따옴표(') 제외 — 인용부호: " ” `
  function getQuotedSegments(text, startIndex = 0) {
    const src = String(text || '');
    const segments = [];
    const patterns = [/\"([^"]+)\"/g, /“([^”]+)”/g, /`([^`]+)`/g];
    for (const re of patterns) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(src)) !== null) {
        const content = m[1]; const start = m.index; const end = re.lastIndex;
        if (end > startIndex) segments.push({ content, start, end, len: content.length });
      }
    }
    segments.sort((a,b)=>a.start-b.start);
    return segments;
  }
  function extractPromptFromBlock(blockText) {
    let src = String(blockText || '').trim();
    
    // **[장면 n]** 패턴 제거
    src = src.replace(/^\*\*\[장면[^\]]*\]\*\*\s*/i, '').trim();
    
    // Korean drama still photo로 시작하는 부분 찾기
    const koreanDramaMatch = src.match(/Korean drama still photo[^]*?(?=\n\n|\n(?=\*\*\[장면|\*\*[^[])|\n(?=##)|$)/i);
    if (koreanDramaMatch) {
      return koreanDramaMatch[0].trim();
    }
    
    // 콜론 뒤의 내용 추출
    const colonIdx = src.search(/:\s*/);
    if (colonIdx >= 0) {
      const tail = src.slice(colonIdx + 1).trim();
      return tail;
    }
    
    return src;
  }

/* === NEW: Markdown-style scene prompts parser (추가) ===
   "### 장면 n: ..." 다음에 오는 단락을 프롬프트로 추출합니다.
   라벨은 "장면 001"처럼 3자리 패딩으로 만듭니다.
*/
function parseMarkdownScenePrompts(fullText) {
  const pad3 = n => String(n).padStart(3,'0');
  const t = (fullText || '').replace(/\r\n/g, '\n');

  // 라인 시작의 "### 장면 n:" 또는 "### 장면 n -", "### 장면 n—" 허용
  const headerRe = /^###\s*장면\s*(\d{1,3})\s*(?::|[-–—])?.*$/gmi;

  const results = [];
  let m;
  while ((m = headerRe.exec(t)) !== null) {
    const num = parseInt(m[1], 10);

    // 이 헤더 라인의 끝 다음부터 본문 시작
    const lineEnd = t.indexOf('\n', m.index);
    const start = lineEnd === -1 ? t.length : lineEnd + 1;

    // 🔧 경계 후보: 다음 "### 장면", 아무 "###", 다음 "##", 수평선(---)
    const rest = t.slice(start);
    const nextSceneRel = rest.search(/^###\s*장면\s*\d{1,3}/mi);
    const nextH3Rel    = rest.search(/^###\s/m);         // 👈 추가
    const nextH2Rel    = rest.search(/^##\s/m);
    const nextHrRel    = rest.search(/^\s*---+\s*$/m);

    let end = t.length;
    [nextSceneRel, nextH3Rel, nextH2Rel, nextHrRel].forEach(rel => {
      if (rel >= 0) end = Math.min(end, start + rel);
    });

    const body = t.slice(start, end).trim();
    if (body) results.push({ label: `장면 ${pad3(num)}`, prompt: body });
  }
  return results;
}



  /* ===== 카드 분할 ===== */
  function startIndexForCards(cleanedText) {
    let i = cleanedText.search(/초반\s*45\s*초\s*훅/i);
    if (i === -1) {
      const j = cleanedText.search(/\[\s*장면\s*0*1\s*(?:\]|:)/i);
      i = (j === -1) ? 0 : j;
    }
    return i < 0 ? 0 : i;
  }
  function sentenceEndPositions(str) {
    const ends = [];
    const END_PUNCT = '.!?！？。…';
    const TRAIL = '’”"\'\\)］〕〉》」『』」】]';
    for (let i=0;i<str.length;i++) {
      const ch = str[i];
      if (END_PUNCT.includes(ch)) {
        let j = i + 1;
        while (j < str.length && TRAIL.includes(str[j])) j++;
        ends.push(j);
      }
    }
    if (ends.length === 0 || ends[ends.length-1] !== str.length) ends.push(str.length);
    return ends;
  }
  function cutAtSentenceBoundary(str, limit) {
    const ends = sentenceEndPositions(str);
    let cut = ends[0];
    for (let k=0;k<ends.length;k++) {
      if (ends[k] <= limit) cut = ends[k];
      else break;
    }
    return { head: str.slice(0, cut), tail: str.slice(cut) };
  }
  
// 카드 분할(대본 섹션): 문장 경계 기준으로 1만자 단위 자르기
function splitCardsUnlimitedFromScript(scriptRaw) {
  const clipped = clipTextBeforeImagePrompt(scriptRaw || '');

  // 장면 표기를 표준화 → 라인 정리 순으로 처리
  const normalized = normalizeForSceneBlocks(clipped);
  const cleaned    = sanitizeLines(normalized);

  // 따옴표(" “ ” « » 등)만 제거 — 작은따옴표(')는 그대로 두기
  const src = cleaned.replace(/["\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '');

  // 시작 위치(예: "초반 45초 훅" 또는 [장면 01]부터) 계산
  let rest = src.slice(startIndexForCards(src));

  // 문장 경계 기준으로 10,000자 이하가 되도록 잘라 카드 배열 생성
  const chunks = [];
  while (rest && rest.trim().length) {
    const { head, tail } = cutAtSentenceBoundary(rest, CARD_LIMIT); // CARD_LIMIT = 10000
    chunks.push(head.trim());
    rest = tail;
  }
  return chunks;
}




  /* ===== 레이아웃: 2 섹션(좌/우) ===== */
  function ensureLayoutStyles() {
    if (document.getElementById('sp-layout-style')) return;
    const st = document.createElement('style');
    st.id = 'sp-layout-style';
    st.textContent = `
      #section-scene-parser .scene-parser-content { display:block !important; height:auto !important; }

      /* 전체 2섹션 좌우 */
      #sp-two-sections {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: start;
        margin-bottom: 12px;
      }
      .sp-section {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--glass-bg);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sp-section-title { font-weight: 900; color: var(--text); }

      /* 입력 블록(두 섹션 동일 높이) */
      .sp-input-wrap { display:flex; flex-direction:column; gap:6px; }
      /* 라벨은 시각적으로 숨겨 동일선상 정렬(타이틀 아래 바로 입력창이 오도록) */
      .sp-input-wrap label { display:none; }

      .sp-input-wrap textarea {
        height: ${INPUT_H}px;
        min-height: ${INPUT_H}px;
        max-height: ${INPUT_H}px;
        resize: none !important;
        overflow-y: auto !important;
        padding: 16px;
        border-radius: 10px;
        border: 2px solid var(--border);
        background: var(--card);
        color: var(--text);
        line-height: 1.6;
        font-size: 14px;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }

      /* 좌측 카드 리스트 */
      #sp-cards { display:flex; flex-direction:column; gap:12px; }
      .sp-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--panel, rgba(255,255,255,.02));
        padding: 12px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .sp-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .sp-card-title { font-weight: 700; color: var(--brand); }
      .sp-card-pre {
        margin: 0; padding: 0;
        white-space: pre-wrap; word-break: break-word;
        line-height: 1.6; font-family: ui-monospace, SFMono-Regular, monospace;
        max-height: ${CARD_H}px; overflow-y: auto;
      }

      /* 하단 표(우측 섹션 안) */
      .sp-table-wrap { width:100%; }

      @media (max-width: 1000px) {
        #sp-two-sections { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(st);
  }

  function rebuildSceneLayout() {
    const section = document.getElementById('section-scene-parser');
    if (!section) return;
    const oldContent = section.querySelector('.scene-parser-content');
    if (!oldContent) return;

    const oldInputArea  = oldContent.querySelector('.scene-input-area');
    const oldOutputArea = oldContent.querySelector('.scene-output-area');
    const tableWrap = oldOutputArea ? oldOutputArea.querySelector('.table-wrap') : null; // ← 기존 표 컨테이너

    // 최상위: 두 섹션
    const two = document.createElement('div'); two.id = 'sp-two-sections';

    /* 좌 — 대본 입력창 (타이틀 추가로 우측과 동일선상) */
    const left = document.createElement('div'); left.className = 'sp-section';
    const leftTitle = document.createElement('div'); leftTitle.className = 'sp-section-title';
    leftTitle.textContent = '대본 입력창';
    const leftInputWrap = document.createElement('div'); leftInputWrap.className = 'sp-input-wrap';
    const lblScene = document.createElement('label'); lblScene.setAttribute('for','scene-input'); lblScene.textContent = '대본 입력창';
    const sceneInput = $('#scene-input', oldInputArea || document);
    if (sceneInput) { sceneInput.style.resize='none'; sceneInput.style.overflow='auto'; }
    leftInputWrap.appendChild(lblScene);
    if (sceneInput) leftInputWrap.appendChild(sceneInput);
    const leftCards = document.createElement('div'); leftCards.id='sp-cards';

    left.appendChild(leftTitle);
    left.appendChild(leftInputWrap);
    left.appendChild(leftCards);

    /* 우 — 이미지 프롬프트 섹션 (기존 구조 유지) */
    const right = document.createElement('div'); right.className = 'sp-section';
    const rightTitle = document.createElement('div'); rightTitle.className = 'sp-section-title';
    // 기존: rightTitle.textContent = '이미지 프롬프트';
// 교체:
const titleSpan = document.createElement('span');
titleSpan.textContent = '이미지 프롬프트';
rightTitle.style.display = 'flex';
rightTitle.style.alignItems = 'center';
rightTitle.style.gap = '12px';
rightTitle.appendChild(titleSpan);

// (추가) 제거 단어 입력창 + 버튼
const removeWrap = document.createElement('div');
removeWrap.style.display = 'inline-flex';
removeWrap.style.gap = '8px';
removeWrap.style.alignItems = 'center';

const removeInput = document.createElement('input');
removeInput.id = 'sp-remove-word';
removeInput.placeholder = '삭제할 단어';
removeInput.style.padding = '6px 10px';
removeInput.style.border = '2px solid var(--border)';
removeInput.style.borderRadius = '6px';
removeInput.style.background = 'var(--card)';
removeInput.style.color = 'var(--text)';
removeInput.style.fontSize = '12px';

const removeBtn = document.createElement('button');
removeBtn.id = 'sp-remove-btn';
removeBtn.type = 'button';
removeBtn.className = 'btn btn-danger sp-remove-btn';
removeBtn.textContent = '제거';

removeWrap.appendChild(removeInput);
removeWrap.appendChild(removeBtn);

const restoreBtn = document.createElement('button');
restoreBtn.id = 'sp-remove-reset';
restoreBtn.type = 'button';
restoreBtn.className = 'btn btn-secondary sp-remove-btn';
restoreBtn.textContent = '복구';
removeWrap.appendChild(restoreBtn);

rightTitle.appendChild(removeWrap);

// 이후 원래 코드 이어서...
const rightInputWrap = document.createElement('div'); 
rightInputWrap.className = 'sp-input-wrap';
const lblPrompt = document.createElement('label');
lblPrompt.setAttribute('for','prompt-input');
lblPrompt.textContent = '이미지 프롬프트 입력창';
const promptInput = document.createElement('textarea');
promptInput.id='prompt-input';

    promptInput.placeholder = '예: [장면 001]\n이미지 프롬프트: "..."';
    rightInputWrap.appendChild(lblPrompt);
    rightInputWrap.appendChild(promptInput);
    const rightTableWrap = document.createElement('div'); rightTableWrap.className = 'sp-table-wrap';
    if (tableWrap) rightTableWrap.appendChild(tableWrap);
    else if (oldOutputArea) rightTableWrap.appendChild(oldOutputArea);
    right.appendChild(rightTitle);
    right.appendChild(rightInputWrap);
    right.appendChild(rightTableWrap);

    // 조립
    two.appendChild(left);
    two.appendChild(right);

// 교체
oldContent.innerHTML = '';
oldContent.appendChild(two);

// 제거/복구 입력 바인딩 (이 위치에 한 번만!)
const btn = document.getElementById('sp-remove-btn');
const inp = document.getElementById('sp-remove-word');
const resetBtn = document.getElementById('sp-remove-reset');

if (btn && inp) {
  const applyRemove = () => {
    const word = (inp.value || '').trim();
    if (word && !SP_REMOVE_WORDS.includes(word)) {
      SP_REMOVE_WORDS.push(word);   // ← 누적
    }
    inp.value = '';                 // 입력창 비우기
    renderPromptTable();            // 즉시 반영
  };
  btn.addEventListener('click', applyRemove);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyRemove(); }
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    SP_REMOVE_WORDS = [];           // 전체 복구
    if (inp) inp.value = '';
    renderPromptTable();
  });
}
// ← 여기까지 바인딩 블록


  }


  /* ===== 주인공 프롬프트 추출 ===== */
  // "### 👤 주인공 이미지 프롬프트:" 제목 다음 ~ 다음 제목("##" 또는 "###") 전까지를 추출
/* ===== 주인공 프롬프트 추출 (개선판) ===== */
// "##/### … 주인공 … 프롬프트" 제목 다음 ~ 다음 제목("##" 또는 "###") 직전까지 추출.
// 첫 줄이 "**이름 … - 주인공**" / "이름 … - 주인공" / "… 주인공" 이면 해당 줄은 제거.
/* ===== 주인공 프롬프트 추출 (강화판) ===== */
// "##/### … 주인공 … 프롬프트" 제목 다음 ~ 다음 제목("##" 또는 "###") 직전까지.
// 맨 첫 줄에 "**… - 주인공**" / "… 주인공" 같은 라벨이 있으면 삭제.
function extractProtagonistPrompt(full) {
  const text = String(full || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // 제목(##/###) 찾기
  let start = -1;
  const headingRe = /^\s*#{2,3}\s*.*주인공.*프롬프트.*$/i;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) { start = i + 1; break; }
  }
  if (start === -1) return '';

  // 다음 제목(##/###) 전까지
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*#{2,3}\s+/.test(lines[i])) { end = i; break; }
  }

  // 본문 정리
  let bodyLines = lines.slice(start, end)
    .map(ln => ln.replace(/^\*\*(.+?)\*\*$/g, '$1'))   // **굵게** 풀기
    .filter(ln => !/^\s*---+\s*$/.test(ln))           // 수평선 제거
    .map(ln => ln.trim());

  // 라벨 줄이면 제거 (여러 줄 연속 라벨도 방어)
  while (bodyLines.length && bodyLines[0]) {
    const first = bodyLines[0];
    const isLabel =
      /(?:-\s*)?주인공\s*$/i.test(first)              // "… - 주인공" / "… 주인공"
      || /^\s*\*{0,2}.*주인공.*\*{0,2}\s*$/.test(first) && !/프롬프트/i.test(first);
    if (isLabel) bodyLines.shift();
    else break;
  }

  let body = bodyLines.join('\n').trim();

  // "라벨: 내용" 패턴 호환
  body = body.replace(/^[^:]{1,80}:\s*/, '').trim();

  return body;
}



  /* ===== 섹션(🎬 …) 토큰 추출 =====
     - 패턴 A: "##/### (🎬) 훅 장면 이미지 프롬프트:" 또는 "##/### (🎬) 1장 장면별 이미지 프롬프트:" 등
     - 패턴 B: "##/### ... 3장 ..." 처럼 제목 안 어딘가에 "<숫자>장"이 포함된 경우(이미지 프롬프트 문구가 없어도 인정)
     - 둘 다 지원하며, '주인공 이미지 프롬프트' 제목은 제외한다. */
  function findSectionTokens(full) {
    const text = String(full || '');
    const byIndex = new Map();

    // 패턴 A: ...이미지 프롬프트
    let m;
    const reA = /^\s*#{2,3}\s*(?:🎬\s*)?(.+?)\s*(?:장면별\s*이미지\s*프롬프트|이미지\s*프롬프트)\s*:?\s*$/gim;
    while ((m = reA.exec(text)) !== null) {
      const fullLine = m[0];         // 제목 전체 라인
      if (/주인공\s*이미지\s*프롬프트/i.test(fullLine)) continue; // 주인공 섹션 제외

      // 숫자 'n장' 우선 인식, 없으면 원문 제목(훅 등)
      const numMatch = /(\d{1,3})\s*장\b/i.exec(fullLine) || /(\d{1,3})\s*장\b/i.exec(m[1] || '');
      const raw = (m[1] || '').trim();
      const title = numMatch ? `🎬 ${parseInt(numMatch[1],10)}장` : `🎬 ${raw}`;
      if (!byIndex.has(m.index)) byIndex.set(m.index, { type:'section', index:m.index, title });
    }

    // 패턴 B: #... <숫자>장 ... (이미지 프롬프트 문구가 없어도 섹션으로 인정)
    const reHeading = /^\s*#{2,3}\s+(.+)$/gim;
    while ((m = reHeading.exec(text)) !== null) {
      const fullLine = m[0];
      const idx  = m.index;
      if (byIndex.has(idx)) continue; // 이미 A에서 잡힌 라인은 건너뜀
      if (/주인공\s*이미지\s*프롬프트/i.test(fullLine)) continue; // 주인공 제외
      if (/이미지\s*프롬프트/i.test(fullLine)) continue;         // '이미지 프롬프트' 제목은 A에서 처리

      const num = /(\d{1,3})\s*장\b/i.exec(fullLine);
      if (num) {
        const n = parseInt(num[1], 10);
        byIndex.set(idx, { type:'section', index: idx, title: `🎬 ${n}장` });
      }
    }

    return Array.from(byIndex.values()).sort((a,b)=>a.index-b.index);
  }

  /* ===== 원문에서 장면 헤더(**장면 n** / [장면 n]) 위치 찾기 ===== */
function findSceneTokens(full) {
  const text = String(full || '');
  const tokens = [];
  const push = (n, idx) => tokens.push({ type:'scene', index: idx, label:`장면 ${pad3(parseInt(n,10))}` });

  let m;

  // **장면 n**
  const reBold = /\*\*\s*장면\s*(\d{1,3})\s*\*\*/gi;
  while ((m = reBold.exec(text)) !== null) push(m[1], m.index);

  // [장면 n] / [장면 n: …]
  const reBr = /\[\s*장면\s*(\d{1,3})\s*(?::[^\]]*)?\]/gi;
  while ((m = reBr.exec(text)) !== null) push(m[1], m.index);

  // 👇 추가: ### 장면 n: / ### 장면 n - / ### 장면 n
  const reH3 = /^###\s*장면\s*(\d{1,3})\s*(?::|[-–—])?.*$/gmi;
  while ((m = reH3.exec(text)) !== null) push(m[1], m.index);

  tokens.sort((a,b)=>a.index-b.index);
  
  return tokens;
}


  /* ===== 표 렌더링 ===== */
  function renderPromptTable() {
    const tbody = document.getElementById('scene-tbody');
    if (!tbody) return;

    const thead = tbody.closest('table')?.querySelector('thead');
    if (thead) {
      thead.innerHTML = `
        <tr>
          <th class="col-scene"  style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border); width:120px;">장면</th>
          <th class="col-prompt" style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">이미지 프롬프트</th>
          <th class="col-copy" style="text-align:center; padding:8px 12px; border-bottom:1px solid var(--border); width:80px;">복사</th>
        </tr>
      `;
    }

// 1) 원문 확보 & 1차 정리
const promptRaw   = ($('#prompt-input')?.value || '');
const promptClean = sanitizeLines(normalizeForSceneBlocks(promptRaw));

// 2) Markdown 규칙 (### 장면 n: …)
const mdRows = parseMarkdownScenePrompts(promptRaw); // [{label, prompt}]

// 3) 기존 규칙 ([장면 nnn] 블록 + 본문에서 프롬프트 추출)
const classicBlocks = parseSceneBlocks(promptClean); // [{label, body}]
const classicRows = classicBlocks.map(({ label, body }) => ({
  label,
  prompt: extractPromptFromBlock(body)
}));

// 4) 병합 — 같은 장면이면 Markdown(### 장면 …) 우선
const sceneNum = (label) => {
  const m = label.match(/장면\s*(\d{1,3})/);
  return m ? parseInt(m[1], 10) : 0;
};
const merged = new Map();
classicRows.forEach(r => merged.set(sceneNum(r.label), r));
mdRows.forEach(r      => merged.set(sceneNum(r.label), r)); // 덮어쓰기 → MD 우선

let rows = Array.from(merged.values())
  .filter(r => (r.prompt||'').trim().length)
  .sort((a,b) => sceneNum(a.label) - sceneNum(b.label));

// 5) 제거 단어 반영
const reRemove = buildRemoveRegex();
if (reRemove) {
  rows = rows.map(r => ({
    ...r,
    prompt: (r.prompt || '').replace(reRemove, '').replace(/\s{2,}/g, ' ').trim()
  }));
}

// 6) map으로 접근성 높이기 (아래 토큰 병합 로직에서 사용)
const rowsMap = new Map(rows.map(r => [r.label, r.prompt]));

    const frag = document.createDocumentFragment();

    // 0) 헤더 바로 아래 "주인공" 행 (있을 때만)
    let protagonist = extractProtagonistPrompt(promptRaw);
	// v2.1 하드 스트립: 본문 맨 앞 라벨 줄(…주인공) 강제 제거
protagonist = (protagonist || '')
  .replace(/^\s*(?:\*\*)?([^\n]*?\b주인공\b).*?\*?\*?\s*\n+/, '') // 줄바꿈 있는 케이스
  .replace(/^\s*(?:\*\*)?[^\n]*?\b주인공\b.*?\*?\*?\s*(?=\S)/, '') // 같은 줄에 이어지는 케이스
  .trim();


const rePro = buildRemoveRegex();
if (rePro) {
  protagonist = (protagonist || '')
    .replace(rePro, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


if (protagonist) {
  const trPro = document.createElement('tr');

  const tdScene = document.createElement('td');
  tdScene.className = 'col-scene';
  tdScene.style.whiteSpace = 'nowrap';
  tdScene.style.padding = '12px';
  tdScene.style.borderBottom = '1px solid var(--border)';
  tdScene.textContent = '주인공';

  const tdPrompt = document.createElement('td');
  tdPrompt.className = 'col-prompt';
  tdPrompt.style.padding = '12px';
  tdPrompt.style.borderBottom = '1px solid var(--border)';
  const divText = document.createElement('div');
  divText.className = 'prompt-text';
  divText.textContent = protagonist;
  tdPrompt.appendChild(divText);

  const tdCopy = document.createElement('td');
  tdCopy.style.padding = '12px';
  tdCopy.style.borderBottom = '1px solid var(--border)';
  const btn = document.createElement('button');
  btn.textContent = '복사';
  // 현재 값 고정해서 복사하려면 아래 두 줄처럼 해도 됩니다.
  const proForCopy = protagonist;
  wireCopyToggle(btn, () => proForCopy);

  tdCopy.appendChild(btn);

  trPro.appendChild(tdScene);
  trPro.appendChild(tdPrompt);
  trPro.appendChild(tdCopy);
  frag.appendChild(trPro);
}


    // 1) 섹션/장면 토큰을 원문 순서대로 병합
    const sectionTokens = findSectionTokens(promptRaw);
    const sceneTokens   = findSceneTokens(promptRaw);

    // 각 섹션별 프롬프트 개수 계산(해당 섹션 이후 ~ 다음 섹션 직전 장면 수)
    for (let i = 0; i < sectionTokens.length; i++) {
      const sec  = sectionTokens[i];
      const next = sectionTokens[i+1] || { index: Infinity };
      let count = 0;
      for (const s of sceneTokens) {
        if (s.index > sec.index && s.index < next.index && rowsMap.has(s.label)) count++;
      }
      sec.count = count;
    }

    const tokens = [...sectionTokens, ...sceneTokens].sort((a,b)=>a.index-b.index);
	let appendedAnyScene = false; // 👈 장면 행을 실제로 추가했는지 추적
    const addedScenes = new Set();

    // 2) 토큰 순회하며 섹션은 "제목 / 프롬프트 n개"(복사버튼 X), 장면은 기존처럼 표시
    for (const tk of tokens) {
      if (tk.type === 'section') {
        const trSec = document.createElement('tr');

        const tdScene = document.createElement('td');
        tdScene.className = 'col-scene';
        tdScene.style.whiteSpace = 'nowrap';
        tdScene.style.padding = '12px';
        tdScene.style.borderBottom = '1px solid var(--border)';
        tdScene.textContent = `${tk.title} / 프롬프트 ${tk.count||0}개`;

        const tdPrompt = document.createElement('td');
        tdPrompt.className = 'col-prompt';
        tdPrompt.style.padding = '12px';
        tdPrompt.style.borderBottom = '1px solid var(--border)';
        tdPrompt.textContent = ''; // 섹션 제목행은 본문 없음

        const tdCopy = document.createElement('td');
        tdCopy.style.padding = '12px';
        tdCopy.style.borderBottom = '1px solid var(--border)';
        // 복사 버튼 없음

        trSec.appendChild(tdScene);
        trSec.appendChild(tdPrompt);
        trSec.appendChild(tdCopy);
        frag.appendChild(trSec);
      } else if (tk.type === 'scene') {
        if (addedScenes.has(tk.label)) continue; // 중복 방지
        const prompt = rowsMap.get(tk.label);
        if (!prompt) continue;

        const tr = document.createElement('tr');

        const tdScene = document.createElement('td');
        tdScene.className = 'col-scene';
        tdScene.style.whiteSpace = 'nowrap';
        tdScene.style.padding = '12px';
        tdScene.style.borderBottom = '1px solid var(--border)';
        tdScene.textContent = tk.label;

        const tdPrompt = document.createElement('td');
        tdPrompt.className = 'col-prompt';
        tdPrompt.style.padding = '12px';
        tdPrompt.style.borderBottom = '1px solid var(--border)';
        const divText = document.createElement('div');
        divText.className = 'prompt-text';
        divText.textContent = prompt || '';
        tdPrompt.appendChild(divText);

        const tdCopy = document.createElement('td');
        tdCopy.style.padding = '12px';
        tdCopy.style.borderBottom = '1px solid var(--border)';
        const btn = document.createElement('button');
        btn.textContent = '복사';
        wireCopyToggle(btn, () => prompt || '');
        tdCopy.appendChild(btn);

        tr.appendChild(tdScene);
        tr.appendChild(tdPrompt);
        tr.appendChild(tdCopy);
        frag.appendChild(tr);
		appendedAnyScene = true;


        addedScenes.add(tk.label);
      }
    }

    // 3) 내용 출력
    tbody.innerHTML = '';
	// ▼▼ 폴백: 토큰이 하나도 없었지만 rows는 있는 경우 → rows로 직접 렌더
if (!appendedAnyScene && rows && rows.length) {
  rows.forEach(({ label, prompt }) => {
    const tr = document.createElement('tr');

    const tdScene = document.createElement('td');
    tdScene.className = 'col-scene';
    tdScene.style.whiteSpace = 'nowrap';
    tdScene.style.padding = '12px';
    tdScene.style.borderBottom = '1px solid var(--border)';
    tdScene.textContent = label;

    const tdPrompt = document.createElement('td');
    tdPrompt.className = 'col-prompt';
    tdPrompt.style.padding = '12px';
    tdPrompt.style.borderBottom = '1px solid var(--border)';
    const divText = document.createElement('div');
    divText.className = 'prompt-text';
    divText.textContent = prompt || '';
    tdPrompt.appendChild(divText);

    const tdCopy = document.createElement('td');
    tdCopy.style.padding = '12px';
    tdCopy.style.borderBottom = '1px solid var(--border)';
    const btn = document.createElement('button');
    btn.textContent = '복사';
    wireCopyToggle(btn, () => prompt || '');
    tdCopy.appendChild(btn);

    tr.appendChild(tdScene);
    tr.appendChild(tdPrompt);
    tr.appendChild(tdCopy);
    frag.appendChild(tr);
  });
}
// ▲▲ 폴백 끝

	
    if (frag.childNodes.length) {
      tbody.appendChild(frag);
    } else {
      const trEmpty = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'empty';
      td.style.color = 'var(--muted)';
      td.style.textAlign = 'center';
      td.style.padding = '28px';
      td.textContent = '이미지 프롬프트 입력창에서 유효한 프롬프트를 찾지 못했습니다.';
      trEmpty.appendChild(td);
      tbody.appendChild(trEmpty);
    }
  }

  function renderCards() {
    const container = document.getElementById('sp-cards');
    if (!container) return;
    container.innerHTML = '';

    const raw = ($('#scene-input')?.value || '');
    const chunks = splitCardsUnlimitedFromScript(raw);

    if (!chunks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '카드로 만들 텍스트가 없습니다. 대본창에 텍스트를 입력해주세요.';
      container.appendChild(empty);
      return;
    }

    chunks.forEach((text, idx) => {
      const n = (text||'').length;

      const card = document.createElement('div');
      card.className = 'sp-card';

      const head = document.createElement('div');
      head.className = 'sp-card-head';

      const title = document.createElement('div');
      title.className = 'sp-card-title';
      title.textContent = `카드 ${String(idx+1)} / ${n.toLocaleString('ko-KR')}자 / ${fmtDuration(n)}`;

      const btn = document.createElement('button');
      btn.textContent = '복사';
      wireCopyToggle(btn, () => text || '');

      const pre = document.createElement('pre');
      pre.className = 'sp-card-pre';
      pre.textContent = text || '';

      head.appendChild(title);
      head.appendChild(btn);
      card.appendChild(head);
      card.appendChild(pre);
      container.appendChild(card);
    });
  }

  /* ===== 저장(JSON) & 기타 ===== */
  function changeDate(dateInput, days) {
    const d = new Date(dateInput.value || today());
    d.setDate(d.getDate() + days);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    dateInput.value = `${d.getFullYear()}-${mm}-${dd}`;
    dateInput.dispatchEvent(new Event('change'));
  }

function restoreDateUI() {
  // actions 안전 획득
  const actions = getActionsEl();
  const sec = document.getElementById('section-scene-parser');
  const date = sec ? sec.querySelector('#scene-date') : null;

  // 아직 헤더/액션바가 없으면 1프레임 뒤 재시도 (최대 10회)
  if (!actions || !date) {
    (restoreDateUI._retry = (restoreDateUI._retry || 0) + 1);
    if (restoreDateUI._retry <= 10) {
      setTimeout(restoreDateUI, 50);
    } else {
      console.warn('[scene-parser] .section-actions not ready');
    }
    return;
  }
  restoreDateUI._retry = 0; // 초기화

  // 기존 날짜 UI 제거/재구성
  const oldWrap = actions.querySelector('.sp-date-wrap'); if (oldWrap) oldWrap.remove();
  const oldLabel = Array.from(actions.children).find(el => el.textContent === '업로드 날짜');
  if (oldLabel) oldLabel.remove();

  const label = document.createElement('div');
  label.textContent = '업로드 날짜';
  Object.assign(label.style,{ fontWeight:'600', marginRight:'8px', color:'var(--text,#e4e6ea)' });

  const wrap = document.createElement('div');
  wrap.className = 'sp-date-wrap';
  Object.assign(wrap.style,{ display:'inline-flex', alignItems:'center', gap:'6px', marginRight:'8px' });

  date.type = 'date';
  if (!date.value) date.value = today();
  Object.assign(date.style,{
    height:'40px', padding:'8px 12px',
    border:'2px solid var(--border,#2a3443)', borderRadius:'8px',
    background:'var(--panel,#1e2329)', color:'var(--text,#e4e6ea)', fontWeight:'600'
  });

  const col = document.createElement('div');
  Object.assign(col.style,{ display:'flex', flexDirection:'column', gap:'2px' });

  const mk=(t)=>{ const b=document.createElement('button'); b.textContent=t;
    Object.assign(b.style,{
      width:'30px', height:'20px', padding:'0',
      border:'1px solid var(--border,#2a3443)', borderRadius:'4px',
      background:'var(--glass-bg,rgba(255,255,255,.05))',
      color:'var(--text,#e4e6ea)', fontSize:'10px',
      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer'
    }); return b; };
  const up=mk('▲'), dn=mk('▼');
  up.addEventListener('click',()=>changeDate(date,1));
  dn.addEventListener('click',()=>changeDate(date,-1));
  col.appendChild(up); col.appendChild(dn);

  wrap.appendChild(date); wrap.appendChild(col);
  actions.insertBefore(label, actions.firstChild||null);
  actions.insertBefore(wrap, label.nextSibling);

  // === 대본 저장/불러오기/삭제 UI ===
  if (!actions.querySelector('.sp-draft-wrap')) {
    const draftWrap = document.createElement('div');
    draftWrap.className = 'sp-draft-wrap';
    Object.assign(draftWrap.style, { display:'inline-flex', alignItems:'center', gap:'6px', marginLeft:'8px' });

    // 저장 버튼
    const btnDraftSave = document.createElement('button');
    btnDraftSave.id = 'sp-draft-save';
    btnDraftSave.textContent = '대본 저장';
    Object.assign(btnDraftSave.style, {
      padding:'8px 12px', border:'1px solid var(--border)', borderRadius:'8px',
      background:'#2d6cdf', color:'#fff', fontWeight:'700', cursor:'pointer'
    });

    // 최근 저장 목록
    const sel = document.createElement('select');
    sel.id = 'sp-draft-select';
    Object.assign(sel.style, {
      height:'36px', padding:'0 8px', border:'1px solid var(--border)', borderRadius:'8px',
      background:'var(--panel)', color:'var(--text)'
    });
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '최근 저장 불러오기';
    sel.appendChild(opt0);

    // 불러오기 버튼
    const btnDraftLoad = document.createElement('button');
    btnDraftLoad.id = 'sp-draft-load';
    btnDraftLoad.textContent = '불러오기';
    Object.assign(btnDraftLoad.style, {
      padding:'8px 12px', border:'1px solid var(--border)', borderRadius:'8px',
      background:'var(--glass-bg)', color:'var(--text)', fontWeight:'700', cursor:'pointer'
    });

    // 삭제 버튼 (신규)
    const btnDraftDelete = document.createElement('button');
    btnDraftDelete.id = 'sp-draft-delete';
    btnDraftDelete.textContent = '삭제';
    Object.assign(btnDraftDelete.style, {
      padding:'8px 12px', border:'1px solid var(--border)', borderRadius:'8px',
      background:'#c4302b', color:'#fff', fontWeight:'700', cursor:'pointer'
    });

    draftWrap.appendChild(btnDraftSave);
    draftWrap.appendChild(sel);
    draftWrap.appendChild(btnDraftLoad);
    draftWrap.appendChild(btnDraftDelete);
    actions.appendChild(draftWrap);

    // 목록 채우기
    (async () => {
      const drafts = await getRecentDrafts();
      drafts.forEach(d => {
        const o = document.createElement('option');
        o.value = d.id;
        const sLen = (d.sceneText||'').length, pLen = (d.promptText||'').length;
        o.textContent = `${d.date} · 대본 ${sLen.toLocaleString()}자 / 프롬프트 ${pLen.toLocaleString()}자`;
        sel.appendChild(o);
      });
    })();

    // 저장
    btnDraftSave.addEventListener('click', async () => {
      const sceneText  = document.getElementById('scene-input')?.value || '';
      const promptText = document.getElementById('prompt-input')?.value || '';
      if (!sceneText && !promptText) { showToast('저장할 내용이 없습니다.', 'warning'); return; }
      try {
        const rec = await saveDraftToDB(sceneText, promptText);
        const opt = document.createElement('option');
        opt.value = rec.id;
        opt.textContent = `${rec.date} · 대본 ${sceneText.length.toLocaleString()}자 / 프롬프트 ${promptText.length.toLocaleString()}자`;
        sel.insertBefore(opt, sel.options[1] || null);
        sel.value = rec.id;
        showToast('대본/프롬프트를 저장했어요 (최근 31일 보관)', 'success');
      } catch (e) {
        console.error(e);
        showToast('저장 중 오류가 발생했습니다.', 'error');
      }
    });

    // 불러오기
    btnDraftLoad.addEventListener('click', async () => {
      const id = sel.value;
      if (!id) { showToast('불러올 항목을 선택해주세요.', 'warning'); return; }
      const rec = await getDraftById(id);
      if (!rec) { showToast('해당 항목을 찾을 수 없습니다.', 'error'); return; }
      const sceneInput = document.getElementById('scene-input');
      const promptInput = document.getElementById('prompt-input');
      if (sceneInput)  sceneInput.value  = rec.sceneText || '';
      if (promptInput) promptInput.value = rec.promptText || '';
      try { renderCards(); renderPromptTable(); } catch(e) {}
      showToast('불러오기 완료', 'success');
    });

    // 삭제 (신규)
    btnDraftDelete.addEventListener('click', async () => {
      const id = sel.value;
      if (!id) { showToast('삭제할 항목을 선택해주세요.', 'warning'); return; }
      const ok = confirm('선택한 저장 항목을 삭제할까요?');
      if (!ok) return;
      try {
        const done = await deleteDraftById(id); // ← 이 함수가 파일 상단 IndexedDB 유틸에 추가되어 있어야 합니다.
        if (done) {
          const toRemove = Array.from(sel.options).find(o => o.value === String(id));
          if (toRemove) sel.removeChild(toRemove);
          sel.value = '';
          showToast('저장 항목을 삭제했습니다.', 'success');
        } else {
          showToast('삭제에 실패했습니다.', 'error');
        }
      } catch (e) {
        console.error(e);
        showToast('삭제 중 오류가 발생했습니다.', 'error');
      }
    });
  }
}







  function debounce(fn, ms){ let t=null; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), ms); }; }

/* ===== 초기화 ===== */
function initializeSceneParser() {
  if (window._sceneParserInitialized) return;
  window._sceneParserInitialized = true;

  // 레이아웃/UI 기본 구성
  ensureLayoutStyles();
  rebuildSceneLayout();
  restoreDateUI();

  const sceneInput  = $('#scene-input');
  const promptInput = $('#prompt-input');
  const btnSave     = $('#scene-save');
  const btnClear    = $('#scene-clear');

  const recomputeAll = () => { try { renderCards(); renderPromptTable(); } catch(e){ console.error(e); } };

  // 입력 이벤트 바인딩
  if (sceneInput) {
    sceneInput.addEventListener('input', debounce(recomputeAll, 120));
    sceneInput.addEventListener('paste', () => setTimeout(recomputeAll, 0));
  }
  if (promptInput) {
    promptInput.addEventListener('input', debounce(recomputeAll, 120));
    promptInput.addEventListener('paste', () => setTimeout(recomputeAll, 0));
  }

  // 저장: 우측 입력창 → JSON  (파일명: [MM-DD] ／ [HH:MM:SS] 대본첫문장(최대10자...))
  if (btnSave) {
  btnSave.addEventListener('click', () => {
    const promptRaw   = $('#prompt-input')?.value || '';
    const promptClean = sanitizeLines(normalizeForSceneBlocks(promptRaw));
    const blocks      = parseSceneBlocks(promptClean);

    let rows = blocks
      .map(({ label, body }, i) => {
        const prompt = extractPromptFromBlock(body).trim();
        if (!prompt) return null;
        const m  = (label || '').match(/(\d{1,3})/);
        const id = pad3(m ? parseInt(m[1], 10) : (i + 1));
        return { id, prompt, suggested_filenames: [`${id}.jpg`, `${id}.png`] };
      })
      .filter(Boolean);

    // 제거 단어 반영
    const reRemove = buildRemoveRegex();
    if (reRemove) {
      rows = rows.map(r => ({
        ...r,
        prompt: r.prompt.replace(reRemove, '').replace(/\s{2,}/g, ' ').trim()
      }));
    }

    if (!rows.length) {
      showToast('저장할 프롬프트가 없습니다.', 'warning');
      return;
    }

    // ✅ 여기서 payload 만들기
    const payload = { version: 1, exported_at: today(), count: rows.length, items: rows };

    // 파일명 규칙
    const sceneTextForName = document.getElementById('scene-input')?.value || '';
    const mmdd  = getUploadMonthDay();
    const hms   = getNowHMS();
    const first = getFirstSentenceForFilename(sceneTextForName);
    const filename = `[${mmdd}] ／ [${hms}] ${first}.json`;

    downloadFile(filename, JSON.stringify(payload, null, 2));
    showToast(`이미지 프롬프트 저장 완료 (${filename})`, 'success');
  });
}


  // 지우기
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (sceneInput)  sceneInput.value  = '';
      if (promptInput) promptInput.value = '';
      recomputeAll();
    });
  }

  // 첫 렌더
  recomputeAll();
}


  window.initializeSceneParser = initializeSceneParser;

  if (document.getElementById('section-scene-parser')) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(() => { try{ initializeSceneParser(); } catch(e){ console.error(e); } }, 0);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        try{ initializeSceneParser(); } catch(e){ console.error(e); }
      });
    }
  }
})();
