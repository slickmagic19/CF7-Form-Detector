(function () {
  'use strict';

  var els = {
    host: document.getElementById('page-host'),
    badge: document.getElementById('wp-badge'),
    note: document.getElementById('bedrock-note'),
    adminUrl: document.getElementById('admin-url'),
    copyAdmin: document.getElementById('copy-admin'),
    notice: document.getElementById('notice'),
    formCount: document.getElementById('form-count'),
    formList: document.getElementById('form-list'),
    empty: document.getElementById('empty'),
    prefillAll: document.getElementById('prefill-all'),
    rescan: document.getElementById('rescan'),
    allForms: document.getElementById('all-forms'),
    settingsBtn: document.getElementById('settings-btn'),
    optionsBtn: document.getElementById('options-btn')
  };

  var lastAdminBase = '';

  function showNotice(message, kind) {
    if (!els.notice) return;
    els.notice.textContent = message || '';
    els.notice.hidden = !message;
    if (message) els.notice.dataset.kind = kind || 'warn';
    else els.notice.removeAttribute('data-kind');
  }

  function setBadge(label, kind) {
    if (!els.badge) return;
    els.badge.textContent = label;
    els.badge.dataset.kind = kind || 'neutral';
  }

  function flashButton(button, label) {
    if (!button) return;
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent;
    }
    button.textContent = label;
    setTimeout(function () {
      button.textContent = button.dataset.originalLabel;
    }, 1400);
  }

  async function copyText(value) {
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (err) {
      try {
        var area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch (err2) {
        return false;
      }
    }
  }

  function formatHost(env) {
    try {
      var url = new URL(env.href || env.origin || 'about:blank');
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        var path = url.pathname && url.pathname !== '/' ? url.pathname : '';
        return url.hostname + path;
      }
    } catch (err) {
      /* fall through */
    }
    return env.origin || '';
  }

  function render(payload) {
    var env = payload.env || {};
    var forms = Array.isArray(payload.forms) ? payload.forms : [];
    var settings = payload.settings || {};
    lastAdminBase = payload.adminBase || '';

    if (els.host) {
      els.host.textContent = formatHost(env) || '\u00a0';
    }

    if (env.isWordPress) {
      if (env.bedrockConfidence === 'strong') {
        setBadge('WordPress \u00b7 Bedrock', 'bedrock');
      } else if (env.bedrockConfidence === 'likely') {
        setBadge('WordPress \u00b7 Bedrock?', 'bedrock');
      } else if (env.wpCorePath && env.wpCorePath !== '/') {
        setBadge('WordPress \u00b7 subdir', 'wordpress');
      } else {
        setBadge('WordPress', 'wordpress');
      }
    } else {
      setBadge('Not WordPress', 'other');
    }

    if (els.note) {
      var bits = [];
      if (env.wpVersion) bits.push('WP ' + env.wpVersion);
      if (env.bedrockConfidence === 'strong') bits.push('app/ content');
      if (env.bedrockConfidence === 'likely') bits.push('no wp-content');
      if (env.wpCorePath) bits.push('core ' + env.wpCorePath);
      if (env.contentDir && env.contentDir !== 'app' && env.contentDir !== 'wp-content') {
        bits.push(env.contentDir + '/');
      }
      els.note.textContent = bits.join(' \u00b7 ');
      els.note.title = bits.join(' \u00b7 ');
    }

    if (els.adminUrl) {
      if (env.isWordPress && lastAdminBase) {
        els.adminUrl.textContent = lastAdminBase;
        els.adminUrl.title = lastAdminBase;
      } else {
        els.adminUrl.textContent = env.isWordPress ? '\u2014' : 'auto-detect unavailable';
        els.adminUrl.title = '';
      }
    }

    if (els.formCount) els.formCount.textContent = String(forms.length);

    if (els.formList) {
      els.formList.textContent = '';

      forms.forEach(function (form) {
        var li = document.createElement('li');
        li.className = 'form-item';

        var main = document.createElement('div');
        main.className = 'form-main';

        var title = document.createElement('div');
        title.className = 'form-title';
        title.textContent = form.title || ('Form #' + form.id);
        title.title = title.textContent;

        var meta = document.createElement('div');
        meta.className = 'form-meta';
        var parts = ['#' + form.id];
        if (form.version) parts.push('CF7 ' + form.version);
        if (typeof form.fieldCount === 'number' && form.fieldCount > 0) {
          parts.push(form.fieldCount + (form.fieldCount === 1 ? ' field' : ' fields'));
        }
        if (form.unitTag) parts.push(form.unitTag);
        if (form.visible === false) parts.push('hidden');
        meta.textContent = parts.join(' \u00b7 ');

        main.appendChild(title);
        main.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'form-actions';

        var edit = document.createElement('a');
        edit.className = 'btn primary';
        edit.href = form.editUrl || '#';
        edit.target = settings.openLinksInNewTab === false ? '_self' : '_blank';
        edit.rel = 'noopener noreferrer';
        edit.textContent = 'Edit';
        edit.title = 'Edit this form in WordPress';

        actions.appendChild(edit);

        var focus = document.createElement('button');
        focus.type = 'button';
        focus.className = 'btn focus';
        focus.textContent = 'Focus';
        focus.title = 'Focus this form on the page';
        focus.addEventListener('click', async function () {
          var result = await sendFocus(form.id);
          if (result && result.ok) {
            flashButton(focus, 'Focused');
          } else {
            flashButton(focus, 'Failed');
          }
        });
        actions.appendChild(focus);

        if (settings.prefillEnabled !== false) {
          var fill = document.createElement('button');
          fill.type = 'button';
          fill.className = 'btn prefill';
          fill.textContent = 'Fill';
          fill.title = 'Fill name, email, phone and message fields';
          fill.addEventListener('click', async function () {
            var result = await sendPrefill(form.id);
            if (result) {
              flashButton(fill, result.filled > 0 ? 'Filled' : 'No fields');
            } else {
              flashButton(fill, 'Failed');
            }
          });
          actions.appendChild(fill);
        }

        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn ghost';
        copy.textContent = 'Copy';
        copy.title = 'Copy the edit link';
        copy.addEventListener('click', async function () {
          var ok = await copyText(form.editUrl || '');
          flashButton(copy, ok ? 'Copied' : 'Failed');
        });

        actions.appendChild(copy);

        li.appendChild(main);
        li.appendChild(actions);
        els.formList.appendChild(li);
      });

      els.formList.hidden = forms.length === 0;
    }

    if (els.empty) {
      els.empty.hidden = forms.length > 0;
      if (env.isWordPress) {
        els.empty.textContent =
          'No Contact Form 7 forms were found on this page. Forms inside iframes or loaded after the page may not be detected.';
      } else {
        els.empty.textContent =
          'This page does not look like WordPress. Contact Form 7 forms only exist on WordPress sites.';
      }
    }

    if (els.allForms) {
      if (env.isWordPress && lastAdminBase) {
        els.allForms.href = lastAdminBase + 'admin.php?page=wpcf7';
        els.allForms.target = settings.openLinksInNewTab === false ? '_self' : '_blank';
        els.allForms.classList.remove('disabled');
        els.allForms.removeAttribute('aria-disabled');
      } else {
        els.allForms.removeAttribute('href');
        els.allForms.classList.add('disabled');
        els.allForms.setAttribute('aria-disabled', 'true');
      }
    }

    if (!env.isWordPress && forms.length > 0) {
      showNotice('This page does not look like WordPress, so the admin links may not work.', 'warn');
    } else {
      showNotice('');
    }

    if (els.prefillAll) {
      var canPrefill = forms.length > 0 && settings.prefillEnabled !== false;
      els.prefillAll.disabled = !canPrefill;
      els.prefillAll.style.opacity = canPrefill ? '' : '0.5';
      els.prefillAll.title = canPrefill
        ? 'Fill name, email, phone and message fields'
        : 'No forms to fill';
    }
  }

  async function sendPrefill(id) {
    var tab;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (err) {
      return null;
    }

    if (!tab) return null;

    var message = id ? { type: 'CF7_PREFILL', id: id } : { type: 'CF7_PREFILL' };

    try {
      return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
    } catch (err) {
      return null;
    }
  }

  async function sendFocus(id) {
    var tab;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (err) {
      return null;
    }

    if (!tab) return null;

    try {
      return await chrome.tabs.sendMessage(tab.id, { type: 'CF7_SCROLL_TO', id: id }, { frameId: 0 });
    } catch (err) {
      return null;
    }
  }

  async function scan() {
    var tab;
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (err) {
      showNotice('Could not read the active tab.', 'error');
      return;
    }

    if (!tab) {
      showNotice('No active tab found.', 'error');
      return;
    }

    if (tab.url && !/^(https?|file):/i.test(tab.url)) {
      setBadge('Unsupported page', 'other');
      showNotice('This page type cannot be inspected. Open a regular http(s) page.', 'error');
      return;
    }

    try {
      var payload = await chrome.tabs.sendMessage(tab.id, { type: 'CF7_SCAN' }, { frameId: 0 });
      if (!payload || !payload.ok) {
        showNotice('The page did not respond. Reload the tab and try again.', 'error');
        return;
      }

      var settings = payload.settings || {};
      if (window.CF7Settings && window.CF7Settings.get) {
        try {
          settings = await window.CF7Settings.get();
        } catch (settingsErr) {
          /* keep payload settings */
        }
      }

      render(Object.assign({}, payload, { settings: settings }));
    } catch (err) {
      setBadge('Page not scanned', 'other');
      showNotice(
        'Could not reach this page. Reload the tab after installing the extension, then try again.',
        'error'
      );
    }
  }

  function openOptions() {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  }

  if (els.rescan) els.rescan.addEventListener('click', scan);

  if (els.prefillAll) {
    els.prefillAll.addEventListener('click', async function () {
      var result = await sendPrefill(null);
      if (!result || !result.ok) {
        showNotice('Could not fill the form fields. Reload the page and try again.', 'error');
        return;
      }
      if (result.filled > 0) {
        showNotice(
          'Filled ' + result.filled + (result.filled === 1 ? ' field' : ' fields') + '.',
          'success'
        );
      } else {
        showNotice('No matching name, email, phone or message fields were found.', 'warn');
      }
    });
  }

  if (els.copyAdmin) {
    els.copyAdmin.addEventListener('click', async function () {
      if (!lastAdminBase) return;
      var ok = await copyText(lastAdminBase);
      flashButton(els.copyAdmin, ok ? 'Copied' : 'Failed');
    });
  }

  if (els.settingsBtn) els.settingsBtn.addEventListener('click', openOptions);
  if (els.optionsBtn) els.optionsBtn.addEventListener('click', openOptions);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
})();