import React, { useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

/** Admin announcements for this user's plan tier; dismiss hides it for good. */
export function AnnouncementBanner() {
  useTheme();
  const [items, setItems] = useState<any[]>([]);
  useFocusEffect(useCallback(() => {
    api("/api/announcements").then((r) => setItems(r.items || [])).catch(() => {});
  }, []));
  if (!items.length) return null;
  const dismiss = (id: string) => {
    setItems((p) => p.filter((x) => x.broadcast_id !== id));
    api(`/api/announcements/${id}/dismiss`, { method: "POST" }).catch(() => {});
  };
  return (
    <View testID="announcements">
      {items.slice(0, 3).map((a) => (
        <View key={a.broadcast_id} testID={`announcement-${a.broadcast_id}`} style={s.card}>
          <Icon name="volume-2" size={16} color={colors.onBrandSecondary} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{a.title}</Text>
            <Text style={s.msg}>{a.message}</Text>
          </View>
          <Pressable testID={`announcement-dismiss-${a.broadcast_id}`} onPress={() => dismiss(a.broadcast_id)} hitSlop={10} style={s.x}>
            <Icon name="x" size={14} color={colors.onBrandSecondary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const s = themedStyles((colors) => ({
  card: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md, marginBottom: spacing.md },
  title: { fontSize: 14, fontWeight: "800", color: colors.onBrandSecondary },
  msg: { fontSize: 13, color: colors.onBrandSecondary, marginTop: 2, lineHeight: 18 },
  x: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
}));
