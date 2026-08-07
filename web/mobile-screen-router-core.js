export const PHONE_SCREENS = Object.freeze(['overview','decision','screening','performance','data']);
export const PERFORMANCE_PANELS = Object.freeze(['current','holdings','chart','risk','metrics']);

export function normalizePhoneScreen(value) {
  return PHONE_SCREENS.includes(value) ? value : 'overview';
}

export function normalizePerformancePanel(value) {
  return PERFORMANCE_PANELS.includes(value) ? value : 'current';
}

export function parsePhoneRoute(hash = '') {
  const text = String(hash).replace(/^#/, '');
  const params = new URLSearchParams(text);
  return {
    screen: normalizePhoneScreen(params.get('screen')),
    panel: normalizePerformancePanel(params.get('panel')),
    params,
  };
}

export function phoneRouteHash(screen, panel = 'current', currentHash = '') {
  const params = parsePhoneRoute(currentHash).params;
  const normalizedScreen = normalizePhoneScreen(screen);
  params.set('screen', normalizedScreen);
  if (normalizedScreen === 'performance') params.set('panel', normalizePerformancePanel(panel));
  else params.delete('panel');
  return `#${params.toString()}`;
}

export function mobileTargetToScreen(target) {
  return ({ overview:'overview', decision:'decision', screening:'screening', performance:'performance', data:'data', strategy:'data' })[target] ?? 'overview';
}

export function screenSelectorMap() {
  return Object.freeze({
    overview: ['#overviewSection','#dataError','#dataNotice','.adaptive-overview'],
    decision: ['#decisionSection','#investmentDecisionReport'],
    screening: ['#screeningSection','#parameterControl','#screeningLab'],
    performance: ['#performanceSection','#mobilePerformanceSubnav','#performanceAnalytics','#riskDiagnostics','#demoTrade'],
    data: ['#strategySection','#dataPlanSection','#adaptiveLegacyDetails','.ranking','.methodology','.own-data'],
  });
}
