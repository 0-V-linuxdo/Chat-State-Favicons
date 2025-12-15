// ==UserScript==
// @name         [Perplexity] State Favicons [20251211] v1.1.0
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Perplexity: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with perplexity.ai-specific selectors/hooks.
// @version      [20251211] v1.1.0
// @update-log   适配 Perplexity：基于 voice/submit/stop 按钮与输入内容判定状态，使用上下文 key 防止切换会话误判结束，默认/等待图标使用官方 favicon。
// @match        https://www.perplexity.ai/*
// @match        https://perplexity.ai/*
// @match        https://*.perplexity.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js
// @icon         https://www.perplexity.ai/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Perplexity] Core module not found. Check @require path.');
        return;
    }

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
        favicon: 'link[rel~="icon"]'
    };

    const DEFAULT_WAIT_ICON = 'https://www.perplexity.ai/favicon.ico';

    let instance = null;
    let waitHref = DEFAULT_WAIT_ICON;
    let lastHref = location.href;
    let lastContextKey = null;

    const isVisible = (el) => !!(
        el &&
        el.isConnected &&
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== 'hidden' &&
        getComputedStyle(el).display !== 'none'
    );

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

    function getComposerSignature() {
        const root = getComposerRoot() || document.body;
        if (!root) return 'no-root';
        if (!root.__sfvPplxSig) {
            root.__sfvPplxSig = `pplx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }
        return root.__sfvPplxSig;
    }

    function getContextKey() {
        const token = getConversationToken();
        const base = `${location.origin}${location.pathname}${location.search}`;
        return token ? `${base}|${token}` : `${base}|${getComposerSignature()}`;
    }

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
            defaultIconHref: DEFAULT_WAIT_ICON,
            hooks: {
                isStreaming: () => !!getStopButton(),
                isInputEmpty: () => isInputEmpty(),
                getContextKey: () => getContextKey()
            }
        });
        instance.start();
        waitHref = instance.icons.wait;
        lastContextKey = getContextKey();
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
        lastHref = location.href;
        lastContextKey = getContextKey();
    }

    function init() {
        createInstance();
        bindInputListener();
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
