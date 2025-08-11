// main.js

const setupEventHandlers = () => {
    // Modal handlers
    const modals = document.querySelectorAll('.modal');
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
    });
    window.addEventListener('click', (e) => {
        modals.forEach(modal => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Theme toggle
    qs('#btn-toggle-theme').addEventListener('click', () => {
        document.body.classList.toggle('dark');
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    });

    // API key modal - 수정됨
    qs('#btn-api').addEventListener('click', () => {
        qs('#modal-api').style.display = 'block';
        const storedKeys = JSON.parse(localStorage.getItem('yt_api_keys') || '[]');
        for (let i = 1; i <= 5; i++) {
            const input = qs(`#api-key-${i}`);
            input.value = storedKeys[i - 1] || '';
        }
    });

    // API 키 저장 - 수정됨
    qs('#save-api-keys').addEventListener('click', () => {
        const keys = [];
        for (let i = 1; i <= 5; i++) {
            const key = qs(`#api-key-${i}`).value.trim();
            if (key) keys.push(key);
        }
        if (keys.length === 0) {
            return showError('유효한 API 키를 하나 이상 입력해주세요.');
        }
        setApiKeys(keys);
        qs('#modal-api').style.display = 'none';
        showSuccess('API 키가 저장되었습니다.');
        refreshAllContent();
    });
    
    // API 키 파일 업로드 - 수정됨
    qs('#btn-upload-api').addEventListener('click', () => {
        qs('#api-file-upload').click();
    });
    qs('#api-file-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const keys = event.target.result.split('\n').map(k => k.trim()).filter(k => k);
            for (let i = 1; i <= 5; i++) {
                const input = qs(`#api-key-${i}`);
                input.value = keys[i - 1] || '';
            }
            showSuccess('API 키 파일을 불러왔습니다.');
        };
        reader.readAsText(file);
    });
    
    // API 키 파일 다운로드 - 수정됨
    qs('#btn-download-api').addEventListener('click', () => {
        const keys = [];
        for (let i = 1; i <= 5; i++) {
            const key = qs(`#api-key-${i}`).value.trim();
            if (key) keys.push(key);
        }
        if (keys.length === 0) {
            return showError('다운로드할 API 키가 없습니다.');
        }
        const data = keys.join('\n');
        const blob = new Blob([data], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'youtube_api_keys.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSuccess('API 키를 다운로드했습니다.');
    });

    // Add channel modal
    qs('#btn-add').addEventListener('click', () => {
        qs('#modal-add').style.display = 'block';
        qs('#channel-id-input').value = '';
    });

    qs('#add-channel').addEventListener('click', () => {
        const id = qs('#channel-id-input').value;
        addChannelById(id);
        qs('#modal-add').style.display = 'none';
    });

    // Import/Export
    qs('#btn-export').addEventListener('click', exportChannels);
    qs('#btn-import').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            if (e.target.files[0]) {
                importChannelsFromFile(e.target.files[0]);
            }
        };
        input.click();
    });

    // Analysis modal
    qs('#btn-analyze').addEventListener('click', () => {
        const select = qs('#analyze-channel-select');
        select.innerHTML = '<option value="">채널 선택</option>';
        allChannels.forEach(ch => {
            const option = document.createElement('option');
            option.value = ch.id;
            option.textContent = ch.title;
            select.appendChild(option);
        });
        qs('#analysis-result').style.display = 'none';
        qs('#modal-analyze').style.display = 'block';
    });

    qs('#start-analysis').addEventListener('click', startAnalysis);

    // Channel list event delegation
    qs('#channel-list').addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const id = e.target.closest('.list-item').dataset.id;
            deleteChannel(id);
        }
    });

    // Sorting
    qs('#sort-channels').addEventListener('change', () => {
        refreshChannels();
        localStorage.setItem('sort-channels', qs('#sort-channels').value);
    });
    qs('#sort-mutants').addEventListener('change', () => {
        refreshMutant();
        localStorage.setItem('sort-mutants', qs('#sort-mutants').value);
    });
    qs('#sort-latest').addEventListener('change', () => {
        refreshLatest();
        localStorage.setItem('sort-latest', qs('#sort-latest').value);
    });

    // Drag-and-drop for channels
    new Sortable(qs('#channel-list'), {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: (event) => {
            const itemEl = event.item;
            const newOrder = Array.from(qs('#channel-list').children).map(el => el.dataset.id);
            localStorage.setItem('channel_order', JSON.stringify(newOrder));
            allChannels.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
        }
    });
};

const refreshAllContent = async () => {
    qs('#loading').style.display = 'block';
    if (!hasKeys()) {
        qs('#channel-list').innerHTML = '<p style="text-align:center;">API 키를 입력해주세요.</p>';
        qs('#mutant-video-list').innerHTML = '';
        qs('#latest-video-list').innerHTML = '';
        qs('#loading').style.display = 'none';
        return;
    }

    await getAllChannels();
    const promises = allChannels.map(ch => ensureUploadsAndLatest(ch));
    await Promise.all(promises);
    await refreshChannels();
    await refreshMutant();
    await refreshLatest();
    qs('#loading').style.display = 'none';
};

const initialize = async () => {
    moment.tz.setDefault("Asia/Seoul");
    qs('#loading').style.display = 'block';
    
    // Load theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.className = savedTheme;
    qs('#btn-toggle-theme').textContent = savedTheme === 'dark' ? '라이트 모드' : '다크 모드';
    
    // Load API keys
    const storedKeys = JSON.parse(localStorage.getItem('yt_api_keys') || '[]');
    setApiKeys(storedKeys);

    // Load sort preferences
    qs('#sort-channels').value = localStorage.getItem('sort-channels') || 'default';
    qs('#sort-mutants').value = localStorage.getItem('sort-mutants') || 'default';
    qs('#sort-latest').value = localStorage.getItem('sort-latest') || 'default';

    await openDB();
    setupEventHandlers();
    refreshAllContent();
};

document.addEventListener('DOMContentLoaded', initialize);
