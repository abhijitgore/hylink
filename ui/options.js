'use strict';
const { ACTIONS, getSettings } = self.HyLinkSettings;
const { ICONS, svgIcon } = self.HyLinkIcons;

const $ = (id) => document.getElementById(id);
let saveTimer = 0;

function buildActionList(visible) {
  const box = $('actions');
  box.textContent = '';
  for (const action of ACTIONS) {
    const label = document.createElement('label');
    label.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.action = action.id;
    cb.checked = visible.includes(action.id);
    cb.addEventListener('change', save);
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = action.label;
    span.appendChild(strong);
    label.append(cb, span);
    box.appendChild(label);
  }
}

/**
 * The demo's action bar, built from the real icon set so it can never show a menu the
 * extension doesn't have. Everything that moves is CSS; this only fills in the row.
 */
function buildDemo() {
  const bar = document.getElementById('demoBar');
  const row = document.createElement('div');
  row.className = 'demo-row';
  for (const action of ACTIONS) {
    const btn = document.createElement('span');
    btn.className = 'demo-btn' + (action.id === ACTIONS[0].id ? ' on' : '');
    btn.appendChild(svgIcon(ICONS[action.id], 14));
    row.appendChild(btn);
  }
  const caption = document.createElement('div');
  caption.className = 'demo-cap';
  caption.textContent = ACTIONS[0].label;
  bar.append(row, caption);
}

function collect() {
  // Stored as an opt-out list so actions added in future versions show up by default.
  const hiddenActions = Array.from(document.querySelectorAll('#actions input'))
    .filter((cb) => !cb.checked)
    .map((cb) => cb.dataset.action);
  return {
    enabled: $('enabled').checked,
    hoverDelay: Number($('hoverDelay').value),
    expandMode: $('expandMode').value,
    requireModifier: $('requireModifier').checked,
    modifier: $('modifier').value,
    newTabActive: $('newTabActive').checked,
    skipNavigation: $('skipNavigation').checked,
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
  $('hoverDelayOut').textContent = s.hoverDelay + ' ms';
  $('requireModifier').checked = s.requireModifier;
  $('modifier').value = s.modifier;
  $('expandMode').value = s.expandMode;
  $('newTabActive').checked = s.newTabActive;
  $('skipNavigation').checked = s.skipNavigation;
  $('disabledSites').value = s.disabledSites.join('\n');
  $('modifierField').classList.toggle('hidden', !s.requireModifier);
  buildActionList(s.visibleActions);
}

async function save() {
  const settings = collect();
  $('hoverDelayOut').textContent = settings.hoverDelay + ' ms';
  $('modifierField').classList.toggle('hidden', !settings.requireModifier);
  await chrome.storage.sync.set(settings);
  // Unticking every box is treated as hiding none; re-render so the checkboxes show
  // what was actually stored rather than an empty-looking list.
  const visible = ACTIONS.map((a) => a.id).filter((id) => !settings.hiddenActions.includes(id));
  buildActionList(visible);
  flash('Saved');
}

function flash(text) {
  const el = $('status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

buildDemo();

getSettings().then((s) => {
  render(s);
  for (const id of ['enabled', 'requireModifier', 'modifier', 'newTabActive', 'expandMode',
    'skipNavigation']) {
    $(id).addEventListener('change', save);
  }
  $('hoverDelay').addEventListener('input', () => {
    $('hoverDelayOut').textContent = $('hoverDelay').value + ' ms';
  });
  $('hoverDelay').addEventListener('change', save);
  $('disabledSites').addEventListener('change', save);
});
