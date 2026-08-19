// ==UserScript==
// @name         [Grok] State Favicons [20260819] v1.0.8
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Keep a vector Grok mark and overlay a small SVG corner badge: streaming / done / ready / error. Idle = original mark, no badge.
// @version      [20260819] v1.0.8
// @update-log   方案 A：纯 SVG 重绘 Grok 标 + 右下角小角标（对勾/叉/弧/上箭头），不再栅格化替换整颗 favicon。
// @match        https://grok.com/*
// @match        https://*.grok.com/*
// @match        https://x.ai/*
// @match        https://*.x.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://grok.com/images/favicon.svg
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
        textarea : '.tiptap.ProseMirror[contenteditable="true"]',
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
        favicon  : 'link[rel="icon"][type="image/svg+xml"], link[rel~="icon"]'
    };

    const { guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });

    /* ----------  Scheme A: vector Grok mark + small SVG corner badge  ---------- */
    const GROK_MARK_PATH = 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815';

    const BADGE = {
        rotate: '#3B82F6',
        done:   '#22C55E',
        ready:  '#F59E0B',
        error:  '#EF4444'
    };

    function grokMarkSvg() {
        return [
            '<rect width="64" height="64" rx="14" fill="#050505"/>',
            '<g transform="translate(8 8) scale(2)" fill="#FCFCFC" fill-rule="evenodd">',
            `<path d="${GROK_MARK_PATH}"/>`,
            '</g>'
        ].join('');
    }

    function badgeGlyph(kind) {
        if (kind === 'rotate') {
            return [
                '<g transform="translate(51.5 51.5)">',
                '<g>',
                '<path d="M0-6.1 A6.1 6.1 0 1 1 -5.3 3.05" fill="none" stroke="#fff" stroke-width="2.15" stroke-linecap="round"/>',
                '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.85s" repeatCount="indefinite"/>',
                '</g>',
                '</g>'
            ].join('');
        }
        if (kind === 'done') {
            return '<path d="M46.6 51.7 L50.1 55.3 L56.8 47.4" fill="none" stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        if (kind === 'ready') {
            return [
                '<path d="M51.5 56.4 V46.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
                '<path d="M46.6 51.2 L51.5 46.2 L56.4 51.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
            ].join('');
        }
        return [
            '<path d="M47.2 47.2 L55.8 55.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
            '<path d="M55.8 47.2 L47.2 55.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>'
        ].join('');
    }

    function composeSvgIcon(kind) {
        const color = BADGE[kind];
        const badge = color
            ? [
                '<circle cx="51.5" cy="51.5" r="12.15" fill="#050505"/>',
                `<circle cx="51.5" cy="51.5" r="9.55" fill="${color}"/>`,
                badgeGlyph(kind)
            ].join('')
            : '';
        const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
            grokMarkSvg(),
            badge,
            '</svg>'
        ].join('');
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    const overlayIcons = {
        wait:   composeSvgIcon('wait'),
        rotate: composeSvgIcon('rotate'),
        done:   composeSvgIcon('done'),
        ready:  composeSvgIcon('ready'),
        error:  composeSvgIcon('error')
    };
    const baseFaviconHref = overlayIcons.wait;

    if (guard?.updateDefaultHref) guard.updateDefaultHref(baseFaviconHref);

    let instance = null;
    let buttonObserver = null;
    let rebinder = null;
    let urlTicker = null;
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

    function getActiveEditor() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        return list.find(isVisible) || list[0] || null;
    }

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

    function getStopButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of (Array.isArray(SELECTORS.stopBtn) ? SELECTORS.stopBtn : [SELECTORS.stopBtn])) {
            candidates.push(...root.querySelectorAll(sel));
        }
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

        const lastSeg = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        const pathId = /^[a-z0-9_-]{8,}$/i.test(lastSeg) ? lastSeg : '';

        const pickAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
        const dataId =
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-session-id]', 'data-session-id') ||
            '';

        return [dataId, paramId, pathId].filter(Boolean).join('|');
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

    function isInputEmpty() {
        const editor = getActiveEditor();
        if (!editor) return true;
        const emptyParagraph = editor.querySelector('p.is-empty.is-editor-empty');
        if (emptyParagraph) return true;
        const text = (editor.textContent || '').replace(/\u200B/g, '').trim();
        return text.length === 0;
    }

    function createInstance() {
        instance = core.createStateFavicon({
            selectors: SELECTORS,
            defaultIconHref: baseFaviconHref,
            icons: overlayIcons,
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
        bindInputListener();
        setupButtonObserver();
    }

    function bindInputListener() {
        const editor = getActiveEditor();
        if (!editor || editor.__sfvBound) return;
        editor.addEventListener('input', scheduleEvaluate, { passive: true });
        editor.addEventListener('compositionend', scheduleEvaluate, { passive: true });
        editor.__sfvBound = true;
    }

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
        instance = null;
        const link = document.getElementById('state-favicon');
        if (link && baseFaviconHref) {
            link.href = baseFaviconHref;
            link.classList.remove('spin');
        }
        createInstance();
        if (guard?.updateDefaultHref && baseFaviconHref) guard.updateDefaultHref(baseFaviconHref);
        lastUrlKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        lastContextKey = contextLock.getContextKey();
    }

    function init() {
        createInstance();
        lastUrlKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        lastContextKey = contextLock.getContextKey();

        try { rebinder?.disconnect(); } catch {}
        rebinder = new MutationObserver(() => {
            bindInputListener();

            const ctx = contextLock.getContextKey();
            if (ctx !== lastContextKey) {
                lastContextKey = ctx;
                restartInstance();
                return;
            }

            setupButtonObserver();
            scheduleEvaluate();
        });
        if (document.body) rebinder.observe(document.body, { childList: true, subtree: true, attributes: true });

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
