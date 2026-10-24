import React, { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/Button";
import { CodeInput, ResendRow, useCountdown, CODE_LEN } from "@/src/CodeInput";
import { ToastHost, toast } from "@/src/Toast";
import { colors, useTheme } from "@/src/theme";
import { authStyles as styles } from "@/src/authStyles";

export default function VerifyEmail() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; resend?: string }>();
  const email = String(params.email || "");
  const { verifySignup, resendSignupCode } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useCountdown(Number(params.resend ?? 60) || 0);

  const submit = async (value = code) => {
    if (value.length !== CODE_LEN || loading) return;
    setLoading(true);
    setError("");
    try {
      await verifySignup(email, value); // root layout routes to plan / onboarding once signed in
    } catch (e: any) {
      setError(e.message || "Verification failed");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setSending(true);
    try {
      const r = await resendSignupCode(email);
      setWait(r.resend_in || 60);
      setCode("");
      setError("");
      toast("New code sent — check your inbox", "success");
    } catch (e: any) {
      if (e.status === 404) { toast(e.message, "error"); router.replace("/(auth)/register"); return; }
      toast(e.message || "Couldn't resend the code", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable testID="verify-back" accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/register"))} style={styles.back}>
            <Icon name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.badge}><Icon name="mail" size={26} color={colors.brandPrimary} /></View>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to{"\n"}<Text testID="verify-email-address" style={styles.email}>{email}</Text>
          </Text>

          <View style={styles.card}>
            <CodeInput testID="verify-code" value={code} onChange={(v) => { setCode(v); if (error) setError(""); }} onComplete={submit}
              error={error} hint="The code expires in 10 minutes. Can't find it? Check your spam folder." />
            <Button testID="verify-submit" label="Verify & create account" onPress={() => submit()} loading={loading} disabled={code.length !== CODE_LEN} />
            <ResendRow testID="verify" wait={wait} sending={sending} onResend={resend} />
          </View>

          <Pressable testID="verify-change-email" onPress={() => router.replace("/(auth)/register")} style={styles.change} hitSlop={8}>
            <Text style={styles.muted}>Wrong email? </Text>
            <Text style={styles.link}>Change it</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastHost />
    </View>
  );
}
