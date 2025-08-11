// db.js

const DB_NAME = 'yt_monitor_db';
const STORE_NAME = 'channels';
const DB_VERSION = 1;

let db;

const openDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
    };
    request.onerror = (event) => reject(event.target.error);
});

const withStore = (mode, callback) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    return callback(store);
};

const idbAll = () => withStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
}));

const idbGet = (id) => withStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
}));

const idbPut = (data) => withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put(data);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
}));

const idbDel = (id) => withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
}));
