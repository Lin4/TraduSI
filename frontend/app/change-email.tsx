import React, { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
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

export default function ChangeEmail() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState<"form" | "code">("form");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [wait, setWait] = useCountdown(0);
  const google = user?.auth_method === "google";

  const close = () => (router.canGoBack() ? router.back() : router.replace("/profile" as any));

  const sendCode = async () => {
    const em = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) { toast("Enter a valid new email address", "error"); return; }
    if (!password) { toast("Enter your current password", "error"); return; }
    setSending(true);
    try {
      const r = await api("/api/auth/email-change/request", { method: "POST", body: JSON.stringify({ new_email: em, current_password: password }) });
      setNewEmail(r.email);
      setWait(r.resend_in || 60);
      setCode("");
      setError("");
      setStep("code");
    } catch (e: any) {
      toast(e.message || "Couldn't send the code", "error");
    } finally {
      setSending(false);
    }
  };

  const resend = async () => {
    setSending(true);
    try {
      const r = await api("/api/auth/email-change/resend", { method: "POST" });
      setWait(r.resend_in || 60);
      setCode("");
      setError("");
      toast("New code sent — check your inbox", "success");
    } catch (e: any) {
      toast(e.message || "Couldn't resend the code", "error");
      if (e.status === 404) setStep("form");
    } finally {
      setSending(false);
    }
  };

  const confirm = async (value = code) => {
    if (value.length !== CODE_LEN || loading) return;
    setLoading(true);
    setError("");
    try {
      const r = await api("/api/auth/email-change/confirm", { method: "POST", body: JSON.stringify({ code: value }) });
      await refresh();
      toast(`Email changed to ${r.email}`, "success");
      setTimeout(close, 900);
    } catch (e: any) {
      setError(e.message || "Couldn't confirm the code");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable testID="chg-back" accessibilityRole="button" accessibilityLabel="Back"
            onPress={() => (step === "code" ? setStep("form") : close())} style={styles.back}>
            <Icon name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.badge}><Icon name="at-sign" size={26} color={colors.brandPrimary} /></View>

          {google ? (
            <>
              <Text style={styles.title}>Change email</Text>
              <Text testID="chg-google-note" style={styles.subtitle}>
                You sign in with Google, so your email (<Text style={styles.email}>{user?.email}</Text>) is managed by your Google account and can&apos;t be changed here.
              </Text>
              <Button testID="chg-close" label="Back to profile" variant="ghost" onPress={close} />
            </>
          ) : step === "form" ? (
            <>
              <Text style={styles.title}>Change email</Text>
              <Text style={styles.subtitle}>
                Current email: <Text testID="chg-current-email" style={styles.email}>{user?.email}</Text>{"\n"}
                We&apos;ll send a 6-digit code to your new address to confirm it.
              </Text>
              <View style={styles.card}>
                <Input testID="chg-new-email" label="New email" value={newEmail} onChangeText={setNewEmail} placeholder="new@example.com" keyboardType="email-address" />
                <Input testID="chg-password" label="Current password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
                <Button testID="chg-send" label="Send code to new email" onPress={sendCode} loading={sending} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Confirm new email</Text>
              <Text style={styles.subtitle}>
                Enter the 6-digit code we sent to{"\n"}<Text testID="chg-new-email-address" style={styles.email}>{newEmail}</Text>
              </Text>
              <View style={styles.card}>
                <CodeInput testID="chg-code" value={code} onChange={(v) => { setCode(v); if (error) setError(""); }} onComplete={confirm}
                  error={error} hint="Your old address will get a short notice once the change is done." />
                <Button testID="chg-confirm" label="Confirm new email" onPress={() => confirm()} loading={loading} disabled={code.length !== CODE_LEN} />
                <ResendRow testID="chg" wait={wait} sending={sending} onResend={resend} />
              </View>
              <Pressable testID="chg-edit" onPress={() => setStep("form")} style={styles.change} hitSlop={8}>
                <Text style={styles.muted}>Typo in the address? </Text>
                <Text style={styles.link}>Edit it</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastHost />
    </View>
  );
}
