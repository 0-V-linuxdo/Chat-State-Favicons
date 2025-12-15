// ==UserScript==
// @name         [Kagi] State Favicons [20251215] v1.1.1
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Kagi Assistant (modular): 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses shared core module; fixes done-state by requiring stop→submit transition and context safety.
// @version      [20251215] v1.1.1
// @update-log   v1.1.1: 适配 Kagi “under construction” 报错态（construction 图 + refresh 按钮），立即标记为 error；保留 v1.1.0 的 Stop 检测修复。
// @match        https://kagi.com/assistant*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @icon         https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/Kagi/icon/assistant.svg
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Kagi] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, toArray, queryAny: coreQueryAny, lazySignature, buildContextKeyFromUrl } = core.utils;

    const SELECTORS = {
        composer: [
            'form#form',
            '#form form',
            'form[action*="assistant"]',
            'form'
        ],
        promptBox: [
            '#promptBox',
            'textarea#promptBox',
            '[contenteditable="true"]#promptBox',
            '[contenteditable="true"][role="textbox"]',
            'textarea[placeholder*="Ask"]',
            'textarea'
        ],
        submitBtn: [
            '#submit',
            'button#submit',
            'input#submit',
            'button[type="submit"]',
            'input[type="submit"]',
            'button[aria-label*="Send" i]',
            'button[aria-label*="Submit" i]'
        ],
        stopBtn: [
            'button.stop-btn',
            '#stop',
            'button#stop',
            'button[aria-label*="Stop" i]',
            'button[title*="Stop" i]',
            'button[aria-label*="Cancel" i]',
            'button[title*="Cancel" i]',
            'button[data-testid*="stop" i]',
            'button[data-testid*="cancel" i]'
        ],
        errorMsg: [
            '.error-message',
            '.alert-error',
            '.toast-error',
            '[role="alert"]',
            '.flash.flash-error'
        ],
        errorBtn: [
            'button[aria-label*="retry" i]',
            'button[aria-label*="regenerate" i]',
            'button[aria-label*="try again" i]'
        ],
        favicon: 'link[rel~="icon"]'
    };

    function queryVisible(scope, selectorOrList) {
        if (!scope) return null;
        const selectors = toArray(selectorOrList);
        for (const sel of selectors) {
            let list = [];
            try { list = Array.from(scope.querySelectorAll(sel)); } catch (_) { /* ignore invalid selectors */ }
            const found = list.find(isVisible);
            if (found) return found;
        }
        // fallback: if nothing visible, allow core's queryAny to pick first match (rare)
        return coreQueryAny(scope, selectorOrList);
    }

    function getPromptBox() {
        return queryVisible(document, SELECTORS.promptBox);
    }

    function getComposerRoot() {
        const form = document.querySelector('form#form');
        if (form) return form;

        const editor = getPromptBox();
        if (editor) {
            const closestForm = editor.closest('form');
            if (closestForm) return closestForm;
            return editor.parentElement || document.body;
        }

        return document.querySelector('form') || document.body;
    }

    function getStopButton() {
        // 桌面 Stop 按钮通常在工具栏；确保只取“可见”按钮，避免被隐藏的移动端节点误判为 streaming。
        const scopes = [];
        const root = getComposerRoot();
        if (root) scopes.push(root);
        scopes.push(document);

        for (const scope of scopes) {
            const selectors = toArray(SELECTORS.stopBtn);
            for (const sel of selectors) {
                let list = [];
                try { list = Array.from(scope.querySelectorAll(sel)); } catch (_) { /* ignore invalid selectors */ }
                const found = list.find(isVisible);
                if (found) return found;
            }
        }
        return null;
    }

    function getSubmitButton() {
        const root = getComposerRoot();
        const stop = getStopButton();

        const candidates = [];
        for (const sel of SELECTORS.submitBtn) {
            try { candidates.push(...root.querySelectorAll(sel)); } catch (_) { /* ignore */ }
        }

        const btn = candidates.find((b) => isVisible(b) && b !== stop) || candidates.find((b) => b !== stop) || null;
        if (!btn) return null;

        // Avoid mis-identifying the stop button as submit.
        if (stop && btn === stop) return null;
        if (btn.matches && btn.matches(toArray(SELECTORS.stopBtn).join(','))) return null;
        return btn;
    }

    function isInputEmpty() {
        const box = getPromptBox();
        if (!box) return true;

        const text = (('value' in box) ? (box.value || '') : (box.textContent || ''))
            .replace(/\u200B/g, '')
            .trim();

        return text.length === 0;
    }

    function hasError() {
        const msg = queryVisible(document, SELECTORS.errorMsg);
        if (msg && isVisible(msg)) return true;

        const errBtn = queryVisible(document, SELECTORS.errorBtn);
        if (errBtn && isVisible(errBtn)) return true;

        // Kagi "under construction" state (shows construction image + refresh button).
        const construction = document.querySelector('.content[data-content] img[src*="assistant/construction"]');
        if (construction && isVisible(construction)) return true;

        // Generic fallback: visible buttons hinting retry/regenerate/error.
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
            if (!isVisible(b)) continue;
            const t = (b.textContent || '').trim();
            if (/(Regenerate|Retry|Try again|Error|Failed|错误|重试|重新生成|失败)/i.test(t)) return true;
        }

        return false;
    }

    function getConversationToken() {
        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('id') ||
            params.get('thread') ||
            params.get('thread_id') ||
            params.get('chat') ||
            params.get('chat_id') ||
            params.get('conversation') ||
            params.get('conversation_id') ||
            params.get('cid') ||
            params.get('sid') ||
            params.get('session') ||
            params.get('session_id') ||
            '';

        const pickAttr = (sel, attr) => {
            try { return document.querySelector(sel)?.getAttribute(attr) || ''; }
            catch { return ''; }
        };

        const dataId =
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            pickAttr('[data-chat-id]', 'data-chat-id') ||
            pickAttr('[data-session-id]', 'data-session-id') ||
            pickAttr('#promptBox[data-thread-id]', 'data-thread-id') ||
            pickAttr('#promptBox[data-conversation-id]', 'data-conversation-id') ||
            '';

        const activeLink = document.querySelector('a[aria-current="page"][href*="/assistant"], a[aria-current="true"][href*="/assistant"]');
        const activeHref = (activeLink && (activeLink.getAttribute('href') || '')) || '';

        const pathPart = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';

        return [dataId, paramId, activeHref, pathPart].filter(Boolean).join('|');
    }

    function getContextKey() {
        const token = getConversationToken();
        return buildContextKeyFromUrl({
            token,
            draftSig: () => lazySignature('kagi', getComposerRoot() || document.body),
            includeHash: true
        });
    }

    let instance = null;
    let lastContextKey = null;
    let lastHref = location.href;
    let waitHref = 'https://kagi.com/favicon-assistant-32x32.png';

    // 兜底 Stop 探测：当选择器失效时，按文本/aria/title 或按钮内的 spinner 识别。
    function findStopByTextOrSpinner() {
        const scopes = [];
        const root = getComposerRoot();
        if (root) scopes.push(root);
        scopes.push(document);

        const labelRegex = /\b(stop|cancel|abort|结束|停止|中止|取消|终止)\b/i;
        const spinnerSel = 'svg.animate-spin, svg[class*="animate-spin"], svg[class*="spinner"], [class*="spinner"] svg, [class*="loader"] svg';

        for (const scope of scopes) {
            const buttons = scope.querySelectorAll('button, [role="button"]');
            for (const btn of buttons) {
                if (!isVisible(btn)) continue;
                const label = `${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`;
                if (labelRegex.test(label)) return btn;
                if (btn.querySelector(spinnerSel)) return btn;
            }
        }
        return null;
    }

    // 兜底流式探测：Stop 按钮不可见时，基于可见 spinner / busy 状态判定 streaming。
    function hasStreamingIndicator() {
        const scopes = [];
        const root = getComposerRoot();
        if (root) scopes.push(root);
        scopes.push(document);

        const spinnerSelectors = [
            'svg.animate-spin',
            'svg[class*="animate-spin"]',
            'svg[class*="spinner"]',
            '[class*="spinner"] svg',
            '[class*="loader"]',
            '[class*="loading"] svg',
            '[data-testid*="spinner" i]',
            '[data-testid*="loading" i]',
            '[data-loading="true"]',
            '[aria-busy="true"]',
            '[role="status"] svg',
            '[aria-live="polite"] svg.animate-spin'
        ];

        for (const scope of scopes) {
            if (coreQueryAny(scope, spinnerSelectors, { visibleOnly: true })) return true;
        }

        // Submit 按钮处于忙碌/禁用并带 spinner 也视为 streaming。
        const composer = getComposerRoot();
        if (composer) {
            for (const sel of toArray(SELECTORS.submitBtn)) {
                try {
                    const btn = composer.querySelector(sel);
                    if (!btn || !isVisible(btn)) continue;
                    if (btn.matches('[aria-busy="true"], [data-loading="true"]')) return true;
                    if (btn.disabled && btn.querySelector('svg')) return true;
                } catch {
                    /* ignore invalid selector */
                }
            }
        }

        return false;
    }

    function bindInputListener() {
        const box = getPromptBox();
        if (!box || box.__sfvBound) return;

        const handler = () => setTimeout(() => instance?.evaluateState(), 0);
        box.addEventListener('input', handler, { passive: true });
        box.addEventListener('keyup', handler, { passive: true });
        box.addEventListener('paste', handler, { passive: true });
        box.addEventListener('cut', handler, { passive: true });
        box.addEventListener('compositionend', handler, { passive: true });

        box.__sfvBound = true;
    }

    function createInstance() {
        // Disable core's base stopBtn detection (it may treat hidden nodes as streaming).
        // We fully control streaming detection via hooks.isStreaming for Kagi.
        instance = core.createStateFavicon({
            selectors: {
                composer: SELECTORS.composer,
                textarea: [],
                stopBtn: [],
                submitBtn: SELECTORS.submitBtn,
                favicon: SELECTORS.favicon
            },
            defaultIconHref: waitHref,
            submitEndsStreaming: true,
            stopSearchScope: () => [getComposerRoot() || document],
            stopMustBeVisible: true,
            hooks: {
                getContextKey: () => getContextKey(),
                isInputEmpty: () => isInputEmpty(),
                hasError: () => hasError(),

                // Streaming: visible & enabled Stop button.
                isStreaming: () => {
                    const stop = getStopButton() || findStopByTextOrSpinner();
                    if (stop && isVisible(stop) && !stop.disabled) return true;
                    return hasStreamingIndicator();
                }
            }
        });

        instance.start();
        waitHref = instance.icons.wait;
        lastContextKey = getContextKey();
        bindInputListener();
    }

    /**
     * Restart instance: stops old instance and creates a fresh one.
     * This resets wasStreaming/justFinished, preventing false "done" on context switch.
     */
    function restartInstance() {
        if (instance) {
            instance.stop();
            // Reset favicon to wait state before creating new instance
            const link = document.getElementById('state-favicon');
            if (link && waitHref) {
                link.href = waitHref;
                link.classList.remove('spin');
            }
        }
        createInstance();
    }

    function init() {
        createInstance();

        // Monitor for SPA navigation and context changes.
        // When context changes (e.g., switching threads), restart instance to reset state.
        const contextWatcher = new MutationObserver(() => {
            bindInputListener();

            const currentKey = getContextKey();
            const currentHref = location.href;

            // If context changed, restart instance to reset wasStreaming/justFinished.
            // This prevents "done" from appearing when switching away from a streaming chat.
            if (currentKey !== lastContextKey || currentHref !== lastHref) {
                const wasStreaming = instance?.getState?.()?.wasStreaming;

                // Only restart if we were streaming (to avoid unnecessary restarts).
                // Or if URL changed significantly.
                if (wasStreaming || currentHref !== lastHref) {
                    lastHref = currentHref;
                    lastContextKey = currentKey;
                    restartInstance();
                    return;
                }

                lastHref = currentHref;
                lastContextKey = currentKey;
            }

            instance?.evaluateState();
        });

        if (document.body) {
            contextWatcher.observe(document.body, { childList: true, subtree: true, attributes: true });
        }

        // Backup: periodic check for URL/context changes (in case MutationObserver misses some).
        setInterval(() => {
            const currentHref = location.href;
            const currentKey = getContextKey();

            if (currentHref !== lastHref || currentKey !== lastContextKey) {
                const wasStreaming = instance?.getState?.()?.wasStreaming;
                if (wasStreaming || currentHref !== lastHref) {
                    lastHref = currentHref;
                    lastContextKey = currentKey;
                    restartInstance();
                    return;
                }
                lastHref = currentHref;
                lastContextKey = currentKey;
            }
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
