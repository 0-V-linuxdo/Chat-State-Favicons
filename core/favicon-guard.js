/*!
 * Favicon Guard
 * Small helper to keep a custom favicon alive on SPAs that replace/override <head>.
 * Exposes: FaviconGuard.createFaviconGuard(options)
 *
 * options:
 *   - document: custom document (default: global document)
 *   - iconId:   id for the managed link element (default: 'state-favicon')
 *   - rel:      rel attribute (default: 'icon shortcut icon')
 *   - type:     type attribute (default: 'image/svg+xml')
 *   - sizes:    sizes attribute (default: 'any')
 *   - defaultHref: initial fallback href
 *   - removeCompetitors: remove other icon links (default: true)
 *   - insertFirst: insert managed link as first child of head (default: true)
 *   - trackAttributes: attributes to watch for icon changes (default: ['href','rel'])
 *
 * Update log:
 * - 2025-12-12: Watch for head icon removal/replacement and self-removal; restore managed favicon
 *   immediately to keep updates timely on SPA head rewrites.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FaviconGuard = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function createFaviconGuard(opts = {}) {
        const doc = opts.document || (typeof document !== 'undefined' ? document : null);
        if (!doc) throw new Error('FaviconGuard: document is required.');

        const iconId = opts.iconId || 'state-favicon';
        const rel = opts.rel || 'icon shortcut icon';
        const type = opts.type || 'image/svg+xml';
        const sizes = opts.sizes || 'any';
        const insertFirst = opts.insertFirst !== false;
        const removeCompetitors = opts.removeCompetitors !== false;
        const trackAttributes = opts.trackAttributes || ['href', 'rel'];

        let waitHref = opts.defaultHref || null;
        let observer = null;

        const isIconLink = (node) =>
            node && node.tagName === 'LINK' && /\bicon\b/i.test(node.getAttribute('rel') || '');

        function ensure() {
            const head = doc.head || doc.documentElement;
            if (!head) return null;

            if (removeCompetitors) {
                const competitors = Array.from(head.querySelectorAll(`link[rel*="icon"]:not(#${iconId})`));
                for (const c of competitors) {
                    if (!waitHref && c.href) waitHref = c.href;
                    c.remove();
                }
            } else {
                const competitors = Array.from(head.querySelectorAll(`link[rel*="icon"]:not(#${iconId})`));
                for (const c of competitors) {
                    if (!waitHref && c.href) waitHref = c.href;
                }
            }

            let link = doc.getElementById(iconId);
            const href = (link && link.href) || waitHref;
            if (!link || !head.contains(link)) {
                link = doc.createElement('link');
                link.id = iconId;
                head.appendChild(link);
            }
            link.rel = rel;
            link.type = type;
            if (sizes) link.setAttribute('sizes', sizes);
            if (href) link.href = href;

            if (insertFirst && head.firstChild !== link) head.insertBefore(link, head.firstChild);
            return link;
        }

        function start() {
            stop();
            ensure();
            const target = doc.head || doc.documentElement;
            if (!target) return;
            observer = new MutationObserver((list) => {
                let touched = false;
                for (const m of list) {
                    if (m.type === 'attributes' && isIconLink(m.target) && m.target.id !== iconId) {
                        if (m.target.href) waitHref = m.target.href;
                        touched = true;
                        break;
                    }
                    if (m.type === 'childList') {
                        for (const node of m.addedNodes || []) {
                            if (isIconLink(node) && node.id !== iconId) {
                                if (node.href) waitHref = node.href;
                                touched = true;
                                break;
                            }
                        }
                        if (touched) break;
                        for (const node of m.removedNodes || []) {
                            if ((node.id === iconId) || isIconLink(node)) {
                                touched = true;
                                break;
                            }
                        }
                    }
                    if (touched) break;
                }
                if (!touched && !doc.getElementById(iconId)) touched = true;
                if (touched) ensure();
            });
            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: trackAttributes
            });
        }

        function stop() {
            if (observer) observer.disconnect();
            observer = null;
        }

        function updateDefaultHref(href) {
            if (href) {
                waitHref = href;
                ensure();
            }
        }

        return {
            start,
            stop,
            ensure,
            updateDefaultHref,
            getDefaultHref: () => waitHref
        };
    }

    return { createFaviconGuard };
});
