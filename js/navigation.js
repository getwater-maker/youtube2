// YouTube 채널 모니터 - 네비게이션 관리 (안정화 버전)
console.log('navigation.js 로딩 시작');

// ============================================================================
// 전역 상태
// ============================================================================
window.navigationState = window.navigationState || {
  currentSection: 'my-channels', // 앱 기본 섹션
  initialized: false
};

// 분석 모드 상태가 없으면 기본값 부여 (다른 파일과의 상호작용 대비)
window.analysisState = window.analysisState || {
  isActive: false,
  previousSection: 'channels'
};

// ============================================================================
// 섹션 전환
// ============================================================================
function showSection(sectionName) {
  console.log('섹션 전환:', sectionName);

  // 분석 모드면 분석 화면 종료 후 전환
  if (window.analysisState && window.analysisState.isActive) {
    console.log('분석 모드에서 섹션 전환 감지, 분석 화면 자동 종료');
    window.analysisState.isActive = false;

    const analysisSection = document.getElementById('analysis-section');
    if (analysisSection) analysisSection.remove();

    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.style.display = '';

    if (window.state) window.state.currentView = 'home';
  }

  // 동일 섹션으로의 재요청은 스킵 (중복 초기화 방지)
  const targetSection = document.getElementById(`section-${sectionName}`);
  const isSameSection = window.navigationState.currentSection === sectionName;
  const isVisible = targetSection && targetSection.style.display !== 'none';
  if (isSameSection && isVisible) {
    console.log('섹션 전환 스킵(동일 섹션):', sectionName);
    return;
  }

  // 상태 업데이트
  window.navigationState.currentSection = sectionName;

  // 모든 섹션 숨김
  document.querySelectorAll('.section').forEach((section) => {
    section.style.display = 'none';
  });

  // 목표 섹션 표시
  if (targetSection) targetSection.style.display = 'block';

  // 네비 버튼 UI 업데이트
  updateNavButtons(sectionName);

  // 섹션별 데이터 로드
  loadSectionData(sectionName);
}

// ============================================================================
// 네비게이션 버튼 상태
// ============================================================================
function updateNavButtons(activeSectionName) {
  // 분석 모드면 버튼 반투명화
  if (window.analysisState && window.analysisState.isActive) {
    document.querySelectorAll('.nav-section, #btn-text-splitter').forEach((btn) => {
      btn.classList.remove('active');
      btn.style.opacity = '0.5';
    });
    return;
  }

  // 일반 모드
  document.querySelectorAll('.nav-section').forEach((btn) => {
    btn.classList.remove('active');
    btn.style.opacity = '';
  });

  const textSplitterBtn = document.getElementById('btn-text-splitter');
  if (textSplitterBtn) {
    textSplitterBtn.classList.remove('active');
    textSplitterBtn.style.opacity = '';
  }

  let activeButtonId = `btn-${activeSectionName}`;
  if (activeSectionName === 'my-channels') activeButtonId = 'btn-my-channels';

  const activeButton = document.getElementById(activeButtonId);
  if (activeButton) activeButton.classList.add('active');
}

// ============================================================================
// 섹션별 데이터 로딩
// ============================================================================
function loadSectionData(sectionName) {
  console.log('섹션 데이터 로드:', sectionName);

  switch (sectionName) {
    case 'my-channels':
      if (typeof window.initializeMyChannels === 'function') {
        window.initializeMyChannels();
      } else {
        console.warn('initializeMyChannels 미정의: my-channels.js 로드 여부 확인');
      }
      break;

    case 'channels':
      if (typeof window.refreshChannels === 'function') {
        window.refreshChannels();
      } else {
        console.warn('refreshChannels 미정의: channels.js 로드 여부 확인');
      }
      break;

    case 'videos':
      if (typeof window.initializeVideosSection === 'function') {
        window.initializeVideosSection();
      } else {
        console.warn('initializeVideosSection 미정의: videos.js 로드 여부 확인');
      }
      break;

    case 'scene-parser': // 🔹 추가
      if (typeof window.initializeSceneParser === 'function') {
        window.initializeSceneParser();
      } else {
        console.warn('initializeSceneParser 미정의: scene-parser.js 로드 여부 확인');
      }
      break;

    default:
      console.warn('알 수 없는 섹션:', sectionName);
  }
}

// ============================================================================
// 이벤트 바인딩
// ============================================================================
function bindNavigationEvents() {
  console.log('네비게이션 이벤트 바인딩 시작');

  const mapping = [
    { id: 'btn-my-channels', section: 'my-channels' },
    { id: 'btn-channels', section: 'channels' },
    { id: 'btn-videos', section: 'videos' },
    { id: 'btn-scene-parser', section: 'scene-parser' } 
  ];

  mapping.forEach(({ id, section }) => {
    const btn = document.getElementById(id);
    if (!btn) {
      console.warn(`버튼을 찾을 수 없음: ${id}`);
      return;
    }
    if (btn.dataset.navBound === '1') return;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // API 키가 필요한 섹션(현재 'videos'만 체크)
      if (section === 'videos') {
        if (!(window.hasKeys && window.hasKeys())) {
          window.toast && window.toast('먼저 API 키를 설정해주세요.\n우상단의 🔑 API 키 버튼을 클릭하세요.', 'warning');
          return;
        }
      }

      showSection(section);
    });

    btn.dataset.navBound = '1';
    console.log(`${id} 버튼 이벤트 바인딩 완료`);
  });
}

// ============================================================================
// 초기화
// ============================================================================
function initializeNavigation() {
  console.log('네비게이션 초기화 시작');

  if (window.navigationState.initialized) {
    console.log('네비게이션이 이미 초기화됨');
    return;
  }
  window.navigationState.initialized = true;

  bindNavigationEvents();

  // 최초 진입 섹션 표시
  const first = window.navigationState.currentSection || 'my-channels';
  showSection(first);

  console.log('네비게이션 초기화 완료');
}

// 전역 공개
window.showSection = showSection;
window.initializeNavigation = initializeNavigation;

console.log('navigation.js 로딩 완료');
