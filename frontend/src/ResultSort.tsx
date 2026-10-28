import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export type SortKey = "optiscore" | "history" | "cost" | "pop";
export type ResultView = { sort: SortKey; minScore: number; lowCost: boolean };
export const DEFAULT_VIEW: ResultView = { sort: "optiscore", minScore: 0, lowCost: false };
export const VIEW_KEY = "discover_result_view";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "optiscore", label: "OptiScore" }, { id: "history", label: "History win rate" },
  { id: "cost", label: "Lowest trading cost" }, { id: "pop", label: "Chance of profit" },
];
const MIN_SCORES = [0, 50, 65, 80];

const histWin = (r: any): number | null => {
  const h = r.validation?.backtest?.hold_to_expiry;
  return h?.trades ? h.win_rate : null;
};
const costPct = (r: any): number => r.validation?.costs?.pct_of_max_profit ?? 999;

/** Filter + sort Discover ideas on the client (ties broken by OptiScore). */
export function applyView(rows: any[], v: ResultView): any[] {
  const key: Record<SortKey, (r: any) => number> = {
    optiscore: (r) => -(r.optiscore ?? 0),
    history: (r) => -(histWin(r) ?? -1),
    cost: costPct,
    pop: (r) => -(r.pop_calibrated ?? r.pop ?? 0),
  };
  return rows
    .filter((r) => (r.optiscore ?? 0) >= v.minScore && (!v.lowCost || r.validation?.costs?.grade === "Low"))
    .sort((a, b) => key[v.sort](a) - key[v.sort](b) || (b.optiscore ?? 0) - (a.optiscore ?? 0));
}

export function ResultToolbar({ view, onChange, shown, total }: { view: ResultView; onChange: (v: ResultView) => void; shown: number; total: number }) {
  useTheme();
  const filtered = view.minScore > 0 || view.lowCost;
  return (
    <View testID="result-toolbar" style={s.wrap}>
      <View style={s.headRow}>
        <Icon name="bar-chart-2" size={13} color={colors.muted} />
        <Text style={s.head}>Sort by</Text>
        <Text testID="result-count" style={s.count}>Showing {shown} of {total}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {SORTS.map((o) => (
          <Chip key={o.id} testID={`sort-${o.id}`} label={o.label} active={view.sort === o.id} onPress={() => onChange({ ...view, sort: o.id })} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {MIN_SCORES.map((m) => (
          <Chip key={m} testID={`min-score-${m}`} label={m ? `Score ${m}+` : "Any score"} active={view.minScore === m} onPress={() => onChange({ ...view, minScore: m })} />
        ))}
        <Chip testID="filter-low-cost" label="Low cost only" icon={view.lowCost ? "check" : undefined} active={view.lowCost} onPress={() => onChange({ ...view, lowCost: !view.lowCost })} />
        {filtered ? <Chip testID="filter-clear" label="Clear" icon="x" active={false} onPress={() => onChange({ ...view, minScore: 0, lowCost: false })} /> : null}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress, testID, icon }: { label: string; active: boolean; onPress: () => void; testID: string; icon?: string }) {
  useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[s.chip, active && s.chipOn]}>
      {icon ? <Icon name={icon as any} size={12} color={active ? colors.onBrandPrimary : colors.onSurface} /> : null}
      <Text style={[s.chipText, active && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const s = themedStyles((colors) => ({
  wrap: { marginBottom: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  head: { fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  count: { flex: 1, textAlign: "right", fontSize: 11, color: colors.muted },
  row: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary },
}));
