export const PERFORMANCE_CATALOG = Object.freeze({
  return:{label:'リターン',metrics:{total_return_pct:['累計収益率','Total Return','累計の投資収益率','higher'],daily_return_pct:['日次収益率','Daily Return','直近日の資産変化率','higher'],cumulative_return_pct:['累積収益率','Cumulative','初期元本からの変化率','higher'],cagr_pct:['年率収益率','CAGR','複利ベースの年率換算。短期履歴では非表示','higher'],positive_day_ratio_pct:['上昇日比率','Positive Days','日次収益がプラスだった割合','higher']}},
  risk:{label:'リスク',metrics:{annualized_volatility_pct:['年率ボラティリティ','Volatility','日次変動の年率換算','lower'],downside_deviation_pct:['下方偏差','Downside Dev','マイナス方向だけの変動率','lower'],max_drawdown_pct:['最大ドローダウン','Max DD','資産ピークから底までの最大下落率','higher'],current_drawdown_pct:['現在ドローダウン','Current DD','直近ピークから現在までの下落率','higher'],ulcer_index:['Ulcer Index','Ulcer','ドローダウンの深さと継続を測る指数','lower'],var_95_pct:['VaR 95%','VaR','過去分布の下位5%の日次損失境界','higher'],cvar_95_pct:['期待ショートフォール','CVaR/ES','VaRを超えた損失日の平均','higher'],best_day_pct:['最高日','Best Day','観測期間の最大日次収益','higher'],worst_day_pct:['最低日','Worst Day','観測期間の最悪日次収益','higher']}},
  risk_adjusted:{label:'リスク調整後',metrics:{sharpe_ratio:['シャープレシオ','Sharpe','超過収益を総変動率で割る','higher'],sortino_ratio:['ソルティノレシオ','Sortino','超過収益を下方偏差で割る','higher'],calmar_ratio:['カルマーレシオ','Calmar','CAGRを最大DDの絶対値で割る','higher'],omega_ratio:['オメガレシオ','Omega','プラス日収益合計÷マイナス日収益絶対合計','higher'],gain_to_pain_ratio:['Gain-to-Pain','GPR','利益合計÷損失合計の絶対値','higher']}},
  trade_quality:{label:'トレード品質',metrics:{trade_count:['完了取引数','Trades','決済まで完了したデモ取引数','higher'],win_rate_pct:['勝率','Win Rate','完了取引のうち利益取引の割合','higher'],loss_rate_pct:['敗率','Loss Rate','完了取引のうち損失取引の割合','lower'],average_win:['平均利益','Avg Win','利益取引1件あたりの平均利益','higher'],average_loss:['平均損失','Avg Loss','損失取引1件あたりの平均損失','higher'],payoff_ratio:['ペイオフレシオ','Payoff','平均利益÷平均損失の絶対値','higher'],risk_reward_ratio:['リスクリワード','Risk/Reward','平均利益÷平均損失の絶対値。Payoffと同じ定義','higher'],profit_factor:['プロフィットファクター','Profit Factor','総利益÷総損失の絶対値','higher'],expectancy_per_trade:['期待値／取引','Expectancy','完了取引1件あたりの平均損益','higher'],average_holding_days:['平均保有日数','Holding Days','現在・完了ポジションの平均保有期間','neutral']}},
  portfolio:{label:'ポートフォリオ',metrics:{turnover_ratio:['売買回転率','Turnover','売買金額÷平均評価額','lower'],gross_exposure_pct:['総エクスポージャー','Gross Exposure','資産に対する保有時価の割合','neutral'],net_exposure_pct:['純エクスポージャー','Net Exposure','ロング－ショートの純保有比率','neutral'],cash_ratio_pct:['現金比率','Cash Ratio','総資産に占める現金割合','neutral'],concentration_hhi:['集中度','HHI','銘柄ウェイト二乗和。高いほど集中','lower'],max_position_weight_pct:['最大銘柄比率','Max Weight','最大ポジションの資産比率','lower'],position_count:['保有銘柄数','Positions','現在の保有銘柄数','neutral'],recovery_factor:['リカバリーファクター','Recovery','累計損益÷最大DD額','higher']}},
  benchmark:{label:'ベンチマーク',metrics:{beta:['ベータ','Beta','ベンチマーク変動に対する感応度','neutral'],alpha_pct:['アルファ','Alpha','ベータ調整後の年率超過収益','higher'],correlation:['相関係数','Correlation','ベンチマークとの連動性','neutral'],tracking_error_pct:['トラッキングエラー','Tracking Error','ベンチマーク差の日次変動を年率化','lower'],information_ratio:['インフォメーションレシオ','IR','超過収益÷トラッキングエラー','higher'],benchmark_excess_return_pct:['ベンチマーク超過収益','Excess Return','同期間のベンチマークとの差','higher']}},
});

export const CHART_MODES = Object.freeze([
  ['equity','資産曲線'],['daily','日次損益'],['cumulative','累積損益'],['drawdown','ドローダウン'],['contribution','銘柄寄与'],['periodic','週次／月次'],
]);
export const PERIODS = Object.freeze([['1W',7],['1M',31],['3M',93],['YTD','YTD'],['ALL','ALL']]);

export function flattenMetrics(analytics) {
  const rows=[];
  for(const [groupKey,group] of Object.entries(PERFORMANCE_CATALOG)){
    const values=analytics?.groups?.[groupKey]??{};
    for(const [key,definition] of Object.entries(group.metrics)){
      const source=values[key]??{value:null,status:'unavailable',reason:'指標が生成されていません。',unit:null};
      rows.push({group:groupKey,groupLabel:group.label,key,label:definition[0],abbreviation:definition[1],description:definition[2],direction:definition[3],...source});
    }
  }
  return rows;
}

export function formatAnalyticsValue(metric) {
  if(metric?.value===null||metric?.value===undefined||metric?.value==='')return'N/A';
  const value=Number(metric.value);if(!Number.isFinite(value))return String(metric.value);
  if(metric.unit==='jpy')return new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(value);
  if(String(metric.unit??'').startsWith('pct'))return`${value>=0?'+':''}${value.toFixed(2)}%`;
  if(metric.unit==='days')return`${value.toFixed(1)}日`;
  if(metric.unit==='count')return`${Math.round(value)}`;
  return value.toFixed(3);
}

export function filterSeriesByPeriod(rows, period, now = new Date()) {
  if(!Array.isArray(rows)||period==='ALL')return rows??[];
  let start;
  if(period==='YTD')start=new Date(now.getFullYear(),0,1);
  else{const days=Number(PERIODS.find(item=>item[0]===period)?.[1]??0);start=new Date(now);start.setDate(start.getDate()-days);}
  return rows.filter(row=>{const date=new Date(`${row.date}T00:00:00+09:00`);return!Number.isNaN(date.getTime())&&date>=start;});
}

export function analyticsRowsToCsv(analytics) {
  const columns=['group','key','label','abbreviation','value','unit','status','reason'];
  const escape=value=>{const text=String(value??'');return/[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};
  return[columns.join(','),...flattenMetrics(analytics).map(row=>columns.map(column=>escape(row[column])).join(','))].join('\n');
}
