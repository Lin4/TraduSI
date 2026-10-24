import React from "react";
import { View, Text, Pressable, ActivityIndicator, Modal, FlatList } from "react-native";
import Icon from "@react-native-vector-icons/feather";
import { useRouter } from "expo-router";

import { Markdown } from "./Markdown";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

export type ChatMsg = {
  id: string; role: "user" | "assistant"; content: string; model?: string; streaming?: boolean; error?: string;
  tickers?: { ticker: string; price?: number; change_pct?: number }[];
};

export function MessageBubble({ m }: { m: ChatMsg }) {
  useTheme();
  if (m.role === "user") {
    return (
      <View testID="chat-msg-user" style={[s.bubble, s.user]}>
        <Text style={s.userText}>{m.content}</Text>
      </View>
    );
  }
  return (
    <View testID="chat-msg-ai" style={[s.bubble, s.ai]}>
      <View style={s.aiHead}>
        <View style={s.aiAvatar}><Icon name="zap" size={11} color={colors.onBrandPrimary} /></View>
        <Text style={s.aiModel}>{m.model || "TraduSI AI"}</Text>
      </View>
      {m.tickers?.length ? (
        <View style={s.chips}>
          {m.tickers.map((t) => (
            <View key={t.ticker} testID={`chat-live-${t.ticker}`} style={s.chip}>
              <View style={s.liveDot} />
              <Text style={s.chipText}>{t.ticker}{t.price != null ? ` $${t.price}` : ""}</Text>
              {t.change_pct != null ? (
                <Text style={[s.chipText, { color: t.change_pct >= 0 ? colors.success : colors.error }]}>
                  {t.change_pct >= 0 ? "+" : ""}{t.change_pct}%
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {m.content ? <Markdown testID="chat-msg-ai-text" text={m.content} /> : m.streaming ? (
        <View style={s.thinking}>
          <ActivityIndicator size="small" color={colors.brandPrimary} />
          <Text style={s.thinkingText}>Reading live market data…</Text>
        </View>
      ) : null}
      {m.streaming && m.content ? <View style={s.cursor} /> : null}
      {m.error ? (
        <View testID="chat-msg-error" style={s.errRow}>
          <Icon name="alert-circle" size={13} color={colors.error} />
          <Text style={s.errText}>{m.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Suggestions({ items, onPick, disabled }: { items: string[]; onPick: (t: string) => void; disabled?: boolean }) {
  useTheme();
  return (
    <View style={s.sugWrap}>
      {items.map((t, i) => (
        <Pressable key={t} testID={`chat-suggestion-${i}`} onPress={() => onPick(t)} disabled={disabled} style={s.sug}>
          <Icon name="corner-down-right" size={14} color={colors.brandPrimary} />
          <Text style={s.sugText}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type ChatRow = { chat_id: string; title: string; updated_at: string; last_model?: string; tickers?: string[] };

/** Entry point into Ask AI with an optional pinned ticker / prefilled question. */
export function AskAIButton({ label, ticker, prompt, testID }: { label: string; ticker?: string; prompt?: string; testID?: string }) {
  useTheme();
  const router = useRouter();
  return (
    <Pressable testID={testID || "ask-ai"} onPress={() => router.push({ pathname: "/assistant", params: { ...(ticker ? { ticker } : {}), ...(prompt ? { prompt } : {}) } } as any)}
      style={s.askBtn} accessibilityRole="button">
      <View style={s.aiAvatarLg}><Icon name="zap" size={15} color={colors.onBrandPrimary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.askTitle}>{label}</Text>
        <Text style={s.askSub}>Claude answers from this live data · Advance & Expert</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.brandPrimary} />
    </Pressable>
  );
}

export function HistorySheet({ visible, chats, loading, onClose, onOpen, onDelete, bottom }: {
  visible: boolean; chats: ChatRow[]; loading: boolean; onClose: () => void; onOpen: (id: string) => void;
  onDelete: (id: string) => void; bottom: number;
}) {
  useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View testID="chat-history" style={[s.sheet, { paddingBottom: bottom + spacing.md }]}>
        <View style={s.grab} />
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle}>Your chats</Text>
          <Pressable testID="chat-history-close" onPress={onClose} hitSlop={8} style={s.iconBtn}>
            <Icon name="x" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
        {loading ? <ActivityIndicator style={{ marginVertical: spacing.xl }} color={colors.brandPrimary} /> : (
          <FlatList
            data={chats}
            keyExtractor={(c) => c.chat_id}
            ListEmptyComponent={<Text style={s.empty}>No saved chats yet — ask your first question.</Text>}
            renderItem={({ item }) => (
              <View style={s.histRow}>
                <Pressable testID={`chat-open-${item.chat_id}`} onPress={() => onOpen(item.chat_id)} style={{ flex: 1, paddingVertical: spacing.md }}>
                  <Text style={s.histTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.histMeta} numberOfLines={1}>
                    {new Date(item.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {item.tickers?.length ? ` · ${item.tickers.join(", ")}` : ""}{item.last_model ? ` · ${item.last_model}` : ""}
                  </Text>
                </Pressable>
                <Pressable testID={`chat-delete-${item.chat_id}`} onPress={() => onDelete(item.chat_id)} hitSlop={8} style={s.iconBtn}
                  accessibilityLabel="Delete chat">
                  <Icon name="trash-2" size={17} color={colors.muted} />
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const s = themedStyles((colors) => ({
  bubble: { maxWidth: "88%", borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  user: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  userText: { color: colors.onBrandPrimary, fontSize: 14, lineHeight: 20 },
  ai: { alignSelf: "flex-start", maxWidth: "96%", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  aiAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  aiModel: { fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  chipText: { fontSize: 11, fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  thinkingText: { fontSize: 13, color: colors.muted },
  cursor: { width: 8, height: 14, backgroundColor: colors.brandPrimary, borderRadius: 2, marginTop: 4, opacity: 0.6 },
  errRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  errText: { flex: 1, fontSize: 12, color: colors.error, lineHeight: 17 },
  sugWrap: { gap: spacing.sm, marginTop: spacing.md },
  sug: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, minHeight: 48, paddingVertical: spacing.sm },
  sugText: { flex: 1, fontSize: 13, color: colors.onSurface, fontWeight: "600", lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { maxHeight: "75%", backgroundColor: colors.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: spacing.lg },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: spacing.sm },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  histRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.divider },
  histTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  histMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  empty: { fontSize: 13, color: colors.muted, textAlign: "center", marginVertical: spacing.xl },
  askBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md, marginTop: spacing.md, minHeight: 56 },
  aiAvatarLg: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  askTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandSecondary },
  askSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 1 },
}));
