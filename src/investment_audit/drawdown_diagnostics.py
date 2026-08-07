from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class DiagnosticThresholds:
    portfolio_drawdown_alert_pct: float = -8.0
    total_unrealized_loss_alert_pct: float = -5.0
    position_loss_alert_pct: float = -8.0
    max_position_weight_pct: float = 20.0
    max_sector_weight_pct: float = 35.0
    weak_technical_score: float = 35.0
    weak_fundamental_score: float = 45.0
    high_trap_risk: float = 65.0
    stale_fundamental_days: int = 90
    high_annualized_volatility_pct: float = 50.0
    min_rule_change_observations: int = 42
    preferred_rule_change_observations: int = 60


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if pd.notna(parsed) else None


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def _age_days(value: Any, generated_at: str | None) -> int | None:
    if not value or not generated_at:
        return None
    try:
        start = pd.Timestamp(value)
        end = pd.Timestamp(generated_at)
    except (TypeError, ValueError):
        return None
    if start.tzinfo is None:
        start = start.tz_localize("UTC")
    if end.tzinfo is None:
        end = end.tz_localize("UTC")
    return max(0, int((end - start).total_seconds() // 86400))


def diagnose_drawdown(
    latest_report: dict[str, Any],
    analytics: dict[str, Any],
    ranking: dict[str, Any],
    thresholds: DiagnosticThresholds = DiagnosticThresholds(),
) -> dict[str, Any]:
    summary = latest_report.get("summary", {})
    sample = analytics.get("sample", {})
    risk = analytics.get("risk", {})
    contributions = analytics.get("series", {}).get("contributions", [])
    decisions = latest_report.get("decisions", [])
    equity = _number(summary.get("equity")) or _number(sample.get("current_equity")) or 0.0
    seed = _number(sample.get("seed_cost_basis")) or 0.0
    unrealized = _number(summary.get("unrealized_pnl")) or 0.0
    unrealized_pct = unrealized / seed * 100 if seed > 0 else None
    max_dd = _number(risk.get("max_drawdown_pct", {}).get("value"))
    current_dd = _number(risk.get("current_drawdown_pct", {}).get("value"))
    observations = int(sample.get("observations") or 0)
    causes: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []

    def cause(code: str, severity: str, title: str, evidence: list[str], explanation: str) -> None:
        causes.append({"code": code, "severity": severity, "title": title, "evidence": evidence, "explanation": explanation})

    def action(code: str, priority: str, title: str, why: str, setting_hint: str, auto_apply: bool = False) -> None:
        actions.append({"code": code, "priority": priority, "title": title, "why": why, "setting_hint": setting_hint, "auto_apply": auto_apply})

    if max_dd is not None and max_dd <= thresholds.portfolio_drawdown_alert_pct:
        cause("portfolio_drawdown", "high", "ポートフォリオのドローダウンが大きい", [f"最大DD {max_dd:.2f}%", f"設定基準 {thresholds.portfolio_drawdown_alert_pct:.2f}%"], "直近ピークからの資産減少が許容水準を超えています。")
        action("reduce_exposure", "high", "総エクスポージャーを下げる候補", "大きなDD中に同じリスク量を維持すると回復に必要な収益率が急増します。", "最大DD上限・1銘柄損失上限・最大ポジション比率を厳しくする")

    if unrealized_pct is not None and unrealized_pct <= thresholds.total_unrealized_loss_alert_pct:
        cause("unrealized_loss", "high", "含み損がポートフォリオ上限を超えた", [f"含み損益率 {unrealized_pct:.2f}%", f"設定基準 {thresholds.total_unrealized_loss_alert_pct:.2f}%"], "未確定損失が元本に対して大きく、複数銘柄の同時悪化や集中リスクを確認すべき状態です。")
        action("loss_budget", "high", "損失予算を銘柄・全体で分離", "ポートフォリオ全体と1銘柄の損失上限を別々に管理すると、単一銘柄の事故が全体へ波及しにくくなります。", "全体含み損上限と1銘柄含み損上限を設定")

    large_losers = []
    for row in contributions:
        return_pct = _number(row.get("return_pct"))
        if return_pct is not None and return_pct <= thresholds.position_loss_alert_pct:
            large_losers.append(row)
    if large_losers:
        evidence = [f"{row.get('company_name')} {float(row.get('return_pct') or 0):.2f}%" for row in large_losers[:5]]
        cause("position_losses", "high", "個別銘柄の損失が集中", evidence, "少数の銘柄が全体損益を大きく押し下げている可能性があります。")
        action("position_stop", "high", "1銘柄ごとの最大損失を明示", "個別損失の肥大化を防ぐ目的です。", "1銘柄最大含み損% / 円、最大ポジション比率を設定")

    overweight = [row for row in contributions if (_number(row.get("weight_pct")) or 0.0) > thresholds.max_position_weight_pct]
    if overweight:
        evidence = [f"{row.get('company_name')} {float(row.get('weight_pct') or 0):.1f}%" for row in overweight[:5]]
        cause("concentration", "medium", "ポジション集中度が高い", evidence, "1銘柄の値動きがポートフォリオ全体を支配しやすい状態です。")
        action("position_cap", "medium", "最大ポジション比率を下げる候補", "集中リスクを抑え、1銘柄の急落耐性を高めます。", "最大ポジション比率を15〜20%以下で比較")

    weak_technical = []
    weak_fundamental = []
    invalid_quotes = []
    sector_losses: dict[str, float] = {}
    ranking_by_code = {str(row.get("code", ""))[:4]: row for row in ranking.get("rows", [])}
    for item in decisions:
        code = str(item.get("code", ""))
        technical = _number(item.get("technical", {}).get("score"))
        fundamental = _number(item.get("fundamental", {}).get("score"))
        trap = _number(item.get("fundamental", {}).get("value_trap_risk"))
        if technical is not None and technical <= thresholds.weak_technical_score:
            weak_technical.append(f"{item.get('company_name')} Technical {technical:.1f}")
        if fundamental is not None and fundamental <= thresholds.weak_fundamental_score:
            weak_fundamental.append(f"{item.get('company_name')} Fundamental {fundamental:.1f}")
        if trap is not None and trap >= thresholds.high_trap_risk:
            weak_fundamental.append(f"{item.get('company_name')} Trap {trap:.1f}")
        if item.get("quote", {}).get("valid") is not True:
            invalid_quotes.append(str(item.get("company_name")))
        row = ranking_by_code.get(code[:4], {})
        sector = str(row.get("sector") or "不明")
        contribution = next((entry for entry in contributions if str(entry.get("code")) == code), None)
        pnl = _number((contribution or {}).get("pnl")) or 0.0
        sector_losses[sector] = sector_losses.get(sector, 0.0) + min(0.0, pnl)

    if weak_technical:
        cause("technical_breakdown", "medium", "テクニカル悪化が複数銘柄で発生", weak_technical[:6], "トレンド崩れ・負のモメンタム・高ボラ化が含み損を拡大させる典型要因です。")
        action("entry_confirmation", "medium", "エントリー確認を厳しくする候補", "弱いトレンドでの新規エントリーを減らす目的です。", "株価>SMA20、SMA20>SMA60、20/60日Momentum>0を比較")

    if weak_fundamental:
        cause("fundamental_weakness", "medium", "ファンダメンタルまたはTrap Riskが弱い銘柄がある", weak_fundamental[:6], "割安に見えても品質悪化やFCF悪化を伴う場合、バリュートラップになり得ます。")
        action("quality_floor", "medium", "品質・FCF・Trap基準を厳しくする候補", "安さだけで残る銘柄を減らす目的です。", "品質/ROE/FCF利回り/Trap Riskの最低条件を比較")

    cutoff = ranking.get("metadata", {}).get("effective_data_cutoff")
    generated = latest_report.get("generated_at")
    fundamental_age = _age_days(cutoff, generated)
    if fundamental_age is not None and fundamental_age >= thresholds.stale_fundamental_days:
        cause("stale_fundamentals", "medium", "ファンダメンタルが古い", [f"実効cutoff {cutoff}", f"評価時点から約{fundamental_age}日"], "Freeの遅延データでは、現在の決算・業績変化が投資判断へ反映されるまで時間差があります。")
        action("freshness", "medium", "Fundamental鮮度を改善", "古い企業情報による判断ズレを減らす目的です。", "Light以上の最新データ、または開示鮮度上限を短くする")

    annual_vol = _number(risk.get("annualized_volatility_pct", {}).get("value"))
    if annual_vol is not None and annual_vol >= thresholds.high_annualized_volatility_pct:
        cause("high_volatility", "medium", "ポートフォリオ変動率が高い", [f"年率Vol {annual_vol:.1f}%"], "同じ株数でも値動きが大きい銘柄ほど損益への寄与が過大になります。")
        action("vol_target", "medium", "低ボラ/逆ボラ配分を比較", "各銘柄のリスク量を近づけ、損益の振れを抑える目的です。", "低ボラプリセット、最大Vol、最大ポジション比率を調整")

    worst_sector = min(sector_losses.items(), key=lambda item: item[1]) if sector_losses else None
    if worst_sector and worst_sector[1] < 0:
        cause("sector_cluster", "low", "同一業種の損失集中を確認", [f"{worst_sector[0]} 合計 {worst_sector[1]:,.0f}円"], "複数銘柄を保有していても同じ業種なら実質的な分散が弱くなります。")
        action("sector_cap", "low", "業種上限を設定する候補", "同じテーマの同時下落を抑える目的です。", "最大業種比率を25〜35%で比較")

    if invalid_quotes:
        cause("data_quality", "low", "一部価格が検証不可", invalid_quotes[:6], "価格データの不整合は損失原因ではなく、誤った損益認識を防ぐためのデータ品質問題です。")

    if not causes:
        causes.append({"code": "normal_fluctuation", "severity": "info", "title": "現時点では特定の異常原因を検出していない", "evidence": [], "explanation": "短期の含み損・ドローダウンは通常の価格変動でも発生します。サンプル数を増やして原因の再現性を確認します。"})

    rule_change_allowed = observations >= thresholds.min_rule_change_observations
    preferred = observations >= thresholds.preferred_rule_change_observations
    stability_plan = {
        "goal": "勝率の最大化ではなく、期待値・ドローダウン・再現性のバランスを改善する",
        "rule_change_allowed": rule_change_allowed,
        "preferred_evidence_reached": preferred,
        "observations": observations,
        "minimum_observations": thresholds.min_rule_change_observations,
        "preferred_observations": thresholds.preferred_rule_change_observations,
        "principles": [
            "損失原因を価格・集中・Fundamental・Technical・データ品質に分解する",
            "1回の損失を理由にルールを変更せず、同じ原因が複数回再現するか確認する",
            "変更候補はweekly strategy labでOOS比較し、既存ルールよりDDと期待値が改善した場合だけ候補化する",
            "ポジションサイズと損失上限を先に固定し、銘柄選択の失敗が全資産へ波及しないようにする",
            "有料データは鮮度と検証期間を改善するが、勝率や収益を保証しない",
        ],
        "status": "変更候補を比較可能" if rule_change_allowed else "履歴不足のためルール変更は参考提案のみ",
    }
    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "paper_only": True,
        "thresholds": asdict(thresholds),
        "snapshot": {
            "equity": equity,
            "seed_cost_basis": seed,
            "unrealized_pnl": unrealized,
            "unrealized_loss_pct_of_seed": unrealized_pct,
            "max_drawdown_pct": max_dd,
            "current_drawdown_pct": current_dd,
            "observations": observations,
        },
        "causes": causes,
        "improvement_candidates": actions,
        "stability_plan": stability_plan,
        "disclaimer": "原因分析と改善案はデモ研究用です。安定利益や勝率を保証せず、十分なOOS検証なしに自動採用しません。",
    }


def generate_diagnostics(root: Path) -> dict[str, Any]:
    web = root / "web"
    data = web / "data" / "paper-trading"
    latest = _load(data / "latest-report.json", {})
    analytics = _load(data / "performance-metrics.json", {})
    ranking = _load(web / "jquants-ranking.json", {"metadata": {}, "rows": []})
    payload = diagnose_drawdown(latest, analytics, ranking)
    _write(data / "drawdown-diagnostics.json", payload)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Diagnose drawdown and unrealized-loss causes")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = generate_diagnostics(args.root)
    print(json.dumps({"causes": len(result["causes"]), "actions": len(result["improvement_candidates"]), "status": result["stability_plan"]["status"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
