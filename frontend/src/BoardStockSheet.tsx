import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { OptiIQChart } from "./OptiIQChart";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

/** Valuation board: one stock's 9-method OptiIQ chart in a bottom sheet, with a jump to the full analysis. */
export function BoardStockSheet({ ticker, onClose, onAnalyze }: { ticker: string | null; onClose: () => void; onAnalyze: (t: string) => void }) {
  useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!ticker) return;
    setData(null);
    setErr("");
    api(`/api/valuation/board/${ticker}`).then(setData).catch((e) => setErr(e.message || "Couldn't load this valuation"));
  }, [ticker]);

  return (
    <Modal visible={!!ticker} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View testID="vb-sheet" style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={s.handle} />
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{ticker}{data?.name ? ` · ${data.name}` : ""}</Text>
              {data?.sector ? <Text style={s.sub}>{data.sector}</Text> : null}
            </View>
            <Pressable testID="vb-sheet-close" onPress={onClose} hitSlop={10} style={s.close}><Icon name="x" size={18} color={colors.muted} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {err ? <Text style={s.err}>{err}</Text> : !data ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.xl }} /> : <OptiIQChart o={data.optiiq} />}
          </ScrollView>
          <Pressable testID="vb-sheet-analyze" onPress={() => ticker && onAnalyze(ticker)} style={s.btn} accessibilityRole="button">
            <Icon name="bar-chart-2" size={16} color={colors.onBrandPrimary} />
            <Text style={s.btnText}>Full long-term analysis</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = themedStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.sheet, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  err: { fontSize: 13, color: colors.error, marginVertical: spacing.lg },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 50, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, marginTop: spacing.sm },
  btnText: { fontSize: 15, fontWeight: "800", color: colors.onBrandPrimary },
}));
