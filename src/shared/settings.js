(function (root) {
  'use strict';

  var DEFAULTS = {
    showFloatingBadge: true,
    openLinksInNewTab: true,
    adminBaseOverride: '',
    fetchFormTitles: true,
    prefillEnabled: true,
    autoFill: false,
    prefillFirstName: "Agent Image Test",
    prefillLastName: "Agent Image Test",
    prefillEmail: "developers@agentimage.com",
    prefillPhone: "1.800.979.5799",
    prefillMessage: "This is a message from Agent Image. We're just checking for possible errors. A response is not needed. Thanks!"
  };

  function getArea() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        return chrome.storage.sync;
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  var CF7Settings = {
    defaults: DEFAULTS,

    get: async function () {
      var area = getArea();
      if (!area) return Object.assign({}, DEFAULTS);
      try {
        var stored = await area.get(DEFAULTS);
        return Object.assign({}, DEFAULTS, stored || {});
      } catch (err) {
        return Object.assign({}, DEFAULTS);
      }
    },

    set: async function (patch) {
      var area = getArea();
      if (!area) return;
      await area.set(patch || {});
    },

    reset: async function () {
      await this.set(Object.assign({}, DEFAULTS));
    }
  };

  root.CF7_DEFAULTS = DEFAULTS;
  root.CF7Settings = CF7Settings;
})(typeof window !== 'undefined' ? window : globalThis);