// ==UserScript==
// @name         [ChatGPT] State Favicons [20251210] v1.0.0
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon (modular): 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. ChatGPT-specific detectors live here; core logic is in state-favicon-core.js for reuse on other AI sites.
// @version      [20251210] v1.0.0
// @update-log   功能拆分：通用核心 + ChatGPT 脚本！
//
// Offical ChatGPT domains
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
//
// mirrored ChatGPT domains
// @match        https://chat.rawchat.cc/*
// @match        https://chat.sharedchat.*/*
// @match        https://*.oaifree.com/*
// @match        https://*.aivvm.*/*
// @match        https://*.donewell.cc/*
// @match        https://free.share-ai.top/*
// @match        https://chatgpt.aicnm.cc/*
//
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js
// @icon         https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/site_icons/ChatGPT.svg
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons] Core module not found. Check @require path.');
        return;
    }

    const instance = core.createStateFavicon({
        // override selectors or default icon here when porting to other sites
        selectors: {
            composer : 'form[data-type="unified-composer"], form.w-full[data-type]',
            sendBtn  : 'button[data-testid="send-button"]',
            stopBtn  : 'button[data-testid="stop-button"]',
            toastErr : '[data-testid="toast-error"]',
            errBtn   : 'button[data-testid="regenerate-thread-error-button"]',
            textarea : '#prompt-textarea'
        },
        hooks: {
            // ChatGPT-specific streaming detectors kept out of the core module
            isStreaming: () =>
                !!getProStopButton() ||
                hasDeepResearchProgress() ||
                hasImageGenerationSpinner()
        }
    });

    instance.start();

    /* ----------  ChatGPT-specific helpers (kept outside the core)  ---------- */
    function getProStopButton() {
        // GPT Pro 将 Stop 放在右侧栏底部：div[slot="trailing"] 内
        const trailing = document.querySelector('div[slot="trailing"]');
        if (!trailing) return null;
        const buttons = trailing.querySelectorAll('button');
        for (const btn of buttons) {
            if (/\bStop\b/i.test(btn.textContent || '')) return btn;
        }
        return null;
    }

    function hasDeepResearchProgress() {
        // Deep Research 卡片中的进度条
        return !!document.querySelector(
            'div.bg-token-main-surface-tertiary div.bg-token-text-primary'
        );
    }

    function hasImageGenerationSpinner() {
        // 生图 spinner：conversation options 按钮后跟随的 svg.animate-spin
        return !!document.querySelector(
            'button[data-testid="conversation-options-button"] + div svg.animate-spin'
        );
    }
})();

