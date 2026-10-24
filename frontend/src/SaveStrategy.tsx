import React, { useState } from "react";
import { View, Text, Modal, Pressable, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";

import { api } from "./api";
import { Input } from "./Input";
import { Button } from "./Button";
import { toast } from "./Toast";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export type Thr = { mode: "usd" | "pct"; value: string };

/** "$ / % of max" toggle + amount, shared by save sheet and edit form. */
export function ThresholdField({ label, value, onChange, idPrefix, pctHint }: {
  label: string; value: Thr; onChange: (t: Thr) => void; idPrefix: string; pctHint: string;
}) {
  useTheme();
  return (
    <View style={s.thr}>
      <View style={s.thrHead}>
        <Text style={s.thrLabel}>{label}</Text>
        <View style={s.toggle}>
          {(["usd", "pct"] as const).map((m) => (
            <Pressable key={m} testID={`${idPrefix}-mode-${m}`} onPress={() => onChange({ ...value, mode: m })} style={[s.tBtn, value.mode === m && s.tOn]}>
              <Text style={[s.tText, value.mode === m && s.tTextOn]}>{m === "usd" ? "$" : "%"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Input testID={`${idPrefix}-value`} label={value.mode === "usd" ? "Amount ($)" : pctHint} value={value.value}
        onChangeText={(v) => onChange({ ...value, value: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" placeholder="Optional" />
    </View>
  );
}

export const toThreshold = (t: Thr) => {
  const v = parseFloat(t.value);
  return v > 0 ? { mode: t.mode, value: v } : null;
};

export function SaveStrategySheet({ visible, onClose, ticker, expiration, legs, defaultName, strategyType }: {
  visible: boolean; onClose: () => void; ticker: string; expiration: string | null; legs: any[]; defaultName: string; strategyType?: string | null;
}) {
  useTheme();
  const router = useRouter();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<Thr>({ mode: "pct", value: "50" });
  const [stop, setStop] = useState<Thr>({ mode: "pct", value: "50" });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!expiration) return;
    setBusy(true);
    try {
      await api("/api/strategies", {
        method: "POST",
        body: JSON.stringify({ name: (name || defaultName).trim(), ticker, expiration, legs, target: toThreshold(target), stop: toThreshold(stop), strategy_type: strategyType || undefined }),
      });
      toast("Strategy saved — tracking live in Portfolio", "success");
      onClose();
      setName("");
      router.push("/(tabs)/portfolio" as any);
    } catch (e: any) { toast(e.message || "Save failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>Save strategy</Text>
            <Pressable testID="save-close" onPress={onClose} style={s.close}><Icon name="x" size={16} color={colors.muted} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Input testID="save-name" label="Name" value={name} onChangeText={setName} placeholder={defaultName} />
            <ThresholdField label="Profit target" idPrefix="target" value={target} onChange={setTarget} pctHint="% of max profit" />
            <ThresholdField label="Stop loss" idPrefix="stop" value={stop} onChange={setStop} pctHint="% of max risk" />
            <Text style={s.note}>You&apos;ll get an alert in the Alerts tab (and a push on a phone build) when live P&L reaches either level. Leave blank to skip.</Text>
            <Button testID="save-confirm" label="Save & track" onPress={save} loading={busy} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = themedStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.sheet, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: "90%" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  title: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  thr: { marginBottom: spacing.xs },
  thrHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  thrLabel: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  toggle: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, padding: 2 },
  tBtn: { width: 40, height: 30, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  tOn: { backgroundColor: colors.brandPrimary },
  tText: { fontWeight: "800", color: colors.onSurface },
  tTextOn: { color: colors.onBrandPrimary },
  note: { fontSize: 12, color: colors.muted, marginBottom: spacing.lg, lineHeight: 17 },
}));
