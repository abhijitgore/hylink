'use strict';
const { getSettings, isSiteDisabled } = self.HyLinkSettings;

(async function () {
  const settings = await getSettings();
  const enabled = document.getElementById('enabled');
  const siteOff = document.getElementById('siteOff');
  const hostEl = document.getElementById('host');

  enabled.checked = settings.enabled;
  enabled.addEventListener('change', () =>
    chrome.storage.sync.set({ enabled: enabled.checked })
  );

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try {
    host = new URL(tab?.url || '').hostname;
  } catch (_) { /* chrome:// pages and the like have no usable host */ }

  if (!host) {
    siteOff.closest('label').style.display = 'none';
  } else {
    hostEl.textContent = host;
    siteOff.checked = isSiteDisabled(settings.disabledSites, host);
    siteOff.addEventListener('change', async () => {
      const list = new Set(settings.disabledSites);
      if (siteOff.checked) list.add(host);
      else {
        // Also clear a parent-domain entry that was covering this host.
        for (const entry of [...list]) {
          if (host === entry || host.endsWith('.' + entry)) list.delete(entry);
        }
      }
      settings.disabledSites = [...list];
      await chrome.storage.sync.set({ disabledSites: settings.disabledSites });
    });
  }

  document.getElementById('openOptions').addEventListener('click', () =>
    chrome.runtime.openOptionsPage()
  );
})();
