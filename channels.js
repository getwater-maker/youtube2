// channels.js

let allChannels = [];

const getAllChannels = async () => {
    allChannels = await idbAll();
    allChannels.forEach(ch => {
        ch.uploads = ch.uploads || [];
        ch.latest = ch.latest || [];
    });
    return allChannels;
};

const sortChannels = (sortBy) => {
    if (sortBy === 'default') {
        const order = JSON.parse(localStorage.getItem('channel_order') || '[]');
        allChannels.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    } else if (sortBy === 'title-asc') {
        allChannels.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'title-desc') {
        allChannels.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortBy === 'videos-asc') {
        allChannels.sort((a, b) => a.videos - b.videos);
    } else if (sortBy === 'videos-desc') {
        allChannels.sort((a, b) => b.videos - a.videos);
    }
};

const refreshChannels = async () => {
    const listElem = qs('#channel-list');
    listElem.innerHTML = '';
    const sortBy = qs('#sort-channels').value;
    sortChannels(sortBy);

    for (const ch of allChannels) {
        const itemElem = document.createElement('div');
        itemElem.className = 'list-item';
        itemElem.dataset.id = ch.id;
        itemElem.innerHTML = `
            <img class="channel-image" src="${ch.thumbnail}" alt="${ch.title} icon"/>
            <div class="details">
                <div class="title">${ch.title}</div>
                <div class="info">
                    구독자: ${fmt(ch.subscribers)}명 | 영상: ${fmt(ch.videos)}개
                </div>
            </div>
            <div class="actions">
                <button class="delete-btn">삭제</button>
            </div>
        `;
        listElem.appendChild(itemElem);
    }
};

const addChannelById = async (id) => {
    if (!id) return showError('채널 ID를 입력하세요.');
    const match = id.match(/(?:youtube\.com\/channel\/|youtube\.com\/c\/|youtube\.com\/@|youtube\.com\/user\/|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/watch\?v=)([^&?/]+)/);
    if (match) id = match[1];
    
    if (allChannels.some(c => c.id === id)) {
        return showError('이미 추가된 채널입니다.');
    }

    qs('#loading').style.display = 'block';

    const channelData = await yt('channels', { part: 'snippet,statistics,contentDetails', id });
    if (!channelData || channelData.items.length === 0) {
        qs('#loading').style.display = 'none';
        return showError('채널을 찾을 수 없습니다.');
    }

    const item = channelData.items[0];
    const newChannel = {
        id: item.id,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url,
        subscribers: parseInt(item.statistics.subscriberCount),
        videos: parseInt(item.statistics.videoCount),
        uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
        uploads: [],
        latest: []
    };

    await idbPut(newChannel);
    allChannels.push(newChannel);
    await refreshChannels();
    showSuccess(`${newChannel.title} 채널을 추가했습니다.`);
    qs('#loading').style.display = 'none';
};

const deleteChannel = async (id) => {
    if (confirm('채널을 삭제하시겠습니까?')) {
        await idbDel(id);
        allChannels = allChannels.filter(c => c.id !== id);
        showSuccess('채널이 삭제되었습니다.');
        refreshChannels();
        refreshMutant();
        refreshLatest();
    }
};

const ensureUploadsAndLatest = async (channel) => {
    if (channel.uploads.length === 0 || channel.latest.length === 0) {
        const videos = await yt('playlistItems', { part: 'snippet', playlistId: channel.uploadsPlaylistId, maxResults: 50 });
        if (videos && videos.items) {
            channel.uploads = videos.items.map(v => v.snippet.resourceId.videoId);
            channel.latest = videos.items.slice(0, 5).map(v => v.snippet.resourceId.videoId);
            await idbPut(channel);
        }
    }
};

const exportChannels = () => {
    const data = JSON.stringify(allChannels, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'channels.json';
    a.click();
    URL.revokeObjectURL(url);
    showSuccess('채널 목록을 내보냈습니다.');
};

const importChannelsFromFile = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedChannels = JSON.parse(e.target.result);
            if (!Array.isArray(importedChannels)) {
                return showError('잘못된 파일 형식입니다.');
            }
            for (const ch of importedChannels) {
                await idbPut(ch);
            }
            await getAllChannels();
            await refreshChannels();
            showSuccess('채널 목록을 가져왔습니다.');
        } catch (error) {
            showError('파일 처리 중 오류가 발생했습니다.');
        }
    };
    reader.readAsText(file);
};
