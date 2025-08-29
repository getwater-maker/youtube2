// YouTube 채널 모니터 - 영상분석 통합 관리 (화면 표시 문제 해결)
console.log('videos.js 로딩 시작 - 화면 표시 문제 해결 버전');

// ============================================================================
// 전역: 채널/사용자 아바타 이미지 폴백(앱 전체 적용)
// ============================================================================
(function installGlobalAvatarFallback() {
  const DEFAULT_AVATAR = 'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj';

  // 이미지 에러를 캡처 단계에서 가로채어 폴백 처리
  window.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img && img.tagName === 'IMG')) return;

    // 이미 폴백을 적용했으면 무시
    if (img.dataset.fallbackApplied === '1') return;

    const src = img.currentSrc || img.src || '';

    // YouTube/Google 아바타 계열만 폴백 적용 (비디오 썸네일 등은 건드리지 않음)
    const isLikelyAvatar =
      /yt3\.ggpht\.com/i.test(src) ||
      /googleusercontent\.com/i.test(src);

    if (isLikelyAvatar) {
      img.dataset.fallbackApplied = '1';
      img.src = DEFAULT_AVATAR;
      console.debug('Avatar fallback applied:', src);
    }
  }, true);

  // 이미 DOM에 있는 이미지들 중 깨진 것 바로 보정
  function fixExistingBroken() {
    document.querySelectorAll('img').forEach((img) => {
      // complete이면서 naturalWidth==0 이면 깨진 이미지
      if (img.complete && img.naturalWidth === 0) {
        const e = new Event('error');
        img.dispatchEvent(e);
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(fixExistingBroken, 0);
  } else {
    document.addEventListener('DOMContentLoaded', fixExistingBroken);
  }
})();

// ============================================================================
// 설정 상수
// ============================================================================
const VIDEO_CONFIG = {
  MIN_VIEWS: 50000,        // 최소 조회수 5만
  DEFAULT_PERIOD: '1m',    // 기본 기간: 한달
  VIDEOS_PER_PAGE: 30,     // 페이지당 영상 수
  MIN_LONGFORM_DURATION: 181 // 롱폼 최소 길이 (초)
};

// ============================================================================
// 통합 상태 관리 (main.js 상태와 동기화)
// ============================================================================
// main.js의 mainState를 기본으로 사용하되, 없으면 생성
if (!window.mainState) {
  window.mainState = {
    currentTab: 'latest',
    currentPeriod: '1m',
    currentSort: 'views',
    latestVideos: [],
    mutantVideos: [],
    lastRefresh: {
      latest: null,
      mutant: null,
      trends: null,
      insights: null
    },
    currentPage: {
      latest: 1,
      mutant: 1,
      trends: 1,
      insights: 1
    },
    videosPerPage: VIDEO_CONFIG.VIDEOS_PER_PAGE,
    completedVideos: JSON.parse(localStorage.getItem('completedVideos') || '{}')
  };
}

// videosState는 mainState의 별칭으로 사용
window.videosState = window.mainState;

// 작업 완료 상태 저장
function saveCompletedVideos() {
  localStorage.setItem('completedVideos', JSON.stringify(window.mainState.completedVideos));
}

// 작업 완료 토글
function toggleVideoCompleted(videoId) {
  if (window.mainState.completedVideos[videoId]) {
    delete window.mainState.completedVideos[videoId];
  } else {
    window.mainState.completedVideos[videoId] = {
      completedAt: new Date().toISOString(),
      date: new Date().toLocaleDateString('ko-KR')
    };
  }
  saveCompletedVideos();
  // UI 업데이트 - 강제로 현재 탭 새로고침
  const currentTab = window.mainState.currentTab;
  setTimeout(() => {
    displayVideos(currentTab);
  }, 100);
}

// ============================================================================
// 유틸리티 함수
// ============================================================================
function getPeriodText(p) {
  switch (p) {
    case '1w': return '최근 1주';
    case '2w': return '최근 2주';
    case '1m': return '최근 1개월';
    case 'all': return '전체';
    default: return '최근 1개월';
  }
}

function getDateRangeForPeriod(period) {
  const now = moment();
  let startDate = null;
  switch (period) {
    case '1w': startDate = moment().subtract(1, 'week'); break;
    case '2w': startDate = moment().subtract(2, 'weeks'); break;
    case '1m': startDate = moment().subtract(1, 'month'); break;
    case 'all': startDate = null; break;
    default: startDate = moment().subtract(1, 'month');
  }
  return { startDate, endDate: now };
}

function filterVideosByDate(videos, period) {
  console.log('필터링 기준:', VIDEO_CONFIG.MIN_VIEWS, '조회수 이상');
  
  // 동적 조회수 기준 적용
  const filteredByViews = videos.filter(v => {
    const views = parseInt(v.statistics?.viewCount || '0', 10);
    const passed = views >= VIDEO_CONFIG.MIN_VIEWS;
    return passed;
  });
  
  console.log(`${videos.length}개 영상 중 ${filteredByViews.length}개가 조회수 기준 통과`);
  
  if (period === 'all') {
    return filteredByViews;
  }
  
  const { startDate } = getDateRangeForPeriod(period);
  if (!startDate) return filteredByViews;
  
  return filteredByViews.filter(v => {
    const publishedAfterDate = moment(v.snippet?.publishedAt).isAfter(startDate);
    return publishedAfterDate;
  });
}

function numberWithCommas(n) {
  const num = parseInt(n || 0, 10);
  return isNaN(num) ? '0' : num.toLocaleString('ko-KR');
}

function ratioSafe(a, b) {
  const x = parseFloat(a || 0);
  const y = parseFloat(b || 0);
  return y > 0 ? (x / y) : 0;
}

// 키워드 추출 및 빈도 계산
function extractKeywordsWithCount(text) {
  if (!text || typeof text !== 'string') return [];
  
  // 간단한 한국어/영문/숫자 토큰 추출
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  // 불용어(간단 버전)
  const stop = new Set(['the','and','for','with','from','this','that','are','was','were','you','your','video','official','full','live','ep','mv','티저','공식','영상','완전','최신','오늘','어제','보기','무료','채널','영상','에서','으로','에게','이런','저런','그런','이것','저것','그것']);
  
  const counted = new Map();
  for (const t of tokens) {
    if (stop.has(t) || t.length < 2) continue;
    counted.set(t, (counted.get(t) || 0) + 1);
  }
  
  // 빈도순 정렬하여 [단어, 횟수] 배열로 반환
  return [...counted.entries()]
    .sort((a,b) => b[1]-a[1])
    .slice(0,20); // 상위 20개
}

// ============================================================================
// 복사 기능들 (완전히 새로운 구현)
// ============================================================================

// 클립보드 복사 핵심 함수 (브라우저 호환성 극대화)
async function safeClipboardCopy(text) {
  // 방법 1: 최신 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'clipboard-api' };
    } catch (err) {
      console.warn('Clipboard API 실패:', err);
    }
  }
  
  // 방법 2: execCommand 폴백
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (success) {
      return { success: true, method: 'execCommand' };
    }
  } catch (err) {
    console.warn('execCommand 실패:', err);
  }
  
  // 방법 3: 수동 복사 안내
  return { success: false, method: 'manual' };
}

