// analysis.js

let chartViews, chartComments, chartLikes, chartDuration;

const startAnalysis = async () => {
    const channelId = qs('#analyze-channel-select').value;
    if (!channelId) {
        return showError('분석할 채널을 선택해주세요.');
    }
    const channel = allChannels.find(c => c.id === channelId);
    if (!channel) {
        return showError('채널 정보를 찾을 수 없습니다.');
    }

    qs('#loading').style.display = 'block';
    qs('#analysis-result').style.display = 'none';

    const videos = await getLongformVideos(channel.uploadsPlaylistId);
    if (!videos) {
        qs('#loading').style.display = 'none';
        return;
    }

    const { stats, videosWithStats } = await analyzeVideos(videos);

    if (stats) {
        renderAnalysisResult(channel.title, stats);
        renderCharts(videosWithStats);
    } else {
        showError('동영상 분석 데이터를 가져오지 못했습니다.');
    }
    
    qs('#loading').style.display = 'none';
};

const getLongformVideos = async (playlistId) => {
    let videos = [];
    let nextPageToken = null;
    do {
        const res = await yt('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: 50,
            pageToken: nextPageToken
        });
        if (!res || !res.items) return null;
        const videoIds = res.items.map(v => v.contentDetails.videoId);
        const videoData = await yt('videos', {
            part: 'snippet,statistics,contentDetails',
            id: videoIds.join(',')
        });
        if (!videoData || !videoData.items) return null;
        videos = videos.concat(videoData.items.filter(v => v.snippet.title !== 'Private video' && v.contentDetails.duration && seconds(v.contentDetails.duration) > 60));
        nextPageToken = res.nextPageToken;
    } while (nextPageToken && videos.length < 500);
    return videos;
};

const analyzeVideos = async (videos) => {
    if (!videos || videos.length === 0) return { stats: null, videosWithStats: [] };

    const videosWithStats = videos.map(v => {
        const views = parseInt(v.statistics.viewCount) || 0;
        const comments = parseInt(v.statistics.commentCount) || 0;
        const likes = parseInt(v.statistics.likeCount) || 0;
        const duration = seconds(v.contentDetails.duration);
        const publishedAt = new Date(v.snippet.publishedAt);
        const daysSincePublished = moment().diff(moment(publishedAt), 'days') || 1;
        const viewsPerDay = views / daysSincePublished;

        return {
            title: v.snippet.title,
            keywords: extractKeywords(v.snippet.title),
            views, comments, likes, duration, publishedAt, viewsPerDay
        };
    });

    const totalViews = videosWithStats.reduce((acc, v) => acc + v.views, 0);
    const totalLikes = videosWithStats.reduce((acc, v) => acc + v.likes, 0);
    const totalComments = videosWithStats.reduce((acc, v) => acc + v.comments, 0);
    const totalDuration = videosWithStats.reduce((acc, v) => acc + v.duration, 0);

    const avgViews = totalViews / videosWithStats.length;
    const avgLikes = totalLikes / videosWithStats.length;
    const avgComments = totalComments / videosWithStats.length;
    const avgDuration = totalDuration / videosWithStats.length;

    const allKeywords = videosWithStats.flatMap(v => v.keywords);
    const keywordCounts = allKeywords.reduce((acc, k) => {
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const sortedKeywords = Object.entries(keywordCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
    const topKeywords = sortedKeywords.map(([k, count]) => `${k} (${count})`).join(', ');

    return {
        stats: {
            videoCount: videosWithStats.length,
            avgViews, avgLikes, avgComments, avgDuration,
            topKeywords
        },
        videosWithStats
    };
};

const renderAnalysisResult = (channelTitle, stats) => {
    qs('#modal-analyze h2').textContent = `${channelTitle} 채널 분석`;
    qs('#analysis-result').style.display = 'block';
    qs('#analysis-stats').innerHTML = `
        <div>총 영상 수<br><strong>${fmt(stats.videoCount)}</strong></div>
        <div>평균 조회수<br><strong>${fmt(Math.round(stats.avgViews))}</strong></div>
        <div>평균 좋아요<br><strong>${fmt(Math.round(stats.avgLikes))}</strong></div>
        <div>평균 댓글 수<br><strong>${fmt(Math.round(stats.avgComments))}</strong></div>
        <div>평균 길이<br><strong>${moment.duration(stats.avgDuration, 'seconds').format('HH:mm:ss')}</strong></div>
        <div>상위 키워드<br><strong>${stats.topKeywords}</strong></div>
    `;
};

const renderCharts = (videos) => {
    const dates = videos.map(v => moment(v.publishedAt).format('YYYY-MM-DD')).reverse();
    const views = videos.map(v => v.views).reverse();
    const comments = videos.map(v => v.comments).reverse();
    const likes = videos.map(v => v.likes).reverse();
    const durations = videos.map(v => Math.round(v.duration / 60)).reverse();

    if (chartViews) chartViews.destroy();
    chartViews = new Chart(qs('#analysis-chart-views').getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '조회수',
                data: views,
                borderColor: '#42a5f5',
                tension: 0.1,
                fill: false
            }]
        },
        options: { responsive: true, scales: { x: { display: false } } }
    });

    if (chartComments) chartComments.destroy();
    chartComments = new Chart(qs('#analysis-chart-comments').getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '댓글 수',
                data: comments,
                borderColor: '#66bb6a',
                tension: 0.1,
                fill: false
            }]
        },
        options: { responsive: true, scales: { x: { display: false } } }
    });

    if (chartLikes) chartLikes.destroy();
    chartLikes = new Chart(qs('#analysis-chart-likes').getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '좋아요 수',
                data: likes,
                borderColor: '#ffa726',
                tension: 0.1,
                fill: false
            }]
        },
        options: { responsive: true, scales: { x: { display: false } } }
    });

    if (chartDuration) chartDuration.destroy();
    chartDuration = new Chart(qs('#analysis-chart-duration').getContext('2d'), {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: '영상 길이 (분)',
                data: durations,
                borderColor: '#ab47bc',
                tension: 0.1,
                fill: false
            }]
        },
        options: { responsive: true, scales: { x: { display: false } } }
    });
};
