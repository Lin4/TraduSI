import React from "react";
import { Pressable, Text, ActivityIndicator, StyleSheet, View, ViewStyle } from "react-native";
import { colors, radius, spacing, useTheme } from "./theme";

type Props = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
  icon?: React.ReactNode;
};

export function Button({ label, onPress, variant = "primary", loading, disabled, style, testID, icon }: Props) {
  useTheme();
  const bg = variant === "primary" ? colors.brandPrimary
    : variant === "secondary" ? colors.brandSecondary
    : "transparent";
  const fg = variant === "primary" ? colors.onBrandPrimary
    : variant === "secondary" ? colors.onBrandSecondary
    : colors.brandPrimary;
  const borderColor = variant === "ghost" ? colors.border : "transparent";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.inner}>
          {icon ? <View style={{ marginRight: spacing.sm }}>{icon}</View> : null}
          <Text style={[styles.label, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  inner: { flexDirection: "row", alignItems: "center" },
  label: { fontSize: 16, fontWeight: "600" },
});
