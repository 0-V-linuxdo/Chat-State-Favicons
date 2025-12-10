/*!
 * State Favicon Core
 * Extracted from "[Chat] State Favicons" and made configurable.
 * Provides a small state machine to swap favicons based on streaming / ready / error states.
 *
 * Interfaces:
 *   - createStateFavicon({ selectors, icons, defaultIconHref, hooks, document, faviconId, styleId })
 *   - hooks: { isStreaming(ctx), hasError(ctx), isInputEmpty(ctx) }
 *   - selectors: override CSS selectors per target site (default values match ChatGPT UI)
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

    const queryAny = (doc, selector) => {
        for (const sel of toArray(selector)) {
            const el = doc.querySelector(sel);
            if (el) return el;
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

        const originalHref = options.defaultIconHref || getOriginalFaviconHref(doc, selectors);
        if (!iconSet.wait) iconSet.wait = originalHref;

        const faviconId = options.faviconId || 'state-favicon';
        const styleId = options.styleId || 'state-favicon-style';

        const favicon = ensureFaviconLink(doc, faviconId, iconSet.wait);
        ensureSpinStyle(doc, styleId, faviconId);

        const state = { wasStreaming:false, justFinished:false };
        let composerRoot = queryAny(doc, selectors.composer);
        let localObserver = null;

        function setFavicon(key) {
            const icon = iconSet[key] ?? iconSet.wait;
            favicon.href = icon;
            key === 'rotate' ? favicon.classList.add('spin') : favicon.classList.remove('spin');
        }

        function baseHasError() {
            if (queryAny(doc, selectors.toastErr)) return true;
            if (queryAny(doc, selectors.errBtn)) return true;
            // Generic retry / error buttons
            return Array.from(doc.querySelectorAll('button')).some(b =>
                /(Regenerate|Retry|Error)/i.test(b.textContent || '')
            );
        }

        function hasError() {
            if (baseHasError()) return true;
            if (typeof hooks.hasError === 'function') return !!hooks.hasError(ctx);
            return false;
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

        function inputIsEmpty() {
            if (typeof hooks.isInputEmpty === 'function') return !!hooks.isInputEmpty(ctx);
            return baseInputIsEmpty();
        }

        function evaluateState() {
            if (hasError()) {
                setFavicon('error');
                state.wasStreaming = false;
                state.justFinished = false;
                return;
            }

            if (isStreaming()) {
                state.wasStreaming = true;
                state.justFinished = false;
                setFavicon('rotate');
                return;
            }

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

            inputIsEmpty() ? setFavicon('wait') : setFavicon('ready');
        }

        function observeComposer() {
            if (localObserver) localObserver.disconnect();
            composerRoot = queryAny(doc, selectors.composer);
            if (!composerRoot) return;

            localObserver = new MutationObserver(evaluateState);
            localObserver.observe(composerRoot, {
                childList:true,
                subtree:true,
                characterData:true,
                attributes:true,
                attributeFilter:['aria-disabled','disabled','data-testid','class']
            });
            evaluateState();
        }

        const globalObserver = new MutationObserver(() => {
            if (composerRoot && !doc.contains(composerRoot)) observeComposer();
            evaluateState();
        });

        function start() {
            if (doc.body) globalObserver.observe(doc.body, { childList:true, subtree:true });
            observeComposer();
        }

        function stop() {
            globalObserver.disconnect();
            if (localObserver) localObserver.disconnect();
        }

        function updateSelectors(nextSelectors) {
            Object.assign(selectors, nextSelectors || {});
            observeComposer();
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

    return {
        createStateFavicon,
        svgEmoji,
        DEFAULT_ICONS,
        DEFAULT_SELECTORS
    };
});

