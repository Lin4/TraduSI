import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { colors, spacing, radius, themedStyles, useTheme } from "./theme";
import { ScoreRing, EquityCurve, Gauge, money, signed, tone } from "./quantcharts";

const PILLARS: [string, string, string][] = [
  ["expected_return", "Expected return", "Edge per $ at risk, plus how this setup did on its own history"],
  ["risk", "Risk", "Reward vs risk, odds of winning, earnings & assignment risk"],
  ["premium_quality", "Premium quality", "Is the option rich vs real movement? Tight spreads & open interest?"],
  ["user_fit", "Your fit", "Matches your risk profile, capital and max-loss limit"],
];

/** Collapsible section used by every quality card. */
export function Section({ icon, title, summary, children, initiallyOpen = false, testID, badge }: {
  icon: string; title: string; summary?: string; children: React.ReactNode; initiallyOpen?: boolean; testID?: string;
  badge?: { text: string; color: string };
}) {
  useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View testID={testID} style={s.section}>
      <Pressable testID={testID ? `${testID}-toggle` : undefined} onPress={() => setOpen((v) => !v)} style={s.sectionHead}
        accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={s.iconWrap}><Icon name={icon as any} size={15} color={colors.brandPrimary} /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.sectionTitle}>{title}</Text>
            {badge ? <View style={[s.miniBadge, { borderColor: badge.color }]}><Text style={[s.miniBadgeText, { color: badge.color }]}>{badge.text}</Text></View> : null}
          </View>
          {summary ? <Text style={s.sectionSummary} numberOfLines={open ? undefined : 2}>{summary}</Text> : null}
        </View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {open ? <View style={s.sectionBody}>{children}</View> : null}
    </View>
  );
}

