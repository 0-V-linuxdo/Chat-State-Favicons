// ==UserScript==
// @name         [Perplexity] State Favicons [20251215] v1.0.6
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Perplexity: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with perplexity.ai-specific selectors/hooks.
// @version      [20251215] v1.0.6
// @update-log   使用 core lazySignature/buildContextKeyFromUrl 复用上下文/签名构造；版本升级至 v1.0.6。
// @match        https://www.perplexity.ai/*
// @match        https://perplexity.ai/*
// @match        https://*.perplexity.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://www.perplexity.ai/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Perplexity] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

    const SELECTORS = {
        composer: [
            'form[role="search"]',
            'form[action*="search"]',
            'form',
            '#ask-input'
        ],
        textarea: '#ask-input',
        stopBtn: [
            'button[data-testid="stop-generating-response-button"]',
            'button[aria-label="Stop generating response"]'
        ],
        sendBtn: [
            'button[data-testid="submit-button"]',
            'button[aria-label="Submit"]'
        ],
        submitBtn: [
            'button[data-testid="submit-button"]',
            'button[aria-label="Submit"]'
        ],
        favicon: 'link[rel~="icon"]'
    };

    const DEFAULT_WAIT_ICON = 'https://www.perplexity.ai/favicon.ico';

    const { defaultIconHref } = initDefaultFavicon({
        document,
        defaultIconHref: DEFAULT_WAIT_ICON,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });
    let instance = null;
    let lastHref = location.href;
    let lastContextKey = null;

    function getActiveEditor() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        return list.find(isVisible) || list[0] || null;
    }

    function getComposerRoot() {
        const editor = getActiveEditor();
        if (!editor) return document.body;
        return editor.closest('form') ||
            editor.closest('div[class*="grid"]') ||
            editor.parentElement ||
            document.body;
    }

    function getSendButton() {
        const scopes = [getComposerRoot(), document].filter(Boolean);
        const candidates = [];
        for (const scope of scopes) {
            for (const sel of SELECTORS.sendBtn) {
                try { candidates.push(...scope.querySelectorAll(sel)); } catch (_) { /* ignore selector errors */ }
            }
            const arrowUse = scope.querySelector('use[href="#pplx-icon-arrow-right"], use[xlink\\:href="#pplx-icon-arrow-right"]');
            if (arrowUse) candidates.unshift(
                arrowUse.closest('button') ||
                arrowUse.closest('[role="button"]') ||
                arrowUse.parentElement
            );
        }
        return candidates.find(isVisible) || candidates[0] || null;
    }

    function getStopButton() {
        const scopes = [getComposerRoot(), document].filter(Boolean);
        const candidates = [];
        for (const scope of scopes) {
            for (const sel of SELECTORS.stopBtn) {
                try { candidates.push(...scope.querySelectorAll(sel)); } catch (_) { /* ignore selector errors */ }
            }
            const stopUse = scope.querySelector('use[href="#pplx-icon-player-stop-filled"], use[xlink\\:href="#pplx-icon-player-stop-filled"]');
            if (stopUse) candidates.unshift(
                stopUse.closest('button') ||
                stopUse.closest('[role="button"]') ||
                stopUse.parentElement
            );
        }
        return candidates.find(isVisible) || candidates[0] || null;
    }

    function getConversationToken() {
        const pickAttr = (sel, attr) => {
            try { return document.querySelector(sel)?.getAttribute(attr) || ''; }
            catch { return ''; }
        };

        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('id') ||
            params.get('cid') ||
            params.get('conversation') ||
            params.get('chat_id') ||
            params.get('q') || '';

        const dataId =
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('[data-session-id]', 'data-session-id') ||
            pickAttr('#ask-input', 'data-thread-id') ||
            pickAttr('#ask-input', 'data-conversation-id') ||
            '';

        const pathPart = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        return [dataId, paramId, pathPart].filter(Boolean).join('|');
    }

    const contextLock = createContextLock({
        isStreaming: () => !!getStopButton(),
        getToken: () => getConversationToken(),
        getSignature: () => lazySignature('pplx', getComposerRoot() || document.body),
        buildKey: (token, sig) => buildContextKeyFromUrl({
            token,
            draftSig: () => sig || lazySignature('pplx', getComposerRoot() || document.body)
        })
    });

    function isInputEmpty() {
        const editor = getActiveEditor();
        if (!editor) return true;

        const text = (editor.textContent || '').replace(/\u200B/g, '').trim();
        if (text.length === 0) return true;

        const sendBtn = getSendButton();
        const disabled = !!(sendBtn &&
            (sendBtn.disabled ||
             sendBtn.getAttribute('aria-disabled') === 'true' ||
             /\bdisabled\b/i.test(sendBtn.className || '')));

        return !(sendBtn && !disabled);
    }

    function bindInputListener() {
        const editor = getActiveEditor();
        if (!editor || editor.__sfvBound) return;
        const handler = () => instance?.evaluateState();
        editor.addEventListener('input', handler, { passive: true });
        editor.addEventListener('compositionend', handler, { passive: true });
        editor.__sfvBound = true;
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
