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

    // API key modal
    qs('#btn-api').addEventListener('click', () => {
        qs('#modal-api').style.display = 'block';
        const storedKeys = localStorage.getItem('yt_api_keys');
        if (storedKeys) {
            qs('#api-keys').value = JSON.parse(storedKeys).join('\n');
        }
    });

    qs('#save-api-keys').addEventListener('click', () => {
        const keys = qs('#api-keys').value.split('\n').map(k => k.trim()).filter(k => k);
        setApiKeys(keys);
        qs('#modal-api').style.display = 'none';
        showSuccess('API 키가 저장되었습니다.');
        refreshAllContent();
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
