'use strict';
/**
 * Fills the extension pages from _locales. The English text stays in the HTML so the
 * page is still readable if this never runs — and so a test can check the two have not
 * drifted apart.
 */
(function () {
  const t = (key, subs) => {
    try {
      return chrome.i18n.getMessage(key, subs) || '';
    } catch (_) {
      return '';                       // opened outside the extension, e.g. a preview
    }
  };

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const message = t(el.dataset.i18n);
    if (message) el.textContent = message;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const message = t(el.dataset.i18nPlaceholder);
    if (message) el.placeholder = message;
  }
  const title = document.querySelector('[data-i18n-title]');
  if (title) {
    const message = t(title.dataset.i18nTitle);
    if (message) document.title = message;
  }

  self.HyLinkI18n = { t };
})();
