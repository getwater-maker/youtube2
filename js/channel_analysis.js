// js/channel_analysis.js

// 참고: 실제 API 호출 로직은 따로 구현 필요
// 이 코드는 샘플 데이터로 각 섹션 UI를 렌더하는 예시입니다.

document.addEventListener('DOMContentLoaded', () => {
  initChannelAnalysis();
});

async function initChannelAnalysis() {
  // 1. 채널 기본정보 불러오기 (샘플)
  const channelInfo = {
    title: "로이의 유튜브 채널",
    thumbnail: "https://yt3.ggpht.com/ytc/AKedOLRcfh0ZbHQpCz7eP9E5wXfYDrjFm_C_SzxUw5p4=s88-c-k-c0x00ffffff-no-rj",
    subscriberCount: 125000,
    videoCount: 230,
    description: "즐거운 영상과 유용한 정보들을 제공합니다.",
    createdAt: "2018-06-15"
  };
  renderChannelInfo(channelInfo);

  // 2. 구독자 성장 데이터 (샘플)
  const subscribersData = {
    labels: ["2023-03", "2023-04", "2023-05", "2023-06", "2023-07", "2023-08"],
    values: [90000, 95000, 100000, 110000, 120000, 125000]
  };
  drawLineChart('subscribers-chart', '구독자 수 추이', subscribersData.labels, subscribersData.values);

  // 3. 영상 업로드 빈도 (샘플)
  const uploadFreqData = {
    labels: ["3월", "4월", "5월", "6월", "7월", "8월"],
    values: [8, 6, 9, 7, 5, 4]
  };
  drawBarChart('upload-frequency-chart', '월별 영상 업로드 수', uploadFreqData.labels, uploadFreqData.values);

  // 4. 조회수 분석 (샘플)
  const viewsData = {
    labels: ["영상1", "영상2", "영상3", "영상4", "영상5", "영상6"],
    values: [150000, 120000, 90000, 80000, 70000, 65000]
  };
  drawBarChart('views-chart', '최근 영상 조회수', viewsData.labels, viewsData.values);

  // 5. 최근 영상 리스트 (샘플)
  const recentVideos = [
    { id: 'abc123', title: "최신 영상 1", views: 150000, publishedAt: "2023-08-05" },
    { id: 'def456', title: "최신 영상 2", views: 120000, publishedAt: "2023-07-20" },
    { id: 'ghi789', title: "최신 영상 3", views: 90000, publishedAt: "2023-07-01" },
  ];
  renderVideoList('recent-videos', recentVideos);

  // 6. 인기 영상 리스트 (샘플)
  const topVideos = [
    { id: 'top001', title: "인기 영상 A", views: 300000 },
    { id: 'top002', title: "인기 영상 B", views: 250000 },
    { id: 'top003', title: "인기 영상 C", views: 200000 },
  ];
  renderVideoList('top-videos', topVideos);

  // 7. 키워드 분석 (샘플)
  const keywords = [
    { word: "로이", count: 30 },
    { word: "유튜브", count: 25 },
    { word: "영상", count: 20 },
    { word: "분석", count: 18 },
  ];
  renderKeywords('keyword-analysis', keywords);

  // 8. 경쟁 채널 비교 (샘플)
  const competitorData = {
    labels: ["로이 채널", "경쟁 채널 1", "경쟁 채널 2"],
    subscribers: [125000, 98000, 87000],
    videos: [230, 210, 150]
  };
  drawCompetitorChart('competitor-chart', competitorData);
}

// DOM에 채널 기본정보 표시
function renderChannelInfo(info){
  const container = document.getElementById('channel-info');
  if(!container) return;
  container.innerHTML = `
    <img src="${info.thumbnail}" alt="채널 이미지" style="width:88px; border-radius:50%; margin-right:12px; vertical-align:middle;" />
    <div style="display:inline-block; vertical-align:middle;">
      <h3>${info.title}</h3>
      <p>구독자: ${info.subscriberCount.toLocaleString()}명 | 영상 수: ${info.videoCount}</p>
      <p>생성일: ${info.createdAt}</p>
      <p style="max-width:600px;">${info.description}</p>
    </div>
  `;
}

// 차트 생성 함수들
function drawLineChart(canvasId, label, labels, data){
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: 'rgba(196, 18, 0, 0.8)',
        backgroundColor: 'rgba(196, 18, 0, 0.3)',
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}

function drawBarChart(canvasId, label, labels, data){
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: 'rgba(196, 18, 0, 0.7)',
        borderRadius: 5
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}

// 인기 영상, 최근 영상 리스트 렌더링
function renderVideoList(containerId, videos){
  const container = document.getElementById(containerId);
  if(!container) return;
  if(videos.length === 0){
    container.innerHTML = '<p class="muted">영상이 없습니다.</p>';
    return;
  }
  container.innerHTML = '';
  videos.forEach(v=>{
    const div = document.createElement('div');
    div.className = 'video-card';
    div.style.marginBottom = '12px';
    div.innerHTML = `
      <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" style="font-weight:600; color:#c4302b; text-decoration:none;">${v.title}</a>
      <p>조회수: ${v.views?.toLocaleString() || 'N/A'} | 업로드: ${v.publishedAt || 'N/A'}</p>
    `;
    container.appendChild(div);
  });
}

// 키워드 태그 렌더링
function renderKeywords(containerId, keywords){
  const container = document.getElementById(containerId);
  if(!container) return;
  if(keywords.length === 0){
    container.innerHTML = '<p class="muted">키워드가 없습니다.</p>';
    return;
  }
  container.innerHTML = keywords.map(k=>`<span class="kw">${k.word} ${k.count}회</span>`).join(' ');
}

// 경쟁 채널 비교 차트
function drawCompetitorChart(canvasId, data){
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: '구독자 수',
          data: data.subscribers,
          backgroundColor: 'rgba(196, 18, 0, 0.7)'
        },
        {
          label: '영상 수',
          data: data.videos,
          backgroundColor: 'rgba(255, 99, 132, 0.5)'
        }
      ]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      interaction: { mode: 'index', intersect: false },
    }
  });
}
