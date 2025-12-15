// ==UserScript==
// @name         [Qwen] State Favicons [20251215] v1.0.6
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Qwen Chat: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with qwen.ai-specific selectors/hooks.
// @version      [20251215] v1.0.6
// @update-log   使用 core lazySignature/buildContextKeyFromUrl 复用上下文/签名构造；版本升级至 v1.0.6。
// @match        https://chat.qwen.ai/*
// @match        https://*.qwen.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://assets.alicdn.com/g/qwenweb/qwen-chat-fe/0.1.17/static/qwen_icon_light_84.png
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Qwen] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

    const SELECTORS = {
        composer: [
            '.chat-prompt-send-button',
            '.omni-button-content',
            '.prompt-input-input-area',
            '#chat-input'
        ],
        textarea: '#chat-input',
        stopBtn: [
            '.chat-prompt-send-button button.stop-button',
            'button.stop-button',
            'button[aria-label="Stop"]'
        ],
        sendBtn: [
            '.chat-prompt-send-button button.send-button',
            'button.send-button',
            'button[aria-label="Send"]'
        ],
        submitBtn: [
            '.chat-prompt-send-button button.send-button',
            'button.send-button',
            'button[aria-label="Send"]'
        ],
        favicon: 'link[rel~="icon"]'
    };

    const { defaultIconHref, guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });
    let instance = null;
    let lastHref = location.href;
    let lastContextKey = null;

    function getActiveTextarea() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        const visible = list.find(isVisible);
        return visible || list[0] || null;
    }

    function getComposerRoot() {
        const ta = getActiveTextarea();
        const inputArea = ta?.closest('.prompt-input-input-area');
        if (inputArea) return inputArea;

        const buttonArea = document.querySelector('.chat-prompt-send-button') ||
            document.querySelector('.omni-button-content');
        if (buttonArea) return buttonArea.closest('form') || buttonArea.parentElement || buttonArea;

        return ta?.closest('form') || ta?.parentElement || document.body;
    }

    function getSendButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of SELECTORS.sendBtn) {
            candidates.push(...root.querySelectorAll(sel));
        }
        const arrowUse = root.querySelector('use[href="#icon-line-arrow-up"], use[xlink\\:href="#icon-line-arrow-up"]');
        if (arrowUse) candidates.unshift(arrowUse.closest('button') || arrowUse.closest('.send-button') || arrowUse.parentElement);
        return candidates.find(isVisible) || null;
    }

    function getStopButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of SELECTORS.stopBtn) {
            candidates.push(...root.querySelectorAll(sel));
        }
        const stopUse = root.querySelector('use[href="#icon-StopIcon"], use[xlink\\:href="#icon-StopIcon"]');
        if (stopUse) candidates.unshift(stopUse.closest('button') || stopUse.closest('.stop-button') || stopUse.parentElement);
        return candidates.find(isVisible) || null;
    }

    function getConversationToken() {
        const pickAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('conversationId') ||
            params.get('sessionId') ||
            params.get('chatId') ||
            params.get('cid') ||
            params.get('id') ||
            '';

        const dataId =
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-session-id]', 'data-session-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('#chat-input', 'data-conversation-id') ||
            '';

        const pathPart = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        return [dataId, paramId, pathPart].filter(Boolean).join('|');
    }

    const contextLock = createContextLock({
        isStreaming: () => !!getStopButton(),
        getToken: () => getConversationToken(),
        getSignature: () => lazySignature('qwen', getComposerRoot() || document.body),
        buildKey: (token, sig) => buildContextKeyFromUrl({
            token,
            draftSig: () => sig || lazySignature('qwen', getComposerRoot() || document.body)
        })
    });

    function isInputEmpty() {
        const ta = getActiveTextarea();
        if (!ta) return true;
        const text = (ta.value ?? ta.textContent ?? '').replace(/\u200B/g, '').trim();
        if (text.length === 0) return true;

        const sendBtn = getSendButton();
        const btnDisabled = !!(sendBtn &&
            (sendBtn.disabled ||
             sendBtn.getAttribute('aria-disabled') === 'true' ||
             /\bdisabled\b/i.test(sendBtn.className || '')));

        return btnDisabled;
    }

    function bindInputListener() {
        const ta = getActiveTextarea();
        if (!ta || ta.__sfvBound) return;
        ta.addEventListener('input', () => instance?.evaluateState(), { passive: true });
        ta.__sfvBound = true;
    }

    function createInstance() {
        instance = core.createStateFavicon({
            selectors: SELECTORS,
            defaultIconHref,
            submitEndsStreaming: true,
            stopSearchScope: () => [getComposerRoot(), document],
            stopMustBeVisible: true,
            hooks: {
                isStreaming: () => !!getStopButton(),
                isInputEmpty: () => isInputEmpty(),
                getContextKey: () => contextLock.getContextKey()
            }
        });
        instance.start();
        lastContextKey = contextLock.getContextKey();
    }

    function restartInstance() {
        if (instance) instance.stop();
        const link = document.getElementById('state-favicon');
        if (link && defaultIconHref) {
            link.href = defaultIconHref;
            link.classList.remove('spin');
        }
        createInstance();
        bindInputListener();
        if (guard?.updateDefaultHref && defaultIconHref) guard.updateDefaultHref(defaultIconHref);
        lastHref = location.href;
        lastContextKey = contextLock.getContextKey();
    }

    function init() {
        createInstance();
        bindInputListener();
        lastHref = location.href;
        lastContextKey = contextLock.getContextKey();

        const rebinder = new MutationObserver(() => {
            bindInputListener();
            const ctx = contextLock.getContextKey();
            if (ctx !== lastContextKey) {
                lastContextKey = ctx;
                restartInstance();
                return;
            }
            instance?.evaluateState();
        });
        if (document.body) rebinder.observe(document.body, { childList: true, subtree: true, attributes: true });

        setInterval(() => {
            if (location.href === lastHref) return;
            lastHref = location.href;
            lastContextKey = null;
            restartInstance();
        }, 800);
    }

    init();
})();
