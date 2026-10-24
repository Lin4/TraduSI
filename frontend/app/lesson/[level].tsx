import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Button } from "@/src/Button";
import { LoadingSkeleton } from "@/src/charts";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

export default function Lesson() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { level } = useLocalSearchParams<{ level: string }>();
  const [data, setData] = useState<any>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/learn/levels/${level}`).then((r) => { setData(r); setAnswers(r.quiz.map(() => null)); }).catch((e) => toast(e.message || "Failed", "error"));
  }, [level]);

  const submit = async () => {
    if (answers.some((a) => a === null)) { toast("Answer all questions", "error"); return; }
    setBusy(true);
    try {
      const r = await api(`/api/learn/levels/${level}/quiz`, { method: "POST", body: JSON.stringify({ answers }) });
      setResult(r);
      toast(r.passed ? "Level complete!" : `${r.score}/${r.total} correct — try again`, r.passed ? "success" : "info");
    } catch (e: any) { toast(e.message || "Failed", "error"); } finally { setBusy(false); }
  };

  const retry = () => { setResult(null); setAnswers((a) => a.map(() => null)); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="lesson-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/learn"))} style={styles.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>{data?.title || "Lesson"}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 60 }]}>
        {!data ? <LoadingSkeleton lines={6} /> : (
          <>
            {data.lessons.map((l: any, i: number) => (
              <View key={l.title} testID={`lesson-card-${i}`} style={styles.card}>
                <Text style={styles.step}>Lesson {i + 1}</Text>
                <Text style={styles.cardTitle}>{l.title}</Text>
                <Text style={styles.body}>{l.body}</Text>
              </View>
            ))}
            <Text style={styles.section}>Quiz · 3 questions</Text>
            {data.quiz.map((q: any, qi: number) => {
              const res = result?.results?.[qi];
              return (
                <View key={q.q} style={styles.card}>
                  <Text style={styles.cardTitle}>{qi + 1}. {q.q}</Text>
                  {q.options.map((o: string, oi: number) => {
                    const picked = answers[qi] === oi;
                    const correct = res && res.answer === oi;
                    const wrong = res && picked && !res.correct;
                    return (
                      <Pressable key={o} testID={`quiz-${qi}-${oi}`} disabled={!!result} onPress={() => setAnswers((a) => a.map((x, i) => (i === qi ? oi : x)))}
                        style={[styles.opt, picked && styles.optPicked, correct && styles.optCorrect, wrong && styles.optWrong]}>
                        <Icon name={correct ? "check-circle" : wrong ? "x-circle" : picked ? "disc" : "circle"} size={16}
                          color={correct ? colors.success : wrong ? colors.error : picked ? colors.brandPrimary : colors.muted} />
                        <Text style={styles.optText}>{o}</Text>
                      </Pressable>
                    );
                  })}
                  {res ? <Text style={styles.explain}>{res.explain}</Text> : null}
                </View>
              );
            })}
            {result ? (
              <View testID="quiz-result" style={[styles.resultBox, { borderColor: result.passed ? colors.success : colors.warning }]}>
                <Text style={styles.resultTitle}>{result.passed ? "Level complete 🎉" : `${result.score}/${result.total} correct`}</Text>
                <Text style={styles.body}>{result.passed ? "Badge earned. Your trading level still comes from your broker approval." : "Get all 3 right to earn the badge."}</Text>
                {!result.passed ? <Button testID="quiz-retry" label="Try again" variant="ghost" onPress={retry} /> : null}
              </View>
            ) : (
              <Button testID="quiz-submit" label="Check answers" onPress={submit} loading={busy} />
            )}
          </>
        )}
      </ScrollView>
      <ToastHost />
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: colors.onSurface },
  scroll: { padding: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  step: { fontSize: 10, fontWeight: "800", color: colors.brandPrimary, textTransform: "uppercase", letterSpacing: 1 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: 4, marginBottom: 6 },
  body: { fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19 },
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  opt: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 6 },
  optPicked: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  optCorrect: { borderColor: colors.success },
  optWrong: { borderColor: colors.error },
  optText: { flex: 1, fontSize: 13, color: colors.onSurface, fontWeight: "600" },
  explain: { fontSize: 12, color: colors.muted, fontStyle: "italic", marginTop: spacing.sm },
  resultBox: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, marginTop: spacing.sm },
  resultTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
}));
