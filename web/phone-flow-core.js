export const PHONE_DESTINATIONS = Object.freeze({
  overview: Object.freeze([
    { key:'summary', label:'今日の要点', purpose:'損益・ドローダウン・注意点を短く確認', selectors:['#overviewSection'] },
    { key:'demo', label:'デモ状況', purpose:'保有銘柄と現在の紙上損益を確認', selectors:['#demoTrade'] },
    { key:'freshness', label:'データ鮮度', purpose:'データ日付と利用可能範囲を確認', selectors:['#dataNotice','#dataError','#adaptiveLegacyDetails'] },
  ]),
  decision: Object.freeze([
    { key:'judgement', label:'売買判断', purpose:'推奨・保有・売却候補と根拠を確認', selectors:['#investmentDecisionReport'], decisionTab:'judge' },
    { key:'fundamental', label:'Fundamental', purpose:'何を保有するかを企業価値から確認', selectors:['#investmentDecisionReport'], decisionTab:'fund' },
    { key:'technical', label:'Technical', purpose:'いつ入る・出るかを価格指標から確認', selectors:['#investmentDecisionReport'], decisionTab:'tech' },
    { key:'ranking', label:'ランキング', purpose:'候補銘柄を順位とスコアで比較', selectors:['.ranking'] },
  ]),
  screening: Object.freeze([
    { key:'simple', label:'かんたん設定', purpose:'母集団と基本スコアを調整', selectors:['#parameterControl'], parameterTab:'screening' },
    { key:'fundamental', label:'Fundamental条件', purpose:'企業価値・品質・成長条件を調整', selectors:['#parameterControl'], parameterTab:'fundamental' },
    { key:'technical', label:'Technical条件', purpose:'RSI・SMA・Momentum条件を調整', selectors:['#parameterControl'], parameterTab:'technical' },
    { key:'risk', label:'リスク上限', purpose:'含み損・DD・集中上限を調整', selectors:['#parameterControl'], parameterTab:'risk' },
    { key:'display', label:'表示', purpose:'文字サイズと画面密度を調整', selectors:['#parameterControl'], parameterTab:'display' },
  ]),
  performance: Object.freeze([
    { key:'summary', label:'サマリー', purpose:'現在の評価額と損益を確認', selectors:['#performanceAnalytics'], performanceMode:'summary' },
    { key:'equity', label:'資産推移', purpose:'資産曲線と日次損益を確認', selectors:['#performanceAnalytics'], chart:'equity', performanceMode:'equity' },
    { key:'drawdown', label:'ドローダウン', purpose:'ピークからの下落と回復状況を確認', selectors:['#performanceAnalytics'], chart:'drawdown', performanceMode:'drawdown' },
    { key:'metrics', label:'分析指標', purpose:'Sharpe・Sortino・勝率などを確認', selectors:['#performanceAnalytics'], performanceMode:'metrics' },
    { key:'causes', label:'原因分析', purpose:'損失原因と改善候補を確認', selectors:['#riskDiagnostics'], performanceMode:'causes' },
  ]),
  other: Object.freeze([
    { key:'plans', label:'J-Quants', purpose:'プラン・鮮度・履歴の違いを確認', selectors:['#investmentDecisionReport'], decisionTab:'plan' },
    { key:'news', label:'適時開示・ニュース', purpose:'公式開示とニュース状況を確認', selectors:['#investmentDecisionReport'], decisionTab:'disc' },
    { key:'strategy', label:'戦略ラボ', purpose:'研究候補と過学習警告を確認', selectors:['#investmentDecisionReport'], decisionTab:'strategy' },
    { key:'export', label:'データ出力', purpose:'設定JSONやCSVを出力', selectors:['#parameterControl'], parameterTab:'management' },
  ]),
});

export const MOBILE_KEY_MAP = Object.freeze({ overview:'overview', decision:'decision', screening:'screening', performance:'performance', data:'other', strategy:'other' });

export function normalizePhoneDestination(value) {
  return Object.hasOwn(PHONE_DESTINATIONS, value) ? value : 'overview';
}

export function normalizePhoneSubpage(destination, value) {
  const pages = PHONE_DESTINATIONS[normalizePhoneDestination(destination)];
  return pages.some(page => page.key === value) ? value : pages[0].key;
}

export function parsePhoneHash(hash = '') {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
  const raw = params.get('phone') ?? '';
  const [destinationRaw, subpageRaw] = raw.split(':');
  const destination = normalizePhoneDestination(destinationRaw);
  return { destination, subpage:normalizePhoneSubpage(destination, subpageRaw), params };
}

export function serializePhoneHash(destination, subpage, currentHash = '') {
  const parsed = parsePhoneHash(currentHash);
  const normalizedDestination = normalizePhoneDestination(destination);
  const normalizedSubpage = normalizePhoneSubpage(normalizedDestination, subpage);
  parsed.params.set('phone', `${normalizedDestination}:${normalizedSubpage}`);
  return `#${parsed.params.toString()}`;
}

export function pageIndex(destination, subpage) {
  const pages = PHONE_DESTINATIONS[normalizePhoneDestination(destination)];
  return Math.max(0, pages.findIndex(page => page.key === normalizePhoneSubpage(destination, subpage)));
}

export function adjacentPhonePage(destination, subpage, direction) {
  const pages = PHONE_DESTINATIONS[normalizePhoneDestination(destination)];
  const index = pageIndex(destination, subpage);
  const next = Math.min(pages.length - 1, Math.max(0, index + (direction < 0 ? -1 : 1)));
  return pages[next];
}

export function allManagedSelectors() {
  return [...new Set(Object.values(PHONE_DESTINATIONS).flat().flatMap(page => page.selectors))];
}
