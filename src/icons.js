/**
 * The menu's icon set, shared by the content script and the options page so the
 * onboarding demo can never drift from the real menu. Each value is the inside of a
 * 16×16 `viewBox` SVG; `class="fill"` marks a shape that is filled rather than stroked.
 */
(function (root) {
  'use strict';

  const ICONS = {
    open: '<path d="M2.5 8h9"/><path d="M8.5 5l3 3-3 3"/>',
    newTab: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M8 5.5v5"/><path d="M5.5 8h5"/>',
    newWindow: '<path d="M13.5 6.5v-4h-4"/><path d="M13.5 2.5L8 8"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
    incognito: '<path d="M5.6 7.2V6.1a2.4 2.4 0 0 1 4.8 0v1.1"/><path d="M2.6 7.4h10.8"/><circle cx="5.5" cy="11.7" r="2.05"/><circle cx="10.5" cy="11.7" r="2.05"/><path d="M7.55 11.7h0.9"/>',
    sideRight: '<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M8 3v10"/><path class="fill" d="M8 3h5a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 13H8z"/>',
    sideStacked: '<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M1.5 8h13"/><path class="fill" d="M1.5 8h13v3.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z"/>',
    copy: '<path d="M5.75 3H4.5A1.5 1.5 0 0 0 3 4.5V13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V4.5A1.5 1.5 0 0 0 11.5 3h-1.25"/><rect x="5.75" y="1.5" width="4.5" height="2.5" rx="1"/>',
    copyClean: '<path d="M5.75 3H4.5A1.5 1.5 0 0 0 3 4.5V13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V9.1"/><rect x="5.75" y="1.5" width="4.5" height="2.5" rx="1"/><path class="fill" d="M11.9 0.7l.85 2.1 2.1.85-2.1.85-.85 2.1-.85-2.1L9 3.65l2.05-.85z"/><path d="M11.9 0.7l.85 2.1 2.1.85-2.1.85-.85 2.1-.85-2.1L9 3.65l2.05-.85z"/>'
  };

  const parser = new DOMParser();

  /**
   * Build the icon through DOMParser rather than innerHTML: pages that set
   * `require-trusted-types-for 'script'` reject raw innerHTML assignment.
   */
  function svgIcon(markup, size = 16) {
    const doc = parser.parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="' + size + '" ' +
      'height="' + size + '" aria-hidden="true">' + markup + '</svg>',
      'image/svg+xml'
    );
    return document.importNode(doc.documentElement, true);
  }

  root.HyLinkIcons = { ICONS, svgIcon };
})(typeof self !== 'undefined' ? self : this);
