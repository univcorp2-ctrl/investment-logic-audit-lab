import { PARAMETER_CATEGORIES, categoryCounts, parameterCategory } from './parameter-category-core.js';

let observer = null;

function decorate() {
  const panel = document.querySelector('#parameterControl');
  if (!panel) return false;
  const controls = [...panel.querySelectorAll('[data-parameter-path]')];
  controls.forEach(control => {
    const host = control.closest('.pc-field,.pc-check');
    if (!host || host.querySelector(':scope > .pc-category-badge')) return;
    const category = parameterCategory(control.dataset.parameterPath);
    const badge = document.createElement('span');
    badge.className = `pc-category-badge category-${category.toLowerCase()}`;
    badge.textContent = category;
    host.prepend(badge);
  });
  let legend = panel.querySelector('#parameterCategoryLegend');
  if (!legend) {
    legend = document.createElement('aside');
    legend.id = 'parameterCategoryLegend';
    legend.className = 'pc-category-legend';
    legend.setAttribute('aria-label', 'パラメータ分類');
    const tabs = panel.querySelector('.pc-tabs');
    tabs?.before(legend);
  }
  const counts = categoryCounts(controls.map(control => control.dataset.parameterPath));
  legend.innerHTML = `<strong>パラメータ分類</strong>${PARAMETER_CATEGORIES.map(category => `<span class="category-${category.toLowerCase()}">${category}<b>${counts[category]}</b></span>`).join('')}`;
  return true;
}

function init() {
  decorate();
  observer = new MutationObserver(decorate);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.setTimeout(() => observer?.disconnect(), 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
else init();
