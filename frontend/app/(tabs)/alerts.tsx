import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Input } from "@/src/Input";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { Badge } from "@/src/parts";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";
import { PlanGate, usePlan } from "@/src/plans";

const KINDS = [
  { id: "price_above", label: "Price above", icon: "trending-up" },
  { id: "price_below", label: "Price below", icon: "trending-down" },
  { id: "earnings", label: "Earnings approaching", icon: "calendar" },
  { id: "smart_setup", label: "New 70%+ setups", icon: "zap" },
];
const PROFILE_OPTS = [{ id: "low_low", label: "Low risk" }, { id: "low_high", label: "Higher reward" }, { id: "high_high", label: "High risk" }];

export default function AlertsGated() {
  useTheme();
  return <PlanGate><Alerts /></PlanGate>;
}

function Alerts() {
  useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState("price_above");
  const [threshold, setThreshold] = useState("");
  const [loading, setLoading] = useState(false);
  const [feed, setFeed] = useState<any[]>([]);
  const [profile, setProfile] = useState("low_low");
  const [checking, setChecking] = useState(false);
  const router = useRouter();
  const plan = usePlan();
  const alertLimit = plan.features.alerts;

  const load = useCallback(async () => {
    try { const r = await api("/api/alerts"); setItems(r.items || []); } catch {}
    try { const f = await api("/api/alerts/feed"); setFeed(f.items || []); } catch {}
  }, []);
  const hasSmart = items.some((i) => i.kind === "smart_setup" && i.active);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api("/api/alerts/smart/check", { method: "POST" });
      toast(r.new?.length ? `${r.new.length} new setup${r.new.length > 1 ? "s" : ""}` : "No new setups (max 3 alerts/day)", "info");
      load();
    } catch (e: any) { toast(e.message || "Failed", "error"); } finally { setChecking(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    const smart = kind === "smart_setup";
    if (smart && !plan.features.smart_alerts) { toast("70%+ smart alerts need the Advance plan", "error"); router.push("/upgrade" as any); return; }
    if (items.length >= alertLimit) { toast(`Alert limit reached (${alertLimit}). Upgrade for more.`, "error"); return; }
    if (!smart && !ticker.trim()) { toast("Enter a ticker", "error"); return; }
    if ((kind === "price_above" || kind === "price_below") && !threshold.trim()) { toast("Enter a price threshold", "error"); return; }
    setLoading(true);
    try {
      await api("/api/alerts/add", {
        method: "POST",
        body: JSON.stringify(smart ? { ticker: "ALL", kind, note: profile } : { ticker: ticker.trim().toUpperCase(), kind, threshold: threshold ? parseFloat(threshold) : null }),
      });
      // Also fire a test push for earnings alerts
      if (kind === "earnings") {
        try { await api("/api/push/earnings-reminder", { method: "POST", body: JSON.stringify({ ticker: ticker.toUpperCase(), earnings_date: new Date().toISOString().slice(0, 10) }) }); } catch {}
      }
      toast("Alert created", "success");
      setOpen(false); setTicker(""); setThreshold("");
      load();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  };

  const remove = async (id: string) => { try { await api(`/api/alerts/${id}`, { method: "DELETE" }); load(); } catch {} };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Alerts</Text>
            <Text style={styles.sub}>New 70%+ setups, price moves & earnings</Text>
            <Text testID="alert-usage" style={styles.emptySub}>{alertLimit >= 100000 ? "Unlimited alerts" : `${items.length}/${alertLimit} alerts used`}</Text>
          </View>
          <Pressable testID="add-alert" onPress={() => setOpen(true)} style={styles.addBtn}>
            <Icon name="plus" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {hasSmart || feed.length ? (
          <View testID="smart-feed" style={{ marginBottom: spacing.lg }}>
            <View style={styles.feedHead}>
              <Text style={styles.feedTitle}>Recent alerts</Text>
              {hasSmart ? <Pressable testID="smart-check-now" onPress={checkNow} disabled={checking} style={styles.checkBtn}>
                <Icon name="refresh-cw" size={13} color={colors.brandPrimary} />
                <Text style={styles.checkText}>{checking ? "Checking…" : "Check now"}</Text>
              </Pressable> : null}
            </View>
            <Text style={styles.emptySub}>Setups checked every 30 min (max 3/day) · saved strategies every 5 min · price alerts every 2 min in market hours</Text>
            {feed.map((e) => {
              const priceEvt = e.kind === "price_below" || e.kind === "price_above";
              return (
              <Pressable key={e.event_id} testID={`feed-${e.event_id}`} onPress={() => priceEvt ? router.push(`/ticker/${e.ticker}` as any) : e.kind?.startsWith("strategy_") ? router.push("/(tabs)/portfolio" as any) : router.push({ pathname: "/(tabs)/analyze", params: { ticker: e.ticker, strategy: e.strategy, range: e.expiration_days > 45 ? "3months" : e.expiration_days > 10 ? "month" : "week" } } as any)} style={styles.feedRow}>
                <View style={styles.iconWrap}><Icon name={e.kind === "price_below" ? "trending-down" : e.kind === "price_above" ? "trending-up" : e.kind === "strategy_target" ? "target" : e.kind === "strategy_stop" ? "shield" : "zap"} size={16} color={e.kind === "strategy_stop" ? colors.error : e.kind === "strategy_target" ? colors.success : colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTicker}>{e.title}</Text>
                  <Text style={styles.rowDesc}>{e.message} · {new Date(e.created_at).toLocaleString()}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.muted} />
              </Pressable>
              );
            })}
            {!feed.length ? <Text style={styles.rowDesc}>No setup alerts yet.</Text> : null}
          </View>
        ) : null}
        {items.map((it) => (
          <View key={it.alert_id} style={styles.row}>
            <View style={styles.iconWrap}>
              <Icon name={(KINDS.find((k) => k.id === it.kind)?.icon || "bell") as any} size={16} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.rowTicker}>{it.ticker}</Text>
                <Badge text={it.triggered_at ? "triggered" : it.active ? "active" : "paused"} kind={it.triggered_at ? "warn" : it.active ? "success" : "info"} />
              </View>
              <Text style={styles.rowDesc}>
                {it.kind === "earnings" ? "Earnings approaching reminder" : it.kind === "smart_setup" ? `New 70%+ setups · ${PROFILE_OPTS.find((p) => p.id === it.note)?.label || "Low risk"}` : `${it.note ? `${it.note} · ` : ""}${it.kind.replace("_", " ")} $${it.threshold}${it.triggered_price ? ` · hit $${it.triggered_price}` : ""}`}
              </Text>
            </View>
            <Pressable testID={`alert-remove-${it.alert_id}`} onPress={() => remove(it.alert_id)} style={styles.removeBtn}>
              <Icon name="trash-2" size={14} color={colors.muted} />
            </Pressable>
          </View>
        ))}

        {!items.length && (
          <View style={styles.empty}>
            <Icon name="bell-off" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>No alerts yet. Create one to get notified on price moves or earnings dates.</Text>
            <Text style={styles.emptySub}>Alerts fire via push notification on signed native builds.</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New alert</Text>
              <Pressable testID="close-alert" onPress={() => setOpen(false)} style={styles.removeBtn}>
                <Icon name="x" size={16} color={colors.muted} />
              </Pressable>
            </View>
            {kind !== "smart_setup" ? <Input testID="alert-ticker" label="Ticker" value={ticker} onChangeText={(v) => setTicker(v.toUpperCase())} placeholder="e.g., AAPL" autoCapitalize="characters" /> : null}
            <Text style={styles.chipLabel}>Trigger</Text>
            <View style={styles.chipsWrap}>
              {KINDS.map((k) => {
                const active = kind === k.id;
                return (
                  <Pressable key={k.id} testID={`alert-kind-${k.id}`} onPress={() => setKind(k.id)} style={[styles.chip, active && styles.chipActive]}>
                    <Icon name={k.icon as any} size={13} color={active ? colors.onBrandPrimary : colors.onSurface} />
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>  {k.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {kind === "smart_setup" ? (
              <>
                <Text style={styles.chipLabel}>Risk profile</Text>
                <View style={styles.chipsWrap}>
                  {PROFILE_OPTS.map((p) => (
                    <Pressable key={p.id} testID={`smart-profile-${p.id}`} onPress={() => setProfile(p.id)} style={[styles.chip, profile === p.id && styles.chipActive]}>
                      <Text style={[styles.chipText, profile === p.id && styles.chipTextActive]}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.emptySub, { marginBottom: spacing.md, textAlign: "left" }]}>Scans all stocks every 30 min in market hours and alerts you (max 3/day) when a new 70%+ POP setup your options level allows appears. Push works in a phone build, not Expo Go.</Text>
              </>
            ) : null}
            {(kind === "price_above" || kind === "price_below") ? (
              <Input testID="alert-threshold" label="Price threshold ($)" value={threshold} onChangeText={setThreshold} keyboardType="numeric" placeholder="e.g., 350" />
            ) : null}
            <Button testID="alert-create" label="Create alert" onPress={add} loading={loading} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 26, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },

  scroll: { padding: spacing.lg, paddingBottom: 100 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  rowTicker: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  rowDesc: { fontSize: 12, color: colors.muted, marginTop: 2 },
  removeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },

  feedHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  feedTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface },
  checkBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandSecondary },
  checkText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12 },
  feedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.onSurface, fontSize: 14, textAlign: "center", fontWeight: "600", lineHeight: 20 },
  emptySub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },

  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  modal: { backgroundColor: colors.sheet, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 48 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface },

  chipLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  chip: { flexDirection: "row", paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },
}));
