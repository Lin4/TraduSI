import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Platform, ActivityIndicator } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";

import { api } from "./api";
import { toast } from "./Toast";
import { usePlan } from "./plans";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

const SVG_FONT = Platform.OS === "web" ? "Helvetica, Arial, sans-serif" : undefined;
const RANGES = [{ id: "6M", n: 126 }, { id: "1Y", n: 252 }, { id: "2Y", n: 0 }];
const LAYERS = [
  { id: "avg", label: "50/200-day avg" },
  { id: "fib", label: "Fibonacci" },
  { id: "rev", label: "Reversals" },
];
const H = 260, PAD_T = 14, PAD_B = 22;

const usd = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (t?: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : "");

/** Polyline points for a series with gaps (moving averages start after N days). */
const segments = (vals: (number | null)[], x: (i: number) => number, y: (v: number) => number) => {
  const out: string[] = [];
  let cur: string[] = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (cur.length > 1) out.push(cur.join(" "));
      cur = [];
    } else cur.push(`${x(i)},${y(v)}`);
  });
  if (cur.length > 1) out.push(cur.join(" "));
  return out;
};

/** Price history with moving averages, Fibonacci levels, reversal points, the intrinsic-value line and up to 4
 *  confluence buy levels; each level explains its signals and can become a buy alert. */
