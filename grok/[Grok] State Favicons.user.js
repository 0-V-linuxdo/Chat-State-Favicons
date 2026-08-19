// ==UserScript==
// @name         [Grok] State Favicons [20260819] v1.0.7
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Keep the Grok favicon and overlay a corner status badge: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · idle = original icon.
// @version      [20260819] v1.0.7
// @update-log   不再整颗替换 favicon，改为在原站点图标右下角叠加状态徽标（仅 Grok 脚本）。
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
        // Prefer the official SVG mark so the overlay sits on a crisp base.
        favicon  : 'link[rel="icon"][type="image/svg+xml"], link[rel~="icon"]'
    };

    const { defaultIconHref, guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });

    const GROK_FALLBACK_ICON = `${location.origin}/images/favicon.svg`;
    const baseFaviconHref = (defaultIconHref && !/^data:/i.test(defaultIconHref))
        ? defaultIconHref
        : GROK_FALLBACK_ICON;

    let instance = null;

    // observers / timers
    let buttonObserver = null;
    let rebinder = null;
    let urlTicker = null;

    // state bookkeeping for SPA stability
    let lastUrlKey = null;
    let lastContextKey = null;
    let rafScheduled = false;
    let buildGen = 0;

    function scheduleEvaluate() {
        if (!instance) return;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            instance?.evaluateState();
        });
    }

    /* ----------  overlay badges (Grok-only; core still just swaps href)  ---------- */
    const OVERLAY = {
        size: 64,
        cx: 48,
        cy: 48,
        ring: 16.2,
        fill: 13.6,
        colors: {
            rotate: '#2563EB',
            done:   '#16A34A',
            ready:  '#D97706',
            error:  '#DC2626'
        }
    };

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('readAsDataURL failed'));
            reader.readAsDataURL(blob);
        });
    }

    async function hrefToDataUrl(href) {
        if (!href) return null;
        if (/^data:/i.test(href)) return href;
        const url = new URL(href, location.href).href;
        try {
            const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
            if (!res.ok) throw new Error(String(res.status));
            return await blobToDataUrl(await res.blob());
        } catch {
            return null;
        }
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('favicon image load failed'));
            img.src = src;
        });
    }

    function fallbackBaseDataUrl() {
        // Dark rounded square matching Grok's mark, used only if the live favicon cannot be read.
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#050505"/></svg>'
        )}`;
    }

    async function rasterizeBase(href, size) {
        const dataUrl = await hrefToDataUrl(href);
        const src = dataUrl || href;
        try {
            const img = await loadImage(src);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('no 2d context');
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            return canvas.toDataURL('image/png');
        } catch {
            return dataUrl;
        }
    }

    function badgeGlyph(kind) {
        if (kind === 'rotate') {
            return `
              <g transform="translate(48 48)">
                <g>
                  <path d="M0-7.4 a7.4 7.4 0 1 1 -6.4 3.7" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
                  <path d="M-7.6-1.2 L-3.8-0.2 L-6.2 3.4 Z" fill="#fff"/>
                  <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.9s" repeatCount="indefinite"/>
                </g>
              </g>`;
        }
        if (kind === 'done') {
            return '<polyline points="41.2,48.2 45.8,53 55.2,41.8" fill="none" stroke="#fff" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        if (kind === 'ready') {
            return '<path d="M44.6 52.6 V45.8 h-2.1 c-1.35 0-2.15-1.15-1.85-2.4 l1.15-4.6 c.35-1.35 1.7-2.15 3-1.7 .65.22 1.1.85 1.2 1.55 l.35 3.15 h7.1 c1.4 0 2.45 1.25 2.15 2.65 l-1.2 5.2 c-.3 1.3-1.55 2.15-2.9 2.15 H44.6z" fill="#fff"/>';
        }
        return [
            '<line x1="42.2" y1="42.2" x2="53.8" y2="53.8" stroke="#fff" stroke-width="3.1" stroke-linecap="round"/>',
            '<line x1="53.8" y1="42.2" x2="42.2" y2="53.8" stroke="#fff" stroke-width="3.1" stroke-linecap="round"/>'
        ].join('');
    }

    function composeOverlay(baseDataUrl, kind) {
        const { size, cx, cy, ring, fill, colors } = OVERLAY;
        const href = String(baseDataUrl)
            .replace(/&/g, '\u0026amp;')
            .replace(/"/g, '\u0026quot;')
            .replace(/</g, '\u0026lt;');
        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
            `<image href="${href}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`,
            `<circle cx="${cx}" cy="${cy}" r="${ring}" fill="#fff"/>`,
            `<circle cx="${cx}" cy="${cy}" r="${fill}" fill="${colors[kind]}"/>`,
            badgeGlyph(kind),
            '</svg>'
        ].join('');
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    const overlayCache = new Map();

    async function buildOverlayIcons(baseHref) {
        const key = baseHref || '__none__';
        if (overlayCache.has(key)) return overlayCache.get(key);

        const raster = await rasterizeBase(baseHref, OVERLAY.size);
        const base = raster || fallbackBaseDataUrl();
        const icons = {
            wait: baseHref || base,
            rotate: composeOverlay(base, 'rotate'),
            done: composeOverlay(base, 'done'),
            ready: composeOverlay(base, 'ready'),
            error: composeOverlay(base, 'error')
        };
        overlayCache.set(key, icons);
        return icons;
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

    async function createInstance() {
        const gen = ++buildGen;
        const icons = await buildOverlayIcons(baseFaviconHref);
        if (gen !== buildGen) return;

        instance = core.createStateFavicon({
            selectors: SELECTORS,
            defaultIconHref: baseFaviconHref,
            icons,
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

    async function restartInstance() {
        try { instance?.stop(); } catch {}
        instance = null;
        // reset to the original site icon (no badge) to avoid stale spin/done sticking
        const link = document.getElementById('state-favicon');
        if (link && baseFaviconHref) {
            link.href = baseFaviconHref;
            link.classList.remove('spin');
        }
        await createInstance();
        if (guard?.updateDefaultHref && baseFaviconHref) guard.updateDefaultHref(baseFaviconHref);
        lastUrlKey = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        lastContextKey = contextLock.getContextKey();
    }

    async function init() {
        await createInstance();
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
