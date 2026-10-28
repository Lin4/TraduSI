import React from "react";
import { View, Text } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { Stat } from "./screen";
import { money } from "./quantcharts";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pts`;
// within 5 pts = on target; beating the forecast is shown in the brand colour, falling short in red
const gapTone = (g: number) => (Math.abs(g) <= 5 ? colors.success : g > 0 ? colors.brandPrimary : g < -12 ? colors.error : colors.warning);

/** Week-by-week: share of settled picks that won vs the POP forecast shown when they were picked. */
export function WeeklyReport({ w }: { w?: any }) {
  useTheme();
  if (!w) return null;
  const weeks: any[] = w.weeks || [];
  const last = weeks[0];
  return (
    <View testID="weekly-report" style={s.box}>
      <View style={s.head}>
        <Icon name="calendar" size={15} color={colors.brandPrimary} />
        <Text style={s.title}>Weekly calibration report</Text>
      </View>
      {!last ? (
        <Text testID="weekly-empty" style={s.text}>No picks have settled yet. {w.settling_next_7d} open pick{w.settling_next_7d === 1 ? "" : "s"} settle in the next 7 days.</Text>
      ) : (
        <>
          <Text style={s.kicker}>{last.in_progress ? `This week so far (${day(last.week_of)}–${day(last.week_end)})` : `Week of ${day(last.week_of)}–${day(last.week_end)}`}</Text>
          <Text testID="weekly-summary" style={s.summary}>{w.summary}</Text>
          <View style={s.grid}>
            <Stat label="Won" value={`${last.realized}%`} tone={last.realized >= last.calibrated_pop - 5 ? "good" : "bad"} />
            <Stat label="Forecast" value={`${last.calibrated_pop}%`} />
            <Stat label="Gap" value={pts(last.gap)} tone={last.gap >= -5 ? "good" : "bad"} />
            <Stat label="P&L" value={money(last.pnl)} tone={last.pnl >= 0 ? "good" : "bad"} />
          </View>
          <Text style={s.weekSub}>Forecast = {last.calibrated_n ? `calibrated POP for ${last.calibrated_n} of ${last.n} picks, model POP for the rest` : "model POP (calibration not switched on for these picks yet)"}</Text>
          <View style={s.legend}>
            <View style={[s.dot, { backgroundColor: colors.borderStrong }]} /><Text style={s.legendText}>Forecast</Text>
            <View style={[s.dot, { backgroundColor: colors.brandPrimary }]} /><Text style={s.legendText}>Won</Text>
          </View>
          {weeks.map((wk) => (
            <View key={wk.week_of} testID={`week-${wk.week_of}`} style={s.week}>
              <View style={s.weekHead}>
                <Text style={s.weekLabel}>{day(wk.week_of)}{wk.in_progress ? " (so far)" : ""} · {wk.n} pick{wk.n === 1 ? "" : "s"}</Text>
                <Text style={[s.gap, { color: gapTone(wk.gap) }]}>{pts(wk.gap)}</Text>
              </View>
              <Bar pct={wk.calibrated_pop} color={colors.borderStrong} label={`${wk.calibrated_pop}%`} />
              <Bar pct={wk.realized} color={colors.brandPrimary} label={`${wk.realized}%`} />
              <Text style={s.weekSub}>
                Model POP {wk.model_pop}%{wk.calibrated_n ? ` · ${wk.calibrated_n} calibrated` : ""} · Brier {wk.brier} · {money(wk.pnl)}
              </Text>
            </View>
          ))}
          <Text style={s.note}>{w.settling_next_7d} open pick{w.settling_next_7d === 1 ? "" : "s"} settle in the next 7 days. {w.note}</Text>
        </>
      )}
    </View>
  );
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  useTheme();
  return (
    <View style={s.barRow}>
      <View style={s.track}><View style={[s.fill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} /></View>
      <Text style={s.barVal}>{label}</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  box: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  kicker: { fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  summary: { fontSize: 13, fontWeight: "700", color: colors.onSurface, lineHeight: 19 },
  text: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11, color: colors.muted, marginRight: spacing.sm },
  week: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, gap: 4 },
  weekHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weekLabel: { fontSize: 12, fontWeight: "800", color: colors.onSurface },
  gap: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  barVal: { width: 46, textAlign: "right", fontSize: 11, fontWeight: "700", color: colors.onSurfaceSecondary, fontVariant: ["tabular-nums"] },
  weekSub: { fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"] },
  note: { fontSize: 11, color: colors.muted, fontStyle: "italic", lineHeight: 16 },
}));
