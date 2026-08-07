export const LEARNING_MODE = Object.freeze({
  learning_only:{ label:'学習中', tone:'learning', description:'安全ゲート未通過。既定のデモルールを継続します。' },
  pending_confirmation:{ label:'確認待ち', tone:'pending', description:'初回ゲート通過。次回も再現した場合だけデモへ反映します。' },
  approved_for_paper:{ label:'デモ自動反映中', tone:'active', description:'期限付きでデモ取引パラメータへ反映しています。' },
  manual_review_required:{ label:'手動確認が必要', tone:'warning', description:'ポジション配分を伴うため自動反映しません。' },
});

export function learningModeInfo(mode) {
  return LEARNING_MODE[mode] ?? LEARNING_MODE.learning_only;
}

export function groupOverrides(overrides = {}) {
  const groups = { Fundamental:{}, Technical:{}, Risk:{} };
  const category = key => {
    if (['buy_fundamental','buy_quality','buy_completeness','buy_max_trap','sell_fundamental','sell_trap'].includes(key)) return 'Fundamental';
    if (['buy_technical','sell_technical'].includes(key)) return 'Technical';
    return 'Risk';
  };
  for (const [key, value] of Object.entries(overrides)) groups[category(key)][key] = value;
  return groups;
}

export function gateProgress(payload = {}) {
  const gates = payload.gates ?? [];
  const passed = gates.filter(gate => gate.passed).length;
  return { passed, total:gates.length || payload.gate_summary?.total || 0, failed:gates.filter(gate => !gate.passed) };
}

export function browserBundlePatch(overrides = {}) {
  const patch = { screening:{}, fundamental:{}, risk:{} };
  if (Number.isFinite(Number(overrides.buy_fundamental))) patch.screening.minFundamental = Number(overrides.buy_fundamental);
  if (Number.isFinite(Number(overrides.buy_quality))) {
    patch.screening.minQuality = Number(overrides.buy_quality);
    patch.fundamental.minQualityScore = Number(overrides.buy_quality);
  }
  if (Number.isFinite(Number(overrides.buy_completeness))) {
    patch.screening.minCompleteness = Number(overrides.buy_completeness);
    patch.fundamental.minCompleteness = Number(overrides.buy_completeness);
  }
  if (Number.isFinite(Number(overrides.buy_max_trap))) {
    patch.screening.maxTrap = Number(overrides.buy_max_trap);
    patch.fundamental.maxTrapRisk = Number(overrides.buy_max_trap);
  }
  if (Number.isFinite(Number(overrides.buy_technical))) patch.screening.minTechnical = Number(overrides.buy_technical);
  if (Number.isFinite(Number(overrides.stop_loss_pct))) patch.risk.maxPositionLossPct = Math.abs(Number(overrides.stop_loss_pct));
  if (Number.isFinite(Number(overrides.max_drawdown_pct))) patch.risk.maxPortfolioDrawdownPct = Math.abs(Number(overrides.max_drawdown_pct));
  return patch;
}

export function mergeBundle(base = {}, patch = {}) {
  const output = JSON.parse(JSON.stringify(base));
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) output[key] = mergeBundle(output[key] ?? {}, value);
    else output[key] = value;
  }
  return output;
}
