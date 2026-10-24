import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { spacing, radius, themedStyles, useTheme } from "@/src/theme";

type Multi = { id: string; q: string; opts: string[] };
type Single = { id: string; q: string; opts: string[] };

const OBJECTIVES: Multi = {
  id: "objectives",
  q: "What are your investing objectives?",
  opts: ["Day trading", "Swing trading", "Long-term investing", "Options income", "Directional options", "Hedging"],
};

const SECTOR_PREFS: Multi = {
  id: "preferred_sectors",
  q: "Any preferred sectors? (optional)",
  opts: ["Tech", "Healthcare", "Financials", "Energy", "Consumer Discretionary", "Consumer Staples", "Industrials", "Index/ETF"],
};

const EXCLUDED: Multi = {
  id: "excluded",
  q: "Anything you want to exclude?",
  opts: ["Leveraged ETFs", "Penny stocks", "Short selling", "Crypto exposure", "Earnings weeks"],
};

const SINGLES: Single[] = [
  { id: "experience", q: "Trading experience?", opts: ["None", "Beginner", "Intermediate", "Advanced"] },
  { id: "horizon", q: "Investment horizon?", opts: ["Intraday", "1-10 days", "1-6 months", "Years"] },
  { id: "risk_tolerance", q: "Risk tolerance — comfort with uncertainty?", opts: ["Low", "Moderate", "High"] },
  { id: "risk_capacity", q: "Risk capacity — ability to withstand a loss?", opts: ["Low", "Moderate", "High"] },
  { id: "capital", q: "Approximate investable capital?", opts: ["< $5k", "$5k–$25k", "$25k–$100k", "> $100k"] },
  { id: "max_loss", q: "Maximum acceptable single-trade loss?", opts: ["< $100", "$100–$500", "$500–$2k", "> $2k"] },
  { id: "options_level", q: "Options approval level?", opts: ["Not approved", "Level 1-2", "Level 3+", "Full access"] },
  { id: "account_type", q: "Account type? (sets which strategies & collateral apply)", opts: ["Cash", "Margin (Reg T)", "Portfolio margin", "IRA"] },
];

export default function Questionnaire() {
  useTheme();
  const insets = useSafeAreaInsets();
  const { refresh, user } = useAuth();
  const router = useRouter();
  const editing = !!(user?.questionnaire_complete && user?.consent_signed);
  const [answers, setAnswers] = useState<Record<string, any>>({ objectives: [], preferred_sectors: [], excluded: [], ...(user?.questionnaire || {}) });
  const [loading, setLoading] = useState(false);

  const setA = (id: string, v: string) => setAnswers((s) => ({ ...s, [id]: v }));
  const toggleMulti = (id: string, v: string) => {
    setAnswers((s) => {
      const cur: string[] = s[id] || [];
      return { ...s, [id]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  };

  const onSubmit = async () => {
    if (!(answers.objectives || []).length) { toast("Pick at least one objective", "error"); return; }
    const missing = SINGLES.filter((q) => !answers[q.id]);
    if (missing.length) { toast(`Please answer: ${missing[0].q}`, "error"); return; }
    setLoading(true);
    try {
      await api("/api/user/questionnaire", { method: "POST", body: JSON.stringify({ answers }) });
      await refresh();
      if (editing) {
        if (router.canGoBack()) router.back(); else router.replace("/profile");
      }
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.step}>{editing ? "Edit answers" : "Step 2 of 3"}</Text>
          <Text style={styles.title}>Tell us about you</Text>
          <Text style={styles.subtitle}>Shapes which ideas we rank. ~2 minutes.</Text>

          <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
            <MultiBlock q={OBJECTIVES} value={answers.objectives || []} onToggle={(v) => toggleMulti(OBJECTIVES.id, v)} />
            {SINGLES.map((q) => (
              <View key={q.id}>
                <Text style={styles.qlabel}>{q.q}</Text>
                <View style={styles.optsRow}>
                  {q.opts.map((o) => {
                    const active = answers[q.id] === o;
                    return (
                      <Pressable key={o} testID={`q-${q.id}-${o}`} onPress={() => setA(q.id, o)} style={[styles.opt, active && styles.optActive]}>
                        <Text style={[styles.optText, active && styles.optTextActive]}>{o}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <MultiBlock q={SECTOR_PREFS} value={answers.preferred_sectors || []} onToggle={(v) => toggleMulti(SECTOR_PREFS.id, v)} optional />
            <MultiBlock q={EXCLUDED} value={answers.excluded || []} onToggle={(v) => toggleMulti(EXCLUDED.id, v)} optional />
          </View>

          <Text style={styles.disclaimer}>We never sell personal data. Your answers only shape the ranking engine.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="quest-submit" label={editing ? "Save answers" : "Continue"} onPress={onSubmit} loading={loading} />
      </View>
      <ToastHost />
    </View>
  );
}

function MultiBlock({ q, value, onToggle, optional }: { q: Multi; value: string[]; onToggle: (v: string) => void; optional?: boolean }) {
  useTheme();
  return (
    <View>
      <Text style={styles.qlabel}>{q.q}{optional ? " " : ""}{optional ? <Text style={styles.opt_}>(optional)</Text> : null}</Text>
      <View style={styles.optsRow}>
        {q.opts.map((o) => {
          const active = value.includes(o);
          return (
            <Pressable key={o} testID={`q-${q.id}-${o}`} onPress={() => onToggle(o)} style={[styles.opt, active && styles.optActive]}>
              <Text style={[styles.optText, active && styles.optTextActive]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: 140 },
  step: { color: colors.brandPrimary, fontWeight: "700", fontSize: 12, letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  qlabel: { fontSize: 15, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.sm },
  opt_: { fontSize: 12, color: colors.muted, fontWeight: "400" },
  optsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  opt: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  optActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  optTextActive: { color: colors.onBrandPrimary },
  disclaimer: { color: colors.muted, fontSize: 11, marginTop: spacing.xl, fontStyle: "italic", textAlign: "center", lineHeight: 16 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
}));
