// ==UserScript==
// @name         [Chat] State Favicons (20250424.1)
// @namespace    0_V userscripts/[Chat] State Favicons
// @description  Dynamic favicon: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting (supports unified-composer 2025-04 UI)
// @version      20250424.1
// @author       0_V
//
// @match        https://chatgpt.com/*
// @match        https://chat.rawchat.cc/*
// @match        https://chat.sharedchat.*/*
// @match        https://*.oaifree.com/*
// @match        https://*.aivvm.*/*
// @match        https://*.donewell.cc/*
// @match        https://free.share-ai.top/*
// @match        https://chatgpt.aicnm.cc/*
//
// @icon         https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    'use strict';

    /* ----------  SVG emoji sprites  ---------- */
    const ICONS = {
        rotate : svg('🔄'),
        done   : svg('✔️'),
        ready  : svg('👍'),
        error  : svg('🚫')
    };
    function svg(e) {
        return `data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${e}</text></svg>`
        )}`;
    }

    /* ----------  favicon element & spin css  ---------- */
    const originalFaviconHref =
        document.querySelector('link[rel~="icon"]')?.href ||
        'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg';

    let favicon = document.querySelector('#state-favicon');
    if (!favicon) {
        favicon = document.createElement('link');
        favicon.id   = 'state-favicon';
        favicon.rel  = 'icon';
        favicon.type = 'image/svg+xml';
        document.head.appendChild(favicon);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes favicon-spin { to { transform: rotate(360deg); } }
            link#state-favicon.spin { animation: favicon-spin 1s linear infinite; }
        `;
        document.head.appendChild(style);
    }

    function setFavicon(k) {
        const icon = ICONS[k] ?? originalFaviconHref;
        favicon.href = icon;
        k === 'rotate' ? favicon.classList.add('spin') : favicon.classList.remove('spin');
    }

    /* ----------  selectors  ---------- */
    const SELECTORS = {
        composer   : 'form[data-type="unified-composer"], form.w-full[data-type]',
        sendBtn    : 'button[data-testid="send-button"]',
        stopBtn    : 'button[data-testid="stop-button"]',
        toastErr   : '[data-testid="toast-error"]',
        errBtnNew  : 'button[data-testid="regenerate-thread-error-button"]',
        textarea   : '#prompt-textarea'
    };

    /* ----------  helpers  ---------- */
    const state = { wasStreaming:false, justFinished:false };

    const getComposer = () => document.querySelector(SELECTORS.composer);

    const inputIsEmpty = () => {
        const ta = document.querySelector(SELECTORS.textarea);
        if (!ta) return true;
        return ta.textContent.replace(/\u200B/g, '').trim().length === 0;
    };

    const hasError = () =>
        !!document.querySelector(SELECTORS.toastErr)  ||
        !!document.querySelector(SELECTORS.errBtnNew) ||
        Array.from(document.querySelectorAll('button'))
             .some(b => /(Regenerate|Retry)/i.test(b.textContent));

    /* ----------  core evaluator  ---------- */
    function evaluateState() {
        /* errors first */
        if (hasError()) {
            setFavicon('error');
            Object.assign(state, { wasStreaming:false, justFinished:false });
            return;
        }

        /* streaming */
        if (document.querySelector(SELECTORS.stopBtn)) {
            Object.assign(state, { wasStreaming:true, justFinished:false });
            setFavicon('rotate');
            return;
        }

        /* just finished */
        if (state.wasStreaming) {
            state.wasStreaming = false;
            state.justFinished = true;
            setFavicon('done');
        }
        if (state.justFinished) {
            if (!inputIsEmpty()) {
                setFavicon('ready');
                state.justFinished = false;
            }
            return;
        }

        /* ready / wait by actual input content */
        inputIsEmpty() ? setFavicon('wait') : setFavicon('ready');
    }

    /* ----------  observers  ---------- */
    let composerRoot = getComposer();
    let localObserver;

    function observeComposer() {
        if (localObserver) localObserver.disconnect();
        composerRoot = getComposer();
        if (!composerRoot) return;

        localObserver = new MutationObserver(evaluateState);
        localObserver.observe(composerRoot, {
            childList:true,
            subtree:true,
            characterData:true,            // NEW: react to typing
            attributes:true,
            attributeFilter:['aria-disabled','disabled','data-testid','class']
        });
        evaluateState();
    }

    const globalObserver = new MutationObserver(() => {
        if (!document.contains(composerRoot)) observeComposer();
        evaluateState();                  // ensure reaction to error / DOM changes
    });
    globalObserver.observe(document.body, { childList:true, subtree:true });

    /* init */
    observeComposer();
})();
