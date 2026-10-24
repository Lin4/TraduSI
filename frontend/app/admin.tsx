import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

const PLANS = ["free", "simple", "advance", "expert"];

export default function Admin() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [stats, setStats] = useState<any>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try { const r = await api(`/api/admin/users?q=${encodeURIComponent(query)}`); setItems(r.items || []); }
    catch (e: any) { if (e.status === 403) setDenied(true); else toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  }, []);

  const loadStats = useCallback(async () => {
    try { setStats(await api("/api/admin/stats")); } catch (e: any) { if (e.status === 403) setDenied(true); }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const setPlan = async (u: any, plan: string) => {
    setBusy(u.user_id + plan);
    try {
      await api(`/api/admin/users/${u.user_id}/plan`, { method: "POST", body: JSON.stringify({ plan }) });
      setItems((p) => p.map((x) => (x.user_id === u.user_id ? { ...x, plan, tier: plan === "free" ? "trial" : plan } : x)));
      toast(`${u.email} → ${plan.toUpperCase()}`, "success");
      load(q);
      loadStats();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="admin-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={s.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={[s.title, { flex: 1 }]}>Admin · Plans</Text>
        {!denied ? (
          <Pressable testID="admin-broadcast-open" onPress={() => router.push("/admin-broadcast" as any)} style={s.bcBtn}>
            <Icon name="volume-2" size={16} color={colors.onBrandPrimary} />
            <Text style={s.bcText}>Broadcast</Text>
          </Pressable>
        ) : null}
      </View>
      {denied ? (
        <View style={s.center}><Icon name="lock" size={28} color={colors.muted} /><Text style={s.muted}>Admin access only.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { load(q); loadStats(); }} />}>
          {stats ? <Insights st={stats} /> : <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />}
          <View style={s.search}>
            <Icon name="search" size={16} color={colors.muted} />
            <TextInput testID="admin-search" value={q} onChangeText={setQ} placeholder="Search email or name" placeholderTextColor={colors.muted}
              autoCapitalize="none" style={s.input} />
          </View>
          <Text style={s.muted}>Tap a plan to switch instantly. Admin grants have no expiry and skip billing.</Text>
          {loading && !items.length ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : null}
          {items.map((u) => (
            <View key={u.user_id} testID={`admin-user-${u.email}`} style={s.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.email} numberOfLines={1}>{u.email}</Text>
                  <Text style={s.sub}>{u.name || "—"} · now <Text style={{ fontWeight: "800", color: colors.onSurface }}>{String(u.tier).toUpperCase()}</Text>{u.plan_source ? ` via ${u.plan_source}` : ""}{u.is_admin ? " · admin" : ""}</Text>
                </View>
              </View>
              <Pressable testID={`admin-detail-${u.email}`} onPress={() => router.push(`/admin-user/${u.user_id}` as any)} style={s.detailLink}>
                <Icon name="user" size={13} color={colors.brandPrimary} />
                <Text style={s.detailText}>Activity, strategies & plan history</Text>
                <Icon name="chevron-right" size={14} color={colors.brandPrimary} />
              </Pressable>
              <View style={s.chips}>
                {PLANS.map((p) => {
                  const on = (u.plan || "free") === p || (p === "free" && !["simple", "advance", "expert"].includes(u.plan));
                  return (
                    <Pressable key={p} testID={`admin-plan-${u.email}-${p}`} onPress={() => !on && setPlan(u, p)} disabled={!!busy}
                      style={[s.chip, on && s.chipOn]}>
                      {busy === u.user_id + p ? <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                        : <Text style={[s.chipText, on && s.chipTextOn]}>{p.toUpperCase()}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {!loading && !items.length ? <Text style={s.muted}>No users found.</Text> : null}
        </ScrollView>
      )}
      <ToastHost />
    </View>
  );
}

const TIER_ORDER = [["expert", "Expert"], ["advance", "Advance"], ["simple", "Simple"], ["trial", "Trial"], ["expired", "Expired"]];

function Insights({ st }: { st: any }) {
  useTheme();
  const max = Math.max(1, ...st.signups_daily.map((d: any) => d.count));
  const tierMax = Math.max(1, ...Object.values(st.tiers as Record<string, number>));
  return (
    <View testID="admin-insights">
      <View style={s.kpis}>
        <Kpi id="kpi-users" label="Users" value={st.total_users} />
        <Kpi id="kpi-paid" label="Paying" value={st.paid} />
        <Kpi id="kpi-mrr" label="MRR" value={`$${st.mrr}`} />
      </View>
      <Text style={s.section}>Active users</Text>
      <View style={s.kpis}>
        <Kpi id="active-24h" label="24 hours" value={st.active["24h"]} />
        <Kpi id="active-7d" label="7 days" value={st.active["7d"]} />
        <Kpi id="active-30d" label="30 days" value={st.active["30d"]} />
      </View>
      <Text style={s.section}>New sign-ups</Text>
      <View style={s.kpis}>
        <Kpi id="signups-24h" label="24 hours" value={st.signups["24h"]} />
        <Kpi id="signups-7d" label="7 days" value={st.signups["7d"]} />
        <Kpi id="signups-30d" label="30 days" value={st.signups["30d"]} />
      </View>
      <View testID="signups-chart" style={s.barsBox}>
        <View style={s.bars}>
          {st.signups_daily.map((d: any) => (
            <View key={d.date} style={s.barCol}>
              {d.count ? <Text style={s.barNum}>{d.count}</Text> : null}
              <View style={[s.bar, { height: Math.max(2, (d.count / max) * 64), backgroundColor: d.count ? colors.brandPrimary : colors.surfaceTertiary }]} />
            </View>
          ))}
        </View>
        <Text style={s.barCap}>Last 14 days · {st.signups_daily[0].date.slice(5)} → today</Text>
      </View>
      <Text style={s.section}>Plans</Text>
      <View testID="plan-counts" style={s.barsBox}>
        {TIER_ORDER.map(([k, label]) => (
          <View key={k} style={s.tierRow}>
            <Text style={s.tierLabel}>{label}</Text>
            <View style={s.tierTrack}><View style={[s.tierFill, { width: `${(st.tiers[k] / tierMax) * 100}%` as any }]} /></View>
            <Text testID={`tier-count-${k}`} style={s.tierNum}>{st.tiers[k]}</Text>
          </View>
        ))}
      </View>
      <Text style={s.section}>Users · {st.open_strategies} open strategies</Text>
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
  kpis: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  kpiLabel: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  kpiVal: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: 2, fontVariant: ["tabular-nums"] },
  section: { fontSize: 11, color: colors.muted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  barsBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 84 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 3 },
  barNum: { fontSize: 9, fontWeight: "800", color: colors.onSurface, marginBottom: 2 },
  barCap: { fontSize: 10, color: colors.muted, marginTop: spacing.sm, textAlign: "center" },
  tierRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  tierLabel: { width: 64, fontSize: 12, fontWeight: "700", color: colors.onSurface },
  tierTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary },
  tierFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  tierNum: { width: 32, textAlign: "right", fontSize: 13, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  bcBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  bcText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  scroll: { padding: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  input: { flex: 1, fontSize: 15, color: colors.onSurface },
  muted: { fontSize: 12, color: colors.muted, marginBottom: spacing.md, textAlign: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  email: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  detailLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, marginTop: spacing.xs },
  detailText: { flex: 1, fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  chip: { flex: 1, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 11, fontWeight: "800", color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary },
}));
