import React, { useState } from "react";
import { View, Text, Pressable, LayoutChangeEvent } from "react-native";
import Svg, { Line } from "react-native-svg";

import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

type Method = { key: string; label: string; short: string; value: number | null; vs_price_pct: number | null; note: string; skipped?: boolean };

const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TRACK_H = 14;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** Green well above the price, light green above it, amber just below, red well below (like the reference chart). */
const barColor = (v: number, price: number) => {
  const r = v / price;
  return r >= 1.2 ? colors.valueVeryUnder : r >= 1 ? colors.valueUnder : r >= 0.9 ? colors.valueOver : colors.valueVeryOver;
};

/** OptiIQ Value = the average of 9 valuation methods, shown as a bar per method with dashed lines at the price and the value. */
export function OptiIQChart({ o }: { o: any }) {
  useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const [w, setW] = useState(0);
  if (!o) return null;
  const methods: Method[] = o.methods || [];
  const price: number = o.price;
  const vals = methods.map((m) => m.value).filter((v): v is number => v != null);
  const max = Math.max(price || 0, o.value || 0, ...vals, 1) * 1.08;
  const x = (v: number) => (Math.max(v, 0) / max) * w;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const up = (o.upside_pct ?? 0) >= 0;
  const g = o.inputs?.growth;

  return (
    <View testID={o.available ? "optiiq-card" : "optiiq-unavailable"} style={s.card}>
      <Text style={s.kicker}>OptiIQ Value</Text>
      {o.available ? (
        <View style={s.row}>
          <Text testID="optiiq-value" style={s.value}>{usd(o.value)}</Text>
          <Text testID="optiiq-upside" style={[s.tag, { color: up ? colors.success : colors.error, borderColor: up ? colors.success : colors.error }]}>
            {pct(o.upside_pct)} vs price
          </Text>
        </View>
      ) : (
        <>
          <Text style={s.value}>—</Text>
          <Text style={s.small}>{o.reason || "Not available"}</Text>
        </>
      )}
      {o.confidence === "low" ? <Text style={s.warn}>{o.confidence_note}</Text> : null}

      {methods.length && price ? (
        <>
          <View style={s.legend}>
            <View style={[s.dash, { borderColor: colors.brandPrimary }]} />
            <Text style={s.legendText}>OptiIQ {o.available ? usd(o.value) : "—"}</Text>
            <View style={[s.dash, { borderColor: colors.onSurface }]} />
            <Text style={s.legendText}>Price {usd(price)}</Text>
          </View>
          <View testID="optiiq-chart" onLayout={onLayout} style={s.chart}>
            {methods.map((m) => {
              const has = m.value != null;
              const col = has ? barColor(m.value as number, price) : colors.muted;
              const isOpen = open === m.key;
              return (
                <Pressable key={m.key} testID={`optiiq-method-${m.key}`} onPress={() => setOpen(isOpen ? null : m.key)}
                  accessibilityRole="button" accessibilityState={{ expanded: isOpen }} style={s.method}>
                  <View style={s.mHead}>
                    <Text style={s.mLabel} numberOfLines={2}>{m.label} <Text style={s.mShort}>({m.short})</Text></Text>
                    <Text testID={`optiiq-method-${m.key}-value`} style={[s.mValue, { color: has ? col : colors.muted }]}>{has ? usd(m.value as number) : m.skipped ? "Skipped" : "n/a"}</Text>
                  </View>
                  <View style={s.track}>
                    {has && (m.value as number) > 0 ? <View style={[s.fill, { width: x(m.value as number), backgroundColor: col }]} /> : null}
                    {w ? (
                      <Svg width={w} height={TRACK_H} style={s.overlay} pointerEvents="none">
                        <Line x1={x(price)} x2={x(price)} y1={0} y2={TRACK_H} stroke={colors.onSurface} strokeWidth={1.5} strokeDasharray="3 2" />
                        {o.available ? <Line x1={x(o.value)} x2={x(o.value)} y1={0} y2={TRACK_H} stroke={colors.brandPrimary} strokeWidth={1.5} strokeDasharray="3 2" /> : null}
                      </Svg>
                    ) : null}
                  </View>
                  {isOpen ? (
                    <Text testID={`optiiq-method-${m.key}-note`} style={s.note}>
                      {m.note}{has && m.vs_price_pct != null ? ` → ${usd(m.value as number)}, ${pct(m.vs_price_pct)} vs price.` : ""}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={s.foot}>
            Average of {o.count} method{o.count === 1 ? "" : "s"}; zero and negative results count.
            {o.bank_or_insurer ? " Banks and insurers skip the 4 cash-flow methods." : ""} Tap a method to see how it&apos;s worked out.
            {g ? ` Growth ${(g.years_1_5 * 100).toFixed(1)}% (years 1–5), ${(g.years_6_10 * 100).toFixed(1)}% (6–10), ${(g.years_11_20 * 100).toFixed(1)}% (11–20)` : ""}
            {o.inputs?.discount_rate ? ` · discount rate ${(o.inputs.discount_rate * 100).toFixed(1)}% (beta ${o.inputs.beta != null ? Number(o.inputs.beta).toFixed(2) : "n/a"}).` : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const s = themedStyles((colors) => ({
  card: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.lg, marginBottom: spacing.md },
  kicker: { fontSize: 11, fontWeight: "800", color: colors.onBrandSecondary, textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 4 },
  value: { fontSize: 30, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  tag: { fontSize: 12, fontWeight: "800", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: "hidden" },
  small: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2 },
  warn: { fontSize: 11, color: colors.warning, marginTop: spacing.xs, lineHeight: 16 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, flexWrap: "wrap" },
  dash: { width: 16, height: 0, borderTopWidth: 2, borderStyle: "dashed" },
  legendText: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceSecondary, marginRight: spacing.sm },
  chart: { marginTop: spacing.sm },
  overlay: { position: "absolute", top: 0, left: 0 },
  method: { paddingVertical: 6, minHeight: 44, justifyContent: "center" },
  mHead: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginBottom: 4 },
  mLabel: { flex: 1, fontSize: 12, fontWeight: "700", color: colors.onSurface, lineHeight: 16 },
  mShort: { fontSize: 11, fontWeight: "600", color: colors.muted },
  mValue: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  track: { height: TRACK_H, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  fill: { height: TRACK_H, borderRadius: 4 },
  note: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 6, lineHeight: 16 },
  foot: { fontSize: 10, color: colors.muted, fontStyle: "italic", marginTop: spacing.sm, lineHeight: 15 },
}));
