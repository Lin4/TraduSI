import React, { useMemo } from "react";
import { View, Text } from "react-native";
import { colors, radius, spacing, themedStyles, useTheme } from "./theme";

type Leg = { action: string; type: string; strike: number; qty?: number };

/** Analytical P&L at expiration for standard options strategies.
 *  Returns value PER CONTRACT (multiplied by 100).
 */
function payoffAt(S: number, legs: Leg[], netPremium: number): number {
  // netPremium > 0 = credit received; < 0 = debit paid
  let totalIntrinsic = 0;
  for (const l of legs) {
    const t = l.type.toLowerCase();
    const sign = l.action.toLowerCase() === "buy" ? 1 : -1;
    const intrinsic = t === "stock" ? S - l.strike : t === "call" ? Math.max(S - l.strike, 0) : Math.max(l.strike - S, 0);
    totalIntrinsic += sign * intrinsic * (l.qty ?? 1);
  }
  return (netPremium + totalIntrinsic) * 100;
}

export function PayoffChart({
  legs,
  premiumNet,
  currentPrice,
  breakevens = [],
  maxProfit,
  maxLoss,
  width = 320,
  height = 160,
}: {
  legs: Leg[];
  premiumNet: number;
  currentPrice: number;
  breakevens?: number[];
  maxProfit?: number | null;
  maxLoss?: number | null;
  width?: number;
  height?: number;
}) {
  useTheme();
  const { points, minY, maxY, minX, maxX } = useMemo(() => {
    const strikes = legs.map((l) => l.strike);
    const lo = Math.min(...strikes, currentPrice) * 0.85;
    const hi = Math.max(...strikes, currentPrice) * 1.15;
    const steps = 60;
    const arr: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const S = lo + ((hi - lo) * i) / steps;
      arr.push({ x: S, y: payoffAt(S, legs, premiumNet) });
    }
    const ys = arr.map((p) => p.y);
    return { points: arr, minY: Math.min(...ys), maxY: Math.max(...ys), minX: lo, maxX: hi };
  }, [legs, premiumNet, currentPrice]);

  // Pad Y range symmetrically a bit
  const yPad = Math.max(Math.abs(minY), Math.abs(maxY)) * 0.1 || 10;
  const y0 = minY - yPad;
  const y1 = maxY + yPad;
  const yRange = y1 - y0 || 1;
  const xRange = maxX - minX || 1;
  const zeroY = height - ((0 - y0) / yRange) * height;

  const scaledPts = points.map((p) => ({
    x: ((p.x - minX) / xRange) * width,
    y: height - ((p.y - y0) / yRange) * height,
    v: p.y,
  }));

  const currentX = ((currentPrice - minX) / xRange) * width;

  return (
    <View style={[styles.wrap, { width, height: height + 40 }]}>
      {/* Zero line */}
      <View style={[styles.zeroLine, { top: zeroY, width }]} />
      {/* Fill above/below zero */}
      {scaledPts.slice(0, -1).map((p, i) => {
        const n = scaledPts[i + 1];
        const positive = p.v >= 0 && n.v >= 0;
        const negative = p.v < 0 && n.v < 0;
        const color = positive ? colors.success : negative ? colors.error : colors.muted;
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: length,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: "left center" as any,
            }}
          />
        );
      })}

      {/* Current price marker */}
      <View style={[styles.currentLine, { left: currentX, height }]} />
      <Text style={[styles.currentLabel, { left: Math.max(0, Math.min(currentX - 20, width - 50)) }]}>
        ${currentPrice.toFixed(0)}
      </Text>

      {/* Breakeven markers */}
      {breakevens.map((be, i) => {
        const bx = ((be - minX) / xRange) * width;
        if (bx < 0 || bx > width) return null;
        return (
          <View key={i} style={[styles.beDot, { left: bx - 4, top: zeroY - 4 }]} />
        );
      })}

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={styles.legendText}>Profit zone</Text>
          <View style={{ width: 10 }} />
          <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
          <Text style={styles.legendText}>Loss zone</Text>
          <View style={{ width: 10 }} />
          <View style={styles.beDotLegend} />
          <Text style={styles.legendText}>Breakeven</Text>
        </View>
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  wrap: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 0, overflow: "hidden" },
  zeroLine: { position: "absolute", height: 1, backgroundColor: colors.borderStrong, left: 0 },
  currentLine: { position: "absolute", width: 1, backgroundColor: colors.brandPrimary, top: 0, opacity: 0.6 },
  currentLabel: { position: "absolute", top: 2, fontSize: 10, color: colors.brandPrimary, fontWeight: "700", fontVariant: ["tabular-nums"], backgroundColor: colors.surface, paddingHorizontal: 4, borderRadius: 4 },
  beDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning, borderWidth: 1.5, borderColor: colors.surface },
  beDotLegend: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning, marginRight: 4 },
  legend: { position: "absolute", bottom: 4, left: 0, right: 0, alignItems: "center" },
  legendRow: { flexDirection: "row", alignItems: "center" },
  legendDot: { width: 8, height: 8, borderRadius: 2, marginRight: 4 },
  legendText: { fontSize: 10, color: colors.muted, fontWeight: "600" },
}));

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  useTheme();
  return (
    <View style={{ gap: 8, padding: spacing.md }}>
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={[skStyles.bar, { width: `${90 - i * 15}%` }]} />
      ))}
    </View>
  );
}

const skStyles = themedStyles((colors) => ({
  bar: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceTertiary },
}));

export function FreshnessPill({ source, timestamp }: { source?: string; timestamp?: string }) {
  useTheme();
  const t = timestamp ? new Date(timestamp) : null;
  const label = t ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "live";
  return (
    <View style={pillStyles.wrap}>
      <View style={pillStyles.dot} />
      <Text style={pillStyles.text}>{source || "Live"} • {label}</Text>
    </View>
  );
}

const pillStyles = themedStyles((colors) => ({
  wrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginRight: 5 },
  text: { fontSize: 10, color: colors.muted, fontWeight: "600" },
}));
