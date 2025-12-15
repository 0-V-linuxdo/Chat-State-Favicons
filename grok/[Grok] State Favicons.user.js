// ==UserScript==
// @name         [Grok] State Favicons [20251215] v1.0.6
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Grok (x.ai): 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with Grok-specific selectors/hooks.
// @version      [20251215] v1.0.6
// @update-log   使用 core lazySignature/buildContextKeyFromUrl 复用上下文/签名构造；版本升级至 v1.0.6。
// @match        https://grok.com/*
// @match        https://*.grok.com/*
// @match        https://x.ai/*
// @match        https://*.x.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://grok.com/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Grok] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

    /* ----------  selectors tailored for Grok  ---------- */
    const SELECTORS = {
        // The contenteditable input area (TipTap/ProseMirror)
        textarea : '.tiptap.ProseMirror[contenteditable="true"]',
        // NOTE: core 默认不会观察 aria-label 属性变化，因此我们会用自定义 observer 触发 evaluateState
        // Stop button during streaming (label may vary; hook will do additional detection)
        stopBtn  : [
            'button[aria-label="Stop model response"]',
            'button[aria-label*="Stop"]',
            'button[aria-label*="stop"]'
        ],
        submitBtn: [
            'button[aria-label*="Send"]',
            'button[aria-label*="Submit"]',
            'button[type="submit"]',
            'button:not([aria-label*="Stop" i])'
        ],
        favicon  : 'link[rel~="icon"]'
    };

    const { defaultIconHref, guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });
    let instance = null;

    // observers / timers
    let buttonObserver = null;
    let rebinder = null;
    let urlTicker = null;

    // state bookkeeping for SPA stability
    let lastUrlKey = null;
    let lastContextKey = null;
    let rafScheduled = false;

    function scheduleEvaluate() {
        if (!instance) return;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            instance?.evaluateState();
        });
    }

    /**
     * Get the "active" editor (visible one preferred)
     */
    function getActiveEditor() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        return list.find(isVisible) || list[0] || null;
    }

    /**
     * Get a reasonable composer root around the editor (used to scope queries/observers)
     */
    function getComposerRoot() {
        const editor = getActiveEditor();
        return editor?.closest('form') || editor?.closest('div.relative') || editor?.parentElement || document.body;
    }

    function queryButtons(root) {
        try {
            const r = root || document;
            return Array.from(r.querySelectorAll('button'));
        } catch {
            return Array.from(document.querySelectorAll('button'));
        }
    }

    /**
     * Find the stop button during streaming (scope to composer root first).
     * Grok 可能通过 aria-label 在同一按钮上切换 stop/submit，因此需要匹配 aria-label 或文本线索。
     */
    function getStopButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of (Array.isArray(SELECTORS.stopBtn) ? SELECTORS.stopBtn : [SELECTORS.stopBtn])) {
            candidates.push(...root.querySelectorAll(sel));
        }
        // Fallback: match aria-label or text content containing "stop" (limit to composer scope)
        if (candidates.length === 0) {
            for (const btn of queryButtons(root)) {
                const label = btn.getAttribute('aria-label') || '';
                const text = btn.textContent || '';
                if (/stop/i.test(label) || /\bstop\b/i.test(text)) candidates.push(btn);
            }
        }
        return candidates.find(isVisible) || candidates[0] || null;
    }

    function getConversationToken() {
        // URL params (try common keys)
        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('conversationId') ||
            params.get('conversation_id') ||
            params.get('chatId') ||
            params.get('chat_id') ||
            params.get('threadId') ||
            params.get('thread_id') ||
            params.get('cid') ||
            params.get('id') ||
            '';

        // pathname last segment (if it looks like an id-ish token)
        const lastSeg = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        const pathId = /^[a-z0-9_-]{8,}$/i.test(lastSeg) ? lastSeg : '';

        // DOM data-* (best-effort; cheap selectors only)
        const pickAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        const dataId =
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-session-id]', 'data-session-id') ||
            '';

        return [dataId, paramId, pathId].filter(Boolean).join('|');
    }

    /**
     * Important:
     * core 的 "done" 判定要求：streamContext === contextKey（严格全等）。
     * 因此这里必须返回“稳定字符串”，不能在流式时返回 element、结束时又返回 string，否则会导致 done 漏判/乱跳。
     */
    function buildContextKey(token, sig) {
        const urlKey = `${location.origin}${location.pathname}`;
        return `${urlKey}|${token || ''}|${sig || 'no-sig'}`;
    }

    const contextLock = createContextLock({
        isStreaming: () => !!getStopButton(),
        getToken: () => getConversationToken(),
        getSignature: () => lazySignature('grok', getComposerRoot() || document.body),
        buildKey: (token, sig) => buildContextKeyFromUrl({
            token,
            draftSig: () => sig || lazySignature('grok', getComposerRoot() || document.body),
            includeSearch: false
        })
    });

    /**
     * Check if editor input is empty (ProseMirror)
     */
    function isInputEmpty() {
        const editor = getActiveEditor();
        if (!editor) return true;

        // ProseMirror empty placeholder pattern (best-effort)
        const emptyParagraph = editor.querySelector('p.is-empty.is-editor-empty');
        if (emptyParagraph) return true;

        const text = (editor.textContent || '').replace(/\u200B/g, '').trim();
        return text.length === 0;
    }

    function createInstance() {
        instance = core.createStateFavicon({
            selectors: SELECTORS,
            defaultIconHref,
            submitEndsStreaming: true,
            stopSearchScope: () => [getComposerRoot() || document],
            stopMustBeVisible: true,
            hooks: {
                isStreaming: () => !!getStopButton(),
                getContextKey: () => contextLock.getContextKey(),
                isInputEmpty: isInputEmpty
            }
        });
        instance.start();

        // input listener makes state changes respond immediately even if observer misses a mutation
        bindInputListener();
        setupButtonObserver();
    }

    /**
     * Bind input listener once per editor node.
     */
    function bindInputListener() {
        const editor = getActiveEditor();
        if (!editor || editor.__sfvBound) return;
        editor.addEventListener('input', scheduleEvaluate, { passive: true });
        editor.addEventListener('compositionend', scheduleEvaluate, { passive: true });
        editor.__sfvBound = true;
    }

    /**
     * Custom MutationObserver to detect button state changes via aria-label/type.
     * Core 的 localObserver 不观察 aria-label，因此必须补。
     * 这里做两点稳定性增强：
     *   1) 尽量将观察范围收敛到 composer root（找不到再退回 body）
     *   2) 使用 rAF 节流，避免大量 aria-label 变动导致 evaluateState 抖动/卡顿
     */
    function setupButtonObserver() {
        try { buttonObserver?.disconnect(); } catch {}

        buttonObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes') {
                    const t = m.target;
                    const a = m.attributeName;
                    if (t && t.tagName === 'BUTTON' && (a === 'aria-label' || a === 'type' || a === 'disabled' || a === 'aria-disabled' || a === 'class')) {
                        scheduleEvaluate();
                        break;
                    }
                } else if (m.type === 'childList') {
                    // stop/submit button may be swapped in/out
                    if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) {
                        scheduleEvaluate();
                        break;
                    }
                }
            }
        });

        const target = getComposerRoot() || document.body;
        if (!target) return;
        buttonObserver.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-label', 'type', 'disabled', 'aria-disabled', 'class']
        });
    }

    function restartInstance() {
        try { instance?.stop(); } catch {}
        // reset to wait icon to avoid stale spin/done sticking
        const link = document.getElementById('state-favicon');
        if (link && defaultIconHref) {
            link.href = defaultIconHref;
            link.classList.remove('spin');
        }
        createInstance();
        if (guard?.updateDefaultHref && defaultIconHref) guard.updateDefaultHref(defaultIconHref);
        lastUrlKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        lastContextKey = contextLock.getContextKey();
    }

    function init() {
        createInstance();
        lastUrlKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        lastContextKey = contextLock.getContextKey();

        // DOM rebinder: rebind input + re-scope observer when composer/editor changes
        try { rebinder?.disconnect(); } catch {}
        rebinder = new MutationObserver(() => {
            bindInputListener();

            const ctx = contextLock.getContextKey();
            if (ctx !== lastContextKey) {
                lastContextKey = ctx;
                restartInstance();
                return;
            }

            // If composer root changed, rescope the button observer
            setupButtonObserver();
            scheduleEvaluate();
        });
        if (document.body) rebinder.observe(document.body, { childList: true, subtree: true, attributes: true });

        // URL ticker: handle SPA route changes robustly
        if (urlTicker) clearInterval(urlTicker);
        urlTicker = setInterval(() => {
            const cur = `${location.origin}${location.pathname}${location.search}${location.hash}`;
            if (cur === lastUrlKey) return;
            lastUrlKey = cur;
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
