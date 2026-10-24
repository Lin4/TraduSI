import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { colors, useTheme } from "@/src/theme";

export const usesNativeTabs = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export default function TabsLayout() {
  useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Discover", tabBarIcon: ({ color, size }) => <Icon name="compass" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="analyze"
        options={{ title: "Analyze", tabBarIcon: ({ color, size }) => <Icon name="bar-chart-2" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="chain"
        options={{ title: "Chain", tabBarIcon: ({ color, size }) => <Icon name="layers" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{ title: "Portfolio", tabBarIcon: ({ color, size }) => <Icon name="briefcase" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{ title: "Alerts", tabBarIcon: ({ color, size }) => <Icon name="bell" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="learn"
        options={{ title: "Learn", tabBarIcon: ({ color, size }) => <Icon name="book-open" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
