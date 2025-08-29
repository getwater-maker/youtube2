// YouTube 채널 모니터 - 메인 섹션 및 채널 분석 관리
console.log('main-monitor.js 로딩 시작');

// ============================================================================
// 분석 상태 관리 추가
// ============================================================================
window.analysisState = {
  isActive: false,
  previousSection: 'channels'
};

// ============================================================================
// 완전한 채널 분석 시스템
// ============================================================================

async function openAnalyzeModal() {
  console.log('openAnalyzeModal 시작');
  
  if (!hasKeys()) { 
    toast('먼저 API 키를 설정해주세요.'); 
    return; 
  }
  
  if (typeof openModal === 'function') {
    openModal('modal-analyze');
  } else {
    console.error('openModal 함수를 찾을 수 없습니다.');
    return;
  }
  
  const list = await getAllChannels();
  
  const wrapSelectors = ['#analyze-channel-list', 'analyze-channel-list', '[id="analyze-channel-list"]'];
  let wrap = null;
  
  for (const selector of wrapSelectors) {
    try {
      if (selector.startsWith('#')) {
        wrap = document.getElementById(selector.slice(1));
      } else {
        wrap = document.querySelector(selector) || document.getElementById(selector);
      }
      if (wrap) break;
    } catch (e) {
      console.warn(`분석 채널 리스트 요소 접근 실패: ${selector}`, e);
    }
  }
  
  if (!wrap) {
    console.error('analyze-channel-list 요소를 찾을 수 없습니다.');
    toast('분석 모달을 열 수 없습니다. 페이지를 새로고침해주세요.');
    return;
  }
  
  if (list.length === 0) { 
    wrap.innerHTML = '<p class="muted">등록된 채널이 없습니다.</p>'; 
    return; 
  }
  
  wrap.innerHTML = '';
  list.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'result-row';
    el.innerHTML = `
      <img class="r-avatar" src="${ch.thumbnail}" alt="${ch.title}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover;">
      <div style="flex: 1; margin: 0 16px;">
        <div class="r-title" style="font-weight: 700; margin-bottom: 4px;">${ch.title}</div>
        <div class="r-sub" style="font-size: 14px; color: #6c757d;">구독자: ${fmt(ch.subscriberCount)}</div>
      </div>
      <button class="btn btn-primary" data-analyze-ch="${ch.id}">분석</button>`;
    
    el.style.cssText = `
      display: flex;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid #dee2e6;
      cursor: pointer;
      transition: background 0.3s;
    `;
    
    el.onmouseenter = () => el.style.background = '#f8f9fa';
    el.onmouseleave = () => el.style.background = '';
    
    el.onclick = () => {
      startCompleteAnalysis(ch.id);
      if (typeof closeModal === 'function') {
        closeModal('modal-analyze');
      }
    };
    
    const button = el.querySelector('button');
    if (button) {
      button.onclick = (e) => {
        e.stopPropagation();
        startCompleteAnalysis(ch.id);
        if (typeof closeModal === 'function') {
          closeModal('modal-analyze');
        }
      };
    }
    
    wrap.appendChild(el);
  });
  
  console.log('openAnalyzeModal 완료, 채널 수:', list.length);
}

