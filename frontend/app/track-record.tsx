import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Badge } from "@/src/parts";
import { LoadingSkeleton } from "@/src/charts";
import { Stat } from "@/src/screen";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";
import { usePlan, LockedFeature } from "@/src/plans";
import { CalibrationChart, EquityCurve, money } from "@/src/quantcharts";

type Tab = "live" | "backtest";

export default function TrackRecord() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("live");
  const plan = usePlan();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api("/api/track-record")); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const live = data?.live;
  const bt = data?.backtest;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="track-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Track record</Text>
          <Text style={styles.sub}>Did 70%+ POP picks really win?</Text>
        </View>
      </View>
      <View style={styles.tabs}>
        {(["live", "backtest"] as Tab[]).map((t) => (
          <Pressable key={t} testID={`track-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "live" ? "Live picks" : "Backtest (1y)"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}>
        {!data ? <LoadingSkeleton lines={6} /> : tab === "live" ? (
          <View testID="track-live">
            <Summary s={live.stats} />
            <Text style={styles.method}>{live.method}</Text>
            <Buckets rows={live.buckets} />
            <Accuracy a={live.accuracy} />
            <CalibrationProgress cal={live.calibration} />
            <RiskAdjusted ra={live.risk_adjusted} />
            <Text style={styles.section}>Settled ({live.stats.count})</Text>
            {!live.settled.length ? (
              <Text style={styles.empty}>No picks have expired yet. {live.open_count} open pick{live.open_count === 1 ? "" : "s"} will settle on their expiration dates — check back then.</Text>
            ) : live.settled.map((t: any) => <TradeRow key={t.pick_id} t={t} />)}
            <Text style={styles.section}>Open ({live.open_count})</Text>
            {live.open.map((t: any) => (
              <View key={t.pick_id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t.ticker} · {t.strategy}</Text>
                  <Text style={styles.rowSub}>POP {t.pop}% · expires {t.expiration}</Text>
                </View>
                <Badge text="open" kind="info" />
              </View>
            ))}
          </View>
        ) : !plan.features.backtest ? (
          <LockedFeature need="advance" label="Backtest tab" testID="locked-backtest" />
        ) : bt?.status !== "ready" ? (
          <Text testID="track-backtest-pending" style={styles.empty}>The backtest is being calculated from past daily prices. Pull down to refresh in a minute.</Text>
        ) : (
          <View testID="track-backtest">
            <View style={styles.hypo}><Icon name="alert-circle" size={14} color={colors.warning} /><Text style={styles.hypoText}>Hypothetical backtest — not live trades</Text></View>
            <Summary s={bt.stats} />
            <Text style={styles.method}>{bt.method} {bt.tickers} stocks with price history.</Text>
            <Buckets rows={bt.buckets} />
            <Accuracy a={bt.accuracy} />
            <RiskAdjusted ra={bt.risk_adjusted} />
            <Text style={styles.section}>By strategy</Text>
            {bt.by_strategy.map((s: any) => (
              <View key={s.strategy} style={styles.row}>
                <Text style={[styles.rowTitle, { flex: 1 }]}>{s.strategy}</Text>
                <Text style={styles.rowSub}>{s.count} trades · {s.win_rate}% won</Text>
              </View>
            ))}
            <Text style={styles.section}>Recent backtest trades</Text>
            {bt.recent.map((t: any, i: number) => <TradeRow key={`${t.ticker}-${t.entry_date}-${i}`} t={t} />)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Summary({ s }: { s: any }) {
  useTheme();
  const diff = s.win_rate != null && s.avg_predicted_pop != null ? s.win_rate - s.avg_predicted_pop : null;
  return (
    <View>
      <View style={styles.grid}>
        <Stat label="Win rate" value={s.win_rate != null ? `${s.win_rate}%` : "—"} tone={s.win_rate != null && s.win_rate >= 70 ? "good" : undefined} />
        <Stat label="Predicted POP" value={s.avg_predicted_pop != null ? `${s.avg_predicted_pop}%` : "—"} />
        <Stat label="Trades" value={`${s.count}`} />
        <Stat label="Total P&L" value={money(s.total_pnl)} tone={s.total_pnl >= 0 ? "good" : "bad"} />
      </View>
      {diff != null ? (
        <Text style={styles.verdict}>
          {diff >= 0 ? `Picks won ${diff.toFixed(1)} pts more often than predicted.` : `Picks won ${Math.abs(diff).toFixed(1)} pts less often than predicted.`} {s.losses} loss{s.losses === 1 ? "" : "es"} included.
        </Text>
      ) : null}
    </View>
  );
}

function Accuracy({ a }: { a: any }) {
  useTheme();
  if (!a) return null;
  const good = a.calibration_error <= 5;
  const vtone = good ? colors.success : a.calibration_error > 12 ? colors.error : colors.warning;
  return (
    <View testID="track-accuracy">
      <Text style={styles.section}>Prediction accuracy</Text>
      <View style={[styles.verdictPill, { borderColor: vtone }]}>
        <Icon name={good ? "check-circle" : "alert-circle"} size={14} color={vtone} />
        <Text style={[styles.verdictPillText, { color: vtone }]}>{a.verdict}</Text>
      </View>
      <View style={[styles.grid, { marginTop: spacing.sm }]}>
        <Stat label="Brier score" value={String(a.brier)} tone={a.brier < 0.2 ? "good" : a.brier > 0.25 ? "bad" : undefined} />
        <Stat label="Calibration error" value={`${a.calibration_error} pts`} tone={good ? "good" : a.calibration_error > 12 ? "bad" : undefined} />
      </View>
      <CalibrationChart testID="track-calibration-chart" buckets={a.buckets} />
      {a.buckets.map((b: any) => (
        <View key={b.range} testID={`acc-${b.range}`} style={styles.accRow}>
          <Text style={styles.bucketLabel}>{b.range}</Text>
          <Text style={styles.accCell}>pred {b.predicted}%</Text>
          <Text style={[styles.accCell, { color: Math.abs(b.gap) <= 5 ? colors.success : colors.warning }]}>real {b.realized}%</Text>
          <Text style={styles.accN}>n={b.n}{b.calibrated ? " ✓" : ""}</Text>
        </View>
      ))}
      <Text style={styles.method}>{a.note}</Text>
    </View>
  );
}

function CalibrationProgress({ cal }: { cal?: any }) {
  useTheme();
  if (!cal) return null;
  const need = cal.min_results_per_bucket;
  return (
    <View testID="track-calibration" style={styles.calBox}>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
        <Icon name={cal.active ? "check-circle" : "clock"} size={15} color={cal.active ? colors.success : colors.muted} />
        <Text style={styles.calTitle}>Auto-calibration {cal.active ? "ON" : "warming up"}</Text>
      </View>
      <Text style={styles.calText}>
        {cal.active
          ? `Stated POP is adjusted for ${cal.buckets.map((b: any) => `${b.range} (${b.adjust_pts > 0 ? "+" : ""}${b.adjust_pts} pts)`).join(", ")}. Discover and Analyze show the calibrated POP.`
          : `Each POP bucket switches on once ${need} real picks in it have settled. Until then you see the model POP.`}
      </Text>
      {(cal.progress || []).map((b: any) => (
        <View key={b.range} testID={`cal-progress-${b.range}`} style={styles.bucket}>
          <Text style={styles.bucketLabel}>POP {b.range}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, (b.n / need) * 100)}%`, backgroundColor: b.n >= need ? colors.success : colors.brandPrimary }]} />
          </View>
          <Text style={styles.bucketVal}>{Math.min(b.n, need)}/{need}{b.n >= need ? " ✓" : ""}</Text>
        </View>
      ))}
    </View>
  );
}

