import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { Gauge, tone } from "./quantcharts";
import { colors, spacing, themedStyles, useTheme } from "./theme";

type Driver = { label: string; pts: number; note: string };

/** One OptiScore pillar; tap to see what pushes it above or below the neutral 50. */
export function PillarRow({ k, label, hint, value, drivers, weight }: {
  k: string; label: string; hint: string; value: number; drivers?: Driver[]; weight?: number;
}) {
  useTheme();
  const [open, setOpen] = useState(false);
  const has = !!drivers?.length;
  return (
    <View testID={`pillar-${k}`} style={s.pillar}>
      <Pressable testID={`pillar-${k}-toggle`} onPress={() => has && setOpen((v) => !v)} disabled={!has} hitSlop={8}
        accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.head}>
        <Text style={s.label}>{label}</Text>
        <View style={s.headRight}>
          <Text style={[s.val, { color: tone(value) }]}>{Math.round(value)}</Text>
          {has ? <Icon name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.muted} /> : null}
        </View>
      </Pressable>
      <Gauge value={value} />
      <Text style={s.hint}>{open ? `Starts at 50 (neutral)${weight ? ` · counts ${Math.round(weight * 100)}% of the OptiScore` : ""}` : hint}</Text>
      {open ? (
        <View testID={`pillar-${k}-drivers`} style={s.drivers}>
          {drivers!.map((d) => <DriverRow key={d.label} d={d} />)}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>= {label}</Text>
            <Text style={[s.totalVal, { color: tone(value) }]}>{Math.round(value)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DriverRow({ d }: { d: Driver }) {
  useTheme();
  const up = d.pts >= 0;
  const zero = Math.abs(d.pts) < 0.5;
  const w = `${Math.min(100, (Math.abs(d.pts) / 50) * 100)}%` as any;
  const col = zero ? colors.muted : up ? colors.success : colors.error;
  return (
    <View style={s.driver}>
      <View style={{ flex: 1 }}>
        <Text style={s.dLabel}>{d.label}</Text>
        <Text style={s.dNote}>{d.note}</Text>
      </View>
      <View style={s.bar}>
        <View style={s.half}>{!up && !zero ? <View style={[s.fill, { width: w, backgroundColor: col, alignSelf: "flex-end" }]} /> : null}</View>
        <View style={s.mid} />
        <View style={s.half}>{up && !zero ? <View style={[s.fill, { width: w, backgroundColor: col }]} /> : null}</View>
      </View>
      <Text style={[s.pts, { color: col }]}>{zero ? "0" : `${up ? "+" : "−"}${Math.abs(d.pts).toFixed(0)}`}</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  pillar: { marginTop: spacing.md },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  val: { fontSize: 13, fontWeight: "800", fontVariant: ["tabular-nums"] },
  hint: { fontSize: 10, color: colors.muted, marginTop: 3, lineHeight: 13 },
  drivers: { marginTop: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.borderStrong, paddingLeft: spacing.sm },
  driver: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  dNote: { fontSize: 11, color: colors.muted, marginTop: 1, lineHeight: 15 },
  bar: { width: 72, flexDirection: "row", alignItems: "center", height: 12 },
  half: { flex: 1, height: 8, justifyContent: "center" },
  fill: { height: 8, borderRadius: 3 },
  mid: { width: 1, height: 12, backgroundColor: colors.borderStrong },
  pts: { width: 30, textAlign: "right", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6 },
  totalLabel: { fontSize: 12, fontWeight: "800", color: colors.onSurfaceSecondary },
  totalVal: { fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
}));
