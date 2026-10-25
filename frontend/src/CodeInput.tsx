import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, Platform, type TextInputInstance } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export const CODE_LEN = 6;

/** 6-box one-time-code input. Box testIDs: `${testID}-boxes`, input: `${testID}-input`, error: `${testID}-error`. */
export function CodeInput({ value, onChange, onComplete, error, hint, testID = "code", autoFocus = true }: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; error?: string; hint?: string;
  testID?: string; autoFocus?: boolean;
}) {
  useTheme();
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => { if (error) input.current?.focus(); }, [error]);

  const change = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, CODE_LEN);
    onChange(digits);
    if (digits.length === CODE_LEN) onComplete?.(digits);
  };

  return (
    <View>
      <Pressable testID={`${testID}-boxes`} onPress={() => input.current?.focus()} style={styles.boxes} accessibilityLabel="6-digit code">
        {Array.from({ length: CODE_LEN }).map((_, i) => {
          const active = focused && i === Math.min(value.length, CODE_LEN - 1);
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, !!error && styles.boxError]}>
              <Text style={styles.digit}>{value[i] || ""}</Text>
            </View>
          );
        })}
        <TextInput
          ref={input}
          testID={`${testID}-input`}
          value={value}
          onChangeText={change}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
          maxLength={CODE_LEN}
          autoFocus={autoFocus}
          caretHidden
          style={styles.hiddenInput}
        />
      </Pressable>
      {error ? (
        <View testID={`${testID}-error`} style={styles.errorRow}>
          <Icon name="alert-circle" size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Seconds-left countdown for "Resend code". */
export function useCountdown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function ResendRow({ wait, sending, onResend, testID = "code" }: { wait: number; sending: boolean; onResend: () => void; testID?: string }) {
  useTheme();
  const mmss = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;
  return (
    <View style={styles.resendRow}>
      {wait > 0 ? (
        <Text testID={`${testID}-resend-timer`} style={styles.muted}>Resend code in {mmss}</Text>
      ) : (
        <Pressable testID={`${testID}-resend`} onPress={onResend} disabled={sending} hitSlop={8} style={styles.resendBtn}>
          <Icon name="refresh-cw" size={14} color={colors.brandPrimary} />
          <Text style={styles.link}>{sending ? "Sending…" : "Resend code"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = themedStyles((colors) => ({
  boxes: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  box: {
    flex: 1, aspectRatio: 0.85, maxHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  boxActive: { borderColor: colors.brandPrimary, borderWidth: 2 },
  boxError: { borderColor: colors.error },
  digit: { fontSize: 24, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  hiddenInput: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: "transparent", fontSize: 1 },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.md, marginBottom: spacing.lg, lineHeight: 17 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, marginBottom: spacing.lg },
  errorText: { flex: 1, fontSize: 13, color: colors.error, fontWeight: "600", lineHeight: 18 },
  resendRow: { alignItems: "center", marginTop: spacing.lg, minHeight: 24, justifyContent: "center" },
  resendBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.md },
  muted: { fontSize: 13, color: colors.muted },
  link: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
}));