function RiskAdjusted({ ra }: { ra: any }) {
  useTheme();
  if (!ra) return null;
  return (
    <View testID="track-risk-adjusted">
      <Text style={styles.section}>Risk-adjusted results</Text>
      <EquityCurve testID="track-equity" height={140}
        series={[{ data: ra.equity || [], color: colors.brandPrimary, label: "Cumulative P&L" }]} />
      <View style={[styles.grid, { marginTop: spacing.sm }]}>
        <Stat label="Profit factor" value={ra.profit_factor != null ? String(ra.profit_factor) : "—"} tone={ra.profit_factor != null ? (ra.profit_factor >= 1.2 ? "good" : ra.profit_factor < 1 ? "bad" : undefined) : undefined} />
        <Stat label="Sharpe (per trade)" value={String(ra.sharpe)} tone={ra.sharpe > 0.1 ? "good" : ra.sharpe < 0 ? "bad" : undefined} />
        <Stat label="Max drawdown" value={money(ra.max_drawdown)} tone={ra.max_drawdown < 0 ? "bad" : undefined} />
        <Stat label="Return on risk" value={ra.return_on_risk_pct != null ? `${ra.return_on_risk_pct}%` : "—"} tone={(ra.return_on_risk_pct ?? 0) >= 0 ? "good" : "bad"} />
        <Stat label="Avg win" value={money(ra.avg_win)} tone="good" />
        <Stat label="Avg loss" value={money(ra.avg_loss)} tone="bad" />
      </View>
      <Text style={styles.method}>Expectancy ${ra.expectancy}/trade{ra.sortino != null ? ` · Sortino ${ra.sortino}` : ""}. {ra.note}</Text>
    </View>
  );
}

