import React, { useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

import { colors, spacing, themedStyles, useTheme } from "./theme";

const SVG_FONT = Platform.OS === "web" ? "Helvetica, Arial, sans-serif" : undefined;

export const money = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`);
export const signed = (v: number) => `${v > 0 ? "+" : ""}${money(v)}`;
export const tone = (v: number) => (v >= 70 ? colors.success : v >= 50 ? colors.warning : colors.error);

/** Circular 0-100 score. */
export function ScoreRing({ score, size = 76, testID }: { score: number; size?: number; testID?: string }) {
  useTheme();
  const sw = 7;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const col = tone(score);
  const mid = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={mid} cy={mid} r={r} stroke={colors.surfaceTertiary} strokeWidth={sw} fill="none" />
        <Circle cx={mid} cy={mid} r={r} stroke={col} strokeWidth={sw} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
          transform={`rotate(-90 ${mid} ${mid})`} />
      </Svg>
      <Text testID={testID} style={[s.ringNum, { color: col, fontSize: size * 0.32 }]}>{score}</Text>
      <Text style={s.ringOf}>/100</Text>
    </View>
  );
}

type Series = { data: number[]; color: string; label: string; dashed?: boolean };

/** Cumulative P&L lines with a zero baseline. */
export function EquityCurve({ series, height = 120, testID }: { series: Series[]; height?: number; testID?: string }) {
  useTheme();
  const [w, setW] = useState(0);
  const rows = series.filter((x) => x.data && x.data.length > 1);
  if (!rows.length) return null;
  const all = rows.flatMap((x) => x.data);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const pad = 8;
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (height - 2 * pad);
  const x = (i: number, n: number) => (i / (n - 1)) * w;
  return (
    <View testID={testID} style={{ marginTop: spacing.sm }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[s.chartBox, { height }]}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            <Line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke={colors.borderStrong} strokeDasharray="4 4" strokeWidth={1} />
            {rows.map((sr) => (
              <Polyline key={sr.label} points={sr.data.map((v, i) => `${x(i, sr.data.length)},${y(v)}`).join(" ")}
                fill="none" stroke={sr.color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={sr.dashed ? "5 4" : undefined} />
            ))}
            <SvgText x={4} y={12} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted}>{money(hi)}</SvgText>
            <SvgText x={4} y={height - 3} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted}>{money(lo)}</SvgText>
          </Svg>
        ) : null}
      </View>
      <View style={s.legend}>
        {rows.map((sr) => {
          const last = sr.data[sr.data.length - 1];
          return (
            <View key={sr.label} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: sr.color }]} />
              <Text style={s.legendText}>{sr.label} <Text style={{ color: last >= 0 ? colors.success : colors.error, fontWeight: "800" }}>{signed(last)}</Text></Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type Bucket = { range: string; n: number; predicted: number; realized: number; gap: number };

/** Predicted POP (x) vs realized win rate (y). Dots on the diagonal = perfectly calibrated. */
export function CalibrationChart({ buckets, testID }: { buckets: Bucket[]; testID?: string }) {
  useTheme();
  const [w, setW] = useState(0);
  if (!buckets?.length) return null;
  const h = 210, padL = 30, padR = 10, padT = 10, padB = 26;
  const lo = 50, hi = 100;
  const cl = (v: number) => Math.max(lo, Math.min(hi, v));
  const X = (v: number) => padL + ((cl(v) - lo) / (hi - lo)) * (w - padL - padR);
  const Y = (v: number) => padT + ((hi - cl(v)) / (hi - lo)) * (h - padT - padB);
  const maxN = Math.max(1, ...buckets.map((b) => b.n));
  const ticks = [50, 60, 70, 80, 90, 100];
  return (
    <View testID={testID} style={{ marginTop: spacing.sm }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[s.chartBox, { height: h }]}>
        {w > 0 ? (
          <Svg width={w} height={h}>
            {ticks.map((t) => (
              <React.Fragment key={t}>
                <Line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke={colors.divider} strokeWidth={1} />
                <SvgText x={padL - 4} y={Y(t) + 3} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted} textAnchor="end">{t}</SvgText>
                <SvgText x={X(t)} y={h - 10} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted} textAnchor="middle">{t}</SvgText>
              </React.Fragment>
            ))}
            <Line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke={colors.brandPrimary} strokeDasharray="5 4" strokeWidth={1.5} />
            {buckets.map((b) => {
              const col = Math.abs(b.gap) <= 5 ? colors.success : b.gap < -10 ? colors.error : colors.warning;
              return (
                <Circle key={b.range} cx={X(b.predicted)} cy={Y(b.realized)} r={4 + 8 * Math.sqrt(b.n / maxN)}
                  fill={col} fillOpacity={0.8} stroke={colors.surface} strokeWidth={1.5} />
              );
            })}
            <SvgText x={(padL + w - padR) / 2} y={h - 1} fontSize={9} fontFamily={SVG_FONT} fill={colors.muted} textAnchor="middle">Predicted POP %</SvgText>
          </Svg>
        ) : null}
      </View>
      <Text style={s.caption}>Y-axis = how often picks really won. Dots above the dashed line beat their prediction; below it the model was too optimistic. Bigger dot = more trades.</Text>
    </View>
  );
}

/** Horizontal 0-100 bar with optional caption ends. */
export function Gauge({ value, left, right, testID }: { value: number; left?: string; right?: string; testID?: string }) {
  useTheme();
  const v = Math.max(0, Math.min(100, value));
  return (
    <View testID={testID} style={{ marginTop: 6 }}>
      <View style={s.gTrack}>
        <View style={[s.gFill, { width: `${Math.max(3, v)}%` as any, backgroundColor: tone(v) }]} />
      </View>
      {left || right ? (
        <View style={s.gEnds}>
          <Text style={s.gEnd}>{left}</Text>
          <Text style={s.gEnd}>{right}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = themedStyles((colors) => ({
  ringNum: { fontWeight: "900", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  ringOf: { fontSize: 9, color: colors.muted, marginTop: -2, fontWeight: "700" },
  chartBox: { backgroundColor: colors.surfaceSecondary, borderRadius: 10, overflow: "hidden" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: colors.onSurfaceSecondary, fontVariant: ["tabular-nums"] },
  caption: { fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 15 },
  gTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  gFill: { height: 8, borderRadius: 4 },
  gEnds: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  gEnd: { fontSize: 10, color: colors.muted },
}));
