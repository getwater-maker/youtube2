// videos.js

const renderVideoList = (listId, videos) => {
    const listElem = qs(listId);
    listElem.innerHTML = '';
    videos.forEach(v => {
        const videoItem = document.createElement('div');
        videoItem.className = 'list-item';
        videoItem.dataset.id = v.id;
        videoItem.innerHTML = `
            <img class="video-thumbnail" src="${v.thumbnail}" alt="${v.title} thumbnail"/>
            <div class="details">
                <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" class="title">${v.title}</a>
                <div class="info">
                    채널: ${v.channelTitle} | 조회수: ${fmt(v.views)}회 | 좋아요: ${fmt(v.likes)}개<br>
                    게시일: ${moment(v.publishedAt).format('YYYY-MM-DD HH:mm:ss')}
                </div>
            </div>
        `;
        listElem.appendChild(videoItem);
    });
};

const sortVideoCards = (list, sortBy) => {
    if (sortBy === 'default') {
        return list;
    }
    const sorted = [...list];
    if (sortBy === 'views-asc') sorted.sort((a, b) => a.views - b.views);
    else if (sortBy === 'views-desc') sorted.sort((a, b) => b.views - a.views);
    else if (sortBy === 'date-asc') sorted.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    else if (sortBy === 'date-desc') sorted.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    else if (sortBy === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === 'title-desc') sorted.sort((a, b) => b.title.localeCompare(a.title));
    return sorted;
};

const refreshMutant = async () => {
    if (!hasKeys()) return;
    const allVideoIds = allChannels.flatMap(ch => ch.uploads);
    if (allVideoIds.length === 0) {
        qs('#mutant-video-list').innerHTML = '<p style="text-align:center;">채널을 추가하면 변이 영상이 표시됩니다.</p>';
        return;
    }
    qs('#loading').style.display = 'block';

    const videoData = await yt('videos', {
        part: 'snippet,statistics',
        id: allVideoIds.join(','),
        maxResults: 50
    });
    if (videoData && videoData.items) {
        let mutants = videoData.items.map(v => {
            const channel = allChannels.find(c => c.id === v.snippet.channelId);
            const channelTitle = channel ? channel.title : '알 수 없는 채널';
            return {
                id: v.id,
                title: v.snippet.title,
                thumbnail: v.snippet.thumbnails.medium.url,
                views: parseInt(v.statistics.viewCount) || 0,
                likes: parseInt(v.statistics.likeCount) || 0,
                publishedAt: v.snippet.publishedAt,
                channelTitle: channelTitle
            };
        });

        mutants = mutants.filter(v => {
            const viewsPerDay = v.views / moment().diff(moment(v.publishedAt), 'days');
            return viewsPerDay > 5000;
        });

        const sortBy = qs('#sort-mutants').value;
        const sortedMutants = sortVideoCards(mutants, sortBy);
        renderVideoList('#mutant-video-list', sortedMutants);
    }
    qs('#loading').style.display = 'none';
};

const refreshLatest = async () => {
    if (!hasKeys()) return;
    const latestVideoIds = allChannels.flatMap(ch => ch.latest);
    if (latestVideoIds.length === 0) {
        qs('#latest-video-list').innerHTML = '<p style="text-align:center;">채널을 추가하면 최신 영상이 표시됩니다.</p>';
        return;
    }
    qs('#loading').style.display = 'block';

    const videoData = await yt('videos', {
        part: 'snippet,statistics',
        id: latestVideoIds.join(','),
        maxResults: 50
    });
    if (videoData && videoData.items) {
        const latest = videoData.items.map(v => {
            const channel = allChannels.find(c => c.id === v.snippet.channelId);
            const channelTitle = channel ? channel.title : '알 수 없는 채널';
            return {
                id: v.id,
                title: v.snippet.title,
                thumbnail: v.snippet.thumbnails.medium.url,
                views: parseInt(v.statistics.viewCount) || 0,
                likes: parseInt(v.statistics.likeCount) || 0,
                publishedAt: v.snippet.publishedAt,
                channelTitle: channelTitle
            };
        });
        const sortBy = qs('#sort-latest').value;
        const sortedLatest = sortVideoCards(latest, sortBy);
        renderVideoList('#latest-video-list', sortedLatest);
    }
    qs('#loading').style.display = 'none';
};
