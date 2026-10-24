import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";

import { api } from "./api";
import { toast } from "./Toast";
import { usePlan } from "./plans";
import { colors, spacing, radius } from "./theme";

const SVG_FONT = Platform.OS === "web" ? "Helvetica, Arial, sans-serif" : undefined;
const RANGES = [{ id: "6M", n: 126 }, { id: "1Y", n: 252 }, { id: "2Y", n: 0 }];
const H = 250, PAD_T = 14, PAD_B = 22;

const usd = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (t?: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : "");
const fullDay = (d?: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/** Price history with the intrinsic-value line and 4 support-based buy levels below it; each level can become a buy alert. */
export function BuyLevelsChart({ r }: { r: any }) {
  const router = useRouter();
  const plan = usePlan();
  const [w, setW] = useState(0);
  const [range, setRange] = useState("2Y");
  const [alerts, setAlerts] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const levels: any[] = r.buy_levels || [];
  const iv: number | null = r.intrinsic_line?.value ?? null;
  const all: [number | null, number][] = r.price_history || [];

  useEffect(() => {
    api("/api/alerts").then((a) => setAlerts(a.items || [])).catch(() => {});
  }, [r.ticker]);

  const n = RANGES.find((x) => x.id === range)?.n || all.length;
  const pts = all.slice(-n);
  if (pts.length < 2 || !levels.length) return null;

  const closes = pts.map((p) => p[1]);
  const lo = Math.min(...closes, ...levels.map((l) => l.price)) * 0.97;
  const hi = Math.max(...closes, iv || 0) * 1.03;
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo || 1)) * (H - PAD_T - PAD_B);
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const last = closes[closes.length - 1];

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
      <View style={s.ranges}>
        {RANGES.map((o) => (
          <Pressable key={o.id} testID={`bl-range-${o.id}`} onPress={() => setRange(o.id)} style={[s.range, range === o.id && s.rangeActive]}>
            <Text style={[s.rangeText, range === o.id && s.rangeTextActive]}>{o.id}</Text>
          </Pressable>
        ))}
      </View>
      <View testID="buy-levels-chart" onLayout={(e) => setW(e.nativeEvent.layout.width)} style={s.chart}>
        {w > 0 ? (
          <Svg width={w} height={H}>
            {iv ? <Line x1={0} x2={w} y1={y(iv)} y2={y(iv)} stroke={colors.chartValue} strokeWidth={1.6} strokeDasharray="6 4" /> : null}
            {levels.map((l) => <Line key={l.label} x1={0} x2={w} y1={y(l.price)} y2={y(l.price)} stroke={colors.valueUnder} strokeWidth={1.2} strokeDasharray="3 3" />)}
            <Polyline points={closes.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={colors.brandPrimary} strokeWidth={1.8} strokeLinejoin="round" />
            <Circle cx={x(closes.length - 1)} cy={y(last)} r={3.5} fill={colors.brandPrimary} />
            {iv ? <Label x={w - 4} y={y(iv)} end text={`Intrinsic ${usd(iv)}`} color={colors.chartValue} /> : null}
            {levels.map((l, i) => <Label key={l.label} x={i % 2 ? w - 4 : 4} y={y(l.price)} end={i % 2 === 1} text={`${l.label} ${usd(l.price)}`} color={colors.valueVeryUnder} />)}
            <SvgText x={4} y={H - 6} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted}>{day(pts[0][0])}</SvgText>
            <SvgText x={w - 4} y={H - 6} fontSize={9} textAnchor="end" fontFamily={SVG_FONT} fill={colors.muted}>{day(pts[pts.length - 1][0])}</SvgText>
          </Svg>
        ) : null}
      </View>
      <View style={s.legend}>
        <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: colors.brandPrimary }]} /><Text style={s.legendText}>Price {usd(last)}</Text></View>
        {iv ? <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: colors.chartValue }]} /><Text style={s.legendText}>{r.intrinsic_line?.source || "Intrinsic value"}</Text></View> : null}
        <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: colors.valueUnder }]} /><Text style={s.legendText}>Buy levels</Text></View>
      </View>

      {levels.map((l) => {
        const on = isSet(l.price);
        return (
          <View key={l.label} testID={`buy-level-${l.label}`} style={s.row}>
            <View style={s.tag}><Text style={s.tagText}>{l.label}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.price}>{usd(l.price)} <Text style={s.pct}>{l.below_price_pct}% from price</Text></Text>
              <Text style={s.why}>
                {l.source === "history"
                  ? `Support: bounced ${l.touches}× · last ${fullDay(l.last_touch)}`
                  : `${l.step_pct}% step below ${l.step_from === "value" ? "intrinsic value" : "price"}`}
                {l.below_value_pct != null ? ` · ${l.below_value_pct}% vs intrinsic` : ""}
              </Text>
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
        );
      })}
      <Text style={s.note}>Buy alerts notify you when the price drops to a level (checked every 2 min in market hours) and show in the Alerts tab. TraduSI does not place orders. Research only, not investment advice.</Text>
    </View>
  );
}

/** Line label on a small background so it stays readable over the price line. */
function Label({ x, y, text, color, end }: { x: number; y: number; text: string; color: string; end?: boolean }) {
  const tw = text.length * 5.6 + 8;
  return (
    <>
      <Rect x={end ? x - tw : x} y={y - 15} width={tw} height={13} rx={3} fill={colors.surface} opacity={0.9} />
      <SvgText x={end ? x - 4 : x + 4} y={y - 5} fontSize={10} fontWeight="700" textAnchor={end ? "end" : "start"} fontFamily={SVG_FONT} fill={color}>{text}</SvgText>
    </>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md, marginBottom: 4 },
  ranges: { flexDirection: "row", gap: 6, marginBottom: spacing.sm },
  range: { height: 30, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  rangeActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rangeText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  rangeTextActive: { color: colors.onBrandPrimary },
  chart: { height: H, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  tag: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.valueVeryUnderBg, alignItems: "center", justifyContent: "center" },
  tagText: { fontSize: 12, fontWeight: "800", color: colors.valueVeryUnder },
  price: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  pct: { fontSize: 12, fontWeight: "600", color: colors.muted },
  why: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 15 },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, height: 36, minWidth: 96, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  btnOn: { backgroundColor: colors.brandTertiary },
  btnText: { fontSize: 12, fontWeight: "800", color: colors.onBrandPrimary },
  btnTextOn: { color: colors.onBrandTertiary },
  note: { fontSize: 11, color: colors.muted, marginTop: spacing.sm, lineHeight: 16 },
});
