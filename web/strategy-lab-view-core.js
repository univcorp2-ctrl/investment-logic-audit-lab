export const finiteMetric = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function strategyRowsToCsv(payload) {
  const columns = ['name','status','observations','total_return_pct','baseline_excess_pct','cagr_pct','volatility_pct','sharpe','sortino','max_drawdown_pct','turnover','hit_rate_pct','profit_factor'];
  const rows = (payload?.strategies ?? []).map(row => ({ name:row.name, baseline_excess_pct:row.baseline_excess_pct, ...(row.metrics ?? {}) }));
  const escape = value => { const text=String(value??''); return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; };
  return [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
}

export function labVerdict(payload) {
  if (!payload) return { tone:'missing', title:'未実行', message:'週次戦略ラボを実行してください。' };
  if (payload.adoption_status !== 'research_candidate') return { tone:'warning', title:'採用不可', message:'履歴またはwalk-forward検証が不足しています。既存デモルールは変更されません。' };
  return { tone:'candidate', title:'研究候補', message:`${payload.research_candidate} がwalk-forward条件を通過しました。自動採用はされません。` };
}
