(function () {
  'use strict';

  if (window.__cf7DetectorLoaded) return;
  window.__cf7DetectorLoaded = true;

  var DEFAULTS = window.CF7_DEFAULTS || {
    showFloatingBadge: true,
    openLinksInNewTab: true,
    adminBaseOverride: ''
  };

  var MAX_ASSET_PATHS = 700;
  var SCAN_DEBOUNCE_MS = 400;
  var HOST_ID = 'cf7-detector-root';

  var state = {
    settings: Object.assign({}, DEFAULTS),
    forms: [],
    env: null,
    adminBase: '',
    panelOpen: false,
    host: null,
    shadow: null,
    started: false,
    lastSignature: '',
    titleCache: Object.create(null),
    titleRequests: Object.create(null),
    autoFilled: new WeakSet(),
    pillDismissed: false,
    hostVisible: false
  };

  var scanTimer = null;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function toPath(raw) {
    if (!raw || typeof raw !== 'string') return '';
    try {
      var url = new URL(raw, document.baseURI || location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.pathname;
    } catch (err) {
      return '';
    }
  }

  function isBefore(a, b) {
    if (!a || !b || !a.compareDocumentPosition) return false;
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  /* ------------------------------------------------------------------ */
  /* Environment detection                                              */
  /* ------------------------------------------------------------------ */

  function collectPaths() {
    var paths = [];
    var seen = Object.create(null);

    function push(raw) {
      if (paths.length >= MAX_ASSET_PATHS) return;
      var p = toPath(raw);
      if (p && !seen[p]) {
        seen[p] = true;
        paths.push(p);
      }
    }

    var attrMap = [
      ['link', 'href'],
      ['script', 'src'],
      ['img', 'src'],
      ['img', 'srcset'],
      ['source', 'src'],
      ['source', 'srcset'],
      ['video', 'src'],
      ['video', 'poster'],
      ['audio', 'src'],
      ['embed', 'src'],
      ['object', 'data'],
      ['iframe', 'src'],
      ['form', 'action']
    ];

    attrMap.forEach(function (entry) {
      var tag = entry[0];
      var attr = entry[1];
      var nodes = document.querySelectorAll(tag + '[' + attr + ']');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (attr === 'srcset') {
          var parts = (el.getAttribute('srcset') || '').split(',');
          for (var j = 0; j < parts.length; j++) {
            var candidate = parts[j].trim().split(/\s+/)[0];
            if (candidate) push(candidate);
          }
        } else {
          var value = el.getAttribute(attr) || '';
          if (value) push(value);
        }
      }
    });

    var cssChunks = [];
    var styleNodes = document.querySelectorAll('style');
    for (var s = 0; s < styleNodes.length && s < 120; s++) {
      var css = styleNodes[s].textContent || '';
      if (css.length > 2000000) css = css.slice(0, 2000000);
      cssChunks.push(css);
    }
    var styledNodes = document.querySelectorAll('[style*="url("]');
    for (var k = 0; k < styledNodes.length && k < 200; k++) {
      cssChunks.push(styledNodes[k].getAttribute('style') || '');
    }

    var urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    for (var c = 0; c < cssChunks.length; c++) {
      if (paths.length >= MAX_ASSET_PATHS) break;
      var match;
      var count = 0;
      urlRe.lastIndex = 0;
      while ((match = urlRe.exec(cssChunks[c])) !== null && count < 150) {
        push(match[1]);
        count++;
      }
    }

    var anchorNodes = document.querySelectorAll(
      'a[href*="wp-json"], a[href*="xmlrpc.php"], a[href*="wp-includes"], a[href*="wp-content"], a[href*="wp-admin"]'
    );
    for (var a = 0; a < anchorNodes.length; a++) {
      push(anchorNodes[a].getAttribute('href') || '');
    }

    return paths;
  }

  function findIncludesBase(paths) {
    for (var i = 0; i < paths.length; i++) {
      var idx = paths[i].indexOf('/wp-includes/');
      if (idx !== -1) return paths[i].slice(0, idx + 1) || '/';
    }
    return '';
  }

  function findContentInfo(paths) {
    for (var i = 0; i < paths.length; i++) {
      var m = paths[i].match(/\/(app|wp-content|content)\/(themes|plugins|mu-plugins|uploads)\//);
      if (m) {
        return {
          dir: m[1],
          base: paths[i].slice(0, m.index + 1) || '/',
          sample: paths[i]
        };
      }
    }
    return null;
  }

  function findXmlrpcBase(url) {
    if (!url) return '';
    try {
      var p = new URL(url, location.href).pathname;
      var m = p.match(/^(.*\/)xmlrpc\.php$/);
      return m ? m[1] : '';
    } catch (err) {
      return '';
    }
  }

  function analyzeEnvironment() {
    var paths = collectPaths();

    var generatorMeta = document.querySelector('meta[name="generator"]');
    var generator = generatorMeta ? generatorMeta.getAttribute('content') || '' : '';

    var restLink = document.querySelector('link[rel="https://api.w.org/"], link[rel="rest-api"]');
    var restUrl = restLink ? restLink.getAttribute('href') || '' : '';

    var rsdLink = document.querySelector('link[rel="EditURI"]');
    var rsdUrl = rsdLink ? rsdLink.getAttribute('href') || '' : '';

    var includesBase = findIncludesBase(paths);
    var contentInfo = findContentInfo(paths);
    var xmlrpcBase = findXmlrpcBase(rsdUrl);

    var signals = [];
    if (/wordpress/i.test(generator)) signals.push('generator');
    if (includesBase) signals.push('wp-includes');
    if (contentInfo && contentInfo.dir === 'wp-content') signals.push('wp-content');
    if (restUrl) signals.push('rest-api');
    if (xmlrpcBase) signals.push('xmlrpc');
    if (paths.some(function (p) { return /\/wp-emoji-release\.min\.js$/.test(p); })) signals.push('emoji-script');
    if (paths.some(function (p) { return /\/wp-block-library\//.test(p); })) signals.push('block-library');
    if (paths.some(function (p) { return /\/wp-embed\.min\.js$/.test(p); })) signals.push('embed-script');
    if (document.getElementById('wpadminbar')) signals.push('admin-bar');

    var isWordPress = signals.length > 0;

    var hasAppPath = paths.some(function (p) {
      return /\/app\/(themes|plugins|mu-plugins|uploads)\//.test(p);
    });
    var hasWpContentPath = paths.some(function (p) {
      return /\/wp-content\//.test(p);
    });

    var bedrockConfidence = 'none';
    if (hasAppPath || (contentInfo && contentInfo.dir === 'app')) {
      bedrockConfidence = 'strong';
    } else if (isWordPress && includesBase === '/wp/' && !hasWpContentPath) {
      bedrockConfidence = 'likely';
    }

    var wpCorePath = includesBase || xmlrpcBase || '';
    if (!wpCorePath && contentInfo && contentInfo.dir === 'wp-content') {
      wpCorePath = contentInfo.base;
    }
    if (!wpCorePath && bedrockConfidence === 'strong') wpCorePath = '/wp/';
    if (!wpCorePath) wpCorePath = '/';

    var versionMatch = generator.match(/WordPress\s+([0-9.]+)/i);

    return {
      isWordPress: isWordPress,
      isBedrock: bedrockConfidence !== 'none',
      bedrockConfidence: bedrockConfidence,
      wpVersion: versionMatch ? versionMatch[1] : '',
      generator: generator.slice(0, 200),
      wpCorePath: wpCorePath,
      contentDir: contentInfo ? contentInfo.dir : '',
      contentSample: contentInfo ? contentInfo.sample : '',
      restUrl: restUrl,
      xmlrpcUrl: rsdUrl,
      signals: signals,
      origin: location.origin,
      href: location.href
    };
  }

  /* ------------------------------------------------------------------ */
  /* Admin URLs                                                         */
  /* ------------------------------------------------------------------ */

  function computeAdminBase(env) {
    var override = String(state.settings.adminBaseOverride || '').trim();

    if (override) {
      if (/^https?:\/\//i.test(override)) {
        try {
          var full = new URL(override);
          full.pathname = full.pathname.replace(/\/?$/, '/');
          return full.href;
        } catch (err) {
          /* fall through */
        }
      }
      var path = override.charAt(0) === '/' ? override : '/' + override;
      try {
        var fromPath = new URL(path, location.origin);
        fromPath.pathname = fromPath.pathname.replace(/\/?$/, '/');
        return fromPath.href;
      } catch (err2) {
        /* fall through */
      }
    }

    var core = env.wpCorePath || '/';
    try {
      return new URL(core + 'wp-admin/', location.origin).href;
    } catch (err3) {
      return location.origin + '/wp-admin/';
    }
  }

  function buildEditUrl(adminBase, id) {
    return adminBase + 'admin.php?page=wpcf7&post=' + encodeURIComponent(id) + '&action=edit';
  }

  function buildAllFormsUrl(adminBase) {
    return adminBase + 'admin.php?page=wpcf7';
  }

  /* ------------------------------------------------------------------ */
  /* CF7 detection                                                      */
  /* ------------------------------------------------------------------ */

  function isCf7Form(form) {
    if (!form || form.tagName !== 'FORM') return false;
    var cls = form.getAttribute('class') || '';
    var id = form.id || '';
    var action = form.getAttribute('action') || '';
    if (/(^|\s)wpcf7-form(\s|$)/.test(cls)) return true;
    if (/^wpcf7-f[0-9]+/.test(id)) return true;
    if (/contact-form-7|wpcf7/i.test(action)) return true;
    if (form.querySelector('input[name="_wpcf7"], input[name="_wpcf7_unit_tag"]')) return true;
    if (form.closest('.wpcf7')) return true;
    return false;
  }

  function extractFormId(form) {
    var hidden = form.querySelector('input[name="_wpcf7"]');
    if (hidden && hidden.value) return String(hidden.value).trim();

    var dataId = form.getAttribute('data-wpcf7-id');
    if (dataId) return String(dataId).trim();

    var wrapper = form.closest('.wpcf7');
    if (wrapper) {
      var wrapId = wrapper.getAttribute('data-wpcf7-id');
      if (wrapId) return String(wrapId).trim();
      var m = (wrapper.id || '').match(/wpcf7-f([0-9]+)/);
      if (m) return m[1];
    }

    var unitInput = form.querySelector('input[name="_wpcf7_unit_tag"]');
    if (unitInput && unitInput.value) {
      var unitMatch = String(unitInput.value).match(/wpcf7-f([0-9]+)/);
      if (unitMatch) return unitMatch[1];
    }

    var idMatch = (form.id || '').match(/wpcf7-f([0-9]+)/);
    if (idMatch) return idMatch[1];

    return '';
  }

  function extractUnitTag(form, formId) {
    var unitInput = form.querySelector('input[name="_wpcf7_unit_tag"]');
    if (unitInput && unitInput.value) return String(unitInput.value).trim();

    var wrapper = form.closest('.wpcf7');
    if (wrapper && wrapper.id) return wrapper.id;
    if (form.id) return form.id;
    return formId ? 'wpcf7-f' + formId : '';
  }

  function isGenericFormTitle(value) {
    var v = String(value || '').replace(/\s+/g, ' ').trim();
    if (!v) return true;
    if (/^contact form(?:\s*7)?(?:\s*#\s*\d+)?$/i.test(v)) return true;
    if (/^form(?:\s*#\s*\d+)?$/i.test(v)) return true;
    if (/^untitled$/i.test(v)) return true;
    return false;
  }

  function extractFormTitle(form, formId) {
    var titleAttr = (form.getAttribute('title') || '').trim();
    if (titleAttr && !isGenericFormTitle(titleAttr)) return titleAttr;

    var titleText = textOf(form.querySelector('.wpcf7-form-title'));
    if (titleText && !isGenericFormTitle(titleText)) return titleText;

    var labelledBy = (form.getAttribute('aria-labelledby') || '').trim();
    if (labelledBy) {
      var firstId = labelledBy.split(/\s+/)[0];
      var labelledText = textOf(document.getElementById(firstId));
      if (labelledText && !isGenericFormTitle(labelledText)) return labelledText;
    }

    var wrapper = form.closest('.wpcf7');
    var scope = wrapper || form;

    var container = scope.closest(
      'section, article, .wp-block-group, .wp-block-column, .elementor-widget, .elementor-section, .vc_column, .wpcf7'
    );
    if (container) {
      var heading = container.querySelector('h1,h2,h3,h4,h5,h6,.elementor-heading-title');
      var headingText = textOf(heading);
      if (headingText && !isGenericFormTitle(headingText)) {
        if (form.contains(heading) || isBefore(heading, form)) {
          return headingText.slice(0, 140);
        }
      }
    }

    var current = scope;
    for (var level = 0; level < 4 && current; level++) {
      var prev = current.previousElementSibling;
      for (var p = 0; p < 3 && prev; p++) {
        var belongsToForm = false;
        if (prev.matches && prev.matches('.wpcf7, form.wpcf7-form, [data-wpcf7-id]')) {
          belongsToForm = true;
        } else if (prev.querySelector && prev.querySelector('.wpcf7, form.wpcf7-form, [data-wpcf7-id]')) {
          belongsToForm = true;
        }

        if (belongsToForm) break;

        var prevHeading = null;
        if (prev.matches && prev.matches('h1,h2,h3,h4,h5,h6,.elementor-heading-title')) {
          prevHeading = prev;
        } else if (prev.querySelector) {
          prevHeading = prev.querySelector('h1,h2,h3,h4,h5,h6,.elementor-heading-title');
        }

        var prevText = textOf(prevHeading);
        if (prevText && !isGenericFormTitle(prevText) && isBefore(prevHeading, form)) {
          return prevText.slice(0, 140);
        }

        prev = prev.previousElementSibling;
      }

      current = current.parentElement;
      if (!current || current === document.body || current === document.documentElement) break;
    }

    var aria = (form.getAttribute('aria-label') || '').trim();
    if (aria && !isGenericFormTitle(aria)) return aria;

    return 'Form #' + formId;
  }

  function countFields(form) {
    return form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'
    ).length;
  }

  function isVisible(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch (err) {
        /* fall back */
      }
    }
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  function detectForms() {
    var forms = [];
    var seen = [];

    function add(el) {
      if (!el) return;
      var form = null;
      if (el.tagName === 'FORM') form = el;
      else form = el.querySelector('form') || el.closest('form');
      if (!form || seen.indexOf(form) !== -1) return;
      if (!isCf7Form(form)) return;

      var id = extractFormId(form);
      if (!id) return;

      seen.push(form);

      var versionEl = form.querySelector('input[name="_wpcf7_version"]');
      forms.push({
        id: id,
        title: extractFormTitle(form, id),
        unitTag: extractUnitTag(form, id),
        version: versionEl && versionEl.value ? String(versionEl.value).trim() : '',
        fieldCount: countFields(form),
        visible: isVisible(form),
        element: form
      });
    }

    var allForms = document.querySelectorAll('form');
    for (var i = 0; i < allForms.length; i++) add(allForms[i]);

    var extra = document.querySelectorAll('.wpcf7-form, .wpcf7, [data-wpcf7-id]');
    for (var j = 0; j < extra.length; j++) add(extra[j]);

    return forms;
  }

  /* ------------------------------------------------------------------ */
  /* Prefill                                                            */
  /* ------------------------------------------------------------------ */

  function getPrefillValues() {
    var s = state.settings;
    return {
      firstName: s.prefillFirstName || '',
      lastName: s.prefillLastName || '',
      email: s.prefillEmail || '',
      phone: s.prefillPhone || '',
      message: s.prefillMessage || ''
    };
  }

  function fieldHints(el) {
    var hints = [];

    if (el.name) hints.push(el.name);
    if (el.id) hints.push(el.id);
    if (el.getAttribute('placeholder')) hints.push(el.getAttribute('placeholder'));

    var aria = el.getAttribute('aria-label');
    if (aria) hints.push(aria);

    var wrap = el.closest ? el.closest('.wpcf7-form-control-wrap') : null;
    if (wrap && wrap.className) hints.push(wrap.className);

    var label = '';
    if (el.labels && el.labels.length > 0) {
      label = el.labels[0].textContent || '';
    }
    if (!label && el.closest) {
      var parentLabel = el.closest('label');
      if (parentLabel) label = parentLabel.textContent || '';
    }
    if (label) hints.push(label);

    return hints.join(' ').toLowerCase();
  }

  function classifyPrefillField(el) {
    var tag = (el.tagName || '').toLowerCase();
    var type = (el.type || '').toLowerCase();

    if (tag !== 'textarea' && tag !== 'input') return '';
    if (el.disabled || el.readOnly) return '';

    if (tag === 'input') {
      if (
        type === 'hidden' ||
        type === 'submit' ||
        type === 'button' ||
        type === 'reset' ||
        type === 'checkbox' ||
        type === 'radio' ||
        type === 'file' ||
        type === 'range' ||
        type === 'color' ||
        type === 'date' ||
        type === 'datetime-local' ||
        type === 'month' ||
        type === 'week' ||
        type === 'time'
      ) {
        return '';
      }
    }

    var hint = fieldHints(el);

    if (tag === 'textarea' || /message|comment|your-message|enquiry|inquiry|body/.test(hint)) {
      return 'message';
    }
    if (type === 'email' || /e-?mail/.test(hint)) return 'email';
    if (type === 'tel' || /(^|[^a-z])(phone|telephone|mobile|cell|whatsapp|tel)([^a-z]|$)/.test(hint)) {
      return 'phone';
    }
    if (/first[\s_-]?name|given[\s_-]?name|fname/.test(hint)) return 'firstName';
    if (/last[\s_-]?name|family[\s_-]?name|surname|lname/.test(hint)) return 'lastName';
    if (/company|business|organization|organisation|firm|website|domain|brand/.test(hint)) return '';
    if (/\byour-name\b|(^|\s)name(\s|$)|full[\s_-]?name/.test(hint)) return 'firstName';

    return '';
  }

  function setPrefillValue(el, value) {
    if (typeof value !== 'string' || value === '') return false;

    el.value = value;

    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      /* ignore */
    }

    return true;
  }

  function prefillForm(form, values) {
    if (!form) return { filled: 0, byType: {} };

    var byType = { firstName: 0, lastName: 0, email: 0, phone: 0, message: 0 };
    var filled = 0;
    var seen = [];

    var fields = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!el || seen.indexOf(el) !== -1) continue;
      seen.push(el);

      var kind = classifyPrefillField(el);
      if (!kind) continue;

      if (setPrefillValue(el, values[kind])) {
        filled++;
        byType[kind]++;
      }
    }

    return { filled: filled, byType: byType };
  }

  /* ------------------------------------------------------------------ */
  /* Form titles                                                        */
  /* ------------------------------------------------------------------ */

  function fetchFormTitle(restUrl, id) {
    if (!restUrl) return Promise.resolve('');

    try {
      var base = new URL(restUrl, location.href);

      var endpoint;
      if (base.searchParams && base.searchParams.has('rest_route')) {
        base.searchParams.set(
          'rest_route',
          '/contact-form-7/v1/contact-forms/' + encodeURIComponent(id)
        );
        endpoint = base;
      } else {
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        endpoint = new URL(
          'contact-form-7/v1/contact-forms/' + encodeURIComponent(id),
          base
        );
      }

      if (endpoint.origin !== location.origin) return Promise.resolve('');

      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;

      if (controller) {
        timer = setTimeout(function () {
          try {
            controller.abort();
          } catch (err) {
            /* ignore */
          }
        }, 4000);
      }

      return fetch(endpoint.href, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        if (!response || !response.ok) return '';
        return response.json();
      }).then(function (data) {
        if (data && typeof data.title === 'string') {
          return data.title.replace(/\s+/g, ' ').trim();
        }
        return '';
      }).catch(function () {
        return '';
      }).then(function (title) {
        if (timer) clearTimeout(timer);
        return title;
      });
    } catch (err) {
      return Promise.resolve('');
    }
  }

  function applyCachedTitle(id, title) {
    for (var i = 0; i < state.forms.length; i++) {
      if (String(state.forms[i].id) === String(id)) {
        if (state.forms[i].title !== title) {
          state.forms[i].title = title;
          state.lastSignature = '';
          updatePanel();
        }
        break;
      }
    }
  }

  function requestFormTitle(id) {
    if (!state.env || !state.env.isWordPress || !state.env.restUrl) return Promise.resolve('');

    var key = String(id);
    if (state.titleCache[key]) return Promise.resolve(state.titleCache[key]);
    if (state.titleRequests[key]) return state.titleRequests[key];

    var promise = fetchFormTitle(state.env.restUrl, key).then(function (title) {
      if (title) {
        state.titleCache[key] = title;
        applyCachedTitle(key, title);
      }
      return title || '';
    });

    state.titleRequests[key] = promise;
    return promise;
  }

  /* ------------------------------------------------------------------ */
  /* Scan                                                               */
  /* ------------------------------------------------------------------ */

  function rescan(full) {
    if (!document.body) return;

    if (full !== false || !state.env) {
      var env = analyzeEnvironment();
      state.env = env;
      state.adminBase = computeAdminBase(env);
    }

    var adminBase = state.adminBase;

    state.forms = detectForms().map(function (f) {
      return {
        id: f.id,
        title: state.titleCache[f.id] || f.title,
        unitTag: f.unitTag,
        version: f.version,
        fieldCount: f.fieldCount,
        visible: f.visible,
        editUrl: buildEditUrl(adminBase, f.id),
        element: f.element
      };
    });

    if (
      state.settings.fetchFormTitles !== false &&
      state.env &&
      state.env.isWordPress &&
      state.env.restUrl
    ) {
      state.forms.forEach(function (f) {
        if (!state.titleCache[f.id]) requestFormTitle(f.id);
      });
    }

    if (
      state.settings.prefillEnabled !== false &&
      state.settings.autoFill === true &&
      state.env &&
      state.env.isWordPress
    ) {
      var values = getPrefillValues();
      state.forms.forEach(function (f) {
        if (!state.autoFilled.has(f.element)) {
          var result = prefillForm(f.element, values);
          if (result.filled > 0) state.autoFilled.add(f.element);
        }
      });
    }

    updatePanel();
  }

  function scheduleScan(delay, full) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      scanTimer = null;
      rescan(full);
    }, typeof delay === 'number' ? delay : SCAN_DEBOUNCE_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Floating panel                                                     */
  /* ------------------------------------------------------------------ */

var FONT_BASE = '';
  try {
    FONT_BASE = chrome.runtime.getURL('fonts/');
  } catch (err) {
    FONT_BASE = '';
  }

  var FONT_FACES = FONT_BASE
    ? [
        "@font-face { font-family: 'Figtree'; font-style: normal; font-weight: 400; font-display: swap; src: url('" + FONT_BASE + "figtree-latin-400-normal.woff2') format('woff2'); }",
        "@font-face { font-family: 'Figtree'; font-style: normal; font-weight: 500; font-display: swap; src: url('" + FONT_BASE + "figtree-latin-500-normal.woff2') format('woff2'); }",
        "@font-face { font-family: 'Figtree'; font-style: normal; font-weight: 600; font-display: swap; src: url('" + FONT_BASE + "figtree-latin-600-normal.woff2') format('woff2'); }",
        "@font-face { font-family: 'Figtree'; font-style: normal; font-weight: 700; font-display: swap; src: url('" + FONT_BASE + "figtree-latin-700-normal.woff2') format('woff2'); }"
      ].join('\n')
    : '';

  var LIGHT_TOKENS = [
    '--font-sans: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '--font-mono: ui-monospace, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
    '--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;',
    '--radius-inner: 4px; --radius-element: 10px; --radius-container: 12px; --radius-full: 9999px;',
    '--motion-fast: 175ms; --duration-fast: 175ms; --duration-exit: 175ms;',
    '--ease-standard: cubic-bezier(0.24, 1, 0.4, 1); --ease-exit: cubic-bezier(0.3, 0, 0.6, 0.6);',
    '--color-background-body: #f1f1f1;',
    '--color-background-surface: #ffffff;',
    '--color-background-card: #ffffff;',
    '--color-background-popover: #ffffff;',
    '--color-background-muted: #f1f1f1;',
    '--color-hover: #f5f5f5;',
    '--color-overlay-hover: rgba(0,0,0,0.05); --color-overlay-pressed: rgba(0,0,0,0.10);',
    '--color-text-primary: #000000;',
    '--color-text-secondary: #474747;',
    '--color-text-disabled: #919191;',
    '--color-border: rgba(0, 0, 0, 0.08);',
    '--color-border-emphasized: #d4d4d4;',
    '--color-accent: #1b1b1b;',
    '--color-on-accent: #ffffff;',
    '--color-info: #0074e2;',
    '--color-info-muted: #b9d7ff;',
    '--color-on-info-muted: #003978;',
    '--color-text-info: #0067ce;',
    '--color-success: #198100;',
    '--color-success-muted: #bce0bb;',
    '--color-on-success-muted: #00490b;',
    '--color-text-success: #2f7d33;',
    '--color-warning: #ffce2f;',
    '--color-warning-muted: #fae19e;',
    '--color-on-warning-muted: #4b3900;',
    '--color-text-warning: #836700;',
    '--color-error: #c9303a;',
    '--color-error-muted: #ffc4be;',
    '--color-on-error-muted: #76000c;',
    '--color-text-error: #c0262c;',
    '--shadow-low: 0 2px 4px rgba(0,0,0,0.05), 0 4px 8px rgba(0,0,0,0.10);',
    '--shadow-med: 0 2px 4px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.10);',
    '--shadow-high: 0 4px 6px rgba(0,0,0,0.10), 0 12px 24px rgba(0,0,0,0.15);'
  ].join(' ');

  var DARK_TOKENS = [
    '--color-background-body: #1b1b1b;',
    '--color-background-surface: #262626;',
    '--color-background-card: #262626;',
    '--color-background-popover: #262626;',
    '--color-background-muted: #262626;',
    '--color-hover: #2f2f2f;',
    '--color-overlay-hover: rgba(255,255,255,0.05); --color-overlay-pressed: rgba(255,255,255,0.10);',
    '--color-text-primary: #ffffff;',
    '--color-text-secondary: #9e9e9e;',
    '--color-text-disabled: #525252;',
    '--color-border: rgba(255, 255, 255, 0.10);',
    '--color-border-emphasized: #525252;',
    '--color-accent: #f1f1f1;',
    '--color-on-accent: #111111;',
    '--color-info: #6d9cfe;',
    '--color-info-muted: rgba(136, 188, 255, 0.24);',
    '--color-on-info-muted: #a1caff;',
    '--color-text-info: #a1caff;',
    '--color-success: #64af4c;',
    '--color-success-muted: rgba(144, 202, 144, 0.24);',
    '--color-on-success-muted: #90ca90;',
    '--color-text-success: #90ca90;',
    '--color-warning: #ffce2f;',
    '--color-warning-muted: rgba(226, 182, 35, 0.24);',
    '--color-on-warning-muted: #eec448;',
    '--color-text-warning: #eec448;',
    '--color-error: #ff705d;',
    '--color-error-muted: rgba(255, 152, 144, 0.24);',
    '--color-on-error-muted: #ffaea7;',
    '--color-text-error: #ffaea7;',
    '--shadow-low: 0 2px 4px rgba(0,0,0,0.25), 0 4px 8px rgba(0,0,0,0.40), inset 0 0 0 1px rgba(255,255,255,0.08);',
    '--shadow-med: 0 2px 4px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.50), inset 0 0 0 1px rgba(255,255,255,0.12);',
    '--shadow-high: 0 4px 6px rgba(0,0,0,0.50), 0 12px 24px rgba(0,0,0,0.70), inset 0 0 0 1px rgba(255,255,255,0.15);'
  ].join(' ');

  var SHADOW_CSS = [
    FONT_FACES,
    ':host { all: initial; ' + LIGHT_TOKENS + ' }',
    '@media (prefers-color-scheme: dark) { :host { ' + DARK_TOKENS + ' } }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: var(--font-sans); font-size: 13px; line-height: 1.4; color: var(--color-text-primary); }',
    '.pill { position: relative; overflow: hidden; isolation: isolate; display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: none; border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent); font: inherit; font-weight: 600; letter-spacing: 0.01em; cursor: pointer; box-shadow: var(--shadow-med); transition: transform var(--duration-fast) var(--ease-standard); }',
    '.pill::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgba(255,255,255,0.16); opacity: 0; transition: opacity var(--duration-fast) var(--ease-standard); pointer-events: none; z-index: -1; }',
    '.pill:hover::before { opacity: 1; }',
    '.pill:active { transform: scale(0.98); }',
    '.pill:active::before { background: rgba(255,255,255,0.24); opacity: 1; transition-duration: 0ms; }',
    '.pill:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }',
    '.pill.is-entering { animation: cf7-pop-in var(--duration-fast) var(--ease-standard); }',
    '@keyframes cf7-pop-in { from { opacity: 0; transform: translateY(4px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }',
    '.dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-success); flex: none; }',
    '.count { min-width: 20px; height: 20px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-full); background: rgba(255,255,255,0.18); color: var(--color-on-accent); font-size: 11px; font-weight: 700; line-height: 1; }',
    '.pill-close { flex: none; width: 22px; height: 22px; border-radius: var(--radius-full); background: var(--color-background-card); color: var(--color-text-secondary); font-size: 15px; line-height: 1; border: 1px solid var(--color-border); box-shadow: var(--shadow-low); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.pill-close:hover { background: var(--color-hover); color: var(--color-text-primary); }',
    '.pill-close:active { transform: scale(0.94); }',
    '.pill-close:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }',
    '.panel { width: 320px; max-width: calc(100vw - 32px); max-height: min(70vh, 560px); display: flex; flex-direction: column; overflow: hidden; background: var(--color-background-popover); color: var(--color-text-primary); border: 1px solid var(--color-border); border-radius: var(--radius-container); box-shadow: var(--shadow-high); opacity: 0; transform: translateY(4px) scale(0.98); transform-origin: bottom right; transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.panel.is-open { opacity: 1; transform: translateY(0) scale(1); }',
    '.panel[hidden] { display: none; }',
    '.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--color-border); }',
    '.panel-title { font-weight: 700; font-size: 13px; letter-spacing: -0.01em; }',
    '.panel-sub { font-size: 11px; color: var(--color-text-secondary); margin-top: 1px; }',
    '.close { border: none; background: transparent; color: var(--color-text-secondary); font-family: var(--font-sans); font-size: 18px; line-height: 1; padding: 4px; border-radius: var(--radius-inner); cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.close:hover { background: var(--color-hover); color: var(--color-text-primary); }',
    '.close:active { transform: scale(0.94); }',
    '.close:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }',
    '.list { overflow-y: auto; min-height: 0; padding: 6px; display: flex; flex-direction: column; gap: 2px; }',
    '.item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: var(--radius-inner); transition: background var(--duration-fast) var(--ease-standard); }',
    '.item:hover { background: var(--color-hover); }',
    '.item-main { min-width: 0; flex: 1; }',
    '.item-title { font-size: 12.5px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.item-meta { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.item-actions { flex: none; display: flex; align-items: center; gap: 6px; }',
    '.edit { flex: none; text-decoration: none; font-size: 11.5px; font-weight: 600; color: var(--color-text-info); background: transparent; border: none; padding: 5px 8px; border-radius: var(--radius-inner); cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.edit:hover { background: var(--color-info-muted); }',
    '.fill { flex: none; border: 1px solid transparent; background: var(--color-success-muted); color: var(--color-on-success-muted); font: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 9px; border-radius: var(--radius-inner); cursor: pointer; transition: filter var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.fill:hover { filter: brightness(0.98); }',
    '.focus { flex: none; border: 1px solid var(--color-border); background: var(--color-hover); color: var(--color-text-primary); font: inherit; font-size: 11.5px; font-weight: 600; padding: 5px 9px; border-radius: var(--radius-inner); cursor: pointer; transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }',
    '.focus:hover { background: var(--color-background-muted); border-color: var(--color-border-emphasized); }',
    '.edit:active, .fill:active, .focus:active { transform: scale(0.97); }',
    '.panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-text-secondary); }',
    '.env { min-width: 0; flex: 1; font-family: var(--font-mono); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.all { flex: none; color: var(--color-text-info); font-weight: 600; text-decoration: none; white-space: nowrap; }',
    '.all:hover { text-decoration: underline; }',
    '.all[hidden] { display: none; }',
    '@media (prefers-color-scheme: dark) { .count { background: rgba(0,0,0,0.10); } .pill::before { background: rgba(0,0,0,0.08); } .pill:active::before { background: rgba(0,0,0,0.14); } }',
    '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }'
  ].join('\n');

  var PANEL_MARKUP = [
    '<div class="wrap">',
    '  <section class="panel" id="cf7-panel" hidden aria-label="Contact Form 7 forms">',
    '    <div class="panel-head">',
    '      <div>',
    '        <div class="panel-title">Contact Form 7</div>',
    '        <div class="panel-sub" id="cf7-sub"></div>',
    '      </div>',
    '      <button class="close" id="cf7-close" type="button" aria-label="Close panel">&times;</button>',
    '    </div>',
    '    <div class="list" id="cf7-list"></div>',
    '    <div class="panel-foot">',
    '      <span class="env" id="cf7-env"></span>',
    '      <a class="all" id="cf7-all" target="_blank" rel="noopener noreferrer">All forms</a>',
    '    </div>',
    '  </section>',
    '  <div class="pill-wrap" id="cf7-pill-wrap" style="display:inline-flex;align-items:center;gap:4px;">',
    '    <button class="pill" id="cf7-pill" type="button" aria-expanded="false" aria-controls="cf7-panel">',
    '      <span class="dot"></span>',
    '      <span>CF7</span>',
'      <span class="count" id="cf7-count">0</span>',
'    </button>',
    '    <button class="pill-close" id="cf7-pill-close" type="button" aria-label="Close badge" title="Close">&times;</button>',
'  </div>',
    '</div>'
  ].join('\n');

  function ensureHost() {
    if (state.host && document.documentElement.contains(state.host)) return state.host;

    var host = document.createElement('div');
    host.id = HOST_ID;

    var supportsPopover = typeof host.showPopover === 'function';
    if (supportsPopover) {
      host.setAttribute('popover', 'manual');
    }

    host.style.cssText = supportsPopover
      ? 'position:fixed;z-index:2147483647;right:16px;bottom:16px;top:auto;left:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;width:fit-content;height:fit-content;display:none;'
      : 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;display:none;';

    var shadow = host.attachShadow({ mode: 'open' });

    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in shadow) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(SHADOW_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } else {
      var style = document.createElement('style');
      style.textContent = SHADOW_CSS;
      shadow.appendChild(style);
    }

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = PANEL_MARKUP;
    shadow.appendChild(wrap);

    (document.body || document.documentElement).appendChild(host);

    state.host = host;
    state.shadow = shadow;

    bindPanelEvents();
    return host;
  }

  function bindPanelEvents() {
    var shadow = state.shadow;
    if (!shadow) return;

    var pill = shadow.getElementById('cf7-pill');
    var closeBtn = shadow.getElementById('cf7-close');

    if (pill) {
      pill.addEventListener('click', function () {
        setPanelOpen(!state.panelOpen);
      });
    }

    var pillClose = shadow.getElementById('cf7-pill-close');
    if (pillClose) {
      pillClose.addEventListener('click', function (e) {
        e.stopPropagation();
        state.pillDismissed = true;
        setPanelOpen(false);
        setHostVisible(false);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        setPanelOpen(false);
      });
    }

    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && state.panelOpen) setPanelOpen(false);
    });

    document.addEventListener('click', function (e) {
      if (!state.panelOpen || !state.host) return;
      var target = e.target;
      if (target === state.host) return;
      if (target && target.nodeType === 1 && state.host.contains(target)) return;
      setPanelOpen(false);
    }, true);
  }

  function setPanelOpen(open) {
    state.panelOpen = !!open;
    if (!state.shadow) return;
    var pill = state.shadow.getElementById('cf7-pill');
    var panel = state.shadow.getElementById('cf7-panel');
    if (pill) pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!panel) return;

    if (open) {
      panel.hidden = false;
      void panel.offsetWidth;
      panel.classList.add('is-open');
    } else {
      panel.classList.remove('is-open');
      setTimeout(function () {
        if (!state.panelOpen) panel.hidden = true;
      }, 175);
    }
  }

  function animatePillIn() {
    if (!state.shadow) return;
    var pill = state.shadow.getElementById('cf7-pill');
    if (!pill) return;
    pill.classList.remove('is-entering');
    void pill.offsetWidth;
    pill.classList.add('is-entering');
  }

  function setHostVisible(visible) {
    if (!state.host) return;

    var supportsPopover = typeof state.host.showPopover === 'function';
    var wasVisible = state.hostVisible;

    if (visible) {
      state.host.style.display = 'block';
      if (supportsPopover) {
        try {
          if (!state.host.matches(':popover-open')) {
            state.host.showPopover();
          }
        } catch (err) {
          /* fall back to plain display */
        }
      }
      if (!wasVisible) animatePillIn();
    } else {
      state.host.style.display = 'none';
      if (supportsPopover) {
        try {
          if (state.host.matches(':popover-open')) {
            state.host.hidePopover();
          }
        } catch (err) {
          /* ignore */
        }
      }
    }

    state.hostVisible = visible;
  }

  function applySettings() {
    var show =
      state.settings.showFloatingBadge !== false &&
      state.forms &&
      state.forms.length > 0 &&
      !state.pillDismissed;
    setHostVisible(show);
    if (!show && state.panelOpen) setPanelOpen(false);
  }

  function updatePanel() {
    if (!state.shadow) return;

    var signature = state.forms.map(function (f) {
      return [f.id, f.title, f.unitTag, f.fieldCount, f.editUrl].join('|');
    }).join('||');

    if (signature === state.lastSignature) {
      applySettings();
      return;
    }
    state.lastSignature = signature;

    var list = state.shadow.getElementById('cf7-list');
    var pill = state.shadow.getElementById('cf7-pill');
    var countEl = state.shadow.getElementById('cf7-count');
    var subEl = state.shadow.getElementById('cf7-sub');
    var envEl = state.shadow.getElementById('cf7-env');
    var allEl = state.shadow.getElementById('cf7-all');
    if (!list || !pill) return;

    list.textContent = '';

    state.forms.forEach(function (f) {
      var item = document.createElement('div');
      item.className = 'item';

      var main = document.createElement('div');
      main.className = 'item-main';

      var title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = f.title;
      title.title = f.title;

      var meta = document.createElement('div');
      meta.className = 'item-meta';
      var parts = ['#' + f.id];
      if (typeof f.fieldCount === 'number' && f.fieldCount > 0) parts.push(f.fieldCount + ' fields');
      if (f.unitTag) parts.push(f.unitTag);
      meta.textContent = parts.join(' \u00b7 ');

      main.appendChild(title);
      main.appendChild(meta);

      var link = document.createElement('a');
      link.className = 'edit';
      link.href = f.editUrl;
      link.target = state.settings.openLinksInNewTab === false ? '_self' : '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Edit';

      var actions = document.createElement('div');
      actions.className = 'item-actions';

      if (state.settings.prefillEnabled !== false) {
        var fill = document.createElement('button');
        fill.type = 'button';
        fill.className = 'fill';
        fill.textContent = 'Fill';
        fill.addEventListener('click', function () {
          var result = prefillForm(f.element, getPrefillValues());
          fill.textContent = result.filled > 0 ? 'Filled' : 'No fields';
          setTimeout(function () {
            fill.textContent = 'Fill';
          }, 1500);
        });
        actions.appendChild(fill);
      }

      var focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'focus';
      focus.textContent = 'Focus';
      focus.addEventListener('click', function () {
        var el = f.element;
        if (el && el.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            var outlineBackup = el.style.outline;
            var shadowBackup = el.style.boxShadow;
            el.style.outline = '3px solid #fff';
            el.style.outlineOffset = '3px';
            el.style.boxShadow = '0 0 0 4px #2563eb';
            el.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
            setTimeout(function () {
              el.style.outline = outlineBackup;
              el.style.boxShadow = shadowBackup;
            }, 1800);
          } catch (err) {
            /* ignore */
          }
          focus.textContent = 'Focused';
          setTimeout(function () {
            focus.textContent = 'Focus';
          }, 1500);
        }
      });
      actions.appendChild(focus);

      actions.appendChild(link);

      item.appendChild(main);
      item.appendChild(actions);
      list.appendChild(item);
    });

    if (countEl) countEl.textContent = String(state.forms.length);

    var env = state.env;
    if (subEl) {
      if (!env) {
        subEl.textContent = '';
      } else if (!env.isWordPress) {
        subEl.textContent = 'Not a WordPress page';
      } else if (env.bedrockConfidence === 'strong') {
        subEl.textContent = 'WordPress \u00b7 Bedrock \u00b7 core ' + env.wpCorePath;
      } else if (env.bedrockConfidence === 'likely') {
        subEl.textContent = 'WordPress \u00b7 likely Bedrock \u00b7 core ' + env.wpCorePath;
      } else if (env.wpCorePath && env.wpCorePath !== '/') {
        subEl.textContent = 'WordPress \u00b7 core ' + env.wpCorePath;
      } else {
        subEl.textContent = 'WordPress';
      }
    }

    if (envEl) {
      if (env && env.isWordPress) {
        envEl.textContent = 'admin ' + state.adminBase;
        envEl.title = state.adminBase;
      } else {
        envEl.textContent = '';
      }
    }

    if (allEl) {
      if (env && env.isWordPress) {
        allEl.href = buildAllFormsUrl(state.adminBase);
        allEl.target = state.settings.openLinksInNewTab === false ? '_self' : '_blank';
        allEl.hidden = false;
      } else {
        allEl.hidden = true;
        allEl.removeAttribute('href');
      }
    }

    applySettings();
  }

  function revealHiddenForm(el) {
    var changes = [];
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var cs = window.getComputedStyle(node);
      var style = node.style;
      var change = null;
      if (cs.display === 'none') {
        change = { prop: 'display', backup: style.display };
        style.display = 'block';
      } else if (cs.visibility === 'hidden') {
        change = { prop: 'visibility', backup: style.visibility };
        style.visibility = 'visible';
      } else if (cs.opacity === '0') {
        change = { prop: 'opacity', backup: style.opacity };
        style.opacity = '1';
      } else if (cs.height === '0px' && cs.overflow === 'hidden') {
        change = { prop: 'height', backup: style.height };
        style.height = 'auto';
        style.overflow = 'visible';
      }
      if (change) {
        changes.push({ node: node, change: change });
      }
      node = node.parentElement;
    }
    return changes;
  }

  function restoreHiddenForm(changes) {
    changes.forEach(function (item) {
      var node = item.node;
      var change = item.change;
      if (change.prop === 'height') {
        node.style.height = change.backup;
        node.style.overflow = '';
      } else {
        node.style[change.prop] = change.backup;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Messaging                                                          */
  /* ------------------------------------------------------------------ */

  function buildScanResponse() {
    return {
      ok: true,
      env: state.env,
      adminBase: state.adminBase,
      forms: state.forms.map(function (f) {
        return {
          id: f.id,
          title: f.title,
          unitTag: f.unitTag,
          version: f.version,
          fieldCount: f.fieldCount,
          visible: f.visible,
          editUrl: f.editUrl
        };
      }),
      settings: state.settings
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'CF7_SCAN') {
        rescan();

        var pending = Object.keys(state.titleRequests).map(function (key) {
          return state.titleRequests[key];
        });

        if (pending.length > 0) {
          var timeout = new Promise(function (resolve) {
            setTimeout(resolve, 1500);
          });

          Promise.race([Promise.all(pending), timeout]).then(function () {
            sendResponse(buildScanResponse());
          });
        } else {
          sendResponse(buildScanResponse());
        }

        return true;
      }

      if (message.type === 'CF7_PREFILL') {
        if (!state.env || !state.env.isWordPress || state.settings.prefillEnabled === false) {
          sendResponse({ ok: true, filled: 0, forms: [] });
          return true;
        }

        var values = getPrefillValues();
        var targets = [];

        if (message.id) {
          for (var f = 0; f < state.forms.length; f++) {
            if (String(state.forms[f].id) === String(message.id)) targets.push(state.forms[f]);
          }
        } else {
          targets = state.forms.slice();
        }

        var total = 0;
        var formResults = [];

        targets.forEach(function (form) {
          var result = prefillForm(form.element, values);
          total += result.filled;
          formResults.push({ id: form.id, filled: result.filled });
        });

        sendResponse({ ok: true, filled: total, forms: formResults });
        return true;
      }

      if (message.type === 'CF7_SCROLL_TO') {
        var target = null;
        for (var i = 0; i < state.forms.length; i++) {
          if (String(state.forms[i].id) === String(message.id)) {
            target = state.forms[i];
            break;
          }
        }
        if (!target) {
          var wrapperEl = document.querySelector('.wpcf7[data-wpcf7-id="' + message.id + '"]');
          var domForm = wrapperEl ? wrapperEl.querySelector('form') : null;
          if (!domForm) {
            domForm = document.querySelector('form[id*="wpcf7-f' + message.id + '"]') ||
                      document.querySelector('form[id="wpcf7-f' + message.id + '"]');
          }
          if (domForm) {
            target = { id: message.id, element: domForm };
          }
        }
        if (target && target.element && target.element.scrollIntoView) {
          var el = target.element;
          var hiddenChanges = revealHiddenForm(el);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            var outlineBackup = el.style.outline;
            var shadowBackup = el.style.boxShadow;
            el.style.outline = '3px solid #fff';
            el.style.outlineOffset = '3px';
            el.style.boxShadow = '0 0 0 4px #2563eb';
            el.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
            setTimeout(function () {
              el.style.outline = outlineBackup;
              el.style.boxShadow = shadowBackup;
              restoreHiddenForm(hiddenChanges);
            }, 1800);
          } catch (err) {
            restoreHiddenForm(hiddenChanges);
          }
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
        return true;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                           */
  /* ------------------------------------------------------------------ */

  function loadSettings() {
    if (window.CF7Settings && window.CF7Settings.get) {
      return window.CF7Settings.get().then(function (settings) {
        state.settings = Object.assign({}, DEFAULTS, settings || {});
        state.lastSignature = '';
        applySettings();
      }).catch(function () {
        /* keep defaults */
      });
    }
    return Promise.resolve();
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'sync') return;
      var dirty = false;
      Object.keys(changes || {}).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
          state.settings[key] = changes[key].newValue;
          if (key === 'showFloatingBadge' && changes[key].newValue === true) {
            state.pillDismissed = false;
          }
          dirty = true;
        }
      });
      if (dirty) {
        state.lastSignature = '';
        rescan();
        applySettings();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */

  function observePage() {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];

        if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#' + HOST_ID)) {
          continue;
        }

        if (m.addedNodes) {
          var ours = false;
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node && node.nodeType === 1 && (node.id === HOST_ID || (node.closest && node.closest('#' + HOST_ID)))) {
              ours = true;
              break;
            }
          }
          if (ours) continue;
        }

        scheduleScan(SCAN_DEBOUNCE_MS, false);
        return;
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('pageshow', function () {
      scheduleScan(200, true);
    });
  }

  function init() {
    if (state.started) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    state.started = true;

    if (/\/wp-admin(\/|$)/i.test(location.pathname)) return;
    if (document.body.classList && document.body.classList.contains('wp-admin')) return;

    ensureHost();
    rescan();

    if (!state.env || !state.env.isWordPress) {
      setHostVisible(false);
      if (state.host && state.host.parentElement) {
        state.host.parentElement.removeChild(state.host);
      }
      state.host = null;
      state.shadow = null;
      return;
    }

    observePage();
  }

  loadSettings().then(init).catch(init);
})();