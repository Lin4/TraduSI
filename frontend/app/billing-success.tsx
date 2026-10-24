import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/Button";
import { colors, spacing, themedStyles, useTheme } from "@/src/theme";

/** Web return page after Stripe checkout: verifies the session and activates the plan. */
export default function BillingSuccess() {
  useTheme();
  const { session_id, cancelled } = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();
  const { refresh } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "paid" | "failed">(cancelled ? "failed" : "checking");
  const [plan, setPlan] = useState("");

  useEffect(() => {
    if (!session_id || cancelled) return;
    let stop = false;
    (async () => {
      for (let i = 0; i < 10 && !stop; i++) {
        try {
          const r = await api(`/api/billing/stripe/status/${session_id}`);
          if (r.paid) { setPlan(r.plan); setState("paid"); await refresh(); return; }
          if (r.status === "expired") break;
        } catch {}
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!stop) setState("failed");
    })();
    return () => { stop = true; };
  }, [session_id, cancelled, refresh]);

  return (
    <View testID="billing-success" style={styles.wrap}>
      {state === "checking" ? <ActivityIndicator color={colors.brandPrimary} size="large" /> : (
        <Icon name={state === "paid" ? "check-circle" : "x-circle"} size={48} color={state === "paid" ? colors.success : colors.error} />
      )}
      <Text style={styles.title}>
        {state === "checking" ? "Confirming your payment…" : state === "paid" ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan active` : cancelled ? "Payment cancelled" : "Payment not confirmed"}
      </Text>
      {state !== "checking" ? <Button testID="billing-continue" label={state === "paid" ? "Start screening" : "Back to plans"} onPress={() => router.replace(state === "paid" ? "/(tabs)" : ("/upgrade" as any))} /> : null}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.surface },
  title: { fontSize: 18, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
}));
