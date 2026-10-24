import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { ToastHost, toast } from "@/src/Toast";
import { Badge, MetricRow } from "@/src/parts";
import { money } from "@/src/pnl";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

const when = (d?: string | null) => (d ? new Date(d.endsWith("Z") || d.includes("+") ? d : d + "Z").toLocaleString() : "—");
const ago = (d?: string | null) => {
  if (!d) return "never (tracked since Admin Insights launch)";
  const m = (Date.now() - new Date(d.endsWith("Z") || d.includes("+") ? d : d + "Z").getTime()) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function AdminUser() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setD(await api(`/api/admin/users/${uid}`)); setErr(null); }
    catch (e: any) { setErr(e.message || "Failed"); toast(e.message || "Failed", "error"); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const u = d?.user;
  const maxScans = d ? Math.max(1, ...d.activity.usage_daily.map((x: any) => x.scans)) : 1;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="admin-user-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin" as any))} style={s.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title} numberOfLines={1}>{u?.email || "User"}</Text>
      </View>
      {!d ? (
        err ? <Text style={s.muted}>{err}</Text> : <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing["2xl"] }} />
      ) : (
        <ScrollView testID="admin-user-detail" contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          <View style={s.card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={s.name}>{u.name || "—"}</Text>
              <Badge testID="detail-tier" text={String(d.access.tier).toUpperCase()} kind={["simple", "advance", "expert"].includes(d.access.tier) ? "success" : d.access.tier === "trial" ? "info" : "warn"} />
              {u.is_admin ? <Badge text="ADMIN" kind="brand" /> : null}
            </View>
            <MetricRow label="Last active" value={ago(u.last_active_at)} mono={false} />
            <MetricRow label="Member since" value={when(u.created_at)} mono={false} />
            <MetricRow label="Plan source" value={u.plan_source || "—"} mono={false} />
            <MetricRow label="Renews / expires" value={d.access.renews_at ? when(d.access.renews_at) : "No expiry"} mono={false} />
            <MetricRow label="Onboarding" value={`${u.questionnaire_complete ? "✓" : "✗"} questionnaire · ${u.consent_signed ? "✓" : "✗"} consent`} mono={false} />
            {Object.entries(d.profile).filter(([, v]) => v).map(([k, v]) => <MetricRow key={k} label={k.replace("_", " ")} value={String(v)} mono={false} />)}
          </View>

          <Text style={s.section}>Activity</Text>
          <View style={s.kpis}>
            <Kpi id="detail-scans" label="Scans (14d)" value={d.activity.scans_14d} />
            <Kpi id="detail-alerts" label="Alerts" value={d.activity.alerts} />
            <Kpi id="detail-watchlist" label="Watchlist" value={d.activity.watchlist} />
          </View>
          <View testID="detail-usage-chart" style={s.card}>
            <View style={s.bars}>
              {d.activity.usage_daily.map((x: any) => (
                <View key={x.date} style={s.barCol}>
                  {x.scans ? <Text style={s.barNum}>{x.scans}</Text> : null}
                  <View style={[s.bar, { height: Math.max(2, (x.scans / maxScans) * 56), backgroundColor: x.scans ? colors.brandPrimary : colors.surfaceTertiary }]} />
                </View>
              ))}
            </View>
            <Text style={s.cap}>Scans per day · last 14 days</Text>
          </View>
          {d.activity.recent_events.length ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Recent alerts ({d.activity.alert_events})</Text>
              {d.activity.recent_events.map((e: any) => (
                <Text key={e.event_id} style={s.line} numberOfLines={1}>{e.title} · {when(e.created_at)}</Text>
              ))}
            </View>
          ) : null}

          <Text style={s.section}>Strategies · {d.strategies.open_count} open · {d.strategies.closed_count} closed</Text>
          <View testID="detail-strategies" style={s.card}>
            {d.strategies.open.map((x: any) => (
              <View key={x.strategy_id} style={s.row}>
                <Text style={s.rowName} numberOfLines={1}>{x.name}</Text>
                <Text style={s.rowSub}>{x.ticker} · open · exp {x.expiration}</Text>
              </View>
            ))}
            {d.strategies.closed.map((x: any) => (
              <View key={x.strategy_id} style={s.row}>
                <Text style={s.rowName} numberOfLines={1}>{x.name}</Text>
                <Text style={[s.rowPnl, { color: (x.final_pnl ?? 0) >= 0 ? colors.success : colors.error }]}>{money(x.final_pnl)}</Text>
              </View>
            ))}
            {!d.strategies.open.length && !d.strategies.closed.length ? <Text style={s.muted}>No saved strategies.</Text> : null}
            {d.strategies.closed_count ? <MetricRow label="Realized total" value={money(d.strategies.realized_total)} color={d.strategies.realized_total >= 0 ? colors.success : colors.error} /> : null}
          </View>

          <Text style={s.section}>Plan history</Text>
          <View testID="detail-plan-history" style={s.card}>
            {d.plan_history.map((p: any, i: number) => (
              <View key={i} style={s.timeline}>
                <View style={[s.dot, { backgroundColor: i === 0 ? colors.brandPrimary : colors.borderStrong }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{String(p.plan || "free").toUpperCase()} <Text style={s.rowSub}>via {p.source || "—"}{p.by ? ` by ${p.by}` : ""}</Text></Text>
                  <Text style={s.rowSub}>{when(p.at)}</Text>
                </View>
              </View>
            ))}
          </View>
          {d.payments.length ? (
            <>
              <Text style={s.section}>Payments</Text>
              <View style={s.card}>
                {d.payments.map((p: any, i: number) => (
                  <MetricRow key={i} label={`${String(p.plan).toUpperCase()} · ${when(p.paid_at)}`} value={p.amount != null ? `$${p.amount}` : "—"} />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
      <ToastHost />
    </View>
  );
}

function Kpi({ id, label, value }: { id: string; label: string; value: any }) {
  useTheme();
  return (
    <View testID={id} style={s.kpi}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiVal}>{value}</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.onSurface },
  scroll: { padding: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm },
  name: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  section: { fontSize: 11, color: colors.muted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  kpis: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  kpiLabel: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  kpiVal: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 74 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3 },
  barNum: { fontSize: 9, fontWeight: "800", color: colors.onSurface, marginBottom: 2 },
  cap: { fontSize: 10, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
  line: { fontSize: 12, color: colors.onSurfaceSecondary, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowName: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.onSurface },
  rowSub: { fontSize: 11, color: colors.muted, fontWeight: "500" },
  rowPnl: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  timeline: { flexDirection: "row", gap: spacing.sm, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  muted: { fontSize: 12, color: colors.muted, textAlign: "center", marginVertical: spacing.sm },
}));