// 개선된 이미지 클립보드 복사 함수 (JPEG를 PNG로 변환)
async function copyImageToClipboard(blob) {
  try {
    // JPEG인 경우 PNG로 변환
    if (blob.type === 'image/jpeg') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      // 이미지 로드 완료까지 기다리기
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
      });
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // URL 정리
      URL.revokeObjectURL(img.src);
      
      // PNG로 변환하여 클립보드에 복사
      return new Promise((resolve, reject) => {
        canvas.toBlob(async (pngBlob) => {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': pngBlob })
            ]);
            resolve({ success: true, method: 'clipboard-png' });
          } catch (error) {
            reject(error);
          }
        }, 'image/png');
      });
      
    } else {
      // PNG나 다른 지원되는 형식인 경우 그대로 복사
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      return { success: true, method: 'clipboard-direct' };
    }
  } catch (error) {
    console.warn('이미지 클립보드 복사 실패:', error);
    return { success: false, method: 'failed', error: error.message };
  }
}

// 제목 복사 함수 (개선됨)
async function copyTitle(title) {
  if (!title) {
    window.toast && window.toast('복사할 제목이 없습니다.', 'warning');
    return;
  }
  
  const result = await safeClipboardCopy(title);
  
  if (result.success) {
    const methodText = result.method === 'clipboard-api' ? '' : ' (호환 모드)';
    window.toast && window.toast(`제목을 복사했습니다!${methodText}`, 'success');
  } else {
    // 수동 복사 안내
    const textArea = document.createElement('textarea');
    textArea.value = title;
    textArea.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:80%;height:200px;z-index:10000;background:white;color:black;border:2px solid #333;padding:10px;border-radius:8px;';
    textArea.readOnly = true;
    document.body.appendChild(textArea);
    textArea.select();
    
    window.toast && window.toast('제목을 선택했습니다. Ctrl+C를 눌러 복사하세요.', 'info');
    
    // 5초 후 자동 제거
    setTimeout(() => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    }, 5000);
    
    // 클릭하면 제거
    textArea.addEventListener('click', () => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    });
  }
}

