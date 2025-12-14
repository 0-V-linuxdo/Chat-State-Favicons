/*!
 * State Favicon Core [20251214] v1.0.1
 * Extracted from "[Chat] State Favicons" and made configurable.
 * Provides a small state machine to swap favicons based on streaming / ready / error states.
 *
 * Interfaces:
 *   - createStateFavicon({ selectors, icons, defaultIconHref, hooks, document, faviconId, styleId, submitEndsStreaming })
 *   - hooks: { isStreaming(ctx), hasError(ctx), isInputEmpty(ctx) }
 *   - hooks.shouldEnterDone(ctx): optional gate for entering the "done" state when streaming ends
 *       - called only when: wasStreaming === true AND isStreaming() === false AND context unchanged
 *       - return true to show ✔️ done; return false to skip done and evaluate ready/wait immediately
 *   - selectors: override CSS selectors per target site (default values match ChatGPT UI)
 *   - submitEndsStreaming: when true, the core will only enter "done" if a submit button (selectors.submitBtn) is visible
 *   - icons: override data URLs for rotate/done/ready/error/wait (wait falls back to current favicon)
 *
 * Note: ChatGPT-specific detectors such as image spinners or the GPT Pro sidebar stop button
 * are intentionally left out. Provide them via hooks.isStreaming from your own script.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.StateFaviconCore = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ----------  helpers & defaults  ---------- */
    const DEFAULT_FALLBACK_ICON = 'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg';

    const DEFAULT_SELECTORS = {
        composer : 'form[data-type="unified-composer"], form.w-full[data-type]',
        textarea : '#prompt-textarea',
        stopBtn  : 'button[data-testid="stop-button"]',
        submitBtn: null, // optional: when submitEndsStreaming is true, this gates entering "done"
        toastErr : '[data-testid="toast-error"]',
        errBtn   : 'button[data-testid="regenerate-thread-error-button"]',
        favicon  : 'link[rel~="icon"]'
    };

    function svgEmoji(e) {
        return `data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${e}</text></svg>`
        )}`;
    }

    const DEFAULT_ICONS = {
        rotate : svgEmoji('🔄'),
        done   : svgEmoji('✔️'),
        ready  : svgEmoji('👍'),
        error  : svgEmoji('🚫')
        // wait will be injected using the site's current favicon (or defaultIconHref)
    };

    const toArray = (value) => {
        if (!value) return [];
        return Array.isArray(value) ? value.filter(Boolean) : [value];
    };

    const isVisible = (el) => {
        if (!el || !el.isConnected) return false;
        if (!el.getClientRects().length) return false;
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
    };

    const queryAny = (doc, selector) => {
        const list = [];
        for (const sel of toArray(selector)) {
            list.push(...doc.querySelectorAll(sel));
            const found = list.find(isVisible) || list[0];
            if (found) return found;
        }
        return null;
    };

    const getOriginalFaviconHref = (doc, selectors) =>
        queryAny(doc, selectors?.favicon || DEFAULT_SELECTORS.favicon)?.href || DEFAULT_FALLBACK_ICON;

    const ensureFaviconLink = (doc, id, href) => {
        let link = doc.getElementById(id);
        if (!link) {
            link = doc.createElement('link');
            link.id = id;
            link.rel = 'icon';
            link.type = 'image/svg+xml';
            doc.head.appendChild(link);
        }
        link.href = href;
        return link;
    };

    const ensureSpinStyle = (doc, styleId, faviconId) => {
        if (doc.getElementById(styleId)) return;
        const style = doc.createElement('style');
        style.id = styleId;
        style.textContent = `
            @keyframes favicon-spin { to { transform: rotate(360deg); } }
            link#${faviconId}.spin { animation: favicon-spin 1s linear infinite; }
        `;
        doc.head.appendChild(style);
    };

    /* ----------  core factory  ---------- */
    function createStateFavicon(options = {}) {
        const doc = options.document || (typeof document !== 'undefined' ? document : null);
        if (!doc) throw new Error('StateFaviconCore: document is required.');

        const selectors = Object.assign({}, DEFAULT_SELECTORS, options.selectors || {});
        const iconSet = Object.assign({}, DEFAULT_ICONS, options.icons || {});
        const hooks = options.hooks || {};
        const ctx = { doc, selectors };
        const submitEndsStreaming = options.submitEndsStreaming === true;

        const originalHref = options.defaultIconHref || getOriginalFaviconHref(doc, selectors);
        if (!iconSet.wait) iconSet.wait = originalHref;

        const faviconId = options.faviconId || 'state-favicon';
        const styleId = options.styleId || 'state-favicon-style';

        let favicon = ensureFaviconLink(doc, faviconId, iconSet.wait);
        ensureSpinStyle(doc, styleId, faviconId);

        const state = { wasStreaming:false, justFinished:false, streamContext:null };
        let composerRoot = queryAny(doc, selectors.composer);
        let localObserver = null;
        let started = false;

        const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
        const raf = view && typeof view.requestAnimationFrame === 'function'
            ? view.requestAnimationFrame.bind(view)
            : null;
        const caf = view && typeof view.cancelAnimationFrame === 'function'
            ? view.cancelAnimationFrame.bind(view)
            : null;

        const nowMs = () =>
            (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();

        const genericErrorScanIntervalMs =
            Number.isFinite(options.genericErrorScanIntervalMs)
                ? Math.max(0, options.genericErrorScanIntervalMs)
                : 800;
        const genericErrorRegex =
            options.genericErrorRegex instanceof RegExp
                ? options.genericErrorRegex
                : /(Regenerate|Retry|Error)/i;
        const genericErrorTest = (text) => {
            if (genericErrorRegex.global) genericErrorRegex.lastIndex = 0;
            return genericErrorRegex.test(text);
        };
        const genericErrorCache = { at: 0, value: false };

        let scheduled = false;
        let scheduledId = null;
        let scheduledViaRaf = false;

        const applied = { href: null, spinning: null };

        function setFavicon(key) {
            const icon = iconSet[key] ?? iconSet.wait;
            const spinning = key === 'rotate';

            if (!favicon || !favicon.isConnected) {
                favicon = ensureFaviconLink(doc, faviconId, iconSet.wait);
                ensureSpinStyle(doc, styleId, faviconId);
                applied.href = null;
                applied.spinning = null;
            }

            if (applied.href !== icon) {
                favicon.href = icon;
                applied.href = icon;
            }
            if (applied.spinning !== spinning) {
                favicon.classList.toggle('spin', spinning);
                applied.spinning = spinning;
            }
        }

        function scheduleEvaluate() {
            if (!started) return;
            if (scheduled) return;
            scheduled = true;

            const runner = () => {
                scheduled = false;
                scheduledId = null;
                if (!started) return;
                if (!composerRoot || !doc.contains(composerRoot)) observeComposer();
                evaluateState();
            };

            if (raf) {
                scheduledViaRaf = true;
                scheduledId = raf(runner);
            } else {
                scheduledViaRaf = false;
                scheduledId = setTimeout(runner, 0);
            }
        }

        function cancelScheduledEvaluate() {
            if (!scheduledId) return;
            if (scheduledViaRaf && caf) caf(scheduledId);
            if (!scheduledViaRaf) clearTimeout(scheduledId);
            scheduledId = null;
            scheduled = false;
        }

        function baseHasError() {
            if (queryAny(doc, selectors.toastErr)) return true;
            if (queryAny(doc, selectors.errBtn)) return true;

            // Generic retry / error buttons (throttled; prefer hooks.hasError for best performance).
            if (genericErrorScanIntervalMs === 0) return false;
            const t = nowMs();
            if (t - genericErrorCache.at < genericErrorScanIntervalMs) return genericErrorCache.value;
            genericErrorCache.at = t;

            let found = false;
            try {
                const buttons = doc.querySelectorAll('button');
                for (let i = 0; i < buttons.length; i++) {
                    const text = buttons[i].textContent || '';
                    if (genericErrorTest(text)) { found = true; break; }
                }
            } catch {
                found = false;
            }
            genericErrorCache.value = found;
            return found;
        }

        function hasError() {
            // If site provides a custom hasError hook, use it exclusively (allows full override)
            if (typeof hooks.hasError === 'function') return !!hooks.hasError(ctx);
            return baseHasError();
        }

        function baseIsStreaming() {
            if (queryAny(doc, selectors.stopBtn)) return true;
            return false;
        }

        function isStreaming() {
            if (baseIsStreaming()) return true;
            if (typeof hooks.isStreaming === 'function') return !!hooks.isStreaming(ctx);
            return false;
        }

        function baseInputIsEmpty() {
            const ta = queryAny(doc, selectors.textarea);
            if (!ta) return true;
            const text = ta.textContent ?? ta.value ?? '';
            return text.replace(/\u200B/g, '').trim().length === 0;
        }

        function submitIsVisible() {
            if (!selectors.submitBtn) return false;
            return !!queryAny(doc, selectors.submitBtn);
        }

        function inputIsEmpty() {
            if (typeof hooks.isInputEmpty === 'function') return !!hooks.isInputEmpty(ctx);
            return baseInputIsEmpty();
        }

        function evaluateState() {
            const contextKey = typeof hooks.getContextKey === 'function' ? hooks.getContextKey(ctx) : null;

            if (hasError()) {
                setFavicon('error');
                state.wasStreaming = false;
                state.justFinished = false;
                state.streamContext = null;
                return;
            }

            if (isStreaming()) {
                state.wasStreaming = true;
                state.justFinished = false;
                state.streamContext = contextKey;
                setFavicon('rotate');
                return;
            }

            if (state.wasStreaming) {
                // Only enter "done" when the context is unchanged or unknown; otherwise reset flags.
                const sameContext =
                    !state.streamContext ||
                    !contextKey ||
                    state.streamContext === contextKey;
                state.wasStreaming = false;
                if (sameContext) {
                    const submitGate = submitEndsStreaming ? submitIsVisible() : true;
                    const shouldEnterDone =
                        typeof hooks.shouldEnterDone === 'function'
                            ? !!hooks.shouldEnterDone(Object.assign({ state }, ctx))
                            : submitGate;
                    if (shouldEnterDone) {
                        state.justFinished = true;
                        setFavicon('done');
                        return;
                    }
                    // Skip "done" if the site indicates it hasn't fully returned to the idle submit state yet.
                    state.justFinished = false;
                    state.streamContext = null;
                } else {
                    state.justFinished = false;
                    state.streamContext = null;
                }
            }

            if (state.justFinished) {
                // If the user navigated away after finishing (SPA thread switch),
                // do not keep showing "done" for an unrelated context.
                const contextChanged =
                    state.streamContext &&
                    contextKey &&
                    state.streamContext !== contextKey;
                if (contextChanged) {
                    state.justFinished = false;
                    state.streamContext = null;
                    // fallthrough to evaluate ready/wait for the current page
                } else {
                if (!inputIsEmpty()) {
                    setFavicon('ready');
                    state.justFinished = false;
                }
                return;
                }
            }

            state.streamContext = null;
            inputIsEmpty() ? setFavicon('wait') : setFavicon('ready');
        }

        function observeComposer() {
            if (localObserver) localObserver.disconnect();
            composerRoot = queryAny(doc, selectors.composer);
            if (!composerRoot) return;

            localObserver = new MutationObserver(scheduleEvaluate);
            localObserver.observe(composerRoot, {
                childList:true,
                subtree:true,
                characterData:true,
                attributes:true,
                attributeFilter:['aria-disabled','disabled','data-testid','class']
            });
        }

        const globalObserver = new MutationObserver(scheduleEvaluate);

        function start() {
            if (started) return;
            started = true;
            const root = doc.body || doc.documentElement;
            if (root) globalObserver.observe(root, { childList:true, subtree:true });
            observeComposer();
            evaluateState();
        }

        function stop() {
            started = false;
            cancelScheduledEvaluate();
            globalObserver.disconnect();
            if (localObserver) localObserver.disconnect();
            localObserver = null;
            composerRoot = null;
        }

        function updateSelectors(nextSelectors) {
            Object.assign(selectors, nextSelectors || {});
            observeComposer();
            evaluateState();
        }

        function updateDefaultIcon(href) {
            if (href) iconSet.wait = href;
            if (!state.wasStreaming && !state.justFinished && inputIsEmpty()) setFavicon('wait');
        }

        function updateIcons(nextIcons) {
            Object.assign(iconSet, nextIcons || {});
            evaluateState();
        }

        return {
            start,
            stop,
            evaluateState,
            updateSelectors,
            updateIcons,
            updateDefaultIcon,
            selectors,
            icons: iconSet,
            getState: () => Object.assign({}, state)
        };
    }

    const globalScope =
        typeof self !== 'undefined'
            ? self
            : (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

    /**
     * Streaming context lock helper:
     *   - while streaming: lock the first seen signature, allow empty→non-empty token fill once
     *   - when not streaming: clear lock and use current token/signature
     */
    function createContextLock(opts = {}) {
        const getToken = typeof opts.getToken === 'function' ? opts.getToken : () => '';
        const getSignature = typeof opts.getSignature === 'function' ? opts.getSignature : () => '';
        const isStreaming = typeof opts.isStreaming === 'function' ? opts.isStreaming : () => false;
        const buildKey = typeof opts.buildKey === 'function'
            ? opts.buildKey
            : (token, sig) => (token ? token : `draft|${sig || 'no-sig'}`);

        let activeToken = '';
        let activeSig = '';

        function getContextKey() {
            const token = getToken();
            const sig = getSignature();

            if (isStreaming()) {
                if (!activeSig) activeSig = sig;
                if (!activeToken && token && sig === activeSig) activeToken = token;
                return buildKey(activeToken, activeSig);
            }

            activeToken = '';
            activeSig = '';
            return buildKey(token, sig);
        }

        function reset() {
            activeToken = '';
            activeSig = '';
        }

        return { getContextKey, reset };
    }

    /**
     * Start favicon guard if available (no-op when FaviconGuard is absent).
     * Returns the guard instance or null.
     */
    function startFaviconGuard(opts = {}) {
        const guardFactory =
            typeof opts.guardFactory === 'function'
                ? opts.guardFactory
                : (globalScope && globalScope.FaviconGuard && globalScope.FaviconGuard.createFaviconGuard);
        if (typeof guardFactory !== 'function') return null;

        try {
            const guard = guardFactory({
                defaultHref: opts.defaultHref,
                iconId: opts.iconId || 'state-favicon',
                rel: opts.rel,
                type: opts.type,
                sizes: opts.sizes,
                removeCompetitors: opts.removeCompetitors !== false,
                insertFirst: opts.insertFirst !== false,
                trackAttributes: opts.trackAttributes || ['href', 'rel']
            });
            guard.start();
            return guard;
        } catch (err) {
            try { console.warn('[StateFaviconCore] FaviconGuard start failed:', err); } catch (_) { /* silent */ }
            return null;
        }
    }

    return {
        createStateFavicon,
        svgEmoji,
        DEFAULT_ICONS,
        DEFAULT_SELECTORS,
        // Shared helpers for site scripts (avoid duplicating visibility checks)
        utils: {
            isVisible,
            queryAny,
            toArray,
            createContextLock,
            startFaviconGuard
        }
    };
});
