import React from "react";
import { View, Text } from "react-native";
import { colors, radius, spacing, themedStyles, useTheme } from "./theme";

export function Sparkline({ data, width = 80, height = 26, up }: { data: number[]; width?: number; height?: number; up?: boolean }) {
  useTheme();
  if (!data?.length) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * height,
  }));
  const color = up ? colors.success : colors.error;
  return (
    <View style={{ width, height, flexDirection: "row", alignItems: "flex-end" }}>
      {points.slice(0, -1).map((p, i) => {
        const next = points[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
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
              height: 1.5,
              backgroundColor: color,
              transform: [{ rotate: `${angle}deg` }],
              transformOrigin: "left center" as any,
            }}
          />
        );
      })}
    </View>
  );
}

export function MetricRow({ label, value, mono = true, color }: { label: string; value: string | number; mono?: boolean; color?: string }) {
  useTheme();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.val, mono && styles.mono, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

export function Badge({ text, kind = "info", testID }: { text: string; kind?: "info" | "success" | "error" | "warn" | "brand"; testID?: string }) {
  useTheme();
  const bg = kind === "success" ? colors.brandTertiary : kind === "error" ? colors.errorBg : kind === "warn" ? colors.warnBg : kind === "brand" ? colors.brandSecondary : colors.surfaceTertiary;
  const fg = kind === "success" ? colors.onBrandTertiary : kind === "error" ? colors.error : kind === "warn" ? colors.onWarnBg : kind === "brand" ? colors.onBrandSecondary : colors.onSurfaceSecondary;
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { color: colors.muted, fontSize: 13 },
  val: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  mono: { fontVariant: ["tabular-nums"] },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
}));
