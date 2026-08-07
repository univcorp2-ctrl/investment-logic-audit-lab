export const AI_BROWSER_PREFERENCES_KEY = 'valuescope-ai-browser-preferences-v1';
export const DEFAULT_AI_BROWSER_PREFERENCES = Object.freeze({
  objectiveWeights: { return:40, drawdown:30, stability:20, turnoverPenalty:10 },
  minimumConfidence:75,
  maximumWeeklyChange:10,
});

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, num(value, fallback)));

export function normalizeObjectiveWeights(input = {}) {
  const raw = {
    return:Math.max(0, num(input.return, 40)),
    drawdown:Math.max(0, num(input.drawdown, 30)),
    stability:Math.max(0, num(input.stability, 20)),
    turnoverPenalty:Math.max(0, num(input.turnoverPenalty, 10)),
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 100;
  const output = {};
  let used = 0;
  Object.keys(raw).forEach((key, index, keys) => {
    const value = index === keys.length - 1 ? 100 - used : Math.round(raw[key] / total * 10000) / 100;
    output[key] = value;
    used += value;
  });
  return output;
}

export function normalizeAiPreferences(input = {}) {
  return {
    objectiveWeights:normalizeObjectiveWeights(input.objectiveWeights),
    minimumConfidence:clamp(input.minimumConfidence, 50, 100, 75),
    maximumWeeklyChange:clamp(input.maximumWeeklyChange, 1, 20, 10),
  };
}

export function learningStatusLabel(status) {
  return ({
    collecting_data:'データ収集中',
    insufficient_oos_history:'OOS履歴不足',
    proposal_ready:'改善候補あり',
    applied_to_paper_strategy:'デモ戦略へ適用済み',
  })[status] ?? String(status ?? '未実行');
}

export function learningProgress(latest = {}) {
  const actual = latest.gates?.actual ?? {};
  const required = latest.gates?.required ?? {};
  const rows = [
    ['成熟データ', num(actual.matured_rows), num(required.matured_rows)],
    ['営業日', num(actual.training_days), num(required.training_days)],
    ['銘柄数', num(actual.securities), num(required.securities)],
  ];
  return rows.map(([label, value, target]) => ({ label, value, target, pct:target > 0 ? Math.min(100, value / target * 100) : 0 }));
}

export function groupedImportance(latest = {}) {
  const source = latest.feature_importance ?? {};
  return {
    Fundamental:[...(source.Fundamental ?? [])].sort((a,b) => num(b.importance) - num(a.importance)),
    Technical:[...(source.Technical ?? [])].sort((a,b) => num(b.importance) - num(a.importance)),
  };
}

export function proposalChanges(latest = {}, proposals = {}) {
  const proposal = latest.proposal ?? proposals.proposals?.[0] ?? null;
  return proposal?.changes ?? [];
}

export function mapAiProposalToParameterBundle(bundle, latest = {}, proposals = {}) {
  const output = structuredClone(bundle);
  for (const change of proposalChanges(latest, proposals)) {
    const value = num(change.new, change.old);
    if (change.parameter === 'buy_quality') {
      output.screening.minQuality = value;
      output.fundamental.minQualityScore = value;
    }
    if (change.parameter === 'buy_technical') output.screening.minTechnical = value;
    if (change.parameter === 'buy_completeness') {
      output.screening.minCompleteness = value;
      output.fundamental.minCompleteness = value;
    }
    if (change.parameter === 'buy_max_trap') {
      output.screening.maxTrap = value;
      output.fundamental.maxTrapRisk = value;
    }
    if (change.parameter === 'stop_loss_pct') output.risk.maxPositionLossPct = Math.abs(value);
    if (change.parameter === 'max_drawdown_pct') output.risk.maxPortfolioDrawdownPct = Math.abs(value);
    if (change.parameter === 'max_position_weight_pct') output.risk.maxPositionWeightPct = value;
  }
  output.preset = 'ai-proposal-browser-copy';
  return output;
}