export function BuyLevelsChart({ r }: { r: any }) {
  useTheme();
  const router = useRouter();
  const plan = usePlan();
  const [w, setW] = useState(0);
  const [range, setRange] = useState("2Y");
  const [layers, setLayers] = useState<Record<string, boolean>>({ avg: true, fib: false, rev: true });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const levels: any[] = r.buy_levels || [];
  const iv: number | null = r.intrinsic_line?.value ?? null;
  const all: [number | null, number][] = r.price_history || [];
  const ov = r.buy_overlay || {};

  useEffect(() => {
    api("/api/alerts").then((a) => setAlerts(a.items || [])).catch(() => {});
  }, [r.ticker]);

  const n = RANGES.find((x) => x.id === range)?.n || all.length;
  const pts = all.slice(-n);
  if (pts.length < 2 || !levels.length) return null;
  const sma50: (number | null)[] = (ov.sma50 || []).slice(-n);
  const sma200: (number | null)[] = (ov.sma200 || []).slice(-n);

  const closes = pts.map((p) => p[1]);
  const avgVals = layers.avg ? [...sma50, ...sma200].filter((v): v is number => v != null) : [];
  let lo = Math.min(...closes, ...levels.map((l) => l.price), ...avgVals) * 0.97;
  let hi = Math.max(...closes, iv || 0, ...avgVals) * 1.03;
  if (lo >= hi) { lo *= 0.9; hi *= 1.1; }
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo || 1)) * (H - PAD_T - PAD_B);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const last = closes[closes.length - 1];
  const idx = new Map(pts.map((p, i) => [p[0], i]));
  const fibs: any[] = layers.fib ? (ov.fib?.levels || []).filter((f: any) => f.price > lo && f.price < hi) : [];
  const revs: any[] = layers.rev ? (ov.reversals || []).filter((p: any) => idx.has(p[0])) : [];

  const isSet = (price: number) => alerts.some((a) => a.ticker === r.ticker && a.kind === "price_below" && a.active && Math.abs(a.threshold - price) < 0.01);

  const setAlert = async (l: any) => {
    if (alerts.length >= plan.features.alerts) {
      toast(`Alert limit reached (${plan.features.alerts}). Upgrade for more.`, "error");
      router.push("/upgrade" as any);
      return;
    }
    setBusy(l.label);
    try {
      const a = await api("/api/alerts/add", { method: "POST", body: JSON.stringify({ ticker: r.ticker, kind: "price_below", threshold: l.price, note: `Buy level ${l.label}` }) });
      setAlerts((cur) => [a, ...cur]);
      toast(`Buy alert set: ${r.ticker} at ${usd(l.price)}`, "success");
    } catch (e: any) { toast(e.message || "Couldn't set the alert", "error"); } finally { setBusy(null); }
  };

  return (
    <View testID="buy-levels">
      <Text style={s.section}>Intrinsic value & buy levels</Text>
      {r.buy_summary ? (
        <View testID="buy-summary" style={s.summary}>
          <Icon name="target" size={16} color={colors.brandPrimary} />
          <Text style={s.summaryText}>{r.buy_summary}</Text>
        </View>
      ) : null}
      <View style={s.ranges}>
        {RANGES.map((o) => (
          <Pressable key={o.id} testID={`bl-range-${o.id}`} onPress={() => setRange(o.id)} style={[s.range, range === o.id && s.rangeActive]}>
            <Text style={[s.rangeText, range === o.id && s.rangeTextActive]}>{o.id}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.ranges}>
        {LAYERS.map((o) => (
          <Pressable key={o.id} testID={`bl-layer-${o.id}`} onPress={() => setLayers((cur) => ({ ...cur, [o.id]: !cur[o.id] }))} style={[s.layer, layers[o.id] && s.layerOn]}>
            <Icon name={layers[o.id] ? "check" : "plus"} size={12} color={layers[o.id] ? colors.brandPrimary : colors.muted} />
            <Text style={[s.layerText, layers[o.id] && s.layerTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <View testID="buy-levels-chart" onLayout={(e) => setW(e.nativeEvent.layout.width)} style={s.chart}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            {fibs.map((f) => (
              <React.Fragment key={f.ratio}>
                <Line x1={0} x2={w} y1={y(f.price)} y2={y(f.price)} stroke={colors.chartFib} strokeWidth={1} strokeDasharray="1 4" />
                <SvgText x={w / 2} y={y(f.price) - 3} fontSize={9} textAnchor="middle" fontFamily={SVG_FONT} fill={colors.chartFib}>{`${(f.ratio * 100).toFixed(1)}%`}</SvgText>
              </React.Fragment>
            ))}
            {iv ? <Line x1={0} x2={w} y1={y(iv)} y2={y(iv)} stroke={colors.chartValue} strokeWidth={1.6} strokeDasharray="6 4" /> : null}
            {levels.map((l) => <Line key={l.label} x1={0} x2={w} y1={y(l.price)} y2={y(l.price)} stroke={colors.valueUnder} strokeWidth={1.2} strokeDasharray="3 3" />)}
            {layers.avg ? segments(sma200, x, y).map((p, i) => <Polyline key={`a200-${i}`} points={p} fill="none" stroke={colors.chartMa200} strokeWidth={1.3} />) : null}
            {layers.avg ? segments(sma50, x, y).map((p, i) => <Polyline key={`a50-${i}`} points={p} fill="none" stroke={colors.chartMa50} strokeWidth={1.1} />) : null}
            <Polyline points={closes.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={colors.brandPrimary} strokeWidth={1.8} strokeLinejoin="round" />
            {revs.map((p, i) => (
              <Circle key={`rv-${i}`} cx={x(idx.get(p[0]) as number)} cy={y(p[1])} r={3} fill={colors.surface} stroke={p[2] === "low" ? colors.valueUnder : colors.chartMa50} strokeWidth={1.5} />
            ))}
            <Circle cx={x(closes.length - 1)} cy={y(last)} r={3.5} fill={colors.brandPrimary} />
            {iv ? <Label x={w - 4} y={levels.some((l) => Math.abs(y(l.price) - y(iv)) < 16) ? y(iv) + 16 : y(iv)} end text={`Intrinsic ${usd(iv)}`} color={colors.chartValue} /> : null}
            {levels.map((l, i) => <Label key={l.label} x={i % 2 ? w - 4 : 4} y={y(l.price)} end={i % 2 === 1} text={`${l.label} ${usd(l.price)}`} color={colors.valueVeryUnder} />)}
            <SvgText x={4} y={H - 6} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted}>{day(pts[0][0])}</SvgText>
            <SvgText x={w - 4} y={H - 6} fontSize={9} textAnchor="end" fontFamily={SVG_FONT} fill={colors.muted}>{day(pts[pts.length - 1][0])}</SvgText>
          </Svg>
        ) : null}
      </View>
      <View style={s.legend}>
        <Key color={colors.brandPrimary} text={`Price ${usd(last)}`} />
        {iv ? <Key color={colors.chartValue} text={r.intrinsic_line?.source || "Intrinsic value"} /> : null}
        <Key color={colors.valueUnder} text="Buy levels" />
        {layers.avg ? <Key color={colors.chartMa50} text="50-day avg" /> : null}
        {layers.avg ? <Key color={colors.chartMa200} text="200-day avg" /> : null}
        {layers.rev ? <Key color={colors.valueUnder} dot text="Reversal point" /> : null}
      </View>

      {levels.map((l) => {
        const on = isSet(l.price);
        const st = l.strength === "Strong" ? { bg: colors.brandTertiary, fg: colors.onBrandTertiary } : l.strength === "Moderate" ? { bg: colors.warnBg, fg: colors.onWarnBg } : { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary };
        return (
          <View key={l.label} testID={`buy-level-${l.label}`} style={s.row}>
            <View style={s.rowTop}>
              <View style={s.tag}><Text style={s.tagText}>{l.label}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.price}>{usd(l.price)} <Text style={s.pct}>{l.below_price_pct}% from price</Text></Text>
                <View style={s.metaRow}>
                  {l.strength ? <Text testID={`buy-level-strength-${l.label}`} numberOfLines={1} style={[s.strength, { backgroundColor: st.bg, color: st.fg }]}>{l.strength}</Text> : null}
                  {l.below_value_pct != null ? <Text style={s.meta}>{l.below_value_pct}% vs intrinsic</Text> : null}
                </View>
              </View>
              <Pressable testID={`buy-alert-${l.label}`} disabled={on || busy === l.label} onPress={() => setAlert(l)} style={[s.btn, on && s.btnOn]}>
                {busy === l.label ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                  <>
                    <Icon name={on ? "check" : "bell"} size={13} color={on ? colors.onBrandTertiary : colors.onBrandPrimary} />
                    <Text style={[s.btnText, on && s.btnTextOn]}>{on ? "Alert on" : "Buy alert"}</Text>
                  </>
                )}
              </Pressable>
            </View>
            <View testID={`buy-level-reasons-${l.label}`} style={s.reasons}>
              {(l.reasons || []).map((t: string) => (
                <View key={t} style={s.reason}>
                  <View style={s.bullet} />
                  <Text style={s.reasonText}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
      <Text style={s.note}>
        Each level is a zone where several signals agree: past reversal points, the 50/100/200-day averages, Fibonacci retracements of the main 2-year swing, the 52-week low and the OptiIQ Value. More agreeing signals means a stronger level. Buy alerts notify you when the price drops to a level (checked every 2 min in market hours). TraduSI does not place orders. Research only, not investment advice.
      </Text>
    </View>
  );
}

function Key({ color, text, dot }: { color: string; text: string; dot?: boolean }) {
  useTheme();
  return (
    <View style={s.legendItem}>
      <View style={dot ? [s.keyDot, { borderColor: color }] : [s.swatch, { backgroundColor: color }]} />
      <Text style={s.legendText}>{text}</Text>
    </View>
  );
}

/** Line label on a small background so it stays readable over the price line. */
function Label({ x, y, text, color, end }: { x: number; y: number; text: string; color: string; end?: boolean }) {
  useTheme();
  const tw = text.length * 5.6 + 8;
  return (
    <>
      <Rect x={end ? x - tw : x} y={y - 15} width={tw} height={13} rx={3} fill={colors.surface} opacity={0.9} />
      <SvgText x={end ? x - 4 : x + 4} y={y - 5} fontSize={10} fontWeight="700" textAnchor={end ? "end" : "start"} fontFamily={SVG_FONT} fill={color}>{text}</SvgText>
    </>
  );
}

const s = themedStyles((colors) => ({
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md, marginBottom: 4 },
  summary: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  summaryText: { flex: 1, fontSize: 13, color: colors.onSurface, lineHeight: 19 },
  ranges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.sm },
  range: { height: 30, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  rangeActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rangeText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  rangeTextActive: { color: colors.onBrandPrimary },
  layer: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  layerOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  layerText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  layerTextOn: { color: colors.onBrandSecondary },
  chart: { height: H, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  keyDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  legendText: { fontSize: 11, color: colors.onSurfaceSecondary },
  row: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tag: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.valueVeryUnderBg, alignItems: "center", justifyContent: "center" },
  tagText: { fontSize: 12, fontWeight: "800", color: colors.valueVeryUnder },
  price: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  pct: { fontSize: 12, fontWeight: "600", color: colors.muted },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: 3 },
  strength: { flexShrink: 0, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  meta: { flexShrink: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  reasons: { marginTop: 6, marginLeft: 42, gap: 3 },
  reason: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.valueUnder, marginTop: 6 },
  reasonText: { flex: 1, fontSize: 11, color: colors.onSurfaceSecondary, lineHeight: 16 },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, height: 44, minWidth: 96, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  btnOn: { backgroundColor: colors.brandTertiary },
  btnText: { fontSize: 12, fontWeight: "800", color: colors.onBrandPrimary },
  btnTextOn: { color: colors.onBrandTertiary },
  note: { fontSize: 11, color: colors.muted, marginTop: spacing.sm, lineHeight: 16 },
}));
