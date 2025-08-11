// api.js

let apiKeys = [];
let keyIdx = 0;

const setApiKeys = (keys) => {
    apiKeys = keys;
    localStorage.setItem('yt_api_keys', JSON.stringify(keys));
};

const nextKey = () => {
    if (apiKeys.length === 0) return null;
    keyIdx = (keyIdx + 1) % apiKeys.length;
    return apiKeys[keyIdx];
};

const hasKeys = () => apiKeys.length > 0;

const yt = async (endpoint, params = {}) => {
    if (!hasKeys()) {
        showError('API 키를 먼저 입력해주세요.');
        return null;
    }
    const apiKey = nextKey();
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.searchParams.append('key', apiKey);
    for (const key in params) {
        url.searchParams.append(key, params[key]);
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 403) {
                showError('API 할당량을 초과했습니다. 다른 API 키를 사용합니다.');
                return yt(endpoint, params);
            }
            throw new Error(`YouTube API error: ${response.statusText}`);
        }
        return response.json();
    } catch (error) {
        showError(`API 요청 실패: ${error.message}`);
        return null;
    }
};
