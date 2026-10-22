// Design tokens for TradeSI. Light theme (iOS-Native Clean personality).
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF",
  onSurface: "#111827",
  surfaceSecondary: "#F9FAFB",
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#F3F4F6",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#111827",
  onSurfaceInverse: "#FFFFFF",
  muted: "#9CA3AF",

  brand: "#115E59",
  onBrand: "#FFFFFF",
  brandPrimary: "#0F766E",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#CCFBF1",
  onBrandSecondary: "#0F766E",
  brandTertiary: "#D1FAE5",
  onBrandTertiary: "#065F46",

  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#6B7280",
  onInfo: "#FFFFFF",

  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  divider: "#F3F4F6",

  // valuation board groups (price vs intrinsic value) + intrinsic-value chart line
  valueVeryUnder: "#047857",
  valueVeryUnderBg: "#D1FAE5",
  valueUnder: "#059669",
  valueUnderBg: "#ECFDF5",
  valueFair: "#475569",
  valueFairBg: "#F1F5F9",
  valueOver: "#B45309",
  valueOverBg: "#FEF3C7",
  valueVeryOver: "#B91C1C",
  valueVeryOverBg: "#FEE2E2",
  chartValue: "#2563EB",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const fonts = {
  mono: "Courier",
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;
