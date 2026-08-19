// ==UserScript==
// @name         [Grok] State Favicons [20260819] v1.1.0
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Grok favicon states with switchable styles: A badge+glyph · B color dot · internal black-hole tint · original icon.
// @version      [20260819] v1.1.0
// @update-log   撤回整底染色。黑洞染色改为只给 G 形吸积盘内部的洞上色；菜单仍为 原图标 / A / B / 黑洞染色。
// @match        https://grok.com/*
// @match        https://*.grok.com/*
// @match        https://x.ai/*
// @match        https://*.x.ai/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://grok.com/images/favicon.svg
// ==/UserScript==

(() => {
    'use strict';

    const core = (typeof window !== 'undefined' && window.StateFaviconCore)
        || (typeof self !== 'undefined' && self.StateFaviconCore);
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Grok] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

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

    const { defaultIconHref, guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });

    const officialHref = (defaultIconHref && !/^data:/i.test(defaultIconHref))
        ? defaultIconHref
        : `${location.origin}/images/favicon.svg`;

    const STORE_KEY = 'sfv-grok-style';
    const STYLES = [
        { id: 'original', label: '原图标' },
        { id: 'a',        label: 'A 角标+符号' },
        { id: 'b',        label: 'B 纯色圆点' },
        { id: 'hole',     label: '黑洞染色' }
    ];

    const GROK_MARK_PATH = 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815';

    const BADGE = {
        rotate: '#3B82F6',
        done:   '#22C55E',
        ready:  '#F59E0B',
        error:  '#EF4444'
    };

    const HOLE_IDLE = '#050505';
    const GROK_BG_PATH = 'M0 256C0 166.392 0 121.587 17.439 87.3615C32.7787 57.2556 57.2556 32.7787 87.3615 17.439C121.587 0 166.392 0 256 0C345.608 0 390.413 0 424.638 17.439C454.744 32.7787 479.221 57.2556 494.561 87.3615C512 121.587 512 166.392 512 256C512 345.608 512 390.413 494.561 424.638C479.221 454.744 454.744 479.221 424.638 494.561C390.413 512 345.608 512 256 512C166.392 512 121.587 512 87.3615 494.561C57.2556 479.221 32.7787 454.744 17.439 424.638C0 390.413 0 345.608 0 256Z';
    const GROK_MARK_P1 = 'M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794';
    const GROK_MARK_P2 = 'M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677';

    function readStoredStyle() {
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue(STORE_KEY, '');
                if (v) return v;
            }
        } catch { /* ignore */ }
        try {
            return localStorage.getItem(STORE_KEY) || '';
        } catch {
            return '';
        }
    }

    function writeStoredStyle(id) {
        try { if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, id); } catch { /* ignore */ }
        try { localStorage.setItem(STORE_KEY, id); } catch { /* ignore */ }
    }

    function normalizeStyle(id) {
        return STYLES.some((s) => s.id === id) ? id : 'a';
    }

    let currentStyle = normalizeStyle(readStoredStyle());

    function grokMarkSvg(holeColor) {
        return [
            `<rect width="64" height="64" rx="14" fill="${holeColor || HOLE_IDLE}"/>`,
            '<g transform="translate(8 8) scale(2)" fill="#FCFCFC" fill-rule="evenodd">',
            `<path d="${GROK_MARK_PATH}"/>`,
            '</g>'
        ].join('');
    }

    function toSvgData(inner, viewBox) {
        const box = viewBox || '0 0 64 64';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="64" height="64">${inner}</svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function officialGrokSvg(holeColor) {
        const hole = holeColor
            ? `<circle cx="248" cy="254" r="46" fill="${holeColor}"/>`
            : '';
        return [
            `<path d="${GROK_BG_PATH}" fill="${HOLE_IDLE}"/>`,
            hole,
            `<path d="${GROK_MARK_P1}" fill="#FCFCFC"/>`,
            `<path d="${GROK_MARK_P2}" fill="#FCFCFC"/>`
        ].join('');
    }

    function badgeGlyph(kind) {
        if (kind === 'rotate') {
            return [
                '<g transform="translate(51.5 51.5)"><g>',
                '<path d="M0-6.1 A6.1 6.1 0 1 1 -5.3 3.05" fill="none" stroke="#fff" stroke-width="2.15" stroke-linecap="round"/>',
                '<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.85s" repeatCount="indefinite"/>',
                '</g></g>'
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

    function composeSvgIcon(kind, style) {
        if (style === 'original') return officialHref;

        const color = BADGE[kind];

        if (style === 'hole') {
            return toSvgData(officialGrokSvg(color || ''), '0 0 512 512');
        }

        let badge = '';
        if (color) {
            if (style === 'b') {
                badge = [
                    '<circle cx="52.2" cy="52.2" r="10.4" fill="#050505"/>',
                    `<circle cx="52.2" cy="52.2" r="7.7" fill="${color}"/>`
                ].join('');
            } else {
                badge = [
                    '<circle cx="51.5" cy="51.5" r="12.15" fill="#050505"/>',
                    `<circle cx="51.5" cy="51.5" r="9.55" fill="${color}"/>`,
                    badgeGlyph(kind)
                ].join('');
            }
        }
        return toSvgData(grokMarkSvg(HOLE_IDLE) + badge);
    }

    function buildIcons(style) {
        return {
            wait:   composeSvgIcon('wait', style),
            rotate: composeSvgIcon('rotate', style),
            done:   composeSvgIcon('done', style),
            ready:  composeSvgIcon('ready', style),
            error:  composeSvgIcon('error', style)
        };
    }

    let overlayIcons = buildIcons(currentStyle);
    let baseFaviconHref = overlayIcons.wait;
    if (guard?.updateDefaultHref) guard.updateDefaultHref(baseFaviconHref);

    let instance = null;
    let buttonObserver = null;
    let rebinder = null;
    let urlTicker = null;
    let lastUrlKey = null;
    let lastContextKey = null;
    let rafScheduled = false;
    const menuIds = [];

    function scheduleEvaluate() {
        if (!instance) return;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            instance?.evaluateState();
        });
    }

    function applyStyle(id) {
        currentStyle = normalizeStyle(id);
        writeStoredStyle(currentStyle);
        overlayIcons = buildIcons(currentStyle);
        baseFaviconHref = overlayIcons.wait;
        if (instance && typeof instance.updateIcons === 'function') {
            instance.updateIcons(overlayIcons);
            if (typeof instance.updateDefaultIcon === 'function') instance.updateDefaultIcon(baseFaviconHref);
            instance.evaluateState();
        }
        if (guard?.updateDefaultHref) guard.updateDefaultHref(baseFaviconHref);
        const link = document.getElementById('state-favicon');
        if (link && currentStyle === 'original') {
            link.href = officialHref;
            link.classList.remove('spin');
        }
        registerMenus();
    }

    function registerMenus() {
        const register = (typeof GM_registerMenuCommand === 'function') ? GM_registerMenuCommand : null;
        const unregister = (typeof GM_unregisterMenuCommand === 'function') ? GM_unregisterMenuCommand : null;
        if (!register) return;

        while (menuIds.length) {
            const id = menuIds.pop();
            try { if (unregister) unregister(id); } catch { /* ignore */ }
        }

        for (const style of STYLES) {
            const mark = style.id === currentStyle ? '✓ ' : '　';
            const name = `${mark}样式：${style.label}`;
            try {
                const id = register(name, () => applyStyle(style.id), style.id);
                if (id !== undefined && id !== null) menuIds.push(id);
            } catch {
                try { register(name, () => applyStyle(style.id)); } catch { /* ignore */ }
            }
        }
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
        overlayIcons = buildIcons(currentStyle);
        baseFaviconHref = overlayIcons.wait;
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
        registerMenus();
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
