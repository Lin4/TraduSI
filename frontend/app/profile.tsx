import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme, useThemePreference, setThemePreference, type ThemePreference } from "@/src/theme";
import { usePlan, tierLabel, PLAN_CARDS, FREE_CARD } from "@/src/plans";
import { MetricRow } from "@/src/parts";
import { LoadingSkeleton } from "@/src/charts";

const PLANS = ["free", "simple", "advance", "expert"];
const PRICE: Record<string, string> = { trial: "Free · 7 days", expired: "Free · ended", simple: "$9/mo", advance: "$29/mo", expert: "$79/mo" };
const ENDED_FEATURES = ["Trial ended: new screens and analysis are locked", "Your saved portfolio and alerts stay visible", "Pick a plan to unlock everything again"];
const Q_FIELDS: [string, string][] = [
  ["experience", "Experience"], ["risk_tolerance", "Risk tolerance"], ["capital", "Capital"],
  ["account_type", "Account type"], ["options_level", "Options level"],
];
const THEME_OPTS: { id: ThemePreference; label: string; icon: string }[] = [
  { id: "system", label: "System", icon: "smartphone" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];

export default function Profile() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const plan = usePlan();
  const planFeatures = plan.tier === "trial" ? FREE_CARD.features : plan.tier === "expired" ? ENDED_FEATURES : (PLAN_CARDS.find((c) => c.id === plan.tier)?.features || []);
  const [loading, setLoading] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const q = (user?.questionnaire || {}) as Record<string, any>;
  const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

  useEffect(() => { refresh(); }, [refresh]);

  const choosePlan = async (p: string) => {
    if (p !== "free") { router.push("/upgrade" as any); return; }
    setLoading(true);
    try { await api("/api/billing/downgrade", { method: "POST" }); await refresh(); toast("Switched to Free (trial rules apply)", "success"); }
    catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  };

  const testPush = async () => {
    if (!plan.features.daily_push) { toast("Daily-pick push is an Expert feature", "info"); router.push("/upgrade" as any); return; }
    setPushBusy(true);
    try {
      const r = await api("/api/push/daily-pick", { method: "POST" });
      if (r.ok) toast(`Push sent for ${r.ticker}`, "success");
      else toast("Push blocked (available after deploy + build)", "info");
    } catch (e: any) { toast(e.message || "Push failed", "error"); }
    finally { setPushBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="profile-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}>
        {!user ? <LoadingSkeleton lines={6} /> : (
        <>
        <Text style={styles.section}>Account</Text>
        <View testID="account-card" style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm }}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text testID="profile-name" style={styles.name}>{user?.name}</Text>
              <Text testID="profile-email" style={styles.email}>{user?.email}</Text>
            </View>
          </View>
          <MetricRow label="Sign-in method" value={user?.auth_method === "google" ? "Google" : "Email & password"} mono={false} />
          {memberSince ? <MetricRow label="Member since" value={memberSince} mono={false} /> : null}
          {user?.auth_method === "google" ? (
            <View testID="profile-email-google" style={styles.googleNote}>
              <Icon name="info" size={14} color={colors.muted} />
              <Text style={styles.googleNoteText}>Your email is managed by your Google account.</Text>
            </View>
          ) : (
            <Pressable testID="profile-change-email" onPress={() => router.push("/change-email" as any)} style={styles.changeRow}>
              <Icon name="at-sign" size={16} color={colors.brandPrimary} />
              <Text style={styles.changeText}>Change email</Text>
              <Icon name="chevron-right" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>

        <Text style={styles.section}>Plan</Text>
        <View testID="plan-card" style={[styles.card, styles.planCard]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text testID="plan-current-name" style={styles.planName}>{tierLabel(plan.tier).toUpperCase()}</Text>
            <Text style={styles.planPrice}>{PRICE[plan.tier]}</Text>
          </View>
          <Text style={styles.included}>What&apos;s included</Text>
          {plan.tier === "trial" ? <Text testID="trial-days" style={styles.featText}>{plan.trialDaysLeft} day{plan.trialDaysLeft === 1 ? "" : "s"} left in your free trial</Text> : null}
          {plan.renewsAt && plan.tier !== "trial" ? <Text style={styles.featText}>Renews {new Date(plan.renewsAt).toLocaleDateString()} via {plan.source}</Text> : null}
          {plan.source === "app_store" ? <Text style={styles.featText}>Billed by the App Store</Text> : null}
          {planFeatures.map((f) => (
            <View key={f} style={styles.featRow}>
              <Icon name="check" size={14} color={colors.brandPrimary} />
              <Text style={styles.featText}>{f}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.section, { marginTop: spacing.lg }]}>Change plan</Text>
        <View style={styles.planRow}>
          {PLANS.map((p) => {
            const active = plan.tier === p || (p === "free" && (plan.tier === "trial" || plan.tier === "expired"));
            const price = p === "simple" ? "$9" : p === "advance" ? "$29" : p === "expert" ? "$79" : "Free";
            return (
              <Pressable key={p} testID={`profile-plan-${p}`} onPress={() => choosePlan(p)} disabled={loading} style={[styles.planChip, active && styles.planChipActive]}>
                <Text style={[styles.planChipText, active && styles.planChipTextActive]}>{p.toUpperCase()}</Text>
                <Text style={[styles.planChipPrice, active && styles.planChipTextActive]}>{price}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>Pay by card, Apple Pay, Google Pay (Stripe), PayPal, or Apple in-app purchase on iPhone. Monthly, auto-renewing.</Text>
        <Button testID="profile-upgrade" label="See plans & upgrade" onPress={() => router.push("/upgrade" as any)} />

        <Text style={styles.section}>Trading profile</Text>
        <View testID="trading-profile-card" style={styles.card}>
          {Q_FIELDS.map(([k, label]) => (
            <MetricRow key={k} label={label} value={q[k] || "—"} mono={false} />
          ))}
          <View style={{ marginTop: spacing.sm }}>
            <Button testID="edit-answers" label="Edit answers" variant="ghost" onPress={() => router.push("/(auth)/questionnaire" as any)} />
          </View>
        </View>
        </>
        )}

        {user?.is_admin ? (
          <>
            <Text style={styles.section}>Admin</Text>
            <Pressable testID="admin-open" onPress={() => router.push("/admin" as any)} style={styles.pushRow}>
              <Icon name="shield" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pushTitle}>Manage user plans</Text>
                <Text style={styles.pushSub}>Grant or change any user&apos;s plan in one tap</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.muted} />
            </Pressable>
          </>
        ) : null}

        <Text style={styles.section}>Appearance</Text>
        <ThemePicker />

        <Text style={styles.section}>Notifications</Text>
        <Pressable testID="push-test-btn" onPress={testPush} disabled={pushBusy} style={styles.pushRow}>
          <Icon name="bell" size={18} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pushTitle}>Send me a sample daily pick</Text>
            <Text style={styles.pushSub}>Only works in a signed native build - earnings reminders and daily picks will fire automatically.</Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.muted} />
        </Pressable>

        <Text style={styles.section}>Onboarding</Text>
        <View style={styles.card}>
          <Row icon="check-circle" label="Plan selected" done={!!user?.plan} />
          <Row icon="file-text" label="Questionnaire" done={!!user?.questionnaire_complete} />
          <Row icon="edit-3" label="Consent signed" done={!!user?.consent_signed} />
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <Button testID="profile-signout" label="Sign out" variant="ghost" onPress={signOut} />
        </View>
        <Text style={styles.disclaimer}>Research only. AI recommendations are educational — not financial advice.</Text>
      </ScrollView>
      <ToastHost />
    </View>
  );
}

function ThemePicker() {
  useTheme();
  const pref = useThemePreference();
  return (
    <>
      <View testID="theme-picker" accessibilityRole="radiogroup" style={styles.segment}>
        {THEME_OPTS.map((o) => {
          const on = pref === o.id;
          return (
            <Pressable key={o.id} testID={`theme-picker-${o.id}`} onPress={() => setThemePreference(o.id)} accessibilityRole="radio"
              accessibilityState={{ checked: on }} style={[styles.segItem, on && styles.segItemOn]}>
              <Icon name={o.icon as any} size={15} color={on ? colors.onSurface : colors.muted} />
              <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>System follows your phone&apos;s light or dark setting.</Text>
    </>
  );
}

function Row({ icon, label, done }: { icon: string; label: string; done: boolean }) {
  useTheme();
  return (
    <View style={styles.rowItem}>
      <Icon name={icon as any} size={16} color={done ? colors.success : colors.muted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Icon name={done ? "check" : "circle"} size={14} color={done ? colors.success : colors.muted} />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  planCard: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  planName: { fontSize: 20, fontWeight: "800", color: colors.onBrandSecondary, letterSpacing: -0.3 },
  planPrice: { fontSize: 15, fontWeight: "800", color: colors.onBrandSecondary, fontVariant: ["tabular-nums"] },
  included: { fontSize: 11, fontWeight: "700", color: colors.onBrandSecondary, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md, marginBottom: 4 },
  featRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  featText: { fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },

  scroll: { padding: spacing.lg, paddingBottom: 60 },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: "800" },
  name: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  email: { fontSize: 13, color: colors.muted, marginTop: 2 },
  section: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.xl, marginBottom: spacing.sm },
  planRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  planChip: { paddingHorizontal: spacing.md, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  planChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  planChipText: { fontSize: 11, fontWeight: "700", color: colors.onSurface },
  planChipPrice: { fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"] },
  planChipTextActive: { color: colors.onBrandPrimary },
  hint: { color: colors.muted, fontSize: 11, marginTop: spacing.sm },
  pushRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  pushTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  pushSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  rowItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10 },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  disclaimer: { marginTop: spacing.xl, fontSize: 11, color: colors.muted, textAlign: "center", lineHeight: 16 },
  changeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  changeText: { flex: 1, color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  googleNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  googleNoteText: { flex: 1, color: colors.muted, fontSize: 12 },
  segment: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  segItem: { flex: 1, height: 44, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  segItemOn: { backgroundColor: colors.surface, boxShadow: "0px 1px 3px rgba(0,0,0,0.18)" },
  segText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  segTextOn: { color: colors.onSurface, fontWeight: "700" },
}));
