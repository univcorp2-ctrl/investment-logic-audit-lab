import { PHONE_DESTINATIONS, MOBILE_KEY_MAP, adjacentPhonePage, allManagedSelectors, normalizePhoneDestination, normalizePhoneSubpage, pageIndex, parsePhoneHash, serializePhoneHash } from './phone-flow-core.js';

const media = window.matchMedia('(max-width: 767px)');
const originalState = new WeakMap();
const state = { destination:'overview', subpage:'summary', initialized:false, applying:false };
const $ = selector => document.querySelector(selector);

function remember(node) {
  if (originalState.has(node)) return;
  originalState.set(node, { hidden:node.hidden, inert:Boolean(node.inert), ariaHidden:node.getAttribute('aria-hidden') });
}

function setVisible(node, visible) {
  remember(node);
  node.hidden = !visible;
  node.inert = !visible;
  node.setAttribute('aria-hidden', String(!visible));
  node.dataset.phoneFlowManaged = 'true';
}

function restoreAll() {
  document.querySelectorAll('[data-phone-flow-managed="true"]').forEach(node => {
    const saved = originalState.get(node);
    if (!saved) return;
    node.hidden = saved.hidden;
    node.inert = saved.inert;
    if (saved.ariaHidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', saved.ariaHidden);
    delete node.dataset.phoneFlowManaged;
  });
  document.body.removeAttribute('data-phone-destination');
  document.body.removeAttribute('data-phone-subpage');
}

function currentPage() {
  return PHONE_DESTINATIONS[state.destination].find(page => page.key === state.subpage) ?? PHONE_DESTINATIONS[state.destination][0];
}

function clickWhenReady(selector, attempts = 24) {
  const node = $(selector);
  if (node instanceof HTMLButtonElement) { node.click(); return; }
  if (attempts > 0) setTimeout(() => clickWhenReady(selector, attempts - 1), 100);
}

function applyPageAction(page) {
  if (page.decisionTab) clickWhenReady(`.dr-tabs [data-tab="${page.decisionTab}"]`);
  if (page.parameterTab) clickWhenReady(`[data-parameter-tab="${page.parameterTab}"]`);
  if (page.chart) clickWhenReady(`[data-chart="${page.chart}"]`);
  document.body.dataset.phonePerformanceMode = page.performanceMode ?? '';
}

function renderPager() {
  const pages = PHONE_DESTINATIONS[state.destination];
  const index = pageIndex(state.destination, state.subpage);
  const page = pages[index];
  const nav = $('#phoneFlow');
  if (!nav) return;
  nav.querySelector('.phone-flow-title strong').textContent = page.label;
  nav.querySelector('.phone-flow-title small').textContent = page.purpose;
  nav.querySelector('.phone-flow-segments').innerHTML = pages.map(item => `<button type="button" role="tab" data-phone-page="${item.key}" aria-selected="${item.key === state.subpage}" tabindex="${item.key === state.subpage ? 0 : -1}">${item.label}</button>`).join('');
  nav.querySelector('.phone-flow-counter').textContent = `${index + 1} / ${pages.length}`;
  nav.querySelector('[data-phone-prev]').disabled = index === 0;
  nav.querySelector('[data-phone-next]').disabled = index === pages.length - 1;
}

function applyVisibility() {
  if (!media.matches || state.applying) return;
  state.applying = true;
  try {
    const page = currentPage();
    const activeNodes = new Set(page.selectors.flatMap(selector => [...document.querySelectorAll(selector)]));
    for (const selector of allManagedSelectors()) {
      document.querySelectorAll(selector).forEach(node => setVisible(node, activeNodes.has(node)));
    }
    document.body.dataset.phoneDestination = state.destination;
    document.body.dataset.phoneSubpage = state.subpage;
    renderPager();
    applyPageAction(page);
    $('#phoneFlowEmpty').hidden = activeNodes.size > 0;
    document.querySelectorAll('#adaptiveMobileNav [data-adaptive-target]').forEach(button => {
      const destination = MOBILE_KEY_MAP[button.dataset.adaptiveTarget] ?? 'overview';
      const active = destination === state.destination;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    window.scrollTo({ top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } finally {
    state.applying = false;
  }
}

function updateHash(mode = 'push') {
  const hash = serializePhoneHash(state.destination, state.subpage, location.hash);
  if (mode === 'replace') history.replaceState({ phoneFlow:true }, '', hash);
  else history.pushState({ phoneFlow:true }, '', hash);
}

function activate(destination, subpage, { historyMode='push', apply=true } = {}) {
  state.destination = normalizePhoneDestination(destination);
  state.subpage = normalizePhoneSubpage(state.destination, subpage);
  if (historyMode !== 'none') updateHash(historyMode);
  if (apply) applyVisibility();
}

function installPager() {
  if ($('#phoneFlow')) return;
  const nav = document.createElement('section');
  nav.id = 'phoneFlow';
  nav.className = 'phone-flow';
  nav.setAttribute('aria-label', 'iPhone画面内ナビゲーション');
  nav.innerHTML = `<div class="phone-flow-title"><div><span>画面</span><strong>今日の要点</strong></div><small></small></div><div class="phone-flow-segments" role="tablist" aria-label="画面内ページ"></div><div class="phone-flow-actions"><button type="button" data-phone-prev>前へ</button><span class="phone-flow-counter">1 / 1</span><button type="button" data-phone-next>次へ</button></div><p id="phoneFlowEmpty" class="phone-flow-empty" hidden>この画面のデータを準備しています。</p>`;
  const main = $('main');
  main?.prepend(nav);
  nav.addEventListener('click', event => {
    const page = event.target.closest('[data-phone-page]');
    if (page) { activate(state.destination, page.dataset.phonePage); return; }
    if (event.target.closest('[data-phone-prev]')) { activate(state.destination, adjacentPhonePage(state.destination, state.subpage, -1).key); return; }
    if (event.target.closest('[data-phone-next]')) activate(state.destination, adjacentPhonePage(state.destination, state.subpage, 1).key);
  });
  nav.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const pages = PHONE_DESTINATIONS[state.destination];
    let index = pageIndex(state.destination, state.subpage);
    if (event.key === 'ArrowLeft') index = Math.max(0, index - 1);
    if (event.key === 'ArrowRight') index = Math.min(pages.length - 1, index + 1);
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = pages.length - 1;
    event.preventDefault();
    activate(state.destination, pages[index].key);
    requestAnimationFrame(() => nav.querySelector(`[data-phone-page="${pages[index].key}"]`)?.focus());
  });
}

function interceptMobileNav() {
  document.addEventListener('click', event => {
    if (!media.matches) return;
    const button = event.target.closest('#adaptiveMobileNav [data-adaptive-target]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const destination = MOBILE_KEY_MAP[button.dataset.adaptiveTarget] ?? 'overview';
    activate(destination, PHONE_DESTINATIONS[destination][0].key);
  }, true);
}

function syncFromHash() {
  const parsed = parsePhoneHash(location.hash);
  activate(parsed.destination, parsed.subpage, { historyMode:'none' });
}

function handleMode() {
  if (media.matches) {
    $('#phoneFlow').hidden = false;
    syncFromHash();
  } else {
    $('#phoneFlow').hidden = true;
    restoreAll();
  }
}

function init() {
  if (state.initialized) return;
  state.initialized = true;
  installPager();
  interceptMobileNav();
  const parsed = parsePhoneHash(location.hash);
  state.destination = parsed.destination;
  state.subpage = parsed.subpage;
  if (!location.hash.includes('phone=')) updateHash('replace');
  const observer = new MutationObserver(() => { if (media.matches) applyVisibility(); });
  observer.observe(document.querySelector('main') ?? document.body, { childList:true, subtree:true });
  media.addEventListener('change', handleMode);
  window.addEventListener('orientationchange', () => requestAnimationFrame(handleMode));
  window.addEventListener('popstate', syncFromHash);
  window.addEventListener('hashchange', syncFromHash);
  handleMode();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
