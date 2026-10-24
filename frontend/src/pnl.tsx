import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Line, Polyline, Circle, Text as SvgText } from "react-native-svg";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export const money = (v: number | null | undefined) => {
  if (v == null) return "∞";
  const a = Math.abs(v);
  const sgn = v < 0 ? "-" : v > 0 ? "+" : "";
  return a >= 1000 ? `${sgn}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `${sgn}$${Math.round(a)}`;
};

type Pt = { price: number; expiry: number; today: number };

/** P&L by underlying price: expiration (green above / red below zero) and today (dashed). */
export function PnLChart({ curve, price, breakevens }: { curve: Pt[]; price: number; breakevens: number[] }) {
  useTheme();
  const [w, setW] = useState(0);
  const h = 200, padL = 8, padR = 8, padT = 16, padB = 22;
  const geo = useMemo(() => {
    if (!curve.length || !w) return null;
    const xs = curve.map((p) => p.price);
    const ys = curve.flatMap((p) => [p.expiry, p.today]).concat(0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = maxY - minY || 1;
    const X = (v: number) => padL + ((v - minX) / (maxX - minX || 1)) * (w - padL - padR);
    const Y = (v: number) => padT + (1 - (v - minY) / span) * (h - padT - padB);
    return { X, Y, minX, maxX, minY, maxY };
  }, [curve, w]);

  return (
    <View testID="pnl-chart" style={st.chartBox} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {geo ? (
        <Svg width={w} height={h}>
          <Line x1={padL} x2={w - padR} y1={geo.Y(0)} y2={geo.Y(0)} stroke={colors.borderStrong} strokeWidth={1} />
          <Line x1={geo.X(price)} x2={geo.X(price)} y1={padT} y2={h - padB} stroke={colors.muted} strokeDasharray="3,3" />
          <SvgText x={geo.X(price)} y={h - 6} fontSize={10} fill={colors.onSurfaceSecondary} textAnchor="middle">${price}</SvgText>
          {curve.slice(1).map((p, i) => {
            const a = curve[i];
            const pos = (a.expiry + p.expiry) / 2 >= 0;
            return <Line key={i} x1={geo.X(a.price)} y1={geo.Y(a.expiry)} x2={geo.X(p.price)} y2={geo.Y(p.expiry)}
              stroke={pos ? colors.success : colors.error} strokeWidth={2.5} />;
          })}
          <Polyline points={curve.map((p) => `${geo.X(p.price)},${geo.Y(p.today)}`).join(" ")} fill="none"
            stroke={colors.brandPrimary} strokeWidth={1.5} strokeDasharray="5,4" />
          {breakevens.filter((b) => b >= geo.minX && b <= geo.maxX).map((b) => (
            <React.Fragment key={b}>
              <Circle cx={geo.X(b)} cy={geo.Y(0)} r={4} fill={colors.surface} stroke={colors.onSurface} strokeWidth={1.5} />
              <SvgText x={geo.X(b)} y={geo.Y(0) - 8} fontSize={10} fontWeight="700" fill={colors.onSurface} textAnchor="middle">{b}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={padL + 2} y={padT - 4} fontSize={10} fill={colors.success} fontWeight="700">{money(geo.maxY)}</SvgText>
          <SvgText x={padL + 2} y={h - padB + 12} fontSize={10} fill={colors.error} fontWeight="700">{money(geo.minY)}</SvgText>
        </Svg>
      ) : null}
      <View style={st.legend}>
        <View style={[st.dot, { backgroundColor: colors.success }]} /><Text style={st.legendText}>At expiration</Text>
        <View style={[st.dash, { borderColor: colors.brandPrimary }]} /><Text style={st.legendText}>Today</Text>
      </View>
    </View>
  );
}

type Heat = { columns: { date: string; days_left: number }[]; rows: { move_pct: number; price: number; pnl: number[] }[] };

/** Price move (rows) × date (columns) P&L grid, green = profit, red = loss. */
export function PnLHeatmap({ data }: { data: Heat }) {
  useTheme();
  const maxAbs = Math.max(1, ...data.rows.flatMap((r) => r.pnl.map(Math.abs)));
  return (
    <View testID="pnl-heatmap" style={st.heat}>
      <View style={st.heatRow}>
        <Text style={[st.heatLabel, st.heatHead]}>Price</Text>
        {data.columns.map((c, i) => (
          <Text key={c.date} style={[st.heatCellText, st.heatHead, { flex: 1 }]}>
            {i === data.columns.length - 1 ? "Exp" : c.date.slice(5).replace("-", "/")}
          </Text>
        ))}
      </View>
      {data.rows.map((r) => (
        <View key={r.move_pct} style={st.heatRow}>
          <View style={st.heatLabel}>
            <Text style={[st.heatPrice, r.move_pct === 0 && { color: colors.brandPrimary }]}>${r.price.toFixed(0)}</Text>
            <Text style={st.heatMove}>{r.move_pct > 0 ? "+" : ""}{r.move_pct}%</Text>
          </View>
          {r.pnl.map((v, i) => {
            const a = Math.min(1, Math.abs(v) / maxAbs);
            const strong = a > 0.45;
            const base = v >= 0 ? colors.success : colors.error;
            return (
              <View key={i} testID={`heat-${r.move_pct}-${i}`} style={st.heatCell}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: base, opacity: 0.12 + a * 0.78, borderRadius: 4 }]} />
                <Text style={[st.heatCellText, { color: strong ? (v >= 0 ? colors.onSuccess : colors.onError) : base }]}>{money(v)}</Text>
              </View>
            );
          })}
        </View>
      ))}
      <Text style={st.heatNote}>P&L per position after fees · rows = stock price, columns = date</Text>
    </View>
  );
}

const st = themedStyles((colors) => ({
  chartBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, marginBottom: spacing.md },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, marginTop: 4 },
  dot: { width: 10, height: 3, borderRadius: 2 },
  dash: { width: 12, height: 0, borderTopWidth: 2, borderStyle: "dashed", marginLeft: spacing.sm },
  legendText: { fontSize: 11, color: colors.onSurfaceSecondary },
  heat: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.md },
  heatRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 3 },
  heatLabel: { width: 54 },
  heatHead: { fontSize: 10, fontWeight: "700", color: colors.muted, textAlign: "center" },
  heatPrice: { fontSize: 11, fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  heatMove: { fontSize: 9, color: colors.muted },
  heatCell: { flex: 1, height: 32, alignItems: "center", justifyContent: "center" },
  heatCellText: { fontSize: 10.5, fontWeight: "800", fontVariant: ["tabular-nums"] },
  heatNote: { fontSize: 10, color: colors.muted, marginTop: 4, textAlign: "center" },
}));

/** Day-by-day P&L line for a saved strategy (one point per day). */
export function DailyPnLChart({ points }: { points: { date: string; pnl: number }[] }) {
  useTheme();
  const [w, setW] = useState(0);
  const h = 110, pad = 14;
  const geo = useMemo(() => {
    if (!w || !points.length) return null;
    const ys = points.map((p) => p.pnl).concat(0);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const X = (i: number) => (points.length === 1 ? w / 2 : pad + (i / (points.length - 1)) * (w - pad * 2));
    const Y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
    return { X, Y };
  }, [w, points]);
  const last = points[points.length - 1];
  return (
    <View testID="daily-pnl-chart" style={st.chartBox} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      {geo ? (
        <Svg width={w} height={h}>
          <Line x1={pad} x2={w - pad} y1={geo.Y(0)} y2={geo.Y(0)} stroke={colors.borderStrong} strokeDasharray="3,3" />
          {points.slice(1).map((p, i) => (
            <Line key={p.date} x1={geo.X(i)} y1={geo.Y(points[i].pnl)} x2={geo.X(i + 1)} y2={geo.Y(p.pnl)}
              stroke={(points[i].pnl + p.pnl) / 2 >= 0 ? colors.success : colors.error} strokeWidth={2.5} />
          ))}
          {points.map((p, i) => (
            <Circle key={p.date} cx={geo.X(i)} cy={geo.Y(p.pnl)} r={i === points.length - 1 ? 4.5 : 2.5}
              fill={p.pnl >= 0 ? colors.success : colors.error} />
          ))}
          <SvgText x={Math.min(geo.X(points.length - 1), w - 30)} y={Math.max(geo.Y(last.pnl) - 8, 10)} fontSize={11} fontWeight="800"
            fill={last.pnl >= 0 ? colors.success : colors.error} textAnchor="middle">{money(last.pnl)}</SvgText>
        </Svg>
      ) : null}
      <View style={st.legend}>
        <Text style={st.legendText}>{points.length === 1 ? "Day 1 · a new point is added each day" : `${points[0].date.slice(5)} → ${last.date.slice(5)} · daily P&L`}</Text>
      </View>
    </View>
  );
}
