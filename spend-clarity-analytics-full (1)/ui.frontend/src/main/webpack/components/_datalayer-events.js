/* VSC Data Layer Events — Adobe Analytics / Launch integration.

   PURPOSE:
   A single global listener that reads `data-cmp-data-layer` JSON off
   any interactive element and pushes a tracking event onto
   window.adobeDataLayer. Covers:
     1. pageView     — fired once per navigation
     2. buttonClick  — buttons with data-cmp-data-layer
     3. linkClick    — links  with data-cmp-data-layer
     4. formSubmit   — forms  with data-cmp-data-layer
     5. componentShow — fires once for every component that has
                       data-cmp-data-layer + data-cmp-track-show
                       (dashboards, drawers, toasts)

   DESIGN RULES (Lighthouse + accessibility):
   - Event delegation only — zero per-element listeners (keeps memory
     flat and survives dynamic DOM updates like wizard steps).
   - Strict mode, no globals leak, no deprecated APIs.
   - Feature-detects IntersectionObserver / MutationObserver.
   - Passive event listeners where possible.
   - Silent failure on malformed JSON — the user's click MUST still
     work normally; analytics is best-effort instrumentation.
   - Never calls preventDefault or stopPropagation — the host app's
     native click/submit flow is preserved byte-for-byte.
   - No PII in the data payload — only hardcoded component-level
     tracking metadata authored into each HTL template. */
(function () {
    "use strict";

    if (typeof window === "undefined" || typeof document === "undefined") {
        return;
    }

    /* ------------ setup ------------ */
    window.adobeDataLayer = window.adobeDataLayer || [];

    var ATTR = "data-cmp-data-layer";
    var TRACK_SHOW = "data-cmp-track-show";

    /* Named no-op for empty handlers (ESLint no-empty-function). */
    function noop() {
        /* intentionally empty - swallows errors without surfacing */
        return undefined;
    }

    function parse(raw) {
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (err) {
            /* Malformed JSON on a component — ignore silently so the
               user's click or form submit still proceeds normally. */
            return null;
        }
    }

    function push(eventName, data) {
        if (!data) {
            return;
        }
        try {
            window.adobeDataLayer.push({
                event: eventName,
                component: data
            });
        } catch (err) {
            /* adobeDataLayer may be sealed or unavailable; drop the
               event rather than throw inside a click handler. */
            noop();
        }
    }

    /* ------------ pageView ------------ */
    function pushPageView() {
        var meta = {
            path: window.location.pathname,
            url: window.location.href,
            title: document.title || "",
            referrer: document.referrer || ""
        };
        /* Read optional page-level hardcoded metadata from <body>. */
        var body = document.body || null;
        if (body && body.hasAttribute(ATTR)) {
            var extra = parse(body.getAttribute(ATTR));
            if (extra) {
                Object.keys(extra).forEach(function (k) {
                    meta[k] = extra[k];
                });
            }
        }
        try {
            window.adobeDataLayer.push({
                event: "pageView",
                page: {
                    path: meta.path,
                    url: meta.url,
                    title: meta.title,
                    referrer: meta.referrer,
                    siteSection: meta.siteSection || "spend-clarity",
                    siteName: meta.siteName || "Spend Clarity",
                    platform: meta.platform || "AEM",
                    environment: meta.environment || "production"
                }
            });
        } catch (err) {
            noop();
        }
    }

    /* ------------ delegated click handler (buttons + links) ------------ */
    function onClick(event) {
        /* Walk up from event.target to find the nearest element that
           carries the data-cmp-data-layer attribute. */
        var node = event.target;
        while (node && node !== document.body) {
            if (node.nodeType === 1 && node.hasAttribute &&
                node.hasAttribute(ATTR)) {
                var data = parse(node.getAttribute(ATTR));
                if (data) {
                    var tag = (node.tagName || "").toLowerCase();
                    var eventName;
                    if (tag === "a") {
                        eventName = "linkClick";
                    } else if (tag === "button" || node.getAttribute("role") === "button") {
                        eventName = "buttonClick";
                    } else {
                        eventName = "elementClick";
                    }
                    push(eventName, data);
                }
                /* Only push once per bubbled click — don't re-push for
                   ancestor containers that also have the attribute. */
                return;
            }
            node = node.parentNode;
        }
    }

    /* ------------ delegated submit handler (forms) ------------ */
    function onSubmit(event) {
        var form = event.target;
        if (!form || form.nodeType !== 1 || !form.hasAttribute ||
            !form.hasAttribute(ATTR)) {
            return;
        }
        var data = parse(form.getAttribute(ATTR));
        if (data) {
            push("formSubmit", data);
        }
    }

    /* ------------ componentShow (for dashboards + drawers + toasts) ------------ */
    var observedShow = null;
    try {
        if (typeof WeakSet === "function") {
            observedShow = new WeakSet();
        }
    } catch (err1) {
        observedShow = null;
    }

    function pushShow(node) {
        if (!node || !node.hasAttribute || !node.hasAttribute(ATTR)) {
            return;
        }
        if (observedShow && observedShow.has(node)) {
            return;
        }
        if (observedShow) {
            observedShow.add(node);
        }
        var data = parse(node.getAttribute(ATTR));
        if (data) {
            push("componentShow", data);
        }
    }

    function scanShow(root) {
        if (!root || typeof root.querySelectorAll !== "function") {
            return;
        }
        try {
            var nodes = root.querySelectorAll("[" + TRACK_SHOW + "]");
            Array.prototype.forEach.call(nodes, pushShow);
        } catch (err2) {
            noop();
        }
    }

    /* ------------ boot ------------ */
    function boot() {
        /* Fire the pageView once, after the page template has settled. */
        pushPageView();

        /* Scan the initial DOM for show-tracked components. */
        scanShow(document);

        /* Delegate click/submit at document level. */
        try {
            document.addEventListener("click", onClick, { passive: true });
        } catch (err3) {
            document.addEventListener("click", onClick);
        }
        /* submit event does not bubble reliably at window; bind at
           document capture phase so it fires even if the form's
           preventDefault is called later by another handler. */
        document.addEventListener("submit", onSubmit, true);

        /* Watch for dynamically-added drawers / wizard steps / toasts
           so their componentShow fires at reveal time. */
        if (typeof window.MutationObserver === "function" && document.body) {
            try {
                new window.MutationObserver(function (records) {
                    records.forEach(function (record) {
                        Array.prototype.forEach.call(record.addedNodes,
                            function (node) {
                                if (node.nodeType === 1) {
                                    if (node.hasAttribute && node.hasAttribute(TRACK_SHOW)) {
                                        pushShow(node);
                                    }
                                    scanShow(node);
                                }
                            });
                    });
                }).observe(document.body,
                    { childList: true, subtree: true });
            } catch (err4) {
                /* MutationObserver unavailable - componentShow events
                   for dynamically-inserted elements will not fire.
                   Static tracking still works. */
                noop();
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
}());
