(function () {
  'use strict';

  var DEFAULTS = window.CF7_DEFAULTS || {
    showFloatingBadge: true,
    openLinksInNewTab: true,
    adminBaseOverride: '',
    fetchFormTitles: true,
    prefillEnabled: true,
    autoFill: false,
    prefillFirstName: 'Agent Image Test',
    prefillLastName: 'Agent Image Test',
    prefillEmail: 'developers@agentimage.com',
    prefillPhone: '1.800.979.5799',
    prefillMessage:
      "This is a message from Agent Image. We're just checking for possible errors. A response is not needed. Thanks!",
    mailBuilderEnabled: true,
    mailBuilderTargets: 'both'
  };

  var form = document.getElementById('options-form');
  var adminInput = document.getElementById('adminBaseOverride');
  var badgeInput = document.getElementById('showFloatingBadge');
  var newTabInput = document.getElementById('openLinksInNewTab');
  var titlesInput = document.getElementById('fetchFormTitles');
  var prefillEnabledInput = document.getElementById('prefillEnabled');
  var autoFillInput = document.getElementById('autoFill');
  var firstNameInput = document.getElementById('prefillFirstName');
  var lastNameInput = document.getElementById('prefillLastName');
  var emailInput = document.getElementById('prefillEmail');
  var phoneInput = document.getElementById('prefillPhone');
  var messageInput = document.getElementById('prefillMessage');
  var mailBuilderEnabledInput = document.getElementById('mailBuilderEnabled');
  var mailBuilderTargetsInput = document.getElementById('mailBuilderTargets');
  var resetBtn = document.getElementById('reset');
  var statusEl = document.getElementById('status');

  var statusTimer = null;

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.dataset.kind = kind || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (message) {
      statusTimer = setTimeout(function () {
        statusEl.textContent = '';
        statusEl.removeAttribute('data-kind');
      }, 2600);
    }
  }

  function fill(settings) {
    var s = Object.assign({}, DEFAULTS, settings || {});
    if (adminInput) adminInput.value = s.adminBaseOverride || '';
    if (badgeInput) badgeInput.checked = s.showFloatingBadge !== false;
    if (newTabInput) newTabInput.checked = s.openLinksInNewTab !== false;
    if (titlesInput) titlesInput.checked = s.fetchFormTitles !== false;
    if (prefillEnabledInput) prefillEnabledInput.checked = s.prefillEnabled !== false;
    if (autoFillInput) autoFillInput.checked = s.autoFill === true;
    if (firstNameInput) firstNameInput.value = s.prefillFirstName || '';
    if (lastNameInput) lastNameInput.value = s.prefillLastName || '';
    if (emailInput) emailInput.value = s.prefillEmail || '';
    if (phoneInput) phoneInput.value = s.prefillPhone || '';
    if (messageInput) messageInput.value = s.prefillMessage || '';
    if (mailBuilderEnabledInput) mailBuilderEnabledInput.checked = s.mailBuilderEnabled !== false;
    if (mailBuilderTargetsInput) {
      var target = s.mailBuilderTargets === 'mail' || s.mailBuilderTargets === 'mail2'
        ? s.mailBuilderTargets
        : 'both';
      mailBuilderTargetsInput.value = target;
    }
  }

  function read() {
    return {
      adminBaseOverride: adminInput ? adminInput.value.trim() : '',
      showFloatingBadge: badgeInput ? badgeInput.checked : true,
      openLinksInNewTab: newTabInput ? newTabInput.checked : true,
      fetchFormTitles: titlesInput ? titlesInput.checked : true,
      prefillEnabled: prefillEnabledInput ? prefillEnabledInput.checked : true,
      autoFill: autoFillInput ? autoFillInput.checked : false,
      prefillFirstName: firstNameInput ? firstNameInput.value : '',
      prefillLastName: lastNameInput ? lastNameInput.value : '',
      prefillEmail: emailInput ? emailInput.value : '',
      prefillPhone: phoneInput ? phoneInput.value : '',
      prefillMessage: messageInput ? messageInput.value : '',
      mailBuilderEnabled: mailBuilderEnabledInput ? mailBuilderEnabledInput.checked : true,
      mailBuilderTargets: mailBuilderTargetsInput ? mailBuilderTargetsInput.value : 'both'
    };
  }

  async function load() {
    var settings = window.CF7Settings ? await window.CF7Settings.get() : DEFAULTS;
    fill(settings);
  }

  async function save() {
    var values = read();
    try {
      if (window.CF7Settings) await window.CF7Settings.set(values);
      else await chrome.storage.sync.set(values);
      setStatus('Saved', 'success');
    } catch (err) {
      setStatus('Could not save settings', 'error');
    }
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      save();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async function () {
      fill(DEFAULTS);
      try {
        if (window.CF7Settings) await window.CF7Settings.reset();
        else await chrome.storage.sync.set(Object.assign({}, DEFAULTS));
        setStatus('Defaults restored', 'success');
      } catch (err) {
        setStatus('Could not reset settings', 'error');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();