import React, { useCallback, useState } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Input } from "@/src/Input";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { Sparkline } from "@/src/parts";
import { LoadingSkeleton } from "@/src/charts";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";
import { PlanGate } from "@/src/plans";
import { StrategiesList, ClosedHistory } from "@/src/StrategiesList";
import { AskAIButton } from "@/src/ChatParts";

export default function PortfolioGated() {
  useTheme();
  return <PlanGate><Portfolio /></PlanGate>;
}

function Portfolio() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [strats, setStrats] = useState<{ items: any[]; total_pnl: number; closed: any[]; archived: any[]; insights: any; realized_total: number }>({ items: [], total_pnl: 0, closed: [], archived: [], insights: null, realized_total: 0 });

  const load = useCallback(async () => {
    try {
      const [r, st] = await Promise.all([api("/api/watchlist"), api("/api/strategies").catch(() => null)]);
      setItems(r.items || []);
      if (st) setStrats({ items: st.items || [], total_pnl: st.total_pnl || 0, closed: st.closed || [], archived: st.archived || [], insights: st.insights, realized_total: st.realized_total || 0 });
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!newTicker.trim()) return;
    try {
      await api("/api/watchlist/add", { method: "POST", body: JSON.stringify({ ticker: newTicker.trim().toUpperCase() }) });
      setNewTicker("");
      load();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
  };

  const remove = async (t: string) => {
    try { await api(`/api/watchlist/${t}`, { method: "DELETE" }); load(); } catch {}
  };

  // Simple concentration: equal weight assumed, show as sector buckets
  const sectors: Record<string, number> = {};
  items.forEach((it) => { const s = it.sector || "Other"; sectors[s] = (sectors[s] || 0) + 1; });
  const sectorTotal = items.length || 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Portfolio</Text>
        <Text style={styles.sub}>Saved strategies with live P&L, plus your watchlist</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <StrategiesList items={strats.items} total={strats.total_pnl} onChanged={load} />
        {strats.items.length ? (
          <AskAIButton testID="portfolio-ask-ai" label="Ask AI to review my open trades"
            prompt="Review my open trades: which look healthy, which need attention, and what should I watch this week?" />
        ) : null}
        <ClosedHistory items={strats.closed} archived={strats.archived} insights={strats.insights} total={strats.realized_total} onChanged={load} />
        {!strats.items.length && !loading ? (
          <Pressable testID="strategies-empty" onPress={() => router.push("/(tabs)/chain" as any)} style={styles.stratEmpty}>
            <Icon name="layers" size={18} color={colors.brandPrimary} />
            <Text style={styles.stratEmptyText}>Build a strategy in the Chain tab and save it to track live P&L here.</Text>
          </Pressable>
        ) : null}
        <View style={styles.addCard}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Input testID="watchlist-ticker" label="Add ticker" value={newTicker} onChangeText={(v) => setNewTicker(v.toUpperCase())} placeholder="e.g., AAPL" autoCapitalize="characters" />
            </View>
            <Button testID="watchlist-add" label="Add" onPress={add} style={{ marginBottom: spacing.lg, paddingHorizontal: spacing.lg, minWidth: 80 }} />
          </View>
        </View>

        {items.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Concentration</Text>
            <View style={styles.concentrationCard}>
              {Object.entries(sectors).map(([s, n]) => (
                <View key={s} style={styles.concentrationRow}>
                  <Text style={styles.concLabel}>{s}</Text>
                  <View style={styles.concBarBg}>
                    <View style={[styles.concBar, { width: `${(n / sectorTotal) * 100}%` }]} />
                  </View>
                  <Text style={styles.concVal}>{Math.round((n / sectorTotal) * 100)}%</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>{items.length} ticker{items.length === 1 ? "" : "s"}</Text>

        {loading && !items.length && <LoadingSkeleton lines={4} />}

        {items.map((it) => {
          const q = it.quote;
          const up = (q?.change_pct ?? 0) >= 0;
          // Build a mini sparkline from open->price for visual (fake 10 points for now)
          const sparkData = q ? Array.from({ length: 10 }).map((_, i) => q.prev_close + ((q.price - q.prev_close) * (i / 9))) : [];
          return (
            <Pressable key={it.ticker} testID={`wl-item-${it.ticker}`} onPress={() => router.push(`/ticker/${it.ticker}` as any)} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTicker}>{it.ticker}</Text>
                <Text style={styles.rowName} numberOfLines={1}>{it.name || it.ticker}</Text>
              </View>
              <View style={{ marginRight: spacing.md }}>
                <Sparkline data={sparkData} up={up} width={56} height={22} />
              </View>
              <View style={{ alignItems: "flex-end", marginRight: spacing.md, minWidth: 72 }}>
                <Text style={styles.rowPrice}>${q ? Number(q.price).toFixed(2) : "—"}</Text>
                {q ? <Text style={[styles.rowChange, { color: up ? colors.success : colors.error }]}>{up ? "+" : ""}{Number(q.change_pct).toFixed(2)}%</Text> : null}
              </View>
              <Pressable testID={`wl-remove-${it.ticker}`} onPress={() => remove(it.ticker)} style={styles.removeBtn}>
                <Icon name="x" size={14} color={colors.muted} />
              </Pressable>
            </Pressable>
          );
        })}

        {!loading && !items.length && (
          <View style={styles.empty}>
            <Icon name="briefcase" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>Your watchlist is empty. Add a ticker to track it live.</Text>
          </View>
        )}
      </ScrollView>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 26, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  scroll: { padding: spacing.lg, paddingBottom: 100 },
  addCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.sm },
  concentrationCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg, gap: spacing.sm },
  concentrationRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  concLabel: { fontSize: 12, color: colors.onSurface, width: 110, fontWeight: "600" },
  concBarBg: { flex: 1, height: 8, backgroundColor: colors.surfaceTertiary, borderRadius: 4 },
  concBar: { height: 8, backgroundColor: colors.brandPrimary, borderRadius: 4 },
  concVal: { fontSize: 11, color: colors.muted, width: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rowTicker: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  rowName: { fontSize: 11, color: colors.muted, marginTop: 2 },
  rowPrice: { fontSize: 15, fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  rowChange: { fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"], marginTop: 2 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },

  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  stratEmpty: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, marginBottom: spacing.lg },
  stratEmptyText: { flex: 1, fontSize: 13, color: colors.onSurfaceSecondary },
  emptyText: { color: colors.muted, textAlign: "center", fontSize: 13, lineHeight: 18 },
}));