async function startCompleteAnalysis(channelId) {
  console.log('startCompleteAnalysis 시작:', channelId);
  
  const container = document.body.querySelector('.container') || document.body;
  const mainContent = document.getElementById('main-content') || document.querySelector('#main-content');
  
  // 현재 섹션 저장
  window.analysisState.previousSection = window.navigationState?.currentSection || 'channels';
  window.analysisState.isActive = true;
  
  if (mainContent) {
    mainContent.style.display = 'none';
  }
  
  const existingAnalysis = document.getElementById('analysis-section') || document.querySelector('#analysis-section');
  if (existingAnalysis) {
    existingAnalysis.remove();
  }
  
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'analysis-section';
  loadingDiv.className = 'analysis-page';
  loadingDiv.innerHTML = `
    <div class="loading-text" style="text-align: center; padding: 60px 20px;">
      <div class="loading" style="
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #c4302b;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      "></div>
      <span style="font-size: 18px; color: #6c757d;">채널 데이터를 심층 분석 중입니다. 잠시만 기다려주세요...</span>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </div>`;
  
  container.appendChild(loadingDiv);
  
  if (window.state) {
    window.state.currentView = 'analysis';
  }
  
  // 네비게이션 시스템에 분석 모드임을 알림
  if (window.navigationState) {
    window.navigationState.currentSection = 'analysis';
  }
  
  try {
    const ch = await idbGet('my_channels', channelId);
    if (!ch) throw new Error('채널을 찾을 수 없습니다.');
    
    console.log('채널 분석 시작:', ch.title);
    
    const analysisData = await performCompleteAnalysis(ch);
    renderCompleteAnalysisResult(ch, analysisData);
    
  } catch (e) {
    console.error('채널 분석 오류:', e);
    
    const analysisSection = document.getElementById('analysis-section');
    if (analysisSection) {
      analysisSection.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <button id="btn-back-home" class="btn btn-secondary" style="margin-bottom: 20px;">← 메인으로 돌아가기</button>
          <div class="error-message" style="
            color: #c4302b;
            font-size: 18px;
            font-weight: 600;
            background: rgba(196, 48, 43, 0.1);
            padding: 20px;
            border-radius: 12px;
            border: 1px solid rgba(196, 48, 43, 0.3);
          ">
            채널 분석 중 오류가 발생했습니다: ${e.message}
          </div>
        </div>`;
      
      // 뒤로가기 버튼 이벤트 바인딩
      const backBtn = document.getElementById('btn-back-home');
      if (backBtn) {
        backBtn.onclick = returnToMainView;
      }
    }
  }
}

// 메인 화면으로 돌아가기 함수 (개선됨)
function returnToMainView() {
  console.log('메인 화면으로 돌아가기');
  
  // 분석 상태 해제
  window.analysisState.isActive = false;
  
  // 분석 섹션 제거
  const analysisSection = document.getElementById('analysis-section');
  if (analysisSection) {
    analysisSection.remove();
  }
  
  // 메인 콘텐츠 표시
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.style.display = '';
  }
  
  // 상태 업데이트
  if (window.state) {
    window.state.currentView = 'home';
  }
  
  // 이전 섹션으로 복귀
  const targetSection = window.analysisState.previousSection || 'channels';
  
  if (typeof window.showSection === 'function') {
    window.showSection(targetSection);
  } else {
    // 대체 방법: 직접 섹션 표시/숨김 처리
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
      section.style.display = 'none';
    });
    
    const targetSectionEl = document.getElementById(`section-${targetSection}`);
    if (targetSectionEl) {
      targetSectionEl.style.display = 'block';
    }
    
    // 네비게이션 버튼 상태 업데이트
    const navButtons = document.querySelectorAll('.nav-section');
    navButtons.forEach(btn => btn.classList.remove('active'));
    
    const targetBtn = document.getElementById(`btn-${targetSection}`);
    if (targetBtn) {
      targetBtn.classList.add('active');
    }
  }
  
  console.log('메인 화면 복귀 완료');
}

async function performCompleteAnalysis(channel) {
  console.log('performCompleteAnalysis 시작:', channel.title);
  
  const subscriberCount = parseInt(channel.subscriberCount || '1');
  
  // 1. 최근 영상 데이터 수집 (최대 200개)
  const videos = await getLongformVideos(channel.uploadsPlaylistId, 200);
  
  // 2. 기본 통계 계산
  const totalViews = videos.reduce((sum, v) => sum + parseInt(v.statistics.viewCount || 0), 0);
  const avgViews = totalViews / videos.length || 0;
  const avgDuration = videos.reduce((sum, v) => sum + (moment.duration(v.contentDetails.duration).asSeconds() || 0), 0) / videos.length || 0;
  const totalLikes = videos.reduce((sum, v) => sum + parseInt(v.statistics.likeCount || 0), 0);
  const totalComments = videos.reduce((sum, v) => sum + parseInt(v.statistics.commentCount || 0), 0);
  
  // 3. 참여도 분석
  const engagementRate = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100) : 0;
  const avgLikeRate = videos.length > 0 ? (totalLikes / videos.length) : 0;
  const avgCommentRate = videos.length > 0 ? (totalComments / videos.length) : 0;
  
  // 4. 상위 성과 영상
  const topVideos = [...videos]
    .sort((a, b) => parseInt(b.statistics.viewCount) - parseInt(a.statistics.viewCount))
    .slice(0, 10);
  
  // 5. 돌연변이 영상 (구독자 대비 높은 조회수)
  const mutantVideos = videos.filter(v => {
    const views = parseInt(v.statistics.viewCount || 0);
    return views >= (subscriberCount * CONFIG.MUTANT_THRESHOLD);
  }).sort((a, b) => parseInt(b.statistics.viewCount) - parseInt(a.statistics.viewCount));
  
  // 6. 업로드 패턴 분석
  const weeklyUploads = new Array(7).fill(0);
  const hourlyUploads = new Array(24).fill(0);
  const monthlyUploads = new Array(12).fill(0);
  
  videos.forEach(v => {
    const publishedMoment = moment(v.snippet.publishedAt);
    weeklyUploads[publishedMoment.day()]++;
    hourlyUploads[publishedMoment.hour()]++;
    monthlyUploads[publishedMoment.month()]++;
  });
  
  // 7. 업로드 빈도 계산
  const oldestVideo = videos[videos.length - 1];
  const newestVideo = videos[0];
  const daysBetween = oldestVideo && newestVideo ? 
    moment(newestVideo.snippet.publishedAt).diff(moment(oldestVideo.snippet.publishedAt), 'days') : 0;
  const uploadFrequency = daysBetween > 0 ? (videos.length / daysBetween * 7).toFixed(1) : 0;
  
  // 8. 카테고리 분석
  const categories = {};
  videos.forEach(v => {
    const cat = getCategoryName(v.snippet.categoryId);
    categories[cat] = (categories[cat] || 0) + 1;
  });
  
  // 9. 키워드 분석
  const allTitles = videos.map(v => v.snippet.title).join(' ');
  const keywords = extractKeywords(allTitles).slice(0, 30);
  
  // 10. 성장 트렌드 분석
  const recentVideos = videos.slice(0, 20);
  const olderVideos = videos.slice(-20);
  const recentAvgViews = recentVideos.reduce((sum, v) => sum + parseInt(v.statistics.viewCount || 0), 0) / recentVideos.length || 0;
  const olderAvgViews = olderVideos.reduce((sum, v) => sum + parseInt(v.statistics.viewCount || 0), 0) / olderVideos.length || 0;
  const viewsGrowthRate = olderAvgViews > 0 ? ((recentAvgViews - olderAvgViews) / olderAvgViews * 100) : 0;
  
  // 11. 최적 업로드 시간 분석
  const bestDay = weeklyUploads.indexOf(Math.max(...weeklyUploads));
  const bestHour = hourlyUploads.indexOf(Math.max(...hourlyUploads));
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  
  // 12. 길이별 성과 분석
  const shortVideos = videos.filter(v => moment.duration(v.contentDetails.duration).asSeconds() < 600);
  const longVideos = videos.filter(v => moment.duration(v.contentDetails.duration).asSeconds() >= 600);
  const avgShortViews = shortVideos.length > 0 ? 
    shortVideos.reduce((sum, v) => sum + parseInt(v.statistics.viewCount || 0), 0) / shortVideos.length : 0;
  const avgLongViews = longVideos.length > 0 ? 
    longVideos.reduce((sum, v) => sum + parseInt(v.statistics.viewCount || 0), 0) / longVideos.length : 0;
  
  // 13. 일관성 지표
  const nonZeroUploads = weeklyUploads.filter(x => x > 0);
  const uploadConsistency = nonZeroUploads.length > 0 ? 
    (Math.max(...weeklyUploads) / Math.min(...nonZeroUploads)).toFixed(1) : '1.0';
  
  console.log('분석 완료:', {
    totalVideos: videos.length,
    avgViews: Math.round(avgViews),
    mutantVideos: mutantVideos.length
  });
  
  return {
    totalViews,
    avgViews,
    avgDuration,
    totalVideos: videos.length,
    engagementRate,
    viewsGrowthRate,
    avgLikeRate,
    avgCommentRate,
    uploadFrequency,
    topVideos,
    mutantVideos,
    recentVideos: videos.slice(0, 10),
    shortVideos,
    longVideos,
    avgShortViews,
    avgLongViews,
    weeklyUploads,
    hourlyUploads,
    monthlyUploads,
    bestUploadTime: `${dayNames[bestDay]} ${bestHour}시`,
    keywords,
    categories,
    topPerformingDay: dayNames[bestDay],
    uploadConsistency
  };
}

async function renderCompleteAnalysisResult(channel, data) {
  console.log('renderCompleteAnalysisResult 시작');
  
  const yesterdaySubCount = await getYesterdaySubCount(channel);
  const todaySubCount = parseInt(channel.subscriberCount || '0');
  const subDiff = yesterdaySubCount ? todaySubCount - yesterdaySubCount : null;
  
  const subDiffDisplay = subDiff === null ? '(전일 정보 없음)' :
    subDiff > 0 ? `+${fmt(subDiff)}` :
    subDiff < 0 ? `${fmt(subDiff)}` : '0';
  
  const subDiffClass = subDiff === null ? 'neutral' :
    subDiff > 0 ? 'positive' :
    subDiff < 0 ? 'negative' : 'neutral';
  
  const analysisSection = document.getElementById('analysis-section');
  if (!analysisSection) {
    console.error('analysis-section을 찾을 수 없습니다.');
    return;
  }
  
  analysisSection.innerHTML = `
    <div class="analysis-header" style="
      display: flex;
      align-items: center;
      gap: 24px;
      margin-bottom: 32px;
      padding: 24px;
      background: var(--card, #fff);
      border-radius: 16px;
      border: 2px solid var(--border, #dee2e6);
    ">
      <button id="btn-back-home" class="btn btn-secondary">← 메인으로 돌아가기</button>
      <img class="thumb" src="${channel.thumbnail}" alt="${channel.title}" style="
        width: 80px;
        height: 80px;
        border-radius: 12px;
        object-fit: cover;
        border: 2px solid var(--border, #dee2e6);
      ">
      <div class="info" style="flex: 1;">
        <h2 style="margin: 0 0 8px 0; font-size: 1.5rem;">${channel.title}</h2>
        <p style="margin: 0 0 16px 0; color: var(--muted, #6c757d);">구독자: ${fmt(channel.subscriberCount)}명</p>
        <div class="analysis-stats" style="
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 16px;
        ">
          <div class="stat-item">
            <div class="stat-value ${subDiffClass}" style="font-weight: 700; font-size: 1.1rem;">${subDiffDisplay}</div>
            <div class="stat-label" style="font-size: 0.8rem; color: var(--muted, #6c757d);">전일대비</div>
          </div>
          <div class="stat-item">
            <div class="stat-value neutral" style="font-weight: 700; font-size: 1.1rem;">${fmt(Math.round(data.avgViews))}</div>
            <div class="stat-label" style="font-size: 0.8rem; color: var(--muted, #6c757d);">평균조회수</div>
          </div>
          <div class="stat-item">
            <div class="stat-value ${data.viewsGrowthRate >= 0 ? 'positive' : 'negative'}" style="font-weight: 700; font-size: 1.1rem;">${data.viewsGrowthRate >= 0 ? '+' : ''}${data.viewsGrowthRate.toFixed(1)}%</div>
            <div class="stat-label" style="font-size: 0.8rem; color: var(--muted, #6c757d);">조회수 성장률</div>
          </div>
          <div class="stat-item">
            <div class="stat-value neutral" style="font-weight: 700; font-size: 1.1rem;">${data.engagementRate.toFixed(2)}%</div>
            <div class="stat-label" style="font-size: 0.8rem; color: var(--muted, #6c757d);">참여도</div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="analysis-content" style="
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
    ">
      <!-- 주요 키워드 섹션 -->
      <div class="analysis-card" style="
        grid-column: 1 / -1;
        background: var(--card, #fff);
        border-radius: 16px;
        padding: 24px;
        border: 2px solid var(--border, #dee2e6);
      ">
        <h3 style="margin: 0 0 20px 0;">🏷️ 주요 키워드 (상위 30개)</h3>
        <div class="tag-cloud-large" style="
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: center;
        ">
          ${data.keywords.map(([word, count]) => `
            <span class="tag-large" style="
              padding: 8px 16px;
              background: linear-gradient(135deg, #c4302b, #a02622);
              color: white;
              border-radius: 25px;
              font-weight: 700;
              font-size: ${Math.min(1.2, 0.9 + count * 0.05)}rem;
              opacity: ${Math.min(1, 0.7 + count * 0.05)};
              cursor: pointer;
              transition: all 0.3s;
              box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            " onmouseover="this.style.transform='translateY(-2px) scale(1.05)'" onmouseout="this.style.transform=''">${word} <small>(${count})</small></span>
          `).join('')}
        </div>
      </div>
      
      <!-- 상위 성과 영상 -->
      <div class="analysis-card" style="
        background: var(--card, #fff);
        border-radius: 16px;
        padding: 24px;
        border: 2px solid var(--border, #dee2e6);
      ">
        <h3 style="margin: 0 0 20px 0;">🔥 상위 성과 영상 (TOP 10)</h3>
        <div class="analysis-videos">
          <div class="video-list">
            ${data.topVideos.map((v, index) => `
              <div class="analysis-video-card" style="
                display: flex;
                gap: 16px;
                align-items: center;
                padding: 12px;
                margin-bottom: 12px;
                background: #f8f9fa;
                border-radius: 12px;
                transition: all 0.3s;
                position: relative;
              " onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
                <span class="rank-badge" style="
                  position: absolute;
                  top: 8px;
                  left: 8px;
                  background: linear-gradient(135deg, #c4302b, #a02622);
                  color: white;
                  border-radius: 50%;
                  width: 28px;
                  height: 28px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-weight: 800;
                  font-size: 12px;
                  z-index: 10;
                ">${index + 1}</span>
                <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" style="text-decoration: none;">
                  <img src="${v.snippet.thumbnails.medium.url}" alt="${v.snippet.title}" style="
                    width: 120px;
                    height: 68px;
                    object-fit: cover;
                    border-radius: 8px;
                    border: 2px solid #dee2e6;
                  ">
                </a>
                <div class="analysis-video-meta" style="flex: 1;">
                  <h4 style="margin: 0 0 8px 0; font-size: 0.9rem; font-weight: 700; line-height: 1.4;">${truncateText(v.snippet.title, 60)}</h4>
                  <p style="margin: 4px 0; font-size: 12px; color: #6c757d;">조회수: ${fmt(v.statistics.viewCount)} · 좋아요: ${fmt(v.statistics.likeCount || 0)} · 댓글: ${fmt(v.statistics.commentCount || 0)}</p>
                  <p style="margin: 4px 0; font-size: 12px; color: #6c757d;">${moment(v.snippet.publishedAt).fromNow()} · 길이: ${Math.round(moment.duration(v.contentDetails.duration).asMinutes())}분</p>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <!-- 돌연변이 영상 -->
      <div class="analysis-card" style="
        background: var(--card, #fff);
        border-radius: 16px;
        padding: 24px;
        border: 2px solid var(--border, #dee2e6);
      ">
        <h3 style="margin: 0 0 20px 0;">🚀 돌연변이 영상 (${data.mutantVideos.length}개)</h3>
        <div class="analysis-videos">
          <div class="video-list">
            ${data.mutantVideos.slice(0, 8).map(v => {
              const mutantIndex = (parseInt(v.statistics.viewCount) / parseInt(channel.subscriberCount)).toFixed(2);
              return `
                <div class="analysis-video-card" style="
                  display: flex;
                  gap: 16px;
                  align-items: center;
                  padding: 12px;
                  margin-bottom: 12px;
                  background: #f8f9fa;
                  border-radius: 12px;
                  transition: all 0.3s;
                  position: relative;
                " onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
                  <span class="mutant-rank" style="
                    background: linear-gradient(135deg, #ffa502, #ff6348);
                    color: white;
                    border-radius: 16px;
                    padding: 4px 8px;
                    font-size: 11px;
                    font-weight: 800;
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    z-index: 10;
                  ">${mutantIndex}x</span>
                  <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" style="text-decoration: none;">
                    <img src="${v.snippet.thumbnails.medium.url}" alt="${v.snippet.title}" style="
                      width: 120px;
                      height: 68px;
                      object-fit: cover;
                      border-radius: 8px;
                      border: 2px solid #dee2e6;
                    ">
                  </a>
                  <div class="analysis-video-meta" style="flex: 1;">
                    <h4 style="margin: 0 0 8px 0; font-size: 0.9rem; font-weight: 700; line-height: 1.4;">${truncateText(v.snippet.title, 60)}</h4>
                    <p style="margin: 4px 0; font-size: 12px; color: #6c757d;">조회수: ${fmt(v.statistics.viewCount)} · 돌연변이지수: ${mutantIndex}</p>
                    <p style="margin: 4px 0; font-size: 12px; color: #6c757d;">${moment(v.snippet.publishedAt).fromNow()}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
      
      <!-- 업로드 패턴 분석 -->
      <div class="analysis-card" style="
        background: var(--card, #fff);
        border-radius: 16px;
        padding: 24px;
        border: 2px solid var(--border, #dee2e6);
      ">
        <h3 style="margin: 0 0 20px 0;">📅 업로드 패턴 분석</h3>
        <div class="chart-container" style="position: relative; height: 300px;">
          <canvas id="weekly-upload-chart"></canvas>
        </div>
        <div class="chart-label" style="text-align: center; margin-top: 16px; color: #6c757d; font-size: 14px;">요일별 업로드 패턴</div>
        <div class="pattern-insights" style="
          margin-top: 20px;
          padding: 16px;
          background: #f8f9fa;
          border-radius: 8px;
        ">
          <p style="margin: 8px 0; font-size: 14px;"><strong style="color: #c4302b;">최적 업로드 시간:</strong> ${data.bestUploadTime}</p>
          <p style="margin: 8px 0; font-size: 14px;"><strong style="color: #c4302b;">업로드 빈도:</strong> 주당 ${data.uploadFrequency}개</p>
          <p style="margin: 8px 0; font-size: 14px;"><strong style="color: #c4302b;">업로드 일관성:</strong> ${data.uploadConsistency}배 (낮을수록 일관적)</p>
        </div>
      </div>
      
      <!-- 시간대별 업로드 -->
      <div class="analysis-card" style="
        background: var(--card, #fff);
        border-radius: 16px;
        padding: 24px;
        border: 2px solid var(--border, #dee2e6);
      ">
        <h3 style="margin: 0 0 20px 0;">⏰ 시간대별 업로드 분포</h3>
        <div class="chart-container" style="position: relative; height: 300px;">
          <canvas id="hourly-upload-chart"></canvas>
        </div>
        <div class="chart-label" style="text-align: center; margin-top: 16px; color: #6c757d; font-size: 14px;">24시간 업로드 분포</div>
      </div>
    </div>`;
  
  // 뒤로가기 버튼 이벤트 연결
  const backBtn = document.getElementById('btn-back-home');
  if (backBtn) {
    backBtn.onclick = returnToMainView;
  }
  
  // 차트 렌더링
  setTimeout(() => {
    renderAnalysisCharts(data);
  }, 100);
  
  console.log('renderCompleteAnalysisResult 완료');
}

function renderAnalysisCharts(data) {
  console.log('renderAnalysisCharts 시작');
  
  const isDark = document.body.classList.contains('dark');
  const colors = {
    grid: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    text: isDark ? '#e4e6ea' : '#333',
    primary: '#c4302b',
    gradient: ['#ff4757', '#ffa502', '#2ed573', '#5352ed', '#ff6b6b', '#3742fa', '#2f3542']
  };

  // 요일별 업로드 차트
  const weeklyCtx = document.getElementById('weekly-upload-chart');
  if (weeklyCtx && typeof Chart !== 'undefined') {
    new Chart(weeklyCtx, {
      type: 'bar',
      data: {
        labels: ['일', '월', '화', '수', '목', '금', '토'],
        datasets: [{
          label: '업로드 수',
          data: data.weeklyUploads,
          backgroundColor: colors.gradient,
          borderColor: colors.primary,
          borderWidth: 2,
          borderRadius: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: colors.grid }, 
            ticks: { color: colors.text }
          },
          x: { 
            grid: { color: colors.grid }, 
            ticks: { color: colors.text }
          }
        },
        plugins: { 
          legend: { 
            labels: { color: colors.text }
          }
        }
      }
    });
  }

  // 시간대별 업로드 차트
  const hourlyCtx = document.getElementById('hourly-upload-chart');
  if (hourlyCtx && typeof Chart !== 'undefined') {
    new Chart(hourlyCtx, {
      type: 'line',
      data: {
        labels: Array.from({length: 24}, (_, i) => `${i}시`),
        datasets: [{
          label: '업로드 수',
          data: data.hourlyUploads,
          borderColor: colors.primary,
          backgroundColor: colors.primary + '20',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: colors.primary,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: colors.grid }, 
            ticks: { color: colors.text }
          },
          x: { 
            grid: { color: colors.grid }, 
            ticks: { color: colors.text }
          }
        },
        plugins: { 
          legend: { 
            labels: { color: colors.text }
          }
        }
      }
    });
  }
  
  console.log('renderAnalysisCharts 완료');
}

async function getLongformVideos(uploadsPlaylistId, videoCount = 200) {
  console.log('getLongformVideos 시작:', uploadsPlaylistId, videoCount);
  
  let videoIds = [];
  let videos = [];
  let nextPageToken = '';
  
  // 재생목록에서 비디오 ID 수집
  while (videoIds.length < videoCount) {
    const playlistRes = await yt('playlistItems', {
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: nextPageToken
    });
    
    const items = playlistRes.items || [];
    if (items.length === 0) break;
    
    const currentVideoIds = items.map(item => item.contentDetails.videoId);
    videoIds.push(...currentVideoIds);
    nextPageToken = playlistRes.nextPageToken;
    if (!nextPageToken) break;
  }
  
  console.log('수집된 비디오 ID 수:', videoIds.length);
  
  // 비디오 세부 정보 가져오기 (50개씩 배치 처리)
  for (let i = 0; i < videoIds.length; i += 50) {
    const idsChunk = videoIds.slice(i, i + 50);
    const videosRes = await yt('videos', {
      part: 'snippet,statistics,contentDetails',
      id: idsChunk.join(',')
    });
    
    const videoItems = videosRes.items || [];
    for (const item of videoItems) {
      // 롱폼만 필터링 (181초 이상)
      if (moment.duration(item.contentDetails.duration).asSeconds() >= 181) {
        videos.push(item);
      }
    }
  }
  
  console.log('롱폼 비디오 수:', videos.length);
  return videos;
}

function getCategoryName(categoryId) {
  const categories = {
    '1': '영화/애니메이션', '2': '자동차/교통', '10': '음악', '15': '애완동물/동물',
    '17': '스포츠', '19': '여행/이벤트', '20': '게임', '22': '사람/블로그',
    '23': '코미디', '24': '엔터테인먼트', '25': '뉴스/정치', '26': '하우투/스타일',
    '27': '교육', '28': '과학/기술', '29': '비영리/행동주의'
  };
  return categories[categoryId] || '기타';
}

// 전일 구독자 수 가져오기 (채널 관리에서 사용하는 함수)
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

// 전역으로 노출
window.openAnalyzeModal = openAnalyzeModal;
window.startCompleteAnalysis = startCompleteAnalysis;
window.performCompleteAnalysis = performCompleteAnalysis;
window.renderCompleteAnalysisResult = renderCompleteAnalysisResult;
window.renderAnalysisCharts = renderAnalysisCharts;
window.getLongformVideos = getLongformVideos;
window.getCategoryName = getCategoryName;
window.returnToMainView = returnToMainView;

console.log('main-monitor.js 로딩 완료');