'use strict';
const { ACTIONS, getSettings, normalize, t, actionLabel, actionById } = self.HyLinkSettings;
const { ICONS, svgIcon } = self.HyLinkIcons;

const $ = (id) => document.getElementById(id);
const ms = (value) => t('optMs', `${value} ms`, [String(value)]);
let saveTimer = 0;

/**
 * The grip on a draggable row. Not part of the shared ICONS set — that one is
 * exactly the menu's actions, and a test holds it to that.
 */
const DRAG_DOTS =
  '<circle class="fill" cx="6" cy="4" r="1.1"/><circle class="fill" cx="10" cy="4" r="1.1"/>' +
  '<circle class="fill" cx="6" cy="8" r="1.1"/><circle class="fill" cx="10" cy="8" r="1.1"/>' +
  '<circle class="fill" cx="6" cy="12" r="1.1"/><circle class="fill" cx="10" cy="12" r="1.1"/>';

/* ------------------------------------------------------- the reorderable list */

/**
 * One row: grip, show/hide box, label, and the two arrows. Dragging and the arrows
 * do the same thing — move the row — and the stored order is then read back out of
 * the DOM, so there is only ever one representation of it.
 */
function actionRow(action, checked, settings) {
  const row = document.createElement('div');
  row.className = 'action-row';
  row.dataset.action = action.id;
  row.draggable = true;

  const grip = svgIcon(DRAG_DOTS, 16);
  grip.classList.add('grip');
  grip.setAttribute('aria-hidden', 'true');

  const label = document.createElement('label');
  label.className = 'switch';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.action = action.id;
  cb.checked = checked;
  cb.addEventListener('change', save);
  const span = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = actionLabel(action);
  span.appendChild(strong);
  label.append(cb, span);

  row.append(grip, label,
    nudge(row, -1, t('optMoveUp', 'Move up'), 'M4 10l4-4 4 4'),
    nudge(row, 1, t('optMoveDown', 'Move down'), 'M4 6l4 4 4-4'));
  return row;
}

function nudge(row, delta, label, path) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nudge';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.appendChild(svgIcon(`<path d="${path}"/>`, 16));
  btn.addEventListener('click', () => move(row, delta));
  return btn;
}

/** Move a row one place and save. Focus stays put, so the arrows can be held down. */
function move(row, delta) {
  const box = $('actions');
  const sibling = delta < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  if (delta < 0) box.insertBefore(row, sibling);
  else box.insertBefore(sibling, row);
  syncNudges();
  save();
}

/** An arrow that cannot move anything is disabled rather than silently inert. */
function syncNudges() {
  const rows = [...$('actions').children];
  rows.forEach((row, i) => {
    const [up, down] = row.querySelectorAll('.nudge');
    up.disabled = i === 0;
    down.disabled = i === rows.length - 1;
  });
}

function buildActionList(settings) {
  const box = $('actions');
  box.textContent = '';
  for (const id of settings.actionOrder) {
    const action = actionById(id);
    if (action) box.appendChild(actionRow(action, !settings.hiddenActions.includes(id), settings));
  }
  syncNudges();
}

/* --------------------------------------------------------------------- drag */

let dragging = null;

/**
 * Insert before the first row whose midpoint is below the pointer — the usual
 * "which gap am I over" test, which needs no placeholder element and so cannot
 * leave one behind if the drag is abandoned.
 */
function rowAfter(y) {
  return [...$('actions').children].find((row) => {
    if (row === dragging) return false;
    const box = row.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) || null;
}

function wireDragging() {
  const box = $('actions');
  box.addEventListener('dragstart', (e) => {
    dragging = e.target.closest('.action-row');
    if (!dragging) return;
    dragging.classList.add('dragging');
    // Firefox refuses to start a drag without payload; the DOM is the real state.
    try { e.dataTransfer.setData('text/plain', dragging.dataset.action); } catch (_) {}
    e.dataTransfer.effectAllowed = 'move';
  });
  box.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();                       // without this, drop never fires
    e.dataTransfer.dropEffect = 'move';
    const after = rowAfter(e.clientY);
    if (after !== dragging) box.insertBefore(dragging, after);
  });
  box.addEventListener('drop', (e) => { if (dragging) e.preventDefault(); });
  box.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    syncNudges();
    save();
  });
}

/* --------------------------------------------------------------------- demo */

/**
 * The demo's middle line wraps a link, so it cannot be swapped wholesale by
 * ui/i18n.js — the translation carries a placeholder and the two halves are rebuilt
 * around the existing link element.
 */
