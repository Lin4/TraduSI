import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";

import { MetricRow } from "./parts";
import { api } from "./api";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

const big = (v: number | null | undefined) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString()}`;
};
const ratio = (v: number | null | undefined) => (v == null ? "—" : Number(v).toFixed(2));

const MEASURES: [string, string, (v: any) => string][] = [
  ["market_cap", "Market Cap", big],
  ["enterprise_value", "Enterprise Value", big],
  ["trailing_pe", "Trailing P/E", ratio],
  ["forward_pe", "Forward P/E", ratio],
  ["peg_ratio", "PEG Ratio (5yr expected)", ratio],
  ["price_to_sales", "Price/Sales", ratio],
  ["price_to_book", "Price/Book", ratio],
  ["ev_to_revenue", "Enterprise Value/Revenue", ratio],
  ["ev_to_ebitda", "Enterprise Value/EBITDA", ratio],
];

export function ValuationMeasures({ m, buy, sell }: { m: Record<string, any>; buy?: number | null; sell?: number | null }) {
  useTheme();
  return (
    <View testID="valuation-measures">
      {MEASURES.map(([k, label, fmt]) => <MetricRow key={k} label={label} value={fmt(m?.[k])} />)}
      <MetricRow label="Buy point (below)" value={buy != null ? `$${buy}` : "—"} color={colors.success} />
      <MetricRow label="Sell point (above)" value={sell != null ? `$${sell}` : "—"} color={colors.brandPrimary} />
    </View>
  );
}

// getters so each read returns the active theme's color
const SERIES = [
  { key: "revenue", label: "Total revenue", get color() { return colors.brandPrimary; } },
  { key: "net_income", label: "Net income", get color() { return colors.success; } },
  { key: "operating_cash_flow", label: "Operating cash flow", get color() { return colors.info; } },
  { key: "free_cash_flow", label: "Free cash flow", get color() { return colors.warning; } },
];

/** Grouped bar chart of the last 3 quarters + details table. */
export function FinancialsChart({ rows: all, source }: { rows: any[]; source?: string }) {
  useTheme();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [n, setN] = useState(3);
  if (!all?.length) return <Text style={s.empty}>Quarterly filings aren&apos;t available for this ticker.</Text>;
  const rows = all.slice(-n);
  const shown = SERIES.filter((x) => !hidden[x.key]);
  const max = Math.max(1, ...rows.flatMap((r) => shown.map((x) => Math.abs(r[x.key] || 0))));
  const H = 140;
  const wide = rows.length > 4;
  return (
    <View testID="financials-chart">
      <View style={s.toggle}>
        {[3, 8].map((q) => (
          <Pressable key={q} testID={`fin-range-${q}`} onPress={() => setN(q)} style={[s.toggleBtn, n === q && s.toggleActive]}>
            <Text style={[s.toggleText, n === q && s.toggleTextActive]}>{q} quarters</Text>
          </Pressable>
        ))}
        {all.length < 8 && n === 8 ? <Text style={s.note}>{all.length} available</Text> : null}
      </View>
      <View style={s.legend}>
        {SERIES.map((x) => (
          <Pressable key={x.key} testID={`fin-legend-${x.key}`} onPress={() => setHidden((h) => ({ ...h, [x.key]: !h[x.key] }))} style={[s.legendItem, hidden[x.key] && { opacity: 0.35 }]}>
            <View style={[s.dot, { backgroundColor: x.color }]} />
            <Text style={s.legendText}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[s.chart, { height: H + 24 }]}>
        {rows.map((r) => (
          <View key={r.label} style={s.group}>
            <View style={[s.bars, { height: H }]}>
              {shown.map((x) => {
                const v = r[x.key] || 0;
                return <View key={x.key} style={[s.bar, wide && { width: 5 }, { height: Math.max(2, (Math.abs(v) / max) * H), backgroundColor: v < 0 ? colors.error : x.color }]} />;
              })}
            </View>
            <Text style={[s.qLabel, wide && { fontSize: 8 }]}>{wide ? r.label.replace(" FY", "'") : r.label}</Text>
          </View>
        ))}
      </View>

      <View style={s.table}>
        <View style={[s.tr, s.th]}>
          <Text style={[s.td, s.tdHead, { flex: 1.5 }]}>Quarter</Text>
          {rows.map((r) => <Text key={r.label} style={[s.td, s.tdHead, wide && { fontSize: 8 }]}>{wide ? r.label.replace(" FY", "'") : r.label}</Text>)}
        </View>
        {[...SERIES, { key: "revenue_growth_pct", label: "Revenue growth QoQ" }, { key: "net_income_growth_pct", label: "Net income growth QoQ" }, { key: "cash", label: "Cash on hand" }, { key: "net_margin_pct", label: "Net margin" }].map((x) => (
          <View key={x.key} testID={`fin-row-${x.key}`} style={s.tr}>
            <Text style={[s.td, { flex: 1.5, fontWeight: "700" }]}>{x.label}</Text>
            {rows.map((r) => (
              <Text key={r.label} style={[s.td, wide && { fontSize: 8 }, r[x.key] != null && r[x.key] < 0 && { color: colors.error }]}>
                {x.key.endsWith("_pct") ? (r[x.key] != null ? `${r[x.key] > 0 && x.key.includes("growth") ? "+" : ""}${r[x.key]}%` : "—") : big(r[x.key])}{x.key === "cash" && r.cash_estimated ? "*" : ""}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <Text style={s.note}>Quarter end: {rows.map((r) => r.end_date).join(" · ")}. {source}{rows.some((r) => r.cash_estimated) ? " *Cash estimated from cash per share." : ""} Banks&apos; operating cash flow swings widely with trading and loan activity.</Text>
    </View>
  );
}

/** Debt vs equity bars + debt-to-equity per quarter. */
export function BalanceSheet({ rows }: { rows: any[] }) {
  useTheme();
  const data = (rows || []).filter((r) => r.equity != null || r.total_debt != null);
  if (!data.length) return <Text style={s.empty}>Balance sheet data isn&apos;t available in recent filings for this ticker.</Text>;
  const max = Math.max(1, ...data.flatMap((r) => [Math.abs(r.total_debt || 0), Math.abs(r.equity || 0)]));
  const H = 110;
  const last = [...data].reverse().find((r) => r.debt_to_equity != null);
  const de = last?.debt_to_equity;
  const health = de == null ? null : de < 0.5 ? { t: "Low leverage — strong balance sheet", c: colors.success } : de < 1.5 ? { t: "Moderate leverage", c: colors.warning } : { t: "High leverage — debt-heavy", c: colors.error };
  return (
    <View testID="balance-sheet">
      {health ? <Text testID="balance-health" style={[s.health, { color: health.c }]}>D/E {de} · {health.t}</Text> : null}
      <View style={s.legend}>
        <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.error }]} /><Text style={s.legendText}>Total debt</Text></View>
        <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.brandPrimary }]} /><Text style={s.legendText}>Equity</Text></View>
      </View>
      <View style={[s.chart, { height: H + 40 }]}>
        {data.map((r) => (
          <View key={r.label} style={s.group}>
            <View style={[s.bars, { height: H }]}>
              <View style={[s.bar, { width: 8, height: Math.max(2, (Math.abs(r.total_debt || 0) / max) * H), backgroundColor: colors.error }]} />
              <View style={[s.bar, { width: 8, height: Math.max(2, (Math.abs(r.equity || 0) / max) * H), backgroundColor: colors.brandPrimary }]} />
            </View>
            <Text style={[s.qLabel, { fontSize: 8 }]}>{r.label.replace(" FY", "'")}</Text>
            <Text style={s.deLabel}>{r.debt_to_equity != null ? r.debt_to_equity.toFixed(2) : "—"}</Text>
          </View>
        ))}
      </View>
      <Text style={s.note}>Bottom row = debt-to-equity (total debt ÷ shareholders&apos; equity). Debt = long-term + current debt + commercial paper from SEC filings.{data.some((r) => r.equity_estimated) ? " Latest equity estimated from book value per share." : ""}</Text>
    </View>
  );
}

const fmtPeer = (k: string, v: any) => (v == null ? "—" : k === "market_cap" || k === "enterprise_value" ? big(v) : Number(v).toFixed(1));

/** Valuation measures side by side with up to 3 peers; lowest ratio highlighted as cheapest. */
export function PeerComparison({ ticker }: { ticker: string }) {
  useTheme();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setD(null); setErr(false);
    api(`/api/screener/peers/${ticker}`).then(setD).catch(() => setErr(true));
  }, [ticker]);
  if (err) return <Text style={s.empty}>Peer data unavailable.</Text>;
  if (!d) return <Text style={s.empty}>Loading peers…</Text>;
  if (d.rows.length < 2) return <Text style={s.empty}>No comparable peers found.</Text>;
  return (
    <View testID="peer-comparison">
      <Text testID="peer-summary" style={s.health}>{d.summary}</Text>
      <View style={s.table}>
        <View style={[s.tr, s.th]}>
          <Text style={[s.td, s.tdHead, { flex: 1.6, textAlign: "left" }]}>Measure</Text>
          {d.rows.map((r: any) => <Text key={r.ticker} style={[s.td, s.tdHead, r.is_target && { color: colors.brandPrimary }]}>{r.ticker}</Text>)}
        </View>
        {MEASURES.map(([k, label]) => {
          const vals = d.rows.map((r: any) => r[k]).filter((v: any) => v != null && v > 0);
          const lowest = k === "market_cap" || k === "enterprise_value" ? null : Math.min(...vals);
          return (
            <View key={k} testID={`peer-row-${k}`} style={s.tr}>
              <Text style={[s.td, { flex: 1.6, textAlign: "left", fontWeight: "700", fontSize: 10 }]}>{label}</Text>
              {d.rows.map((r: any) => (
                <Text key={r.ticker} style={[s.td, r.is_target && { fontWeight: "800" }, lowest != null && r[k] === lowest && { color: colors.success, fontWeight: "800" }]}>{fmtPeer(k, r[k])}</Text>
              ))}
            </View>
          );
        })}
      </View>
      <Text style={s.note}>Green = lowest (cheapest) among the group. Lower ratios mean you pay less per $ of earnings, sales or book value — but check growth and quality too. {d.source}.</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  iq: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.lg, marginBottom: spacing.md },
  iqRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 4 },
  iqTag: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: "hidden" },
  iqTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.sm },
  iqLabel: { fontSize: 11, fontWeight: "800", color: colors.onBrandSecondary, textTransform: "uppercase", letterSpacing: 1 },
  iqValue: { fontSize: 30, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  iqUp: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  iqBadge: { fontSize: 11, fontWeight: "800", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  iqSmall: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },
  iqSection: { fontSize: 10, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.sm, marginBottom: 6 },
  rangeTrack: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceTertiary, position: "relative" },
  rangeFill: { position: "absolute", top: 0, bottom: 0, borderRadius: 6, backgroundColor: colors.brandPrimary, opacity: 0.3 },
  rangeMark: { position: "absolute", top: -3, width: 4, height: 18, borderRadius: 2, marginLeft: -2 },
  methodRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  methodName: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  wTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceTertiary, marginTop: 4 },
  wFill: { height: 4, borderRadius: 2, backgroundColor: colors.brandPrimary },
  methodVal: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"], minWidth: 70, textAlign: "right" },
  methodW: { fontSize: 11, fontWeight: "700", color: colors.muted, width: 36, textAlign: "right" },
  iqToggle: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  iqToggleText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 13 },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  toggleBtn: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  toggleActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toggleText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  toggleTextActive: { color: colors.onBrandPrimary },
  health: { fontSize: 13, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  deLabel: { fontSize: 10, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  empty: { fontSize: 12, color: colors.muted, fontStyle: "italic" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontWeight: "700", color: colors.onSurface },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingTop: spacing.sm },
  group: { alignItems: "center", flex: 1 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  bar: { width: 12, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  qLabel: { fontSize: 10, color: colors.muted, fontWeight: "700", marginTop: 6, height: 16 },
  table: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginTop: spacing.md },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  th: { backgroundColor: colors.surfaceTertiary, borderTopWidth: 0 },
  td: { flex: 1, fontSize: 11, color: colors.onSurface, fontVariant: ["tabular-nums"], textAlign: "right" },
  tdHead: { fontSize: 10, color: colors.muted, fontWeight: "800" },
  note: { fontSize: 10, color: colors.muted, fontStyle: "italic", marginTop: spacing.sm, lineHeight: 14 },
}));

/** OptiIQ Value: intrinsic value per share, with % vs current price. */
export function OptiIQCard({ o }: { o: any }) {
  useTheme();
  if (!o || !o.available) {
    return (
      <View testID="optiiq-unavailable" style={s.iq}>
        <Text style={s.iqLabel}>OptiIQ Value</Text>
        <Text style={s.iqValue}>—</Text>
        <Text style={s.iqSmall}>{o?.reason || "Not available"}</Text>
      </View>
    );
  }
  const up = o.upside_pct >= 0;
  return (
    <View testID="optiiq-card" style={s.iq}>
      <Text style={s.iqLabel}>OptiIQ Value</Text>
      <View style={s.iqRow}>
        <Text testID="optiiq-value" style={s.iqValue}>${o.value}</Text>
        <Text testID="optiiq-upside" style={[s.iqTag, { color: up ? colors.success : colors.error, borderColor: up ? colors.success : colors.error }]}>
          {up ? "+" : ""}{o.upside_pct}% vs price
        </Text>
      </View>
    </View>
  );
}
