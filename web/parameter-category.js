import { PARAMETER_CATEGORIES, categoryForParameterPath, categorySummary } from './parameter-category-core.js';

const $ = selector => document.querySelector(selector);

function badge(category) {
  const meta = PARAMETER_CATEGORIES[category];
  const node = document.createElement('span');
  node.className = `parameter-category-badge category-${category.toLowerCase()}`;
  node.dataset.parameterBadge = category;
  node.textContent = category;
  node.title = `${meta.label}: ${meta.description}`;
  node.setAttribute('aria-label', `${meta.label}パラメータ`);
  return node;
}

function categorizeFields() {
  const panel = $('#parameterControl');
  if (!panel) return;
  panel.querySelectorAll('[data-parameter-path]').forEach(control => {
    const category = categoryForParameterPath(control.dataset.parameterPath);
    const wrapper = control.closest('.pc-field,.pc-check') ?? control.parentElement;
    if (!wrapper) return;
    wrapper.dataset.parameterCategory = category;
    if (!wrapper.querySelector('[data-parameter-badge]')) {
      const label = wrapper.querySelector(':scope > span') ?? wrapper;
      label.prepend(badge(category));
    }
  });
  const activeTab = panel.querySelector('[data-parameter-tab][aria-selected=true]')?.dataset.parameterTab;
  const intro = panel.querySelector('.pc-panel-heading p');
  if (intro && activeTab === 'fundamental' && !intro.dataset.categoryCopy) {
    intro.textContent = 'Fundamentalは「何を保有するか」を判断します。割安・品質・成長・FCF・開示鮮度をTechnicalと分けて調整します。';
    intro.dataset.categoryCopy = 'F';
  }
  if (intro && activeTab === 'technical' && !intro.dataset.categoryCopy) {
    intro.textContent = 'Technicalは「いつ入る・出るか」を判断します。RSI・SMA・Momentum・Volatility・Drawdownを調整します。';
    intro.dataset.categoryCopy = 'T';
  }
}

function installLegend() {
  const panel = $('#parameterControl');
  if (!panel || $('#parameterCategoryLegend')) return;
  const paths = [
    'screening.minOverall','screening.minFundamental','screening.minValue','screening.minQuality','screening.minGrowth','screening.minCompleteness','screening.minTechnical','screening.maxTrap','screening.minTradingValue','screening.topN','screening.market','screening.sector','screening.holding','screening.action','screening.missingPolicy','screening.minRsi','screening.maxRsi','screening.minMomentum20','screening.minMomentum60','screening.maxVolatility','screening.minDrawdown','screening.weights.technical','screening.requirePriceAboveSma20','screening.requireSma20AboveSma60',
    'fundamental.minValueScore','fundamental.minQualityScore','fundamental.minGrowthScore','fundamental.maxTrapRisk','fundamental.minCompleteness','fundamental.minEarningsYieldPct','fundamental.minBookToMarketPct','fundamental.minFcfYieldPct','fundamental.minRoePct','fundamental.minOperatingMarginPct','fundamental.maxDisclosureAgeDays','fundamental.weights.value','fundamental.weights.quality','fundamental.weights.growth','fundamental.weights.trapSafety','fundamental.weights.completeness','risk.maxPortfolioDrawdownPct','risk.maxTotalUnrealizedLossPct','risk.maxTotalUnrealizedLossYen','risk.maxPositionLossPct','risk.maxPositionLossYen','risk.maxPositionWeightPct','risk.maxSectorWeightPct','display.fontScale','display.density','display.contrast','display.reducedMotion',
  ];
  const counts = categorySummary(paths);
  const details = document.createElement('details');
  details.id = 'parameterCategoryLegend';
  details.className = 'parameter-category-legend';
  details.innerHTML = `<summary>パラメータ分類を見る</summary><div>${Object.values(PARAMETER_CATEGORIES).map(meta => `<article class="category-${meta.key.toLowerCase()}"><strong>${meta.key}</strong><span>${meta.label}</span><small>${meta.description}</small><b>${counts[meta.key]}項目</b></article>`).join('')}</div>`;
  panel.querySelector('.pc-header')?.after(details);
}

function apply() {
  installLegend();
  categorizeFields();
}

function start() {
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  apply();
  setTimeout(() => observer.disconnect(), 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