function Row({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  useTheme();
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={[s.rowVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/** Small score pill for result cards. */
export function OptiScorePill({ score, grade }: { score?: number; grade?: string }) {
  useTheme();
  if (score == null) return null;
  return (
    <View testID="optiscore-pill" style={[s.pill, { borderColor: tone(score) }]}>
      <Text style={[s.pillNum, { color: tone(score) }]}>{score}</Text>
      <Text style={s.pillLbl}>{grade || "OptiScore"}</Text>
    </View>
  );
}

const px = (v: number) => `$${Number(v).toFixed(2)}`;
const histOf = (r: any) => r.validation?.backtest?.hold_to_expiry;

/** The 5-stage pipeline at a glance: Scan → Rank → Plan → Validate → Track. */
export function PipelineStrip({ r }: { r: any }) {
  useTheme();
  const h = histOf(r);
  const steps = [
    { icon: "radio", label: "Scan", value: r.scan ? `${r.scan.liquidity.grade} liq.` : "—", ok: r.scan?.liquidity?.grade !== "Low" },
    { icon: "award", label: "Rank", value: r.optiscore != null ? `${r.optiscore}/100` : "—", ok: (r.optiscore ?? 0) >= 50 },
    { icon: "map", label: "Plan", value: r.plan ? `${r.plan.sizing.contracts} ctr` : "—", ok: (r.plan?.sizing?.contracts ?? 0) > 0 },
    { icon: "check-circle", label: "Validate", value: h?.trades ? `${Math.round(h.win_rate)}% won` : r.validation ? `costs ${r.validation.costs.grade.toLowerCase()}` : "—",
      ok: h?.trades ? h.win_rate >= r.pop - 10 : r.validation?.costs?.grade !== "High" },
    { icon: "activity", label: "Track", value: r.pop_calibrated != null ? "calibrated" : "model POP", ok: true },
  ];
  return (
    <View testID="pipeline-strip" style={s.pipe}>
      {steps.map((st, i) => (
        <React.Fragment key={st.label}>
          <View testID={`pipeline-${st.label.toLowerCase()}`} style={s.pipeStep}>
            <View style={[s.pipeDot, { backgroundColor: st.ok ? colors.brandSecondary : colors.warnBg }]}>
              <Icon name={st.icon as any} size={13} color={st.ok ? colors.brandPrimary : colors.onWarnBg} />
            </View>
            <Text style={s.pipeLabel}>{i + 1}. {st.label}</Text>
            <Text style={[s.pipeVal, !st.ok && { color: colors.onWarnBg }]} numberOfLines={1}>{st.value}</Text>
          </View>
          {i < steps.length - 1 ? <View style={s.pipeLine} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

/** 0-100 OptiScore with the 4 pillars. */
export function OptiScoreCard({ r }: { r: any }) {
  useTheme();
  if (r.optiscore == null) return null;
  const p = r.pillars || {};
  const ranked = PILLARS.map(([k, label]) => ({ k, label, v: p[k] ?? 0 })).sort((a, b) => b.v - a.v);
  const best = ranked[0], worst = ranked[ranked.length - 1];
  return (
    <View testID="optiscore-card" style={s.scoreCard}>
      <View style={s.scoreTop}>
        <ScoreRing score={r.optiscore} testID="optiscore-value" />
        <View style={{ flex: 1 }}>
          <Text style={s.scoreKicker}>OptiScore</Text>
          <Text style={[s.scoreTitle, { color: tone(r.optiscore) }]}>{r.optiscore_grade}</Text>
          <Text style={s.scoreSub}>
            Best at <Text style={s.bold}>{best.label.toLowerCase()}</Text>
            {worst.v < 60 ? <> · watch <Text style={[s.bold, { color: tone(worst.v) }]}>{worst.label.toLowerCase()}</Text></> : null}
          </Text>
          {r.pop_calibrated != null ? (
            <View testID="pop-calibrated" style={s.calPill}>
              <Icon name="target" size={11} color={colors.brandPrimary} />
              <Text style={s.calText}>Calibrated POP {r.pop_calibrated}% · from {r.calibration_n} real results</Text>
            </View>
          ) : null}
        </View>
      </View>
      {PILLARS.map(([k, label, hint]) => (
        <View key={k} testID={`pillar-${k}`} style={s.pillar}>
          <View style={s.pillarHead}>
            <Text style={s.pillarLabel}>{label}</Text>
            <Text style={[s.pillarVal, { color: tone(p[k] ?? 0) }]}>{Math.round(p[k] ?? 0)}</Text>
          </View>
          <Gauge value={p[k] ?? 0} />
          <Text style={s.pillarHint}>{hint}</Text>
        </View>
      ))}
      {(r.fit_reasons || []).map((t: string) => <Text key={t} style={s.warnText}>• {t}</Text>)}
    </View>
  );
}

/** Stage 3: management plan for an options idea. */
export function PlanCard({ plan, pop }: { plan: any; pop?: number }) {
  useTheme();
  if (!plan) return null;
  const z = plan.sizing;
  const loss = plan.stop.loss, gain = plan.take_profit.gain;
  const beWin = loss + gain > 0 ? Math.round((loss / (loss + gain)) * 100) : null;
  return (
    <Section testID="plan-card" icon="map" title="Trade plan" initiallyOpen
      badge={{ text: `${z.contracts} contract${z.contracts === 1 ? "" : "s"}`, color: z.contracts ? colors.brandPrimary : colors.error }}
      summary={`Take profit ${signed(gain)} · stop ${money(-loss)} · exit by ${plan.time_exit.date}`}>
      <View style={s.planGrid}>
        <PlanBox label="Entry limit" value={px(plan.entry.limit)} sub={`worst ${px(plan.entry.worst_acceptable)}`} />
        <PlanBox label="Take profit" value={px(plan.take_profit.option_price)} sub={signed(gain)} color={colors.success} />
        <PlanBox label="Stop" value={px(plan.stop.option_price)} sub={money(-loss)} color={colors.error} />
      </View>
      <View testID="plan-rr" style={s.rrWrap}>
        <View style={s.rrBar}>
          <View style={[s.rrSeg, { flex: Math.max(loss, 1), backgroundColor: colors.error, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 }]} />
          <View style={s.rrEntry} />
          <View style={[s.rrSeg, { flex: Math.max(gain, 1), backgroundColor: colors.success, borderTopRightRadius: 5, borderBottomRightRadius: 5 }]} />
        </View>
        <View style={s.rrLabels}>
          <Text style={[s.rrLbl, { color: colors.error }]}>Risk {money(loss)}</Text>
          <Text style={s.rrLbl}>entry</Text>
          <Text style={[s.rrLbl, { color: colors.success }]}>Reward {money(gain)}</Text>
        </View>
        {beWin != null ? (
          <Text style={s.rrNote}>
            Needs to win <Text style={s.bold}>{beWin}%</Text> of the time to break even with this plan
            {pop != null ? <> — model says <Text style={[s.bold, { color: pop >= beWin ? colors.success : colors.error }]}>{pop}%</Text></> : null}
          </Text>
        ) : null}
      </View>
      <Step n={1} icon="log-in" title="Entry" lines={plan.entry.conditions} />
      <Step n={2} icon="trending-up" title="Take profit" lines={[plan.take_profit.text]} />
      <Step n={3} icon="shield" title="Stop loss" lines={[plan.stop.text]} />
      <Step n={4} icon="alert-octagon" title="Invalidation" lines={[plan.invalidation.text]} />
      <Step n={5} icon="clock" title="Time exit" lines={[plan.time_exit.text]} />
      <View testID="plan-sizing" style={s.sizing}>
        <Text style={s.sizingTitle}>Position size · {z.risk_pct}% risk budget</Text>
        <Row label="Contracts" value={String(z.contracts)} color={z.contracts ? colors.onSurface : colors.error} />
        <Row label="Risk budget" value={money(z.risk_budget)} sub={`${z.risk_pct}% of ${money(z.account_size)}`} />
        <Row label="Planned loss per contract" value={money(z.planned_loss_per_contract)} />
        <Row label="Planned loss (total)" value={money(z.planned_loss_total)} color={colors.error} />
        <Row label="Capital used" value={money(z.capital_used)} />
      </View>
      {(plan.notes || []).map((t: string) => <Text key={t} style={s.warnText}>• {t}</Text>)}
    </Section>
  );
}

function PlanBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  useTheme();
  return (
    <View style={s.planBox}>
      <Text style={s.planBoxLabel}>{label}</Text>
      <Text style={[s.planBoxVal, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={s.planBoxSub}>{sub}</Text> : null}
    </View>
  );
}

function Step({ n, icon, title, lines }: { n: number; icon: string; title: string; lines: string[] }) {
  useTheme();
  return (
    <View style={s.step}>
      <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={icon as any} size={13} color={colors.onSurfaceSecondary} />
          <Text style={s.stepTitle}>{title}</Text>
        </View>
        {lines.map((t) => <Text key={t} style={s.stepText}>{t}</Text>)}
      </View>
    </View>
  );
}

function verdictOf(v: any, pop: number) {
  const h = v.backtest?.hold_to_expiry;
  if (!h?.trades) return { text: "Not enough history to backtest", badge: "no history", color: colors.muted, icon: "clock" };
  const gap = h.win_rate - pop;
  if ((h.profit_factor ?? 1) < 1 && h.avg_pnl < 0) return { text: "Won often but lost money on history", badge: "caution", color: colors.error, icon: "alert-triangle" };
  if (gap < -10) return { text: "Model looks optimistic for this ticker", badge: "optimistic", color: colors.warning, icon: "alert-circle" };
  if (gap > 10) return { text: "History did better than predicted", badge: "beats model", color: colors.success, icon: "thumbs-up" };
  return { text: "History agrees with the model", badge: "in line", color: colors.success, icon: "check-circle" };
}

/** Stage 4: own-history backtest, costs, stress tests. */
export function ValidationCard({ v, pop }: { v: any; pop: number }) {
  useTheme();
  if (!v) return null;
  const bt = v.backtest;
  const h = bt?.hold_to_expiry;
  const m = bt?.managed;
  const st = v.stress;
  const vd = verdictOf(v, pop);
  const maxAbs = Math.max(1, ...st.scenarios.map((x: any) => Math.abs(x.pnl)));
  const costColor = v.costs.grade === "Low" ? colors.success : v.costs.grade === "Moderate" ? colors.warning : colors.error;
  return (
    <Section testID="validation-card" icon="check-circle" title="Validation" badge={{ text: vd.badge, color: vd.color }}
      summary={`${vd.text} · costs ${v.costs.grade.toLowerCase()} · worst stress ${money(st.worst.pnl)}`}>
      <View testID="validation-verdict" style={[s.verdictBox, { borderColor: vd.color }]}>
        <Icon name={vd.icon as any} size={16} color={vd.color} />
        <Text style={[s.verdictText, { color: vd.color }]}>{vd.text}</Text>
      </View>

      <Text style={s.sub}>Backtest on this ticker&apos;s history</Text>
      {h?.trades ? (
        <View testID="validation-backtest">
          <WinBar label="Model POP" value={pop} color={colors.brandPrimary} />
          <WinBar label="History · hold" value={h.win_rate} color={colors.onSurfaceSecondary} />
          {m ? <WinBar label="History · with plan" value={m.win_rate} color={colors.success} /> : null}
          <EquityCurve testID="validation-equity" series={[
            { data: bt.equity?.hold || [], color: colors.onSurfaceSecondary, label: "Hold to expiry", dashed: true },
            { data: bt.equity?.managed || [], color: colors.brandPrimary, label: "With plan" },
          ]} />
          <View style={[s.btHead, { marginTop: spacing.sm }]}>
            <Text style={[s.btCell, s.btLabel]} />
            <Text style={[s.btCell, s.btTh]}>Hold</Text>
            {m ? <Text style={[s.btCell, s.btTh]}>With plan</Text> : null}
          </View>
          <BtRow label="Trades" a={String(h.trades)} b={m ? String(m.trades) : undefined} />
          <BtRow label="Avg P&L" a={money(h.avg_pnl)} b={m ? money(m.avg_pnl) : undefined} colorA={h.avg_pnl >= 0} colorB={m ? m.avg_pnl >= 0 : undefined} />
          <BtRow label="Profit factor" a={h.profit_factor ?? "—"} b={m ? (m.profit_factor ?? "—") : undefined} />
          <BtRow label="Max drawdown" a={money(h.max_drawdown)} b={m ? money(m.max_drawdown) : undefined} />
          <BtRow label="Worst trade" a={money(h.worst)} b={m ? money(m.worst) : undefined} />
          {(v.verdict || []).map((t: string) => <Text key={t} style={s.verdict}>{t}</Text>)}
          <Text style={s.fine}>{bt.method}</Text>
        </View>
      ) : <Text style={s.fine}>Not enough price history yet for a ticker backtest.</Text>}

      <Text style={s.sub}>Trading costs</Text>
      <View testID="validation-costs">
        <View style={s.costHead}>
          <Text style={[s.costPct, { color: costColor }]}>{v.costs.pct_of_max_profit}%</Text>
          <Text style={s.costHint}>of the max profit goes to fees & slippage (round trip)</Text>
        </View>
        <Gauge value={100 - Math.min(100, v.costs.pct_of_max_profit * 2)} left="expensive" right="cheap" />
        <Row label="Fees (round trip)" value={money(v.costs.fees_round_trip)} />
        <Row label="Slippage (round trip)" value={money(v.costs.slippage_round_trip)} />
        <Text style={s.fine}>{v.costs.note}</Text>
      </View>

      <Text style={s.sub}>Stress tests · {st.survives ? "stays within max loss" : "can exceed planned loss"}</Text>
      <View testID="validation-stress">
        {st.scenarios.map((x: any) => {
          const pct = (Math.abs(x.pnl) / maxAbs) * 100;
          return (
            <View key={x.name} style={s.stressRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.stressName}>{x.name}</Text>
                <Text style={s.stressPx}>stock ${x.price}</Text>
              </View>
              <View style={s.divTrack}>
                <View style={[s.divHalf, { alignItems: "flex-end" }]}>
                  {x.pnl < 0 ? <View style={[s.divFill, { width: `${Math.max(4, pct)}%` as any, backgroundColor: colors.error }]} /> : null}
                </View>
                <View style={s.divMid} />
                <View style={s.divHalf}>
                  {x.pnl >= 0 ? <View style={[s.divFill, { width: `${Math.max(4, pct)}%` as any, backgroundColor: colors.success }]} /> : null}
                </View>
              </View>
              <Text style={[s.stressVal, { color: x.pnl >= 0 ? colors.success : colors.error }]}>{signed(x.pnl)}</Text>
            </View>
          );
        })}
      </View>
    </Section>
  );
}

function WinBar({ label, value, color }: { label: string; value: number; color: string }) {
  useTheme();
  return (
    <View style={s.winRow}>
      <Text style={s.winLabel}>{label}</Text>
      <View style={s.winTrack}><View style={[s.winFill, { width: `${Math.max(2, Math.min(100, value))}%` as any, backgroundColor: color }]} /></View>
      <Text style={s.winVal}>{Math.round(value)}%</Text>
    </View>
  );
}

function BtRow({ label, a, b, sub, colorA, colorB }: { label: string; a: any; b?: any; sub?: string; colorA?: boolean; colorB?: boolean }) {
  useTheme();
  const c = (x?: boolean) => (x == null ? colors.onSurface : x ? colors.success : colors.error);
  return (
    <View style={s.btRow}>
      <View style={[s.btCell, s.btLabel]}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={[s.btCell, s.btVal, { color: c(colorA) }]}>{String(a)}</Text>
      {b !== undefined ? <Text style={[s.btCell, s.btVal, { color: c(colorB) }]}>{String(b)}</Text> : null}
    </View>
  );
}

/** Stage 1: market scan report for the ticker. */
export function ScanCard({ scan }: { scan: any }) {
  useTheme();
  if (!scan) return null;
  const v = scan.volatility, a = scan.options_activity, f = scan.fundamentals, l = scan.liquidity;
  const pct = (x?: number | null) => (x != null ? `${(x * 100).toFixed(1)}%` : "—");
  return (
    <Section testID="scan-card" icon="radio" title="Market scan"
      badge={{ text: scan.trend.label, color: scan.trend.label === "Uptrend" ? colors.success : scan.trend.label === "Downtrend" ? colors.error : colors.muted }}
      summary={`${l.grade} liquidity · IV rank ${v.iv_rank != null ? Math.round(v.iv_rank) : "—"} · ${a ? a.activity.toLowerCase() + " options flow" : "no chain"} · fundamentals ${f.label.toLowerCase()}`}>
      <View style={s.tiles}>
        <Tile label="Liquidity" value={l.grade} color={l.grade === "High" ? colors.success : l.grade === "Low" ? colors.error : colors.warning} />
        <Tile label="IV ÷ realized" value={v.iv_hv_ratio != null ? `${v.iv_hv_ratio}×` : "—"} color={v.iv_hv_ratio > 1.2 ? colors.success : undefined} />
        <Tile label="Fundamentals" value={f.score != null ? `${f.score}` : "—"} color={f.score != null ? tone(f.score) : undefined} />
      </View>

      <Text style={s.sub}>IV rank · {v.iv_rank != null ? Math.round(v.iv_rank) : "—"}/100</Text>
      <Gauge testID="scan-ivrank" value={v.iv_rank ?? 0} left="cheap options" right="rich options" />
      <Text style={s.fine}>{v.iv_rank_source}</Text>
      <Row label="Implied vol (ATM)" value={pct(v.atm_iv)} />
      <Row label="Realized vol 20d / 60d" value={`${pct(v.hv20)} / ${pct(v.hv60)}`} />
      <Row label="IV percentile" value={v.iv_percentile != null ? `${Math.round(v.iv_percentile)}` : "—"} />
      {v.atr_pct != null ? <Row label="Avg daily range (ATR)" value={`${v.atr_pct}%`} /> : null}

      <Text style={s.sub}>Stock liquidity</Text>
      <Row label="Avg daily volume (20d)" value={l.avg_volume_20d.toLocaleString()} />
      <Row label="Avg daily $ volume" value={money(l.avg_dollar_volume)} />

      {a ? (
        <>
          <Text style={s.sub}>Options activity · {a.expiration}</Text>
          <View testID="scan-flow" style={s.flowBar}>
            <View style={{ flex: Math.max(a.call_volume, 1), backgroundColor: colors.success }} />
            <View style={{ flex: Math.max(a.put_volume, 1), backgroundColor: colors.error }} />
          </View>
          <View style={s.rrLabels}>
            <Text style={[s.rrLbl, { color: colors.success }]}>Calls {a.call_volume.toLocaleString()}</Text>
            <Text style={s.rrLbl}>{a.tone}</Text>
            <Text style={[s.rrLbl, { color: colors.error }]}>Puts {a.put_volume.toLocaleString()}</Text>
          </View>
          <Row label="Put/call ratio (volume · OI)" value={`${a.put_call_volume ?? "—"} · ${a.put_call_oi ?? "—"}`} />
          <Row label="Volume ÷ open interest" value={`${a.volume_to_oi}`} sub={a.activity} />
          {a.unusual.map((u: any) => (
            <Text key={`${u.type}${u.strike}`} style={s.warnText}>• Unusual: {u.volume.toLocaleString()} {u.type.toLowerCase()}s at ${u.strike} vs OI {u.open_interest.toLocaleString()}</Text>
          ))}
        </>
      ) : null}

      <Text style={s.sub}>Fundamentals · {f.label}</Text>
      {Object.entries(f.parts || {}).map(([k, x]: any) => (
        <View key={k} style={s.partRow}>
          <Text style={s.partLabel}>{k}</Text>
          <View style={{ flex: 1 }}><Gauge value={x} /></View>
          <Text style={[s.partVal, { color: tone(x) }]}>{x}</Text>
        </View>
      ))}

      <Text style={s.sub}>Trend</Text>
      <Row label={scan.trend.label} value={`1m ${scan.trend.return_1m_pct ?? "—"}% · 3m ${scan.trend.return_3m_pct ?? "—"}%`} />
      {(scan.flags || []).map((t: string) => <Text key={t} style={s.flag}>• {t}</Text>)}
    </Section>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  useTheme();
  return (
    <View style={s.tile}>
      <Text style={s.planBoxLabel}>{label}</Text>
      <Text style={[s.tileVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md, overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 60 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  sectionSummary: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 16 },
  sectionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  miniBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  miniBadgeText: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  rowLabel: { fontSize: 13, color: colors.onSurfaceSecondary },
  rowSub: { fontSize: 10, color: colors.muted, marginTop: 1 },
  rowVal: { fontSize: 13, fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"], textAlign: "right" },
  sub: { fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: 2 },
  fine: { fontSize: 11, color: colors.muted, marginTop: spacing.sm, lineHeight: 15 },
  warnText: { fontSize: 12, color: colors.warning, marginTop: 4, lineHeight: 17 },
  flag: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 17 },
  verdict: { fontSize: 12, fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm, lineHeight: 17 },
  bold: { fontWeight: "800", color: colors.onSurface },

  pill: { alignItems: "center", borderWidth: 2, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 2, minWidth: 54 },
  pillNum: { fontSize: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  pillLbl: { fontSize: 9, fontWeight: "700", color: colors.muted, textTransform: "uppercase" },

  pipe: { flexDirection: "row", alignItems: "flex-start", marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: 4 },
  pipeStep: { flex: 1, alignItems: "center", minWidth: 0 },
  pipeDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  pipeLabel: { fontSize: 10, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  pipeVal: { fontSize: 10, color: colors.onSurfaceSecondary, marginTop: 1, fontVariant: ["tabular-nums"] },
  pipeLine: { width: 6, height: 2, backgroundColor: colors.borderStrong, marginTop: 13 },

  scoreCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
  scoreTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  scoreKicker: { fontSize: 10, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  scoreTitle: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  scoreSub: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 16 },
  calPill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  calText: { fontSize: 11, fontWeight: "700", color: colors.brandPrimary },
  pillar: { marginTop: spacing.md },
  pillarHead: { flexDirection: "row", justifyContent: "space-between" },
  pillarLabel: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  pillarVal: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pillarHint: { fontSize: 10, color: colors.muted, marginTop: 3, lineHeight: 13 },

  planGrid: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  planBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: "center" },
  planBoxLabel: { fontSize: 10, color: colors.muted, fontWeight: "700", textTransform: "uppercase" },
  planBoxVal: { fontSize: 17, fontWeight: "800", color: colors.onSurface, marginTop: 2, fontVariant: ["tabular-nums"] },
  planBoxSub: { fontSize: 10, color: colors.muted, marginTop: 1, fontVariant: ["tabular-nums"] },
  rrWrap: { marginTop: spacing.md },
  rrBar: { flexDirection: "row", height: 10, alignItems: "center" },
  rrSeg: { height: 10 },
  rrEntry: { width: 3, height: 18, backgroundColor: colors.onSurface, borderRadius: 2 },
  rrLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  rrLbl: { fontSize: 11, fontWeight: "700", color: colors.muted, fontVariant: ["tabular-nums"] },
  rrNote: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 6, lineHeight: 17 },
  step: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800" },
  stepTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  stepText: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 17 },
  sizing: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  sizingTitle: { fontSize: 12, fontWeight: "800", color: colors.onSurface, marginBottom: 2 },

  verdictBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  verdictText: { flex: 1, fontSize: 13, fontWeight: "800" },
  winRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  winLabel: { width: 112, fontSize: 12, color: colors.onSurfaceSecondary },
  winTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  winFill: { height: 10, borderRadius: 5 },
  winVal: { width: 38, textAlign: "right", fontSize: 12, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  btHead: { flexDirection: "row", paddingVertical: 4 },
  btRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  btCell: { flex: 1 },
  btLabel: { flex: 1.4 },
  btTh: { fontSize: 10, fontWeight: "800", color: colors.muted, textAlign: "right", textTransform: "uppercase" },
  btVal: { fontSize: 13, fontWeight: "700", textAlign: "right", fontVariant: ["tabular-nums"] },
  costHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  costPct: { fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  costHint: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 16 },
  stressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stressName: { fontSize: 12, color: colors.onSurface, fontWeight: "600" },
  stressPx: { fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"] },
  divTrack: { width: 96, flexDirection: "row", alignItems: "center", height: 12 },
  divHalf: { flex: 1, height: 10, justifyContent: "center" },
  divFill: { height: 10, borderRadius: 3 },
  divMid: { width: 1, height: 14, backgroundColor: colors.borderStrong },
  stressVal: { width: 64, textAlign: "right", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },

  tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  tile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: "center" },
  tileVal: { fontSize: 16, fontWeight: "800", color: colors.onSurface, marginTop: 2, fontVariant: ["tabular-nums"] },
  flowBar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", marginTop: 6, gap: 2 },
  partRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  partLabel: { width: 112, fontSize: 12, color: colors.onSurfaceSecondary },
  partVal: { width: 28, textAlign: "right", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
}));
