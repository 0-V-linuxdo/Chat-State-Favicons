// ==UserScript==
// @name         [DeepSeek] State Favicons [20251211] v1.0.0
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for DeepSeek Chat: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with DeepSeek-specific selectors/hooks.
// @version      [20251211] v1.0.0
// @update-log   抽离 favicon 保护为通用模块并接入 DeepSeek 脚本；更新版本号
// @match        https://chat.deepseek.com/*
// @match        https://*.deepseek.com/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://chat.deepseek.com/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][DeepSeek] Core module not found. Check @require path.');
        return;
    }

    /* ----------  selectors tailored for DeepSeek  ---------- */
    const SELECTORS = {
        composer : [
            'textarea[placeholder*="DeepSeek"]',
            'form textarea[placeholder*="DeepSeek"]'
        ],
        textarea : 'textarea[placeholder*="DeepSeek"]',
        stopBtn  : [
            'div.ds-icon-button svg path[d^="M2 4.88"]',              // stop icon (square)
            '.ds-icon-button[role="button"][aria-label*="Stop"]'
        ],
        favicon  : 'link[rel~="icon"]'
    };

    let instance = null;
    let waitHref = null;

    function createInstance() {
        instance = core.createStateFavicon({
            selectors: SELECTORS,
            hooks: {
                isStreaming: () => !!getStopButton(),
                getContextKey: () => `${location.pathname}${location.search || ''}`,
                isInputEmpty: () => {
                    const ta = document.querySelector(SELECTORS.textarea);
                    if (!ta) return true;

                    const raw = (ta.value ?? ta.textContent ?? '').replace(/\u200B/g, '').trim();
                    if (raw.length > 0) return false;

                    // DeepSeek mirrors textarea content into a sibling div for resizing.
                    const mirror = ta.parentElement?.querySelector('.b13855df');
                    return !(mirror && mirror.textContent.trim().length > 0);
                }
            }
        });
        instance.start();
        waitHref = instance.icons.wait;
    }

    createInstance();

    // Favicon guard: reusable helper to keep our icon alive.
    const guardFactory = window.FaviconGuard && window.FaviconGuard.createFaviconGuard;
    let guard = null;
    if (typeof guardFactory === 'function') {
        guard = guardFactory({
            defaultHref: waitHref,
            iconId: 'state-favicon',
            removeCompetitors: true,
            insertFirst: true
        });
        guard.start();
    } else {
        console.warn('[StateFavicons][DeepSeek] FaviconGuard not found; consider adding @require.');
    }

    /* ----------  DeepSeek-specific helpers  ---------- */
    function getComposerRoot() {
        const ta = document.querySelector(SELECTORS.textarea);
        return ta?.closest('form') || ta?.parentElement || null;
    }

    function getStopButton() {
        const root = getComposerRoot() || document;
        // Prefer the explicit stop icon path seen during streaming.
        const path = root.querySelector('div.ds-icon-button svg path[d^="M2 4.88"]');
        if (path) return path.closest('.ds-icon-button');

        // Fallback: aria-label / title contains "Stop".
        const labeled = Array.from(
            root.querySelectorAll('.ds-icon-button[role="button"][aria-disabled]')
        ).find(btn => {
            const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`;
            return /stop/i.test(label);
        });
        return labeled || null;
    }
})();
