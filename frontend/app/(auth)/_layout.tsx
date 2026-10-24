import { Stack } from "expo-router";
import { colors, useTheme } from "@/src/theme";

export default function AuthLayout() {
  useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
