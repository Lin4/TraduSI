// Design tokens for TraduSI: light + dark themes (iOS-Native Clean personality).
// `colors` and `themedStyles()` always resolve to the active theme; components call useTheme() so they
// re-render when the user switches System / Light / Dark in Profile (saved on the device).
import { useMemo, useSyncExternalStore } from "react";
import { Appearance, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
  chartMa50: "#D97706",
  chartMa200: "#7C3AED",
  chartFib: "#94A3B8",

  // status pill / scenario cell / modal scrim backgrounds
  warnBg: "#FEF3C7",
  onWarnBg: "#92400E",
  errorBg: "#FEE2E2",
  gainBg: "#ECFDF5",
  lossBg: "#FEF2F2",
  backdrop: "rgba(0,0,0,0.4)",
  sheet: "#FFFFFF", // bottom sheets / dialogs
};

export type ThemeColors = typeof light;

const dark: ThemeColors = {
  // this codebase paints screens with `surface` and cards with `surfaceSecondary`
  surface: "#000000",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1C1C1E",
  onSurfaceSecondary: "#E5E5EA",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#8E8E93",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#000000",
  muted: "#9CA3AF",

  brand: "#14B8A6",
  onBrand: "#042F2E",
  brandPrimary: "#2DD4BF",
  onBrandPrimary: "#042F2E",
  brandSecondary: "#134E4A",
  onBrandSecondary: "#5EEAD4",
  brandTertiary: "#042F2E",
  onBrandTertiary: "#2DD4BF",

  success: "#34D399",
  onSuccess: "#022C22",
  warning: "#FBBF24",
  onWarning: "#451A03",
  error: "#F87171",
  onError: "#450A0A",
  info: "#9CA3AF",
  onInfo: "#111827",

  border: "#38383A",
  borderStrong: "#545456",
  divider: "#2C2C2E",

  valueVeryUnder: "#34D399",
  valueVeryUnderBg: "#022C22",
  valueUnder: "#6EE7B7",
  valueUnderBg: "#064E3B",
  valueFair: "#94A3B8",
  valueFairBg: "#1E293B",
  valueOver: "#FBBF24",
  valueOverBg: "#451A03",
  valueVeryOver: "#F87171",
  valueVeryOverBg: "#450A0A",
  chartValue: "#94A3B8",
  chartMa50: "#FBBF24",
  chartMa200: "#A78BFA",
  chartFib: "#64748B",

  warnBg: "#451A03",
  onWarnBg: "#FBBF24",
  errorBg: "#450A0A",
  gainBg: "#022C22",
  lossBg: "#450A0A",
  backdrop: "rgba(0,0,0,0.7)",
  sheet: "#1C1C1E",
};

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: Record<ColorScheme, ThemeColors> = { light, dark };

// ---- theme preference store -------------------------------------------------------------
export type ThemePreference = "system" | "light" | "dark";
const PREF_KEY = "theme_preference";
const asScheme = (s: string | null | undefined): ColorScheme => (s === "dark" ? "dark" : "light");
let preference: ThemePreference = "system";
let systemScheme: ColorScheme = asScheme(Appearance.getColorScheme());
let activeScheme: ColorScheme = systemScheme;
const listeners = new Set<() => void>();

function publish() {
  activeScheme = preference === "system" ? systemScheme : preference;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

Appearance.addChangeListener(({ colorScheme }) => {
  if (preference !== "system") return; // the override itself also fires this listener
  systemScheme = asScheme(colorScheme);
  publish();
});

/** Switch theme now and remember it on this device. Native UI (alerts, keyboard, status bar) follows too. */
export function setThemePreference(p: ThemePreference) {
  preference = p;
  AsyncStorage.setItem(PREF_KEY, p).catch(() => {});
  Appearance.setColorScheme?.(p === "system" ? "unspecified" : p);
  if (p === "system") systemScheme = asScheme(Appearance.getColorScheme());
  publish();
}

/** Restore the saved choice at launch (resolves once applied, so the first screen paints in the right theme). */
export async function loadThemePreference() {
  const saved = await AsyncStorage.getItem(PREF_KEY).catch(() => null);
  if (saved === "light" || saved === "dark") setThemePreference(saved);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference, () => preference);
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const fonts = {
  mono: "Courier",
};

/** Active theme. Calling it subscribes the component, so it re-renders when the theme changes. */
export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const scheme = useSyncExternalStore(subscribe, () => activeScheme, () => activeScheme);
  return { scheme, colors: themes[scheme] };
}

/** Module-level stylesheet whose values follow the active theme (one cached StyleSheet per scheme).
 *  Components reading it must call useTheme() so they re-render on a switch. */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return new Proxy({} as T, {
    get: (_t, key) => {
      const sheet = (cache[activeScheme] ??= StyleSheet.create(factory(themes[activeScheme])) as T);
      return sheet[key as keyof T];
    },
  });
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

/** Active theme's colors (resolved on every read). */
export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get: (_t, key) => themes[activeScheme][key as keyof ThemeColors],
});
