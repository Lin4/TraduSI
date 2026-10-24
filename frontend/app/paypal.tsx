import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

const RETURN_HOST = "optionscope.preview.emergentagent.com";

export default function PaypalCheckout() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useAuth();
  const { plan } = useLocalSearchParams<{ plan: string }>();
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "pay" | "capturing" | "done" | "error">("loading");
  const [error, setError] = useState<string>("");
  const captured = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api("/api/paypal/create-order", { method: "POST", body: JSON.stringify({ plan }) });
        setOrderId(r.order_id);
        setApproveUrl(r.approve_url);
        setStatus("pay");
      } catch (e: any) {
        setError(e.message || "Failed to create order");
        setStatus("error");
      }
    })();
  }, [plan]);

  const capture = async () => {
    if (!orderId || captured.current) return;
    captured.current = true;
    setStatus("capturing");
    try {
      const r = await api("/api/paypal/capture-order", { method: "POST", body: JSON.stringify({ order_id: orderId }) });
      if (r.status === "COMPLETED") {
        await refresh();
        setStatus("done");
        toast(`Upgraded to ${r.plan}`, "success");
        setTimeout(() => router.replace("/profile"), 1200);
      } else {
        setError(`PayPal status: ${r.status}`);
        setStatus("error");
      }
    } catch (e: any) {
      setError(e.message || "Capture failed");
      setStatus("error");
    }
  };

  const onNavChange = (nav: { url: string }) => {
    if (!nav?.url) return;
    if (nav.url.includes("paypal-return") || nav.url.includes("/paypal-return")) {
      capture();
    }
    if (nav.url.includes("paypal-cancel")) {
      router.back();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="paypal-back" onPress={() => router.back()} style={styles.back}>
          <Icon name="x" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Upgrade to {String(plan || "").toUpperCase()}</Text>
      </View>

      {status === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.sub}>Creating PayPal order…</Text>
        </View>
      )}

      {status === "pay" && approveUrl && (
        Platform.OS === "web" ? (
          <View style={styles.center}>
            <Text style={styles.sub}>Opening PayPal checkout…</Text>
            <Pressable testID="paypal-open" style={styles.ctaBtn} onPress={() => {
              const win = window.open(approveUrl, "paypal", "popup");
              const timer = setInterval(async () => {
                if (!win || win.closed) {
                  clearInterval(timer);
                  await capture();
                }
              }, 1500);
            }}>
              <Text style={styles.ctaText}>Open PayPal checkout</Text>
            </Pressable>
            <Pressable testID="paypal-capture-manual" style={styles.secondaryBtn} onPress={capture}>
              <Text style={styles.secondaryText}>I completed payment</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            testID="paypal-webview"
            source={{ uri: approveUrl }}
            onNavigationStateChange={onNavChange}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
          />
        )
      )}

      {status === "capturing" && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
          <Text style={styles.sub}>Finalizing payment…</Text>
        </View>
      )}

      {status === "done" && (
        <View style={styles.center}>
          <Icon name="check-circle" size={48} color={colors.success} />
          <Text style={styles.title}>Upgrade complete</Text>
        </View>
      )}

      {status === "error" && (
        <View style={styles.center}>
          <Icon name="alert-triangle" size={40} color={colors.error} />
          <Text style={styles.sub}>{error}</Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.back()}><Text style={styles.ctaText}>Close</Text></Pressable>
        </View>
      )}
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  sub: { color: colors.muted, fontSize: 14, textAlign: "center" },
  ctaBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "700" },
  secondaryBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.brandPrimary, fontWeight: "700" },
}));