// 썸네일 복사 함수 (개선된 버전)
async function copyThumbnail(videoId, title) {
  if (!videoId) {
    window.toast && window.toast('복사할 썸네일이 없습니다.', 'warning');
    return;
  }
  
  // 진행상황 토스트 표시
  const loadingToast = window.toast && window.toast('썸네일을 불러오는 중...', 'info');
  
  try {
    // 여러 해상도 시도 (높은 품질부터)
    const thumbnailUrls = [
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/default.jpg`
    ];
    
    let thumbnailBlob = null;
    let usedUrl = '';
    
    // 사용 가능한 썸네일 찾기
    for (const url of thumbnailUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          thumbnailBlob = await response.blob();
          usedUrl = url;
          console.log('썸네일 로드 성공:', url);
          break;
        }
      } catch (e) {
        console.warn('썸네일 로드 실패:', url, e);
        continue;
      }
    }
    
    if (!thumbnailBlob) {
      throw new Error('썸네일을 찾을 수 없습니다.');
    }
    
    // 클립보드 API 지원 여부 확인
    if (!navigator.clipboard || !ClipboardItem) {
      throw new Error('이 브라우저는 이미지 클립보드 복사를 지원하지 않습니다.');
    }
    
    // 이미지 클립보드 복사 시도
    const result = await copyImageToClipboard(thumbnailBlob);
    
    if (result.success) {
      let message = '썸네일을 클립보드에 복사했습니다!';
      if (result.method === 'clipboard-png') {
        message += '\n(JPEG → PNG 변환됨)';
      }
      message += '\n\nCtrl+V로 다른 곳에 붙여넣기 할 수 있습니다.';
      
      window.toast && window.toast(message, 'success');
    } else {
      throw new Error(result.error || '클립보드 복사에 실패했습니다.');
    }
    
  } catch (error) {
    console.error('썸네일 복사 실패:', error);
    
    // 대체 방법: 썸네일 URL을 텍스트로 복사
    try {
      const highestQualityUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
      await navigator.clipboard.writeText(highestQualityUrl);
      
      window.toast && window.toast(
        '이미지 복사는 실패했지만 썸네일 URL을 복사했습니다.\n' +
        '주소창에 붙여넣으면 이미지를 볼 수 있습니다.\n\n' +
        '또는 해당 URL에서 우클릭 → "이미지 복사"를 시도해보세요.',
        'info'
      );
    } catch (urlError) {
      window.toast && window.toast(
        `썸네일 복사 실패: ${error.message}\n\n` +
        '최신 Chrome, Firefox, Safari에서 시도해보세요.',
        'error'
      );
    }
  }
}

// URL 복사 함수 (새로 추가)
async function copyVideoUrl(videoId) {
  if (!videoId) {
    window.toast && window.toast('복사할 URL이 없습니다.', 'warning');
    return;
  }
  
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const result = await safeClipboardCopy(url);
  
  if (result.success) {
    const methodText = result.method === 'clipboard-api' ? '' : ' (호환 모드)';
    window.toast && window.toast(`영상 URL을 복사했습니다!${methodText}`, 'success');
  } else {
    // 수동 복사 안내
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:80%;height:100px;z-index:10000;background:white;color:black;border:2px solid #333;padding:10px;border-radius:8px;';
    textArea.readOnly = true;
    document.body.appendChild(textArea);
    textArea.select();
    
    window.toast && window.toast('URL을 선택했습니다. Ctrl+C를 눌러 복사하세요.', 'info');
    
    // 5초 후 자동 제거
    setTimeout(() => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    }, 5000);
    
    // 클릭하면 제거
    textArea.addEventListener('click', () => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    });
  }
}

// ============================================================================
// 데이터 다운로드 기능 (현재 페이지만)
// ============================================================================
function downloadCurrentPageData() {
  const tabName = window.mainState.currentTab;
  
  if (tabName === 'trends' || tabName === 'insights') {
    window.toast && window.toast('이 탭에서는 다운로드 기능을 지원하지 않습니다.', 'warning');
    return;
  }
  
  // 현재 화면에 표시중인 영상들만 가져오기
  const videos = tabName === 'latest' ? window.mainState.latestVideos : window.mainState.mutantVideos;
  const filteredVideos = filterVideosByDate(videos, window.mainState.currentPeriod);
  
  // 페이지네이션 적용
  const currentPage = window.mainState.currentPage[tabName];
  const startIndex = (currentPage - 1) * window.mainState.videosPerPage;
  const endIndex = startIndex + window.mainState.videosPerPage;
  const currentPageVideos = filteredVideos.slice(startIndex, endIndex);
  
  if (currentPageVideos.length === 0) {
    window.toast && window.toast('다운로드할 영상이 없습니다.', 'warning');
    return;
  }
  
  let content = '';
  
  // 현재 페이지 영상 데이터
  content += `=== ${tabName === 'latest' ? '최신영상' : '돌연변이 영상'} (${currentPage}페이지) ===\n`;
  currentPageVideos.forEach(video => {
    const title = video.snippet?.title || '제목 없음';
    const views = numberWithCommas(video.statistics?.viewCount || 0);
    const publishedAt = moment(video.snippet?.publishedAt).format('YYYY-MM-DD');
    content += `${title} | ${views} | ${publishedAt}\n`;
  });
  
  // 파일 다운로드
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tabName}_${currentPage}페이지_${moment().format('YYYY-MM-DD_HH-mm')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  window.toast && window.toast(`현재 페이지 영상 제목 목록을 다운로드했습니다. (${currentPageVideos.length}개)`, 'success');
}

// ============================================================================
// API 헬퍼
// ============================================================================
async function getChannelRecentLongformVideos(channel, perChannelMax = 10) {
  const uploadsId = channel.uploadsPlaylistId;
  if (!uploadsId) return [];

  const list = await window.yt('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsId,
    maxResults: Math.min(20, perChannelMax * 2)
  });

  const ids = (list.items || [])
    .map(i => i.contentDetails && i.contentDetails.videoId)
    .filter(Boolean)
    .slice(0, Math.max(1, perChannelMax * 2));

  if (!ids.length) return [];

  const details = await window.yt('videos', {
    part: 'snippet,contentDetails,statistics',
    id: ids.join(',')
  });

const longform = (details.items || []).filter(v => {
  const dur = moment.duration(v.contentDetails?.duration || 'PT0S').asSeconds();
  const views = parseInt(v.statistics?.viewCount || '0', 10);
  
  // 롱폼 조건만 체크, 조회수는 나중에 필터링
  return dur >= VIDEO_CONFIG.MIN_LONGFORM_DURATION && views >= 1000; // 최소 1천 조회수
});

  longform.forEach(v => {
    v.__channel = {
      id: channel.id,
      title: channel.title,
      thumbnail: channel.thumbnail,
      subscribers: parseInt(channel.subscriberCount || '0', 10)
    };
  });

  return longform;
}

// ============================================================================
// 진행률 표시 함수들 (상태바 복구)
// ============================================================================
function showProgressBar(message, current = 0, total = 0) {
  let progressEl = document.getElementById('video-progress-bar');
  
  if (!progressEl) {
    // 진행률 바 생성
    progressEl = document.createElement('div');
    progressEl.id = 'video-progress-bar';
    progressEl.className = 'progress-wrap';
    progressEl.innerHTML = `
      <div class="progress-head">
        <span class="progress-title" id="progress-title">${message}</span>
        <span class="progress-detail" id="progress-detail">준비 중...</span>
      </div>
      <div class="progress-outer">
        <div class="progress-bar" id="progress-bar-fill"></div>
      </div>
      <div class="progress-foot" id="progress-foot">0%</div>
    `;
    
    // 현재 탭의 리스트 요소 찾기
    const currentTab = window.mainState.currentTab;
    const listEl = document.getElementById(`${currentTab}-list`);
    if (listEl && listEl.parentNode) {
      listEl.parentNode.insertBefore(progressEl, listEl);
    }
  }
  
  // 진행률 업데이트
  updateProgressBar(message, current, total);
}

function updateProgressBar(message, current, total) {
  const titleEl = document.getElementById('progress-title');
  const detailEl = document.getElementById('progress-detail');
  const fillEl = document.getElementById('progress-bar-fill');
  const footEl = document.getElementById('progress-foot');
  
  if (titleEl) titleEl.textContent = message;
  
  if (total > 0) {
    const percentage = Math.round((current / total) * 100);
    if (detailEl) detailEl.textContent = `${current}/${total} 처리 중`;
    if (fillEl) fillEl.style.width = `${percentage}%`;
    if (footEl) footEl.textContent = `${percentage}%`;
  } else {
    if (detailEl) detailEl.textContent = '처리 중...';
    if (fillEl) fillEl.style.width = '0%';
    if (footEl) footEl.textContent = '0%';
  }
}

function hideProgressBar() {
  const progressEl = document.getElementById('video-progress-bar');
  if (progressEl) {
    progressEl.remove();
  }
}

// ============================================================================
// 데이터 로딩 함수 (진행률 표시 포함)
// ============================================================================
async function loadVideosData(tabName) {
  console.log('비디오 데이터 로딩:', tabName);
  
  if (!(window.hasKeys && window.hasKeys())) {
    window.toast && window.toast('먼저 API 키를 설정해주세요.', 'warning');
    return;
  }

  const channels = await window.getAllChannels();
  if (!channels || !channels.length) {
    window.toast && window.toast('채널을 먼저 추가해주세요.', 'warning');
    return;
  }

  // 진행률 표시 시작
  const loadingMessage = tabName === 'latest' ? '최신영상을 불러오는 중' : '돌연변이 영상을 불러오는 중';
  showProgressBar(loadingMessage, 0, channels.length);

  try {
    const perChannelMax = tabName === 'mutant' ? 8 : 6;
    const allVideos = [];
    let completedChannels = 0;

    for (const channel of channels) {
      try {
        // 진행률 업데이트
        updateProgressBar(loadingMessage, completedChannels, channels.length);
        
        const videos = await getChannelRecentLongformVideos(channel, perChannelMax);
        allVideos.push(...videos);
        
        completedChannels++;
        
        // 중간 진행률 업데이트
        updateProgressBar(loadingMessage, completedChannels, channels.length);
        
      } catch (e) {
        console.warn('채널 영상 조회 실패:', channel?.title, e);
        completedChannels++;
      }
    }

    // 돌연변이 지수 계산
    if (tabName === 'mutant') {
      allVideos.forEach(v => {
        const views = parseInt(v.statistics?.viewCount || '0', 10);
        const subs = v.__channel?.subscribers || 0;
        v.__mutant = ratioSafe(views, subs);
      });
    }

    // 정렬
    sortVideos(allVideos, window.mainState.currentSort, tabName);

    // 캐시에 저장
    if (tabName === 'latest') {
      window.mainState.latestVideos = allVideos;
      window.mainState.lastRefresh.latest = new Date();
    } else if (tabName === 'mutant') {
      window.mainState.mutantVideos = allVideos;
      window.mainState.lastRefresh.mutant = new Date();
    }

    // 진행률 완료
    updateProgressBar(`${loadingMessage} 완료`, channels.length, channels.length);
    
    // 잠시 후 진행률 바 숨기기
    setTimeout(hideProgressBar, 1000);

    window.toast && window.toast(`${tabName === 'latest' ? '최신' : '돌연변이'} 영상 ${allVideos.length}개를 불러왔습니다.`, 'success');

    // 즉시 화면에 표시
    displayVideos(tabName);

  } catch (e) {
    console.error('비디오 데이터 로딩 실패:', e);
    hideProgressBar();
    window.toast && window.toast('영상 데이터 로딩 중 오류가 발생했습니다.', 'error');
  }
}

function sortVideos(videos, sortType, tabName) {
  videos.sort((a, b) => {
    const av = parseInt(a.statistics?.viewCount || '0', 10);
    const bv = parseInt(b.statistics?.viewCount || '0', 10);
    const as = a.__channel?.subscribers || 0;
    const bs = b.__channel?.subscribers || 0;
    const ap = new Date(a.snippet?.publishedAt || 0).getTime();
    const bp = new Date(b.snippet?.publishedAt || 0).getTime();
    const aIdx = a.__mutant || ratioSafe(av, as);
    const bIdx = b.__mutant || ratioSafe(bv, bs);

    switch (sortType) {
      case 'subscribers': return bs - as;
      case 'latest': return bp - ap;
      case 'mutantIndex': return bIdx - aIdx;
      case 'views':
      default: return bv - av;
    }
  });
}

// ============================================================================
// UI 표시 함수 (메인 수정 부분)
// ============================================================================
function showLoadingUI(tabName) {
  const listEl = document.getElementById(`${tabName}-list`);
  if (!listEl) return;

  const loadingMessages = {
    latest: '최신영상을 불러오는 중...',
    mutant: '돌연변이 영상을 불러오는 중...',
    trends: '트렌드를 분석하는 중...',
    insights: '인사이트를 생성하는 중...'
  };

  listEl.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p class="muted">${loadingMessages[tabName] || '데이터를 불러오는 중...'}</p>
    </div>`;
}

function displayVideos(tabName) {
  console.log('displayVideos 호출됨:', tabName, {
    latest: window.mainState.latestVideos.length,
    mutant: window.mainState.mutantVideos.length
  });

  if (tabName === 'trends') {
    loadTrendsData();
    return;
  }
  
  if (tabName === 'insights') {
    loadInsightsData();
    return;
  }
  
  const videos = tabName === 'latest' ? window.mainState.latestVideos : window.mainState.mutantVideos;
  console.log('원본 비디오 데이터:', videos.length);

  if (!videos || videos.length === 0) {
    console.log('비디오 데이터가 없음');
    showEmptyState(tabName);
    return;
  }

  const filteredVideos = filterVideosByDate(videos, window.mainState.currentPeriod);
  console.log('필터된 비디오:', filteredVideos.length);
  
  // 페이지네이션 적용
  const currentPage = window.mainState.currentPage[tabName];
  const startIndex = (currentPage - 1) * window.mainState.videosPerPage;
  const endIndex = startIndex + window.mainState.videosPerPage;
  const paginatedVideos = filteredVideos.slice(startIndex, endIndex);
  console.log('페이지네이션된 비디오:', paginatedVideos.length);

  const listEl = document.getElementById(`${tabName}-list`);
  if (!listEl) {
    console.error(`${tabName}-list 요소를 찾을 수 없음`);
    return;
  }

  if (paginatedVideos.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${tabName === 'latest' ? '📱' : '🚀'}</div>
        <p class="muted">표시할 영상이 없습니다.</p>
      </div>`;
    return;
  }

  // 강제로 UI 업데이트
  listEl.innerHTML = '';
  console.log('비디오 카드 렌더링 시작');
  renderVideoCards(listEl, paginatedVideos, tabName);

  // 키워드 업데이트
  updateKeywords(filteredVideos, tabName);
  
  // 페이지네이션 업데이트
  updatePagination(tabName, filteredVideos.length);
  
  console.log('displayVideos 완료');
}

function showEmptyState(tabName) {
  const listEl = document.getElementById(`${tabName}-list`);
  if (!listEl) return;

  const emptyMessages = {
    latest: '📱 최신영상',
    mutant: '🚀 돌연변이 영상',
    trends: '📊 트렌드 분석',
    insights: '💡 인사이트'
  };

  listEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${emptyMessages[tabName]?.split(' ')[0] || '📊'}</div>
      <p class="muted">"다시불러오기" 버튼을 클릭하여 ${emptyMessages[tabName]?.split(' ')[1] || '데이터'}를 불러오세요.</p>
    </div>`;
}

// ============================================================================
// 개선된 비디오 카드 렌더링 (고유 ID 사용) - URL 복사 버튼 추가
// ============================================================================
// 전체 정보 복사 함수 (새로 추가)
async function copyFullVideoInfo(video) {
  if (!video) {
    window.toast && window.toast('복사할 영상 정보가 없습니다.', 'warning');
    return;
  }
  
  const ch = video.__channel || {};
  const title = video.snippet?.title || '(제목 없음)';
  const videoId = video.id || video.contentDetails?.videoId || '';
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const subscribers = numberWithCommas(ch.subscribers || 0);
  const views = numberWithCommas(video.statistics?.viewCount || 0);
  const uploadDate = moment(video.snippet?.publishedAt).format('YYYY-MM-DD');
  
  // 정리된 형태로 텍스트 구성
  const fullInfo = `📺 제목: ${title}
🔗 URL: ${url}
👥 구독자: ${subscribers}명
👀 조회수: ${views}회
📅 업로드: ${uploadDate}`;
  
  const result = await safeClipboardCopy(fullInfo);
  
  if (result.success) {
    const methodText = result.method === 'clipboard-api' ? '' : ' (호환 모드)';
    window.toast && window.toast(`영상 정보를 복사했습니다!${methodText}`, 'success');
  } else {
    // 수동 복사 안내
    const textArea = document.createElement('textarea');
    textArea.value = fullInfo;
    textArea.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:80%;height:300px;z-index:10000;background:white;color:black;border:2px solid #333;padding:10px;border-radius:8px;font-family:monospace;font-size:12px;';
    textArea.readOnly = true;
    document.body.appendChild(textArea);
    textArea.select();
    
    window.toast && window.toast('영상 정보를 선택했습니다. Ctrl+C를 눌러 복사하세요.', 'info');
    
    // 5초 후 자동 제거
    setTimeout(() => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    }, 5000);
    
    // 클릭하면 제거
    textArea.addEventListener('click', () => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    });
  }
}

// renderVideoCards 함수에서 HTML 부분 수정 - 기존 action-left 부분을 다음으로 교체
function renderVideoCards(container, videos, tabName) {
  console.log('renderVideoCards 시작:', videos.length, '개 비디오');
  
  if (!container || !videos || videos.length === 0) {
    console.log('렌더링 조건 불충족');
    return;
  }

  const cardsHTML = videos.map((v, index) => {
    const ch = v.__channel || {};
    const title = v.snippet?.title || '(제목 없음)';
    const videoId = v.id || v.contentDetails?.videoId || '';
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const thumb =
      v.snippet?.thumbnails?.maxres?.url ||
      v.snippet?.thumbnails?.standard?.url ||
      v.snippet?.thumbnails?.high?.url ||
      v.snippet?.thumbnails?.medium?.url ||
      v.snippet?.thumbnails?.default?.url || '';
    const chThumb = ch.thumbnail || 'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj';
    const views = numberWithCommas(v.statistics?.viewCount);
    const published = moment(v.snippet?.publishedAt).format('YYYY-MM-DD');
    const mutIdx = v.__mutant != null ? v.__mutant.toFixed(2) : ratioSafe(v.statistics?.viewCount, ch.subscribers).toFixed(2);
    
    // 작업 완료 상태 확인
    const isCompleted = window.mainState.completedVideos[videoId];
    const completedClass = isCompleted ? 'completed' : '';
    const completedInfo = isCompleted ? window.mainState.completedVideos[videoId] : null;
    
    // 고유 ID 생성 (카드별 중복 방지)
    const uniqueId = `${tabName}-${videoId}-${index}`;
    const thumbBtnId = `thumb-btn-${uniqueId}`;
    const infoBtnId = `info-btn-${uniqueId}`;
    const completeBtnId = `complete-btn-${uniqueId}`;
    
    // 작업완료 버튼 텍스트 (날짜 포함)
    let completedText = '작업완료';
    if (isCompleted && completedInfo) {
      const completedDate = moment(completedInfo.completedAt).format('MM/DD');
      completedText = `완료 (${completedDate})`;
    }

    return `
      <div class="video-card ${completedClass}">
        <a class="video-link" href="${url}" target="_blank" rel="noopener">
          <div class="thumb-wrap">
            <img class="thumb" src="${thumb}" alt="${title}"
                 onerror="this.src='https://i.ytimg.com/vi/${videoId}/hqdefault.jpg'">
            ${isCompleted ? '<div class="completed-badge">✓ 완료</div>' : ''}
          </div>
          <div class="video-body">
            <div class="title">${title}</div>

            <div class="meta">
              <img src="${chThumb}" alt="${ch.title || 'channel'}"
                   onerror="this.src='https://yt3.ggpht.com/a/default-user=s48-c-k-c0x00ffffff-no-rj'">
              <span>${ch.title || '-'}</span>
            </div>

            <div class="v-meta">
              <div class="v-meta-top">
                <span>조회수 ${views}</span>
                <span class="upload-date">${published}</span>
                ${tabName === 'mutant' ? `<span class="mutant-indicator">지수 ${mutIdx}</span>` : ''}
              </div>
            </div>
          </div>
        </a>
        <div class="video-actions">
          <div class="action-left">
            <button id="${thumbBtnId}" class="btn btn-sm btn-thumbnail" 
                    title="썸네일 복사">
              📷 썸네일
            </button>
            <button id="${infoBtnId}" class="btn btn-sm btn-info" 
                    title="영상 정보 복사 (제목, URL, 채널, 구독자, 조회수, 업로드날짜)">
              📋 정보
            </button>
          </div>
          <button id="${completeBtnId}" class="btn btn-sm ${isCompleted ? 'btn-success' : 'btn-secondary'}" 
                  title="${isCompleted ? `작업완료: ${completedInfo?.date || ''}` : '작업완료 표시'}">
            ${completedText}
          </button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = cardsHTML;
  console.log('HTML 삽입 완료');

  // 이벤트 바인딩 (고유 ID로 정확한 버튼 찾기)
  videos.forEach((v, index) => {
    const videoId = v.id || v.contentDetails?.videoId || '';
    const uniqueId = `${tabName}-${videoId}-${index}`;
    
    // 썸네일 복사 버튼
    const thumbBtn = document.getElementById(`thumb-btn-${uniqueId}`);
    if (thumbBtn) {
      thumbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        copyThumbnail(videoId, v.snippet?.title);
      });
    }
    
    // 정보 복사 버튼 (기존 제목/URL 버튼을 대체)
    const infoBtn = document.getElementById(`info-btn-${uniqueId}`);
    if (infoBtn) {
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        copyFullVideoInfo(v);
      });
    }
    
    // 작업완료 버튼
    const completeBtn = document.getElementById(`complete-btn-${uniqueId}`);
    if (completeBtn) {
      completeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleVideoCompleted(videoId);
      });
    }
  });
  
  console.log('이벤트 바인딩 완료');
}

// 전역 함수로 내보내기
window.copyFullVideoInfo = copyFullVideoInfo;

function updateKeywords(videos, tabName) {
  const kwBox = document.getElementById(`${tabName}-keywords`);
  if (!kwBox) return;

  const allTitles = videos.map(v => v.snippet?.title || '').join(' ');
  const keywordsWithCount = extractKeywordsWithCount(allTitles);
  
  if (keywordsWithCount.length === 0) {
    kwBox.innerHTML = '<span class="kw">키워드 없음</span>';
    return;
  }

  // 상위 키워드들을 크기별로 표시
  const maxCount = keywordsWithCount[0][1];
  const html = keywordsWithCount.map(([word, count]) => {
    const percentage = (count / maxCount) * 100;
    const fontSize = Math.max(11, Math.min(16, 11 + (percentage / 100) * 5));
    const opacity = Math.max(0.7, percentage / 100);
    
    return `<span class="kw" style="font-size: ${fontSize}px; opacity: ${opacity};" onclick="copyTitle('${word}')" title="클릭하여 복사">
      ${word} <small>(${count})</small>
    </span>`;
  }).join('');
  
  kwBox.innerHTML = html;
}

function updatePagination(tabName, totalVideos) {
  const paginationEl = document.getElementById(`${tabName}-pagination`);
  if (!paginationEl) return;

  const totalPages = Math.ceil(totalVideos / window.mainState.videosPerPage);
  const currentPage = window.mainState.currentPage[tabName];

  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  let html = '';
  
  // 이전 페이지
  if (currentPage > 1) {
    html += `<button class="btn btn-secondary" onclick="changePage('${tabName}', ${currentPage - 1})">‹ 이전</button>`;
  }
  
  // 페이지 번호들
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);
  
  for (let i = startPage; i <= endPage; i++) {
    const activeClass = i === currentPage ? 'active' : '';
    html += `<button class="btn btn-secondary ${activeClass}" onclick="changePage('${tabName}', ${i})">${i}</button>`;
  }
  
  // 다음 페이지
  if (currentPage < totalPages) {
    html += `<button class="btn btn-secondary" onclick="changePage('${tabName}', ${currentPage + 1})">다음 ›</button>`;
  }

  paginationEl.innerHTML = html;
}

// ============================================================================
// 이벤트 핸들러
// ============================================================================
function changePage(tabName, page) {
  window.mainState.currentPage[tabName] = page;
  displayVideos(tabName);
}

function refreshCurrentTab() {
  displayVideos(window.mainState.currentTab);
}

function refreshTabData(tabName) {
  if (tabName === 'trends') {
    loadTrendsData();
  } else if (tabName === 'insights') {
    loadInsightsData();
  } else {
    loadVideosData(tabName);
  }
}

// ============================================================================
// 탭 초기화 (강화된 버전)
// ============================================================================
function initializeVideoTabs() {
  console.log('비디오 탭 초기화 시작');
  
  const tabButtons = document.querySelectorAll('.video-tab');
  const tabContents = document.querySelectorAll('.video-tab-content');

  // 모든 탭 콘텐츠 숨기기
  tabContents.forEach(c => (c.style.display = 'none'));
  
  // 최신영상 탭을 기본으로 표시
  const latestContent = document.getElementById('video-tab-latest');
  if (latestContent) {
    latestContent.style.display = 'block';
    latestContent.classList.add('active');
  }

  // 최신 탭 버튼 활성화
  const latestBtn = document.querySelector('[data-video-tab="latest"]');
  if (latestBtn) {
    latestBtn.classList.add('active');
  }

  tabButtons.forEach(btn => {
    if (btn.dataset.tabBound === '1') return;
    btn.dataset.tabBound = '1';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = btn.dataset.videoTab;
      
      console.log('탭 클릭됨:', tab);
      
      window.mainState.currentTab = tab;

      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      tabContents.forEach(c => { 
        c.style.display = 'none'; 
        c.classList.remove('active'); 
      });
      
      const target = document.getElementById(`video-tab-${tab}`);
      if (target) { 
        target.style.display = 'block'; 
        target.classList.add('active'); 
      }

      updateSortOptions(tab);
      
      // 캐시된 데이터가 있으면 바로 표시, 없으면 빈 상태 표시
      const hasCache = getTabCache(tab);
      
      if (hasCache) {
        console.log('캐시된 데이터로 표시');
        displayVideos(tab);
      } else {
        console.log('빈 상태 표시');
        showEmptyState(tab);
      }
    });
  });
  
  console.log('비디오 탭 초기화 완료');
}

function getTabCache(tab) {
  switch (tab) {
    case 'latest': return window.mainState.latestVideos.length > 0;
    case 'mutant': return window.mainState.mutantVideos.length > 0;
    case 'trends': return window.mainState.lastRefresh.trends !== null;
    case 'insights': return window.mainState.lastRefresh.insights !== null;
    default: return false;
  }
}

function updateSortOptions(tabName) {
  const sortSelect = document.getElementById('sort-videos');
  if (!sortSelect) return;
  sortSelect.value = (tabName === 'mutant') ? 'mutantIndex' : 'views';
  window.mainState.currentSort = sortSelect.value;
}

function initializePeriodButtons() {
  // 기간 버튼 이벤트 바인딩
  const periodButtons = document.querySelectorAll('.period-btn');
  periodButtons.forEach(btn => {
    if (btn.dataset.periodBound === '1') return;
    btn.dataset.periodBound = '1';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const p = btn.dataset.period;
      window.mainState.currentPeriod = p;
      periodButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshCurrentTab();
    });
  });

// 조회수 기준 버튼 이벤트 바인딩 (새로 추가)
  const viewsButtons = document.querySelectorAll('.views-btn');
  viewsButtons.forEach(btn => {
    if (btn.dataset.viewsBound === '1') return;
    btn.dataset.viewsBound = '1';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const minViews = parseInt(btn.dataset.views, 10);
      
      // 조회수 기준 변경
      VIDEO_CONFIG.MIN_VIEWS = minViews;
      
      // 버튼 활성화 상태 변경
      viewsButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // 캐시된 데이터 다시 필터링 (새로 로드하지 않고)
// 캐시된 데이터에서 다시 필터링 (빠른 처리)
const currentTab = window.mainState.currentTab;
displayVideos(currentTab);
      
      // 토스트 메시지 표시
      window.toast && window.toast(`조회수 기준이 ${(minViews/10000)}만으로 변경되었습니다.`, 'success');
    });
  });
}

function initializeSortFilter() {
  const sortSelect = document.getElementById('sort-videos');
  if (!sortSelect || sortSelect.dataset.sortBound === '1') return;
  sortSelect.dataset.sortBound = '1';

  sortSelect.addEventListener('change', (e) => {
    window.mainState.currentSort = e.target.value;
    
    // 현재 탭의 비디오를 다시 정렬
    const tabName = window.mainState.currentTab;
    const videos = tabName === 'latest' ? window.mainState.latestVideos : window.mainState.mutantVideos;
    sortVideos(videos, e.target.value, tabName);
    
    refreshCurrentTab();
  });
}

// ============================================================================
// 새로고침 버튼 초기화 (위치 변경됨)
// ============================================================================
function initializeVideoButtons() {
  // 다시불러오기 버튼 (헤더에 이미 있음)
  const refreshBtn = document.getElementById('btn-refresh-videos');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.onclick = () => {
      console.log('새로고침 버튼 클릭:', window.mainState.currentTab);
      refreshTabData(window.mainState.currentTab);
    };
  }

  // 현재 페이지 다운로드 버튼 (헤더에 이미 있음)
  const downloadBtn = document.getElementById('btn-download-current');
  if (downloadBtn && !downloadBtn.dataset.bound) {
    downloadBtn.dataset.bound = '1';
    downloadBtn.onclick = downloadCurrentPageData;
  }
}

// ============================================================================
// 트렌드/인사이트 임시 함수들 (간단 구현)
// ============================================================================
async function loadTrendsData() {
  console.log('트렌드 분석 데이터 로딩');
  
  const listEl = document.getElementById('trends-list');
  if (listEl) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <p class="muted">트렌드 분석 기능은 준비 중입니다.</p>
      </div>`;
  }
}

async function loadInsightsData() {
  console.log('인사이트 데이터 로딩');
  
  const listEl = document.getElementById('insights-list');
  if (listEl) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💡</div>
        <p class="muted">인사이트 기능은 준비 중입니다.</p>
      </div>`;
  }
}

// ============================================================================
// 섹션 초기화 & 외부 래퍼
// ============================================================================
function initializeVideosSection() {
  console.log('영상분석 섹션 초기화 (화면 표시 문제 해결)');
  
  // 캐시 확인 및 즉시 표시
  const hasLatestCache = window.mainState.latestVideos.length > 0;
  const hasMutantCache = window.mainState.mutantVideos.length > 0;
  
  console.log('캐시 상태:', { latest: hasLatestCache, mutant: hasMutantCache });
  
  initializeVideoTabs();
  initializePeriodButtons();
  initializeSortFilter();
  initializeVideoButtons();
  
  // 캐시가 있으면 바로 표시
  if (hasLatestCache) {
    console.log('최신영상 캐시 데이터로 즉시 표시');
    displayVideos('latest');
  } else {
    console.log('최신영상 빈 상태 표시');
    showEmptyState('latest');
  }
  
  console.log('영상분석 섹션 초기화 완료');
}

// 외부에서 호출 가능한 함수들
window.refreshVideos = refreshCurrentTab;
window.toggleVideoCompleted = toggleVideoCompleted;
window.copyThumbnail = copyThumbnail;
window.copyTitle = copyTitle;
window.copyVideoUrl = copyVideoUrl;
window.changePage = changePage;
window.refreshTabData = refreshTabData;
window.downloadCurrentPageData = downloadCurrentPageData;
window.displayVideos = displayVideos;
window.loadVideosData = loadVideosData;

// 전역 공개
window.initializeVideosSection = initializeVideosSection;

// CSS 스타일 추가
const style = document.createElement('style');
style.textContent = `
  .video-card.completed {
    opacity: 0.7;
    border-color: #16a34a;
  }
  
  .completed-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #16a34a;
    color: white;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
  }
  
  .video-actions {
    padding: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  
  .action-left {
    display: flex;
    gap: 6px;
  }
  
  .btn-sm {
    padding: 6px 12px;
    font-size: 12px;
  }
  
  .btn-success {
    background: #16a34a;
    color: white;
    border-color: #16a34a;
  }
  
  .btn-thumbnail {
    background: #667eea;
    color: white;
    border-color: #667eea;
    flex-shrink: 0;
  }
  
  .btn-thumbnail:hover {
    background: #5a67d8;
    border-color: #5a67d8;
  }
  
  .btn-title {
    background: #38b2ac;
    color: white;
    border-color: #38b2ac;
    flex-shrink: 0;
  }
  
  .btn-title:hover {
    background: #319795;
    border-color: #319795;
  }
  
  .btn-url {
    background: #9f7aea;
    color: white;
    border-color: #9f7aea;
    flex-shrink: 0;
  }
  
  .btn-url:hover {
    background: #805ad5;
    border-color: #805ad5;
  }
  
  .loading-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  
  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top: 3px solid var(--brand);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 16px;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .video-actions-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .kw {
    transition: all 0.3s ease;
    cursor: pointer;
  }
  
  .kw:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(196, 48, 43, 0.2);
  }
  
  .kw small {
    opacity: 0.8;
    font-weight: 600;
  }
  
  .pagination {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 20px;
    flex-wrap: wrap;
  }
  
  .pagination .btn {
    min-width: 40px;
  }
  
  .pagination .btn.active {
    background: var(--brand);
    color: white;
    border-color: var(--brand);
  }
  
  /* 키워드 영역 가변 높이 - 스크롤바 제거 */
  .keywords {
    margin-bottom: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px;
    border: 2px solid var(--border);
    border-radius: 8px;
    background: var(--glass-bg);
    min-height: 60px;
    max-height: none !important;
    overflow: visible !important;
  }
  
  /* 반응형 */
  @media (max-width: 768px) {
    .action-left {
      flex-wrap: wrap;
      gap: 4px;
    }
    
    .video-actions {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    
    .video-actions-group {
      flex-wrap: wrap;
      justify-content: center;
    }
  }
`;

document.head.appendChild(style);

// 전체 정보 복사 함수 (새로 추가)
async function copyFullVideoInfo(video) {
  if (!video) {
    window.toast && window.toast('복사할 영상 정보가 없습니다.', 'warning');
    return;
  }
  
  const ch = video.__channel || {};
  const title = video.snippet?.title || '(제목 없음)';
  const videoId = video.id || video.contentDetails?.videoId || '';
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const channelName = ch.title || '(채널명 없음)';
  const subscribers = numberWithCommas(ch.subscribers || 0);
  const views = numberWithCommas(video.statistics?.viewCount || 0);
  const uploadDate = moment(video.snippet?.publishedAt).format('YYYY-MM-DD');
  
  // 정리된 형태로 텍스트 구성
  const fullInfo = `📺 제목: ${title}
🔗 URL: ${url}
👤 채널: ${channelName}
👥 구독자: ${subscribers}명
👀 조회수: ${views}회
📅 업로드: ${uploadDate}`;
  
  const result = await safeClipboardCopy(fullInfo);
  
  if (result.success) {
    const methodText = result.method === 'clipboard-api' ? '' : ' (호환 모드)';
    window.toast && window.toast(`영상 정보를 복사했습니다!${methodText}`, 'success');
  } else {
    // 수동 복사 안내
    const textArea = document.createElement('textarea');
    textArea.value = fullInfo;
    textArea.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:80%;height:300px;z-index:10000;background:white;color:black;border:2px solid #333;padding:10px;border-radius:8px;font-family:monospace;font-size:12px;';
    textArea.readOnly = true;
    document.body.appendChild(textArea);
    textArea.select();
    
    window.toast && window.toast('영상 정보를 선택했습니다. Ctrl+C를 눌러 복사하세요.', 'info');
    
    // 5초 후 자동 제거
    setTimeout(() => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    }, 5000);
    
    // 클릭하면 제거
    textArea.addEventListener('click', () => {
      if (textArea.parentNode) {
        document.body.removeChild(textArea);
      }
    });
  }
}


console.log('videos.js 로딩 완료 (화면 표시 문제 해결)');

