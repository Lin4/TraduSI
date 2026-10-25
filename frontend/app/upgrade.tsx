import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, Platform, Modal, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { PLAN_CARDS, FREE_CARD, usePlan, tierLabel } from "@/src/plans";
import { useSubscription, rcEnabled, rcSimulated, PACKAGE_TIER } from "@/src/revenuecat";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

type PlanId = "simple" | "advance" | "expert";

export default function Upgrade() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh, user } = useAuth();
  const plan = usePlan();
  const sub = useSubscription();
  const [selected, setSelected] = useState<PlanId>("advance");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<any>(null);
  const pendingSession = useRef<string | null>(null);

  // Apple in-app purchase only in real iOS builds; Expo Go / web preview would only show a simulated Test Store button
  const showApple = rcEnabled && !rcSimulated && Platform.OS === "ios";
  const showStripe = Platform.OS !== "ios" || __DEV__; // iPhone store builds use Apple in-app purchase
  const rcPackage = (sub.offerings?.current?.availablePackages || []).find((p: any) => PACKAGE_TIER[p.identifier] === selected);

  const verifyStripe = async (sid: string) => {
    for (let i = 0; i < 8; i++) {
      try {
        const r = await api(`/api/billing/stripe/status/${sid}`);
        if (r.paid) { await refresh(); toast(`${r.plan} plan active`, "success"); pendingSession.current = null; return true; }
        if (r.status === "expired") break;
      } catch {}
      await new Promise((res) => setTimeout(res, 2000));
    }
    return false;
  };

  useEffect(() => {
    const subApp = AppState.addEventListener("change", (s) => {
      if (s === "active" && pendingSession.current) verifyStripe(pendingSession.current);
    });
    return () => subApp.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payStripe = async () => {
    setBusy(true);
    try {
      const returnUrl = Platform.OS === "web" ? `${window.location.origin}/billing-success` : undefined;
      const r = await api("/api/billing/stripe/checkout", { method: "POST", body: JSON.stringify({ plan: selected, return_url: returnUrl }) });
      pendingSession.current = r.session_id;
      if (Platform.OS === "web") { window.location.assign(r.url); return; }
      await WebBrowser.openBrowserAsync(r.url);
      const ok = await verifyStripe(r.session_id);
      if (!ok) toast("Payment not completed yet", "info");
    } catch (e: any) { toast(e.message || "Checkout failed", "error"); } finally { setBusy(false); }
  };

  const buyApple = async () => {
    if (!rcPackage) return;
    setConfirm(null);
    try {
      await sub.purchase(rcPackage);
      toast(`${selected} plan active`, "success");
    } catch (e: any) {
      if (e?.userCancelled) return;
      toast(e?.message === "identity_not_ready" ? "Account not linked to App Store yet — try again in a moment" : e?.message || "Purchase failed", "error");
    }
  };

  const restore = async () => {
    try { await sub.restore(); toast("Purchases restored", "success"); } catch (e: any) { toast(e?.message || "Restore failed", "error"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="upgrade-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Choose your plan</Text>
          <Text testID="upgrade-current" style={styles.sub}>
            Current: {tierLabel(plan.tier)}{plan.tier === "trial" ? ` · ${plan.trialDaysLeft} day${plan.trialDaysLeft === 1 ? "" : "s"} left` : ""}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}>
        {plan.expired ? (
          <View testID="upgrade-trial-ended" style={styles.ended}>
            <Icon name="clock" size={16} color={colors.brandPrimary} />
            <Text style={styles.endedText}>Your 7-day free trial has ended. Pick a plan to run new screens again. Your saved portfolio and alerts are still there.</Text>
          </View>
        ) : null}
        <View testID="upgrade-plan-free" style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{FREE_CARD.name}</Text>
            {plan.tier === "trial" ? <Text style={styles.currentTag}>CURRENT</Text> : plan.expired ? <Text style={styles.endedTag}>ENDED</Text> : null}
            <Text style={styles.price}>$0<Text style={styles.per}> · 7 days</Text></Text>
          </View>
          {FREE_CARD.features.map((f) => (
            <View key={f} style={styles.feat}><Icon name="check" size={13} color={colors.brandPrimary} /><Text style={styles.featText}>{f}</Text></View>
          ))}
        </View>
        {PLAN_CARDS.map((p) => {
          const active = selected === p.id;
          const current = plan.tier === p.id;
          return (
            <Pressable key={p.id} testID={`upgrade-plan-${p.id}`} onPress={() => setSelected(p.id as PlanId)} style={[styles.card, active && styles.cardActive]}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{p.name}</Text>
                {current ? <Text style={styles.currentTag}>CURRENT</Text> : null}
                <Text style={styles.price}>${p.price}<Text style={styles.per}>/mo</Text></Text>
              </View>
              {p.features.map((f) => (
                <View key={f} style={styles.feat}><Icon name="check" size={13} color={colors.brandPrimary} /><Text style={styles.featText}>{f}</Text></View>
              ))}
            </Pressable>
          );
        })}
        <Text style={styles.renew}>Monthly subscription · renews automatically · cancel anytime</Text>

        <Text style={styles.section}>Pay with</Text>
        {showApple ? (
          <View>
            <Button testID="pay-apple" label={rcPackage ? `Subscribe with Apple · ${rcPackage.product.priceString}/mo` : "App Store options unavailable right now"}
              onPress={() => setConfirm(rcPackage)} loading={sub.isPurchasing} disabled={!rcPackage || !sub.identityReady} />
            {!sub.identityReady && rcPackage ? <Text style={styles.warn}>Linking your account to the App Store…</Text> : null}
            <Pressable testID="restore-purchases" onPress={restore} style={styles.link}><Text style={styles.linkText}>Restore purchases</Text></Pressable>
          </View>
        ) : null}
        {showStripe ? (
          <View style={{ marginTop: spacing.sm }}>
            <Button testID="pay-card" label="Card · Apple Pay · Google Pay (Stripe)" onPress={payStripe} loading={busy} />
            <Text style={styles.hint}>Secure checkout by Stripe. Apple Pay / Google Pay appear on supported devices & browsers. Cancel anytime from your Profile.</Text>
            <Button testID="pay-paypal" label="PayPal" variant="ghost" onPress={() => router.push(`/paypal?plan=${selected}` as any)} />
          </View>
        ) : null}
        {plan.source && plan.tier !== "trial" ? <Text style={styles.hint}>Billing via {plan.source === "app_store" ? "App Store" : plan.source}{plan.renewsAt ? ` · renews ${new Date(plan.renewsAt).toLocaleDateString()}` : ""}. Signed in as {user?.email}.</Text> : null}
      </ScrollView>

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Confirm subscription</Text>
            <Text style={styles.featText}>{selected} · {confirm?.product?.priceString}/month</Text>
            <Button testID="confirm-apple" label="Subscribe" onPress={buyApple} />
            <Button testID="cancel-apple" label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
          </View>
        </View>
      </Modal>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  scroll: { padding: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  cardActive: { borderColor: colors.brandPrimary, borderWidth: 2, backgroundColor: colors.brandSecondary },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  name: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.onSurface },
  currentTag: { fontSize: 10, fontWeight: "800", color: colors.brandPrimary, letterSpacing: 1 },
  endedTag: { fontSize: 10, fontWeight: "800", color: colors.muted, letterSpacing: 1 },
  ended: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandSecondary, borderWidth: 1, borderColor: colors.brandPrimary, marginBottom: spacing.md },
  endedText: { flex: 1, fontSize: 13, color: colors.onBrandSecondary, lineHeight: 19 },
  price: { fontSize: 20, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  per: { fontSize: 12, color: colors.muted, fontWeight: "600" },
  feat: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  featText: { flex: 1, fontSize: 13, color: colors.onSurface, lineHeight: 19 },
  renew: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { fontSize: 11, color: colors.muted, marginVertical: spacing.sm, lineHeight: 16 },
  warn: { fontSize: 12, color: colors.warning, marginTop: 4 },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  modalWrap: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: spacing.xl },
  modal: { backgroundColor: colors.sheet, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
}));