function Buckets({ rows }: { rows: any[] }) {
  useTheme();
  return (
    <View>
      <Text style={styles.section}>Predicted vs actual</Text>
      {rows.map((b) => (
        <View key={b.range} testID={`bucket-${b.range}`} style={styles.bucket}>
          <Text style={styles.bucketLabel}>POP {b.range}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${b.win_rate ?? 0}%` }]} />
          </View>
          <Text style={styles.bucketVal}>{b.count ? `${b.win_rate}% of ${b.count}` : "—"}</Text>
        </View>
      ))}
    </View>
  );
}

function TradeRow({ t }: { t: any }) {
  useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{t.ticker} · {t.strategy}</Text>
        <Text style={styles.rowSub}>POP {t.pop}% · ${t.entry_price} → ${t.exit_price}{t.exit_date ? ` (${t.exit_date})` : ""}</Text>
      </View>
      <Text style={[styles.pnl, { color: t.won ? colors.success : colors.error }]}>{t.pnl >= 0 ? "+" : "-"}${Math.abs(t.pnl).toFixed(0)}</Text>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  tab: { flex: 1, minHeight: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  tabTextActive: { color: colors.onBrandPrimary },
  scroll: { padding: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  verdict: { fontSize: 13, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, lineHeight: 19 },
  method: { fontSize: 11, color: colors.muted, fontStyle: "italic", marginTop: spacing.sm, lineHeight: 16 },
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  bucket: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  bucketLabel: { width: 92, fontSize: 12, fontWeight: "700", color: colors.onSurface },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  bucketVal: { width: 84, fontSize: 11, color: colors.onSurfaceSecondary, textAlign: "right", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  rowSub: { fontSize: 11, color: colors.muted, marginTop: 2, fontVariant: ["tabular-nums"] },
  pnl: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  empty: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  hypo: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  hypoText: { fontSize: 12, fontWeight: "800", color: colors.warning },
  accRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  accCell: { fontSize: 12, fontWeight: "700", color: colors.onSurface, width: 72, fontVariant: ["tabular-nums"] },
  accN: { flex: 1, textAlign: "right", fontSize: 11, color: colors.muted },
  calBox: { gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg },
  calTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface },
  calText: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  verdictPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  verdictPillText: { fontSize: 12, fontWeight: "800" },
}));
