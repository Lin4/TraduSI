import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { useAuth } from "./auth";
import { useSubscription } from "./revenuecat";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export type Tier = "expired" | "trial" | "simple" | "advance" | "expert";
export const TIER_RANK: Record<Tier, number> = { expired: 0, trial: 1, simple: 2, advance: 3, expert: 4 };
const INF = 100000;

export type Features = {
  scans_per_day: number; alerts: number; smart_alerts: boolean; custom_period: boolean; collateral_views: boolean;
  ai_explain: boolean; backtest: boolean; day_lab: boolean; voice: boolean; daily_push: boolean; strategy_tier: number;
  ai_chat_per_day: number; ai_deep_per_day: number;
};
const base = { smart_alerts: false, custom_period: false, collateral_views: false, ai_explain: false, backtest: false, day_lab: false, voice: false, daily_push: false, ai_chat_per_day: 0, ai_deep_per_day: 0 };
export const FEATURES: Record<Tier, Features> = {
  expired: { ...base, scans_per_day: 0, alerts: 0, strategy_tier: 0 },
  trial: { ...base, scans_per_day: 5, alerts: 3, strategy_tier: 1 },
  simple: { ...base, scans_per_day: 10, alerts: 3, strategy_tier: 1 },
  advance: { scans_per_day: INF, alerts: 20, smart_alerts: true, custom_period: true, collateral_views: true, ai_explain: true, backtest: true, day_lab: false, voice: false, daily_push: false, strategy_tier: 3, ai_chat_per_day: 30, ai_deep_per_day: 5 },
  expert: { scans_per_day: INF, alerts: INF, smart_alerts: true, custom_period: true, collateral_views: true, ai_explain: true, backtest: true, day_lab: true, voice: true, daily_push: true, strategy_tier: 4, ai_chat_per_day: 100, ai_deep_per_day: 25 },
};

export const PLAN_CARDS = [
  { id: "simple", name: "Simple", price: 9, features: ["10 scans a day", "Covered calls & cash-secured puts", "Swing & long-term stock analysis", "3 price alerts", "Learn & live track record"] },
  { id: "advance", name: "Advance", price: 29, features: ["Unlimited scans", "All spreads & iron condors", "Custom periods", "Collateral & margin views", "70%+ smart alerts · 20 alerts", "AI explanations & backtest", "Ask AI chat · 30 questions/day (5 deep)"] },
  { id: "expert", name: "Expert", price: 79, features: ["Everything in Advance", "Naked Sell Put, Sell Call, Short Strangle", "Day-trade lab", "Voice (listen & speak)", "Daily-pick push · unlimited alerts", "Ask AI · 100 questions/day (25 deep with Claude Opus)"] },
];

export const tierLabel = (t: Tier) => (t === "trial" ? "Free trial" : t === "expired" ? "Trial ended" : t.charAt(0).toUpperCase() + t.slice(1));

export function usePlan() {
  const { user } = useAuth();
  const { rcTier } = useSubscription();
  const access = user?.access;
  let tier: Tier = (access?.tier as Tier) || "trial";
  let source = access?.source || null;
  if (rcTier && TIER_RANK[rcTier] > TIER_RANK[tier]) { tier = rcTier; source = "app_store"; }
  const strategyAllowed = (name: string) => {
    const st = FEATURES[tier].strategy_tier;
    if (st >= 4) return true;
    if (st >= 3) return !["Sell Put", "Sell Call", "Short Strangle"].includes(name);
    return ["Cash Secured Put", "Covered Call", "auto"].includes(name);
  };
  return {
    tier, source, features: FEATURES[tier], expired: tier === "expired",
    trialDaysLeft: access?.trial_days_left ?? 0, renewsAt: access?.renews_at, strategyAllowed,
    atLeast: (t: Tier) => TIER_RANK[tier] >= TIER_RANK[t],
  };
}

/** Inline lock shown in place of a gated feature. */
export function LockedFeature({ need, label, testID }: { need: "simple" | "advance" | "expert"; label: string; testID?: string }) {
  useTheme();
  const router = useRouter();
  return (
    <Pressable testID={testID || `locked-${need}`} onPress={() => router.push("/upgrade" as any)} style={s.lock}>
      <Icon name="lock" size={14} color={colors.brandPrimary} />
      <Text style={s.lockText}>{label} · {need.charAt(0).toUpperCase() + need.slice(1)} plan</Text>
      <Text style={s.lockCta}>Upgrade</Text>
    </Pressable>
  );
}

/** Full paywall when the 7-day trial has ended and no plan is active. */
export function PlanGate({ children }: { children: React.ReactNode }) {
  useTheme();
  const { expired } = usePlan();
  const router = useRouter();
  if (!expired) return <>{children}</>;
  return (
    <View testID="paywall" style={s.wall}>
      <View style={s.wallIcon}><Icon name="clock" size={28} color={colors.brandPrimary} /></View>
      <Text style={s.wallTitle}>Your 7-day free trial has ended</Text>
      <Text style={s.wallSub}>Pick a plan to keep screening options. Learn and Profile stay open.</Text>
      <Pressable testID="paywall-upgrade" onPress={() => router.push("/upgrade" as any)} style={s.wallBtn}>
        <Text style={s.wallBtnText}>See plans</Text>
      </Pressable>
    </View>
  );
}

const s = themedStyles((colors) => ({
  lock: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary, marginVertical: spacing.sm },
  lockText: { flex: 1, fontSize: 12, fontWeight: "700", color: colors.onBrandSecondary },
  lockCta: { fontSize: 12, fontWeight: "800", color: colors.brandPrimary },
  wall: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: colors.surface },
  wallIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  wallTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  wallSub: { fontSize: 14, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  wallBtn: { minHeight: 48, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  wallBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
}));
