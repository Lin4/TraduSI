import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/feather";

import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { Button } from "@/src/Button";
import { Input } from "@/src/Input";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

export default function Consent() {
  useTheme();
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!agreed || !signature.trim()) { toast("Please agree and sign", "error"); return; }
    setLoading(true);
    try {
      await api("/api/user/consent", { method: "POST", body: JSON.stringify({ agreed, signature }) });
      await refresh();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.step}>Step 3 of 3</Text>
          <Text style={styles.title}>Consent & disclosures</Text>
          <Text style={styles.subtitle}>Required before you can use TraduSI&apos;s AI recommendations.</Text>

          <View style={styles.doc}>
            <Text style={styles.docTitle}>Risk disclosure</Text>
            <Text style={styles.docP}>
              Trading options and stocks carries substantial risk. All recommendations provided by TraduSI are
              for educational purposes and generated using AI models that may be inaccurate. You are solely
              responsible for your trading decisions and should consult a licensed advisor.
            </Text>
            <Text style={styles.docTitle}>Data use</Text>
            <Text style={styles.docP}>
              Your onboarding answers help personalize AI recommendations. We do not sell personal data. Market
              data is sourced from third-party providers and may be delayed.
            </Text>
            <Text style={styles.docTitle}>No financial advice</Text>
            <Text style={styles.docP}>
              Nothing in this app constitutes investment, legal, or tax advice. Past performance is not indicative
              of future results.
            </Text>
          </View>

          <Pressable testID="consent-agree" onPress={() => setAgreed((v) => !v)} style={styles.agreeRow}>
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed ? <Icon name="check" size={14} color={colors.onBrandPrimary} /> : null}
            </View>
            <Text style={styles.agreeText}>I have read and agree to the terms above.</Text>
          </Pressable>

          <Input
            testID="consent-signature"
            label="Type your full name as signature"
            value={signature}
            onChangeText={setSignature}
            placeholder="e.g., Jane Trader"
            autoCapitalize="words"
          />
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="consent-submit" label="Finish & enter app" onPress={onSubmit} loading={loading} />
      </View>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: 160 },
  step: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12, letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  doc: {
    marginTop: spacing.xl, padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  docTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm },
  docP: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 19 },
  agreeRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong,
    marginRight: spacing.md, alignItems: "center", justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  agreeText: { fontSize: 14, color: colors.onSurface, flex: 1 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
}));
