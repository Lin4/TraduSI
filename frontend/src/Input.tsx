import React, { useState } from "react";
import { View, Text, TextInput, KeyboardTypeOptions, Pressable } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { colors, radius, spacing, themedStyles, useTheme } from "./theme";

type Props = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  testID?: string;
};

export function Input({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, autoCapitalize, testID }: Props) {
  const { scheme } = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardAppearance={scheme}
          secureTextEntry={secureTextEntry && !visible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? "none"}
          autoCorrect={false}
          style={[styles.input, secureTextEntry && { paddingRight: 52 }]}
        />
        {secureTextEntry ? (
          <Pressable
            testID={testID ? `${testID}-toggle` : "password-toggle"}
            accessibilityRole="button"
            accessibilityLabel={visible ? "Hide password" : "Show password"}
            onPress={() => setVisible((v) => !v)}
            hitSlop={8}
            style={styles.eye}
          >
            <Icon name={visible ? "eye-off" : "eye"} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  label: { color: colors.onSurface, fontSize: 13, fontWeight: "600", marginBottom: spacing.xs },
  wrap: { position: "relative", justifyContent: "center" },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eye: { position: "absolute", right: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
}));
