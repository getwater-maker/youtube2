// utils.js

const qs = (selector) => document.querySelector(selector);
const fmt = (num) => new Intl.NumberFormat().format(num);
const seconds = (duration) => moment.duration(duration).asSeconds();
const extractKeywords = (title) => [...new Set(title.split(/[\s-()_]+/g).filter(k => k.length > 1).map(k => k.toLowerCase()))];

function toast(message, isError = false) {
    const toastElem = qs('#toast');
    toastElem.textContent = message;
    toastElem.style.backgroundColor = isError ? 'red' : '#333';
    toastElem.className = 'toast show';
    setTimeout(() => { toastElem.className = toastElem.className.replace('show', ''); }, 3000);
}

const showError = (message) => toast(message, true);
const showSuccess = (message) => toast(message);
