import React, { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/feather";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/Button";
import { Input } from "@/src/Input";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

export default function Login() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInEmail, exchangeSessionId } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);

  const onLogin = async () => {
    if (!email || !password) { toast("Enter email and password", "error"); return; }
    setLoading(true);
    try { await signInEmail(email.trim(), password); }
    catch (e: any) {
      toast(e.message || "Login failed", "error");
      if (e.status === 403) router.push({ pathname: "/(auth)/verify-email", params: { email: email.trim().toLowerCase(), resend: "0" } });
    }
    finally { setLoading(false); }
  };

  const onGoogle = async () => {
    setGLoading(true);
    try {
      const redirect = Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      if (Platform.OS === "web") {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
      let url: string | null = null;
      if (result.type === "success") url = result.url;
      if (!url) url = await Linking.getInitialURL();
      if (url) {
        const m = url.match(/[?#&]session_id=([^&#]+)/);
        if (m) await exchangeSessionId(decodeURIComponent(m[1]));
      }
    } catch (e: any) {
      toast(e.message || "Google sign-in failed", "error");
    } finally { setGLoading(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logoBadge}>
              <Icon name="trending-up" size={28} color={colors.onBrandPrimary} />
            </View>
            <Text style={styles.title}>TraduSI</Text>
            <Text style={styles.subtitle}>AI-powered option & stock screening</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in to TraduSI</Text>
            <View style={styles.hint} testID="login-brand-hint">
              <Icon name="info" size={14} color={colors.brandPrimary} />
              <Text style={styles.hintText}>
                Use your TraduSI account — this is not your Expo account.
              </Text>
            </View>
            <Input testID="login-email" label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            <Input testID="login-password" label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
            <Pressable testID="login-forgot" accessibilityRole="link" hitSlop={8} style={styles.forgot}
              onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: { email: email.trim().toLowerCase() } })}>
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
            <Button testID="login-submit" label="Sign in" onPress={onLogin} loading={loading} />
            <View style={styles.dividerRow}>
              <View style={styles.divider} /><Text style={styles.or}>or</Text><View style={styles.divider} />
            </View>
            <Button
              testID="login-google"
              label="Continue with Google"
              variant="ghost"
              loading={gLoading}
              onPress={onGoogle}
              icon={<Icon name="chrome" size={18} color={colors.brandPrimary} />}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New here? </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable testID="go-register"><Text style={styles.link}>Create an account</Text></Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing["2xl"] },
  logoWrap: { alignItems: "center", marginTop: spacing.xl, marginBottom: spacing["2xl"] },
  logoBadge: {
    width: 60, height: 60, borderRadius: radius.lg,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  hint: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface, marginBottom: spacing.lg,
  },
  hintText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 17 },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { marginHorizontal: spacing.md, color: colors.muted, fontSize: 12 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  footerText: { color: colors.muted },
  link: { color: colors.brandPrimary, fontWeight: "700" },
  forgot: { alignSelf: "flex-end", marginTop: -spacing.sm, marginBottom: spacing.lg, minHeight: 32, justifyContent: "center" },
}));
