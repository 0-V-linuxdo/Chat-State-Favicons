// ==UserScript==
// @name         [Le Chat] State Favicons [20251215] v1.0.6
// @namespace    https://github.com/0-V-linuxdo/Chat-State-Favicons/tree/main
// @description  Dynamic favicon for Le Chat (chat.mistral.ai): 🔄 streaming · ✔️ done · 👍 ready · 🚫 error · default waiting. Uses the shared core module with Le Chat-specific selectors/hooks.
// @version      [20251215] v1.0.6
// @update-log   使用 core lazySignature/buildContextKeyFromUrl 复用上下文/签名构造；版本升级至 v1.0.6。
// @match        https://chat.mistral.ai/*
// @match        https://*.chat.mistral.ai/*
// @grant        none
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/state-favicon-core.js?v=20251215.0.0.4
// @require      https://github.com/0-V-linuxdo/Chat-State-Favicons/raw/refs/heads/main/core/favicon-guard.js
// @icon         https://chat.mistral.ai/favicon.ico
// ==/UserScript==

(() => {
    'use strict';

    const core = window.StateFaviconCore;
    if (!core || typeof core.createStateFavicon !== 'function') {
        console.warn('[StateFavicons][Le Chat] Core module not found. Check @require path.');
        return;
    }
    const { isVisible, createContextLock, initDefaultFavicon, lazySignature, buildContextKeyFromUrl } = core.utils;

    const SELECTORS = {
        composer: [
            '[data-radix-scroll-area-viewport]',
            '.ProseMirror[contenteditable="true"]',
            'form'
        ],
        textarea: '.ProseMirror[contenteditable="true"]',
        stopBtn: [
            'button[aria-label="Stop generation"]',
            'button[title="Stop generation"]'
        ],
        sendBtn: [
            'button[aria-label="Send question"]',
            'button[type="submit"]'
        ],
        submitBtn: [
            'button[aria-label="Send question"]',
            'button[type="submit"]'
        ],
        voiceBtn: 'button[aria-label="Voice Mode"]',
        favicon: 'link[rel~="icon"]'
    };

    const { defaultIconHref, guard } = initDefaultFavicon({
        document,
        selectors: { favicon: SELECTORS.favicon },
        removeCompetitors: true,
        insertFirst: true
    });
    let instance = null;
    let lastHref = location.href;

    function getActiveEditor() {
        const list = Array.from(document.querySelectorAll(SELECTORS.textarea));
        return list.find(isVisible) || list[0] || null;
    }

    function getComposerRoot() {
        const editor = getActiveEditor();
        if (!editor) return null;

        const scrollArea = editor.closest('[data-radix-scroll-area-viewport]');
        if (scrollArea) {
            const form = scrollArea.closest('form');
            if (form) return form;
            if (scrollArea.parentElement) return scrollArea.parentElement;
        }

        return editor.closest('form') || editor.parentElement || document.body;
    }

    function getStopButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of SELECTORS.stopBtn) {
            try { candidates.push(...root.querySelectorAll(sel)); } catch (_) { /* ignore selector errors */ }
        }
        const square = root.querySelector('svg.lucide-square, svg[class*="lucide-square"]');
        if (square) candidates.unshift(square.closest('button') || square.parentElement);
        return candidates.find(isVisible) || null;
    }

    function getSendButton() {
        const root = getComposerRoot() || document;
        const candidates = [];
        for (const sel of SELECTORS.sendBtn) {
            try { candidates.push(...root.querySelectorAll(sel)); } catch (_) { /* ignore selector errors */ }
        }
        const arrow = root.querySelector('svg.-rotate-90, svg[class*="-rotate-90"], svg[class*="lucide-send"]');
        if (arrow) candidates.unshift(arrow.closest('button') || arrow.parentElement);
        return candidates.find(isVisible) || null;
    }

    function getVoiceButton() {
        const root = getComposerRoot() || document;
        try { return Array.from(root.querySelectorAll(SELECTORS.voiceBtn)).find(isVisible) || null; }
        catch { return null; }
    }

    function isInputEmpty() {
        const editor = getActiveEditor();
        if (!editor) return true;

        const text = (editor.textContent || '').replace(/\u200B/g, '').trim();
        if (text.length === 0) return true;

        const sendBtn = getSendButton();
        if (sendBtn) {
            const label = (sendBtn.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('voice mode')) return true;
            const disabled = sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true';
            return !!disabled;
        }

        const voice = getVoiceButton();
        if (voice && isVisible(voice)) return true;

        return false;
    }

    function getConversationToken() {
        const pickAttr = (sel, attr) => {
            try { return document.querySelector(sel)?.getAttribute(attr) || ''; }
            catch { return ''; }
        };

        const params = new URLSearchParams(location.search || '');
        const paramId =
            params.get('threadId') ||
            params.get('conversationId') ||
            params.get('conversation_id') ||
            params.get('chat_id') ||
            params.get('chatId') ||
            params.get('id') ||
            '';

        const dataId =
            pickAttr('[data-thread-id]', 'data-thread-id') ||
            pickAttr('[data-conversation-id]', 'data-conversation-id') ||
            '';

        const pathPart = location.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
        return [dataId, paramId, pathPart].filter(Boolean).join('|');
    }

    const contextLock = createContextLock({
        isStreaming: () => !!getStopButton(),
        getToken: () => getConversationToken(),
        getSignature: () => lazySignature('lechat', getComposerRoot() || document.body),
        buildKey: (token, sig) => buildContextKeyFromUrl({
            token,
            draftSig: () => sig || lazySignature('lechat', getComposerRoot() || document.body),
            includeSearch: false
        })
    });

    function bindEditorListener() {
        const editor = getActiveEditor();
        if (!editor || editor.__sfvBound) return;
        const handler = () => instance?.evaluateState();
        editor.addEventListener('input', handler, { passive: true });
        editor.addEventListener('keyup', handler, { passive: true });
        editor.__sfvBound = true;
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
                isInputEmpty: () => isInputEmpty(),
                getContextKey: () => contextLock.getContextKey()
            }
        });
        instance.start();
    }

    function tick() {
        if (!instance) return;
        if (location.href !== lastHref) {
            lastHref = location.href;
            instance.evaluateState();
            bindEditorListener();
            if (guard?.updateDefaultHref && defaultIconHref) guard.updateDefaultHref(defaultIconHref);
        }
    }

    function init() {
        createInstance();
        bindEditorListener();
        instance.evaluateState();
        setInterval(tick, 1000);
    }

    init();
})();
