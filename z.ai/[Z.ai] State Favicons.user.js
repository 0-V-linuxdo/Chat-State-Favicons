// ==UserScript==
// @name         [Z.ai] State Favicons [20251211] v1.0.0
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for z.ai chat: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with z.ai-specific selectors/hooks.
// @version      [20251211] v1.0.0
// @update-log   回退简化：依赖上下文键区分聊天，周期评估+DOM 监听避免卡在 stream，去除过度重置导致的误判。
// @match        https://z.ai/*
// @match        https://*.z.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://z.ai/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][z.ai] Core module not found. Check @require path.');
        return;
    }

    const SELECTORS = {
        composer : [
            'div[aria-label="Stop"]',
            'div[aria-label="Send Message"]',
            'form textarea#chat-input',
            '#chat-input'
        ],
        textarea : '#chat-input',
        stopBtn  : [
            'div[aria-label="Stop"] button',
            'button[aria-label="Stop"]',
            'div[aria-label="Stop"] span.rounded-xs'
        ],
        favicon  : 'link[rel~="icon"]'
    };

    let instance = null;
    let guard = null;
    let waitHref = null;
    let lastHref = location.href;
    let lastContextKey = null;

    const isVisible = (el) => !!(el && el.isConnected && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');

    function getActiveTextarea() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        const visible = list.find(isVisible);
        return visible || list[0] || null;
    }

    function getComposerRoot() {
        const ta = getActiveTextarea();
        return ta?.closest('form') || ta?.parentElement || null;
    }

    function getStopButton() {
        const root = getComposerRoot();
        if (!root) return null;

        const candidates = [
            ...root.querySelectorAll('div[aria-label="Stop"] button'),
            ...root.querySelectorAll('button[aria-label="Stop"]')
        ];

        const square = root.querySelector('div[aria-label="Stop"] span.rounded-xs');
        if (square) candidates.unshift(square.closest('button') || square);

        return candidates.find(isVisible) || null;
    }

    function isTextareaEmpty() {
        const ta = getActiveTextarea();
        if (!ta) return true;
        const text = (ta.value ?? ta.textContent ?? '').replace(/\u200B/g, '').trim();

        // Ready 需要“可发送”+“有内容”；禁用按钮视为未就绪。
        const sendBtn = document.getElementById('send-message-button');
        const btnDisabled = !!(sendBtn &&
            (sendBtn.disabled ||
             sendBtn.getAttribute('aria-disabled') === 'true' ||
             /\bdisabled\b/i.test(sendBtn.className || '')));

        return !(text.length > 0 && !btnDisabled);
    }

    function getConversationToken() {
        const pickAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr);
        const convAttr =
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('#send-message-button', 'data-conversation-id') ||
            pickAttr('#send-message-button', 'data-chat-id') ||
            '';

        // URL 末段常为会话 id；备用拼入上下文。
        const pathPart = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        return `${convAttr}|${pathPart}`;
    }

    function getContextKey() {
        const conversation = getConversationToken();
        return `${location.href}|${conversation}`;
    }

    function bindInputListener() {
        const ta = getActiveTextarea();
        if (!ta) return;
        ta.addEventListener('input', () => instance?.evaluateState(), { passive: true });
    }

    function createInstance() {
        instance = core.createStateFavicon({
            selectors: SELECTORS,
            hooks: {
                isStreaming: () => !!getStopButton(),           // streaming only when visible stop exists
                isInputEmpty: () => isTextareaEmpty(),           // ready depends on content+enabled send
                getContextKey: () => getContextKey()             // context binds to URL + conv token
            }
        });
        instance.start();
        waitHref = instance.icons.wait;
        lastContextKey = getContextKey();
    }

    function startGuard() {
        const guardFactory = window.FaviconGuard && window.FaviconGuard.createFaviconGuard;
        if (typeof guardFactory !== 'function') {
            console.warn('[StateFavicons][z.ai] FaviconGuard not found; consider adding @require.');
            return;
        }
        guard = guardFactory({
            defaultHref: waitHref,
            iconId: 'state-favicon',
            removeCompetitors: true,
            insertFirst: true
        });
        guard.start();
    }

    function restartInstance() {
        if (instance) instance.stop();
        const link = document.getElementById('state-favicon');
        if (link && waitHref) {
            link.href = waitHref;
            link.classList.remove('spin');
        }
        createInstance();
        bindInputListener();
        if (guard?.updateDefaultHref) guard.updateDefaultHref(waitHref);
        lastHref = location.href;
        lastContextKey = getContextKey();
    }

    function init() {
        createInstance();
        bindInputListener();
        startGuard();
        lastHref = location.href;
        lastContextKey = getContextKey();

        const rebinder = new MutationObserver(() => {
            bindInputListener();
            const ctx = getContextKey();
            if (ctx !== lastContextKey) {
                lastContextKey = ctx;
                restartInstance();
                return;
            }
            instance?.evaluateState();
        });
        if (document.body) rebinder.observe(document.body, { childList: true, subtree: true, attributes: true });

        // URL change (SPA) guard: restart on href change to drop previous stream context.
        setInterval(() => {
            if (location.href === lastHref) return;
            lastHref = location.href;
            lastContextKey = null;
            restartInstance();
        }, 800);
    }

    init();
})();
