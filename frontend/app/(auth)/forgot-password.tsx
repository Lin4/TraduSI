import React, { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button } from "@/src/Button";
import { Input } from "@/src/Input";
import { CodeInput, ResendRow, useCountdown, CODE_LEN } from "@/src/CodeInput";
import { ToastHost, toast } from "@/src/Toast";
import { colors, useTheme } from "@/src/theme";
import { authStyles as styles } from "@/src/authStyles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ForgotPassword() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { resetPassword } = useAuth();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(String(params.email || ""));
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useCountdown(0);

  const requestCode = async (isResend = false) => {
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) { toast("Enter a valid email address", "error"); return; }
    setSending(true);
    try {
      const r = await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: em }) });
      setEmail(em);
      setWait(r.resend_in || 60);
      setCode("");
      setError("");
      setStep("reset");
      if (isResend) toast("New code sent — check your inbox", "success");
    } catch (e: any) {
      toast(e.message || "Couldn't send the code", "error");
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (code.length !== CODE_LEN) { setError("Enter the 6-digit code from the email"); return; }
    if (password.length < 6) { toast("New password must be 6+ characters", "error"); return; }
    if (password !== confirm) { toast("Passwords don't match", "error"); return; }
    setLoading(true);
    setError("");
    try {
      await resetPassword(email, code, password); // signs in; root layout routes into the app
      toast("Password updated — you're signed in", "success");
    } catch (e: any) {
      setError(e.message || "Reset failed");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step === "reset") { setStep("email"); setError(""); return; }
    if (router.canGoBack()) router.back(); else router.replace("/(auth)/login");
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable testID="forgot-back" accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.back}>
            <Icon name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.badge}><Icon name={step === "email" ? "lock" : "mail"} size={26} color={colors.brandPrimary} /></View>
          {step === "email" ? (
            <>
              <Text style={styles.title}>Forgot password?</Text>
              <Text style={styles.subtitle}>Enter your account email and we&apos;ll send you a 6-digit code to set a new password.</Text>
              <View style={styles.card}>
                <Input testID="forgot-email" label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                <Button testID="forgot-send" label="Send code" onPress={() => requestCode()} loading={sending} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Set a new password</Text>
              <Text style={styles.subtitle}>
                If an account exists for <Text testID="forgot-email-address" style={styles.email}>{email}</Text>, we sent it a 6-digit code.
              </Text>
              <View style={styles.card}>
                <CodeInput testID="forgot-code" value={code} onChange={(v) => { setCode(v); if (error) setError(""); }}
                  error={error} hint="The code expires in 10 minutes. Can't find it? Check your spam folder." />
                <Input testID="forgot-new-password" label="New password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry />
                <Input testID="forgot-confirm-password" label="Confirm new password" value={confirm} onChangeText={setConfirm} placeholder="Type it again" secureTextEntry />
                <Button testID="forgot-submit" label="Reset password & sign in" onPress={submit} loading={loading} disabled={code.length !== CODE_LEN} />
                <Text style={[styles.muted, { marginTop: 12, fontSize: 12, lineHeight: 17 }]}>For your safety, every other device will be signed out.</Text>
                <ResendRow testID="forgot" wait={wait} sending={sending} onResend={() => requestCode(true)} />
              </View>
              <Pressable testID="forgot-change-email" onPress={() => setStep("email")} style={styles.change} hitSlop={8}>
                <Text style={styles.muted}>Wrong email? </Text>
                <Text style={styles.link}>Change it</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastHost />
    </View>
  );
}
