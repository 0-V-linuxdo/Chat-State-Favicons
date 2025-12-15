// ==UserScript==
// @name         [ChatGPT] State Favicons [20251215] v1.0.6
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon (modular): 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. ChatGPT-specific detectors live here; core logic is in state-favicon-core.js for reuse on other AI sites.
// @version      [20251215] v1.0.6
// @update-log   使用 core 新增 lazySignature/buildContextKeyFromUrl，复用通用上下文/签名 helper；版本提升至 v1.0.6。
//
// Offical ChatGPT domains
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
//
// mirrored ChatGPT domains
// @match        https://free.share-ai.top/*
// @match        https://chatgpt.aicnm.cc/*
//
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.6
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/ChatGPT/icon/ChatGPT.svg?v=20251215.0.0.6
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons] Core module not found. Check @require path.');
        return;
    }
    // Reuse core utilities (visibility/query helpers + shared helpers)
    const { isVisible, queryAny, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

    /* ----------  ChatGPT-specific helpers (kept outside the core)  ---------- */
    const SELECTORS = {
        composer : 'form[data-type="unified-composer"], form.w-full[data-type]',
        textarea : '#prompt-textarea',
        sendBtn  : 'button[data-testid="send-button"]',
        stopBtn  : 'button[data-testid="stop-button"]',
        toastErr : '[data-testid="toast-error"]',
        errBtn   : 'button[data-testid="regenerate-thread-error-button"]',
        favicon  : '#state-favicon, link[rel~="icon"]'
    };

    const { defaultIconHref } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: false,
        insertFirst: true,
        trackAttributes: ['href', 'rel']
    });

    function getComposerRoot() {
        const forms = Array.from(document.querySelectorAll(SELECTORS.composer));
        const visibleForm = forms.find(isVisible);
        if (visibleForm) return visibleForm;

        const ta = queryAny(document, SELECTORS.textarea);
        return ta?.closest('form') || ta?.parentElement || document.body;
    }

    function getSendButton() {
        const root = getComposerRoot() || document;
        return queryAny(root, SELECTORS.sendBtn);
    }

    function hasScopedStop() {
        const root = getComposerRoot() || document;
        return !!queryAny(root, SELECTORS.stopBtn, { visibleOnly: true });
    }

    function getProStopButton() {
        // GPT Pro 将 Stop 放在右侧栏底部：div[slot="trailing"] 内
        const trailing = document.querySelector('div[slot="trailing"]');
        if (!trailing) return null;
        const buttons = trailing.querySelectorAll('button');
        for (const btn of buttons) {
            if (!isVisible(btn)) continue;
            if (/\bStop\b/i.test(btn.textContent || '')) return btn;
        }
        return null;
    }

    function hasDeepResearchProgress() {
        // Deep Research 卡片中的进度条
        const el = document.querySelector('div.bg-token-main-surface-tertiary div.bg-token-text-primary');
        return !!(el && isVisible(el));
    }

    function hasImageGenerationSpinner() {
        // 生图 spinner：conversation options 按钮后跟随的 svg.animate-spin
        const el = document.querySelector('button[data-testid="conversation-options-button"] + div svg.animate-spin');
        return !!(el && isVisible(el));
    }

    function isStreamingExtra() {
        if (getProStopButton()) return true;

        // Submit（send）按钮可见：视为已结束/可输入状态（Stop→Submit）
        if (getSendButton()) return false;

        // 兜底：某些模式下可能没有 stop，但仍有明显的“生成中”标志
        if (hasDeepResearchProgress()) return true;
        if (hasImageGenerationSpinner()) return true;

        return false;
    }

    function getConversationToken() {
        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('conversationId') ||
            params.get('conversation_id') ||
            params.get('threadId') ||
            params.get('thread_id') ||
            params.get('chatId') ||
            params.get('chat_id') ||
            params.get('id') ||
            '';

        const parts = location.pathname.split('/').filter(Boolean);
        const at = (key) => {
            const i = parts.indexOf(key);
            return i >= 0 ? (parts[i + 1] || '') : '';
        };
        const byPrefix =
            at('c') ||
            at('chat') ||
            at('conversation') ||
            '';

        const last = parts.slice(-1)[0] || '';
        const lastId = /^[a-z0-9_-]{8,}$/i.test(last) ? last : '';

        const pickAttr = (sel, attr) => {
            try { return document.querySelector(sel)?.getAttribute(attr) || ''; }
            catch { return ''; }
        };
        const dataId =
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            '';

        return [dataId, paramId, byPrefix || lastId].filter(Boolean).join('|');
    }

    const contextLock = createContextLock({
        isStreaming: () => hasScopedStop() || isStreamingExtra(),
        getToken: () => getConversationToken(),
        getSignature: () => lazySignature('chatgpt', getComposerRoot() || document.body),
        buildKey: (token, sig) => buildContextKeyFromUrl({
            token,
            draftSig: () => sig || lazySignature('chatgpt', getComposerRoot() || document.body)
        })
    });

    const instance = core.createStateFavicon({
        selectors: {
            composer : SELECTORS.composer,
            textarea : SELECTORS.textarea,
            submitBtn: SELECTORS.sendBtn,
            toastErr : SELECTORS.toastErr,
            errBtn   : SELECTORS.errBtn,
            favicon  : SELECTORS.favicon,
            stopBtn  : SELECTORS.stopBtn
        },
        submitEndsStreaming: true,
        stopSearchScope: 'composer',
        stopMustBeVisible: true,
        hooks: {
            // ChatGPT-specific detectors kept out of the core module
            getContextKey: () => contextLock.getContextKey(),

            // Streaming 以“Stop 按钮存在”为准；Submit 按钮回归即视为结束（即使某些卡片/Spinner 仍存在）。
            isStreaming: () => isStreamingExtra()
        },
        defaultIconHref: defaultIconHref
    });

    instance.start();
})();
