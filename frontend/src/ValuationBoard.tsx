import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { BoardStockSheet } from "./BoardStockSheet";
import { colors, spacing, radius, themedStyles, useTheme, type ThemeColors } from "./theme";

type Stock = { t: string; n: string; s: string; p: number; v: number; d: number; b: string };
type Board = {
  buckets: { id: string; label: string; range: string; count: number }[];
  stocks: Stock[];
  unrated: { t: string }[];
  sectors: string[];
  progress: { valued: number; total: number };
  prices_at?: string | null;
  method: string;
};

// getters so each read returns the active theme's color
const tone = (fg: keyof ThemeColors, bg: keyof ThemeColors) => ({ get fg() { return colors[fg]; }, get bg() { return colors[bg]; } });
export const BUCKET_TONE: Record<string, { fg: string; bg: string }> = {
  very_under: tone("valueVeryUnder", "valueVeryUnderBg"),
  under: tone("valueUnder", "valueUnderBg"),
  fair: tone("valueFair", "valueFairBg"),
  over: tone("valueOver", "valueOverBg"),
  very_over: tone("valueVeryOver", "valueVeryOverBg"),
};

export const signedPct = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(0)}%`;

/** All S&P 500 stocks grouped by price vs OptiIQ Value (same model as the Long-term analysis). Tap a stock to analyze it. */
export function ValuationBoard({ onSelect }: { onSelect: (ticker: string) => void }) {
  useTheme();
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [bucket, setBucket] = useState("very_under");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All");
  const [showMethod, setShowMethod] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api("/api/valuation/board")); setErr(""); } catch (e: any) { setErr(e.message || "Couldn't load the board"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const building = !!data && data.progress.valued < data.progress.total;
  useEffect(() => {
    if (!building) return;
    const id = setInterval(load, 30000); // the board fills in while company data loads
    return () => clearInterval(id);
  }, [building, load]);

  const q = query.trim().toUpperCase();
  const inSector = useMemo(() => (data?.stocks || []).filter((x) => sector === "All" || x.s === sector), [data, sector]);
  const shown = useMemo(() => {
    if (q) return inSector.filter((x) => x.t.includes(q) || x.n.toUpperCase().includes(q));
    const rows = inSector.filter((x) => x.b === bucket);
    return bucket === "over" || bucket === "very_over" ? [...rows].reverse() : rows; // most extreme first
  }, [inSector, bucket, q]);

  if (!data) {
    return (
      <View testID="valuation-board" style={s.card}>
        <Text style={s.title}>S&P 500 valuation board</Text>
        {err ? <Pressable onPress={load}><Text style={s.err}>{err} · Tap to retry</Text></Pressable> : <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />}
      </View>
    );
  }

  return (
    <View testID="valuation-board" style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>S&P 500 valuation board</Text>
          <Text style={s.sub}>Price vs OptiIQ Value{data.prices_at ? ` · prices ${new Date(data.prices_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</Text>
        </View>
        <Pressable testID="vb-info" onPress={() => setShowMethod((v) => !v)} hitSlop={10} style={s.iconBtn}>
          <Icon name="info" size={16} color={colors.brandPrimary} />
        </Pressable>
      </View>
      {showMethod ? <Text style={s.method}>{data.method}</Text> : null}

      {building ? (
        <View testID="vb-progress" style={s.progress}>
          <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round((data.progress.valued / data.progress.total) * 100)}%` }]} /></View>
          <Text style={s.progressText}>Valuing stocks: {data.progress.valued}/{data.progress.total}. The board fills in as company data arrives.</Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {data.buckets.map((b) => {
          const tone = BUCKET_TONE[b.id];
          const active = !q && bucket === b.id;
          const count = inSector.filter((x) => x.b === b.id).length;
          return (
            <Pressable key={b.id} testID={`vb-bucket-${b.id}`} onPress={() => { setBucket(b.id); setQuery(""); }}
              style={[s.tab, { borderColor: tone.fg, backgroundColor: active ? tone.fg : tone.bg }]}>
              <Text style={[s.tabLabel, { color: active ? colors.onBrandPrimary : tone.fg }]}>{b.label}</Text>
              <Text style={[s.tabMeta, { color: active ? colors.onBrandPrimary : tone.fg }]}>{b.range} · {count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.searchWrap}>
        <Icon name="search" size={15} color={colors.muted} />
        <TextInput testID="vb-search" value={query} onChangeText={setQuery} placeholder="Search all 500 stocks" placeholderTextColor={colors.muted}
          autoCapitalize="characters" autoCorrect={false} style={s.search} />
        {query ? <Pressable onPress={() => setQuery("")} hitSlop={10}><Icon name="x" size={15} color={colors.muted} /></Pressable> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sectors}>
        {["All", ...data.sectors].map((sec) => {
          const active = sector === sec;
          return (
            <Pressable key={sec} testID={`vb-sector-${sec}`} onPress={() => setSector(sec)} style={[s.sector, active && s.sectorActive]}>
              <Text style={[s.sectorText, active && s.sectorTextActive]}>{sec}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View testID="vb-grid" style={s.grid}>
        {shown.map((x) => {
          const tone = BUCKET_TONE[x.b];
          return (
            <Pressable key={x.t} testID={`vb-stock-${x.t}`} onPress={() => setPeek(x.t)} style={[s.chip, { backgroundColor: tone.bg }]}>
              <Text style={s.chipTicker} numberOfLines={1}>{x.t}</Text>
              <Text style={[s.chipPct, { color: tone.fg }]}>{signedPct(x.d)}</Text>
            </Pressable>
          );
        })}
      </View>
      {!shown.length ? <Text style={s.empty}>{q ? `No S&P 500 stock matches "${query}" yet.` : building ? "Nothing in this group yet. Still valuing stocks." : "No stocks in this group right now."}</Text> : null}

      <Text style={s.foot}>
        Negative % = price below OptiIQ Value (discount). Tap a stock to see its 9 valuation methods.
        {data.unrated.length ? ` ${data.unrated.length} stocks have no OptiIQ value (losses or missing data).` : ""}
      </Text>
      <BoardStockSheet ticker={peek} onClose={() => setPeek(null)} onAnalyze={(t) => { setPeek(null); onSelect(t); }} />
    </View>
  );
}

const s = themedStyles((colors) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.lg },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  method: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17, marginTop: spacing.sm },
  err: { color: colors.error, fontSize: 13, marginTop: spacing.md },
  progress: { marginTop: spacing.md },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.brandPrimary },
  progressText: { fontSize: 11, color: colors.muted, marginTop: 4 },
  tabs: { gap: spacing.sm, paddingVertical: spacing.md },
  tab: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48, justifyContent: "center" },
  tabLabel: { fontSize: 13, fontWeight: "800" },
  tabMeta: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md },
  search: { flex: 1, fontSize: 14, color: colors.onSurface, height: 44 },
  sectors: { gap: 6, paddingVertical: spacing.sm },
  sector: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  sectorActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  sectorText: { fontSize: 12, fontWeight: "600", color: colors.onSurface },
  sectorTextActive: { color: colors.onBrandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.xs },
  chip: { flexBasis: "23%", flexGrow: 1, maxWidth: "25%", minHeight: 48, borderRadius: radius.sm, paddingVertical: 6, alignItems: "center", justifyContent: "center" },
  chipTicker: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  chipPct: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"], marginTop: 1 },
  empty: { fontSize: 13, color: colors.muted, textAlign: "center", marginVertical: spacing.lg },
  foot: { fontSize: 11, color: colors.muted, marginTop: spacing.md, lineHeight: 16 },
}));
