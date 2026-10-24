import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, useTheme } from "./theme";

type ToastItem = { id: number; message: string; type: "success" | "error" | "info" };
let listeners: ((t: ToastItem) => void)[] = [];
let seq = 0;

export function toast(message: string, type: ToastItem["type"] = "info") {
  const t = { id: ++seq, message, type };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  useTheme();
  const [items, setItems] = React.useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3000);
    };
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  }, []);
  return (
    <View pointerEvents="none" style={styles.host}>
      {items.map((t) => <ToastView key={t.id} item={t} />)}
    </View>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  useTheme();
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(a, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [a]);
  const bg = item.type === "error" ? colors.error : item.type === "success" ? colors.success : colors.surfaceInverse;
  const fg = colors.onSurfaceInverse;
  return (
    <Animated.View style={[styles.toast, { backgroundColor: bg, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
      <Text style={{ color: fg, fontWeight: "600" }}>{item.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingTop: 56, zIndex: 9999 },
  toast: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    maxWidth: "88%",
  },
});
