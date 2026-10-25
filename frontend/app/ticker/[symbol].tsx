import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { ToastHost, toast } from "@/src/Toast";
import { MetricRow, Badge } from "@/src/parts";
import { FreshnessPill, LoadingSkeleton } from "@/src/charts";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";
import { PlanGate } from "@/src/plans";

export default function TickerDetailGated() {
  useTheme();
  return <PlanGate back><TickerDetail /></PlanGate>;
}

function TickerDetail() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const [tab, setTab] = useState<"tech" | "fund" | "options">("tech");
  const [day, setDay] = useState<any>(null);
  const [long, setLong] = useState<any>(null);
  const [options, setOptions] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    (async () => {
      setLoading(true);
      try {
        const [d, l, o] = await Promise.all([
          api("/api/screener/stock-analysis", { method: "POST", body: JSON.stringify({ ticker: symbol, purpose: "swing" }) }),
          api("/api/screener/stock-analysis", { method: "POST", body: JSON.stringify({ ticker: symbol, purpose: "long" }) }),
          api("/api/screener/ticker-options", { method: "POST", body: JSON.stringify({ ticker: symbol, expiration_range: "month" }) }),
        ]);
        setDay(d.result); setLong(l.result); setOptions(o.result);
      } catch (e: any) { toast(e.message || "Failed", "error"); }
      finally { setLoading(false); }
    })();
  }, [symbol]);

  const price = day?.price || long?.price || options?.price || 0;
  const candles = day?.candles || long?.candles || [];
  const max = candles.length ? Math.max(...candles.map((c: any) => c.h)) : 1;
  const min = candles.length ? Math.min(...candles.map((c: any) => c.l)) : 0;
  const range = max - min || 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="ticker-back" onPress={() => router.back()} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.ticker}>{symbol}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={styles.price}>${Number(price).toFixed(2)}</Text>
            <FreshnessPill source="Finnhub" timestamp={new Date().toISOString()} />
          </View>
        </View>
        {day?.verdict && <Badge text={day.verdict} kind={day.verdict === "BUY" ? "success" : day.verdict === "SELL" ? "error" : "warn"} />}
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl }}><LoadingSkeleton lines={6} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.chart}>
            {/* Horizontal gridlines */}
            {[0.25, 0.5, 0.75].map((p, i) => (
              <View key={i} style={[styles.gridline, { top: p * 160 }]} />
            ))}
            {candles.map((c: any, i: number) => {
              const bodyTop = ((max - Math.max(c.o, c.c)) / range) * 160;
              const bodyH = Math.max(((Math.abs(c.o - c.c)) / range) * 160, 1);
              const wickTop = ((max - c.h) / range) * 160;
              const wickH = ((c.h - c.l) / range) * 160;
              const up = c.c >= c.o;
              return (
                <View key={i} style={styles.candleCol}>
                  <View style={[styles.wick, { top: wickTop, height: wickH, backgroundColor: up ? colors.success : colors.error }]} />
                  <View style={[styles.body, { top: bodyTop, height: bodyH, backgroundColor: up ? colors.success : colors.error }]} />
                </View>
              );
            })}
            <Text style={styles.axisHigh}>${max.toFixed(0)}</Text>
            <Text style={styles.axisLow}>${min.toFixed(0)}</Text>
          </View>

          <View style={styles.tabs}>
            {(["tech", "fund", "options"] as const).map((t) => (
              <Pressable key={t} testID={`detail-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === "tech" ? "Technical" : t === "fund" ? "Fundamentals" : "Options"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ marginTop: spacing.lg }}>
            {tab === "tech" && day && (
              <View style={styles.card}>
                <Text style={styles.ai}>{day.ai_summary}</Text>
                <MetricRow label="Buy point" value={`$${day.buy_point}`} color={colors.success} />
                <MetricRow label="Sell point" value={`$${day.sell_point}`} color={colors.brandPrimary} />
                <MetricRow label="Stop loss" value={`$${day.stop_loss}`} color={colors.error} />
                <MetricRow label="Support" value={`$${day.support}`} />
                <MetricRow label="Resistance" value={`$${day.resistance}`} />
                <MetricRow label="SMA 20 / 50" value={`$${day.sma_20} / $${day.sma_50}`} />
                <MetricRow label="RSI" value={day.rsi} />
                <MetricRow label="Sentiment" value={day.market_sentiment} />
                <MetricRow label="Profit prob." value={`${day.profit_probability}%`} color={colors.success} />
              </View>
            )}
            {tab === "fund" && long && (
              <View style={styles.card}>
                <Text style={styles.ai}>{long.ai_summary}</Text>
                <MetricRow label="Intrinsic" value={`$${long.intrinsic_value}`} />
                <MetricRow label="Price target" value={`$${long.price_target}`} color={colors.success} />
                <MetricRow label="Trend" value={long.stock_trend} />
                {long.pe_ratio != null ? <MetricRow label="P/E (TTM)" value={Number(long.pe_ratio).toFixed(2)} /> : null}
                {long.eps_ttm != null ? <MetricRow label="EPS (TTM)" value={`$${Number(long.eps_ttm).toFixed(2)}`} /> : null}
                {long.roe != null ? <MetricRow label="ROE" value={`${Number(long.roe).toFixed(1)}%`} /> : null}
                {long.revenue_growth_pct != null ? <MetricRow label="Rev growth" value={`${Number(long.revenue_growth_pct).toFixed(1)}%`} /> : null}
                {long.beta != null ? <MetricRow label="Beta" value={Number(long.beta).toFixed(2)} /> : null}
                <MetricRow label="Earnings date" value={long.earnings_date || "TBA"} />
                {long.earnings_eps_estimate != null ? <MetricRow label="EPS est." value={`$${Number(long.earnings_eps_estimate).toFixed(2)}`} /> : null}
                <MetricRow label="Moat" value={long.business_moat} />
                <View style={{ marginTop: spacing.sm, flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
                  {(long.competitors || []).map((c: string) => <Badge key={c} text={c} kind="brand" />)}
                </View>
              </View>
            )}
            {tab === "options" && options && (
              <View style={styles.card}>
                <Badge text={options.strategy} kind="brand" />
                <View style={{ height: spacing.sm }} />
                <Text style={styles.ai}>{options.ai_summary}</Text>
                {(options.legs || []).map((l: any, i: number) => (
                  <MetricRow key={i} label={`${l.action} ${l.type}`} value={`$${l.strike} • ${l.exp}`} />
                ))}
                <MetricRow label="Premium" value={`$${options.premium}`} color={colors.success} />
                <MetricRow label="Pop" value={`${options.pop}%`} color={colors.success} />
                <MetricRow label="Expiration" value={options.expiration} />
                <MetricRow label="Collateral" value={`$${options.collateral}`} />
                <MetricRow label="w/ Margin" value={`$${options.collateral_margin}`} />
                <MetricRow label="APR" value={`${options.annual_pct_no_margin}%`} color={colors.success} />
              </View>
            )}
          </View>
        </ScrollView>
      )}
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  ticker: { fontSize: 20, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  price: { fontSize: 14, color: colors.muted, fontVariant: ["tabular-nums"] },
  scroll: { padding: spacing.lg, paddingBottom: 60 },
  chart: { height: 160, flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, overflow: "hidden", position: "relative" },
  gridline: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: colors.divider },
  axisHigh: { position: "absolute", top: 4, left: 6, fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"], fontWeight: "600" },
  axisLow: { position: "absolute", bottom: 4, left: 6, fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"], fontWeight: "600" },
  candleCol: { flex: 1, height: 160, position: "relative", marginHorizontal: 1 },
  wick: { position: "absolute", left: "48%", width: 1 },
  body: { position: "absolute", left: 0, right: 0, borderRadius: 1 },

  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  tab: { flex: 1, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: colors.onBrandPrimary },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  ai: { backgroundColor: colors.brandSecondary, color: colors.onBrandSecondary, padding: spacing.sm, borderRadius: radius.md, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
}));