function buildDemoLine() {
  const link = document.querySelector('.page-link');
  if (!link) return;
  const line = link.parentElement;
  const text = t('optDemoLine2', '', ['\u0000']);
  if (!text) return;                        // no catalogue — keep the English markup
  const [before, after] = text.split('\u0000');
  if (after === undefined) return;
  link.firstChild.textContent = t('optDemoLinkText', 'tab strip');
  for (const node of [...line.childNodes]) if (node !== link) line.removeChild(node);
  line.insertBefore(document.createTextNode(before), link);
  line.appendChild(document.createTextNode(after));
}

/**
 * The demo's action bar, built from the real icon set and the user's own menu, so it
 * can never show a menu the extension doesn't have — or one they don't have.
 * Everything that moves is CSS; this only fills in the row.
 */
function buildDemo(settings) {
  const bar = $('demoBar');
  bar.textContent = '';
  const row = document.createElement('div');
  row.className = 'demo-row';
  const shown = settings.visibleActions.map(actionById).filter(Boolean);
  for (const action of shown) {
    const btn = document.createElement('span');
    btn.className = 'demo-btn' + (action === shown[0] ? ' on' : '');
    btn.appendChild(svgIcon(ICONS[action.id], 14));
    row.appendChild(btn);
  }
  const caption = document.createElement('div');
  caption.className = 'demo-cap';
  caption.textContent = shown.length ? actionLabel(shown[0]) : '';
  bar.append(row, caption);
}

/* ----------------------------------------------------------------- settings */

function collect() {
  const boxes = Array.from(document.querySelectorAll('#actions input[type="checkbox"]'));
  // Stored as an opt-out list so actions added in future versions show up by default.
  const hiddenActions = boxes.filter((cb) => !cb.checked).map((cb) => cb.dataset.action);
  return {
    enabled: $('enabled').checked,
    hoverDelay: Number($('hoverDelay').value),
    expandMode: $('expandMode').value,
    requireModifier: $('requireModifier').checked,
    modifier: $('modifier').value,
    newTabActive: $('newTabActive').checked,
    skipNavigation: $('skipNavigation').checked,
    cleanBeforeOpen: $('cleanBeforeOpen').checked,
    // The list's own order is the setting — read straight back out of the DOM, so
    // dragging and the arrow buttons need no bookkeeping of their own.
    actionOrder: [...$('actions').children].map((row) => row.dataset.action),
    hiddenActions: hiddenActions.length >= ACTIONS.length ? [] : hiddenActions,
    disabledSites: $('disabledSites').value
      .split('\n')
      .map((line) => line.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)
  };
}

function render(s) {
  $('enabled').checked = s.enabled;
  $('hoverDelay').value = s.hoverDelay;
  $('hoverDelayOut').textContent = ms(s.hoverDelay);
  $('requireModifier').checked = s.requireModifier;
  $('modifier').value = s.modifier;
  $('expandMode').value = s.expandMode;
  $('newTabActive').checked = s.newTabActive;
  $('skipNavigation').checked = s.skipNavigation;
  $('cleanBeforeOpen').checked = s.cleanBeforeOpen;
  $('disabledSites').value = s.disabledSites.join('\n');
  $('modifierField').classList.toggle('hidden', !s.requireModifier);
  buildActionList(s);
  buildDemo(s);
}

async function save() {
  const collected = collect();
  const settings = normalize(collected);
  $('hoverDelayOut').textContent = ms(collected.hoverDelay);
  $('modifierField').classList.toggle('hidden', !collected.requireModifier);
  await chrome.storage.sync.set(collected);
  // Unticking every box is treated as hiding none, and the last button's label
  // depends on the cleaning switch — either way the rows can now be out of date.
  // Rebuilding on every keystroke would steal focus from the arrows, so only when
  // what was stored differs from what is on screen.
  if (rowsAreStale(settings)) buildActionList(settings);
  buildDemo(settings);
  flash(t('optSaved', 'Saved'));
}

function rowsAreStale(settings) {
  const rows = [...$('actions').children];
  return rows.some((row, i) => {
    const id = settings.actionOrder[i];
    if (row.dataset.action !== id) return true;
    // A ticked box means the action is not hidden; disagreeing with what was stored is
    // the "unticking every box hides none" case coming back.
    return row.querySelector('input').checked === settings.hiddenActions.includes(id);
  });
}

function flash(text) {
  const el = $('status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

buildDemoLine();
wireDragging();

getSettings().then((s) => {
  render(s);
  for (const id of ['enabled', 'requireModifier', 'modifier', 'newTabActive', 'expandMode',
    'skipNavigation', 'cleanBeforeOpen']) {
    $(id).addEventListener('change', save);
  }
  $('hoverDelay').addEventListener('input', () => {
    $('hoverDelayOut').textContent = ms($('hoverDelay').value);
  });
  $('hoverDelay').addEventListener('change', save);
  $('disabledSites').addEventListener('change', save);
});
