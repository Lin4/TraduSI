import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, ThemeProvider, DarkTheme, DefaultTheme } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogBox, Platform, View, ActivityIndicator, Text } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth";
import { colors, useTheme, loadThemePreference } from "@/src/theme";
import { registerForPush } from "@/src/push";
import Purchases from "react-native-purchases";
import { initializeRevenueCat, SubscriptionProvider, rcEnabled } from "@/src/revenuecat";

LogBox.ignoreAllLogs(true);

try {
  initializeRevenueCat();
} catch (err) {
  console.warn("RevenueCat unavailable:", err);
}
WebBrowser.maybeCompleteAuthSession();

// Push: module-scope setup (web-guarded)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  useTheme();
  const { user, loading, exchangeSessionId } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let sub: any;
    const tryExchange = async (url: string | null) => {
      const sid = extractSessionId(url);
      if (!sid) return;
      try {
        await exchangeSessionId(sid);
        if (Platform.OS === "web") {
          try {
            const u = new URL(window.location.href);
            u.hash = "";
            u.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", u.toString());
          } catch {}
        }
      } catch (e) { console.warn("session exchange failed", e); }
    };

    if (Platform.OS === "web" && typeof window !== "undefined") {
      tryExchange(window.location.href);
    } else {
      Linking.getInitialURL().then(tryExchange);
      sub = Linking.addEventListener("url", (e) => tryExchange(e.url));
    }
    return () => { sub?.remove?.(); };
  }, [exchangeSessionId]);

  // Push notification tap handlers (native-only)
  useEffect(() => {
    if (Platform.OS === "web") return;

    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as any;
      const url = data.deeplink || data.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = (response.notification.request.content.data || {}) as any;
      const url = data.deeplink || data.action_url;
      if (url) {
        if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
        else router.push(url);
      }
    });

    // Weekly nudge if denied
    (async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;
      const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (lastNudge && Date.now() - Number(lastNudge) <= oneWeek) return;
      // Store so we don't spam
      await AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
    })();

    return () => { tapSub.remove(); };
  }, [router]);

  // Register for push whenever user is set
  useEffect(() => {
    if (user?.user_id) registerForPush(user.user_id);
  }, [user?.user_id]);

  // RevenueCat identity: bind to our stable user id on every auth path
  const rcIdentityRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const [purchaseIdentityError, setPurchaseIdentityError] = useState<string | null>(null);
  useEffect(() => {
    if (!rcEnabled) return;
    (async () => {
      try {
        if (user?.user_id && rcIdentityRef.current !== user.user_id) {
          const { customerInfo } = await Purchases.logIn(user.user_id);
          console.log("[RevenueCat] identity bound:", await Purchases.getAppUserID());
          queryClient.setQueryData(["revenuecat", "customer-info"], customerInfo);
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
          rcIdentityRef.current = user.user_id;
          setPurchaseIdentityError(null);
        } else if (!user?.user_id && rcIdentityRef.current) {
          await Purchases.logOut();
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
          rcIdentityRef.current = null;
        }
      } catch (e) {
        console.warn("[RevenueCat] logIn failed:", e);
        setPurchaseIdentityError(String(e));
      }
    })();
  }, [user?.user_id]);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) {
      router.replace("/(auth)/login");
    } else if (user && inAuth) {
      const onboarded = user.plan && user.questionnaire_complete && user.consent_signed;
      if (onboarded && segments[1] === "questionnaire") return; // editing answers from Profile
      if (!user.plan) router.replace("/(auth)/plan");
      else if (!user.questionnaire_complete) router.replace("/(auth)/questionnaire");
      else if (!user.consent_signed) router.replace("/(auth)/consent");
      else router.replace("/(tabs)");
    } else if (user && !inAuth) {
      if (!user.plan) router.replace("/(auth)/plan");
      else if (!user.questionnaire_complete) router.replace("/(auth)/questionnaire");
      else if (!user.consent_signed) router.replace("/(auth)/consent");
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }
  return (
    <>
      {purchaseIdentityError ? (
        <View testID="rc-identity-error" style={{ backgroundColor: colors.error, padding: 8 }}>
          <Text style={{ color: colors.onError, fontSize: 12 }}>App Store account link failed: {purchaseIdentityError}</Text>
        </View>
      ) : null}
      {children}
    </>
  );
}

export default function RootLayout() {
  const { scheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => { loadThemePreference().finally(() => setThemeReady(true)); }, []);
  useEffect(() => { SystemUI.setBackgroundColorAsync(colors.surface).catch(() => {}); }, [scheme]);
  const navTheme = useMemo(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, primary: colors.brandPrimary, background: colors.surface, card: colors.surface, text: colors.onSurface, border: colors.border } };
  }, [scheme]);
  if (!themeReady) return null; // saved theme loads in a few ms; avoids a light flash for dark-mode users

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <SubscriptionProvider>
                <AuthProvider>
                  <ThemeProvider value={navTheme}>
                    <StatusBar style={scheme === "dark" ? "light" : "dark"} />
                    <AuthGate>
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
                    </AuthGate>
                  </ThemeProvider>
                </AuthProvider>
              </SubscriptionProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
