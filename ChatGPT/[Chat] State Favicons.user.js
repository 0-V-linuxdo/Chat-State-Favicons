// ==UserScript==
// @name         [Chat] State Favicons (20251127) 5.1_T +icon
// @namespace    0_V userscripts/[Chat] State Favicons
// @description  Dynamic favicon: 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting (supports unified-composer 2025-04 UI, Deep Research, GPT Pro sidebar, image generation spinner)
// @version      20251127.1
// @author       0_V
//
// Core ChatGPT domains
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
//
// Known mirrors
// @match        https://chat.rawchat.cc/*
// @match        https://chat.sharedchat.*/*
// @match        https://*.oaifree.com/*
// @match        https://*.aivvm.*/*
// @match        https://*.donewell.cc/*
// @match        https://free.share-ai.top/*
// @match        https://chatgpt.aicnm.cc/*
//
// @icon         https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/site_icons/ChatGPT.svg
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
        stopBtn    : 'button[data-testid="stop-button"]', // classic / default UI
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

    // --- NEW: GPT Pro sidebar stop button detection ---
    function getProStopButton() {
        // GPT Pro 将 Stop 放在右侧栏底部：div[slot="trailing"] 内
        const trailing = document.querySelector('div[slot="trailing"]');
        if (!trailing) return null;

        // 在 trailing 区域查找文本包含 "Stop" 的按钮
        const buttons = trailing.querySelectorAll('button');
        for (const btn of buttons) {
            if (/\bStop\b/i.test(btn.textContent || '')) {
                return btn;
            }
        }
        return null;
    }

    // --- NEW: Deep Research progress bar detection ---
    function hasDeepResearchProgress() {
        // 基于提供的源码：
        // 外层：div.bg-token-main-surface-tertiary
        // 内层：div.bg-token-text-primary（宽度随进度变化）
        //
        // 这里不强依赖层级，只要存在“tertiary 容器 + primary 进度条”的组合即可
        const progress = document.querySelector(
            'div.bg-token-main-surface-tertiary div.bg-token-text-primary'
        );
        return !!progress;
    }

    // --- NEW: Image generation spinner detection (生图状态) ---
    function hasImageGenerationSpinner() {
        // 生图中示例结构：
        // <div class="relative" type="button" ...>
        //   <button data-testid="conversation-options-button">...</button>
        //   <div class="pointer-events-none ...">
        //     <svg class="animate-spin text-blue-400">...</svg>
        //   </div>
        // </div>
        //
        // 其他时候：没有后面的 div / svg.animate-spin
        //
        // 选择：conversation-options-button 紧随其后的兄弟 div 内有 svg.animate-spin。
        const spinner = document.querySelector(
            'button[data-testid="conversation-options-button"] + div svg.animate-spin'
        );
        return !!spinner;
    }

    // --- NEW: unified streaming detection ---
    function isStreaming() {
        // 1) 经典 UI：中间 stop 按钮
        if (document.querySelector(SELECTORS.stopBtn)) return true;

        // 2) GPT Pro：右侧栏底部 Stop 按钮
        if (getProStopButton()) return true;

        // 3) Deep Research：存在进度条卡片
        if (hasDeepResearchProgress()) return true;

        // 4) Image generation: conversation options button overlay spinner
        if (hasImageGenerationSpinner()) return true;

        return false;
    }

    /* ----------  core evaluator  ---------- */
    function evaluateState() {
        /* errors first */
        if (hasError()) {
            setFavicon('error');
            Object.assign(state, { wasStreaming:false, justFinished:false });
            return;
        }

        /* streaming (classic, Deep Research, GPT Pro sidebar, image generation) */
        if (isStreaming()) {
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
            characterData:true,            // react to typing
            attributes:true,
            attributeFilter:['aria-disabled','disabled','data-testid','class']
        });
        evaluateState();
    }

    const globalObserver = new MutationObserver(() => {
        if (!document.contains(composerRoot)) observeComposer();
        // 全局观察器可以捕获 Deep Research 卡片、GPT Pro 右侧栏以及生图 spinner 的变化
        evaluateState();
    });
    globalObserver.observe(document.body, { childList:true, subtree:true });

    /* init */
    observeComposer();
})();

