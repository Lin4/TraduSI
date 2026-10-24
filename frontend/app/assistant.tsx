import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { streamChat, Usage } from "@/src/assistant";
import { MessageBubble, Suggestions, HistorySheet, ChatMsg } from "@/src/ChatParts";
import { usePlan } from "@/src/plans";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { colors, spacing, radius } from "@/src/theme";

type Mode = "quick" | "deep";
const MODE_LABEL: Record<Mode, string> = { quick: "Claude Sonnet 5.5", deep: "Claude Opus 5.5" };

const suggestionsFor = (t?: string) => t ? [
  `Is ${t} a good options trade right now?`,
  `Explain the best ${t} idea and its biggest risk`,
  `What does ${t}'s own backtest say about this setup?`,
  `Covered call or cash-secured put on ${t}?`,
] : [
  "Review my open trades — anything I should adjust?",
  "SPY iron condor or QQQ bull put spread right now?",
  "Is NVDA's implied volatility rich or cheap today?",
  "Explain OptiScore like I'm new to options",
];

export default function Assistant() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const plan = usePlan();
  const params = useLocalSearchParams<{ ticker?: string; prompt?: string }>();
  const [pinned, setPinned] = useState<string | undefined>(params.ticker ? String(params.ticker).toUpperCase() : undefined);
  const [input, setInput] = useState(params.prompt ? String(params.prompt) : "");
  const [mode, setMode] = useState<Mode>("quick");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const list = useRef<FlatList<ChatMsg>>(null);
  const allowed = plan.features.ai_chat_per_day > 0;

  const loadChats = useCallback(async () => {
    setHistLoading(true);
    try { const r = await api("/api/assistant/chats"); setChats(r.chats); setUsage(r.usage); }
    catch (e: any) { if (e.status !== 403) toast(e.message || "Couldn't load chats", "error"); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => { if (allowed) loadChats(); }, [allowed, loadChats]);

  const patch = (id: string, p: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    if (usage && usage.used >= usage.limit) { toast(`You've used all ${usage.limit} questions today`, "error"); return; }
    if (mode === "deep" && usage && usage.deep_used >= usage.deep_limit) { toast("No deep analyses left today — switch to Quick", "error"); return; }
    setInput("");
    setBusy(true);
    const stamp = Date.now();
    const aid = `a${stamp}`;
    setMessages((ms) => [...ms, { id: `u${stamp}`, role: "user", content: text }, { id: aid, role: "assistant", content: "", streaming: true, model: MODE_LABEL[mode] }]);
    try {
      await streamChat({ message: text, chat_id: chatId, mode, ticker: pinned }, (e) => {
        if (e.type === "meta") { setChatId(e.chat_id); patch(aid, { model: e.model, tickers: e.tickers }); }
        else if (e.type === "delta") patch(aid, (m) => ({ content: m.content + e.text }));
        else if (e.type === "done") { patch(aid, { streaming: false }); setUsage(e.usage); }
        else if (e.type === "error") patch(aid, { streaming: false, error: e.detail });
      });
    } catch (e: any) {
      patch(aid, { streaming: false, error: e.message || "Something went wrong" });
    } finally {
      patch(aid, { streaming: false });
      setBusy(false);
    }
  };

  const newChat = () => { if (busy) return; setMessages([]); setChatId(null); setPinned(undefined); setInput(""); };

  const openChat = async (id: string) => {
    setHistoryOpen(false);
    try {
      const r = await api(`/api/assistant/chats/${id}`);
      setChatId(id);
      setPinned(undefined);
      setUsage(r.usage);
      setMessages(r.messages.map((m: any) => ({ id: m.message_id, role: m.role, content: m.content, model: m.model,
        tickers: m.role === "assistant" ? (m.tickers || []).map((t: string) => ({ ticker: t })) : undefined })));
    } catch (e: any) { toast(e.message || "Couldn't open chat", "error"); }
  };

  const deleteChat = async (id: string) => {
    try {
      await api(`/api/assistant/chats/${id}`, { method: "DELETE" });
      setChats((c) => c.filter((x) => x.chat_id !== id));
      if (id === chatId) newChat();
    } catch (e: any) { toast(e.message || "Couldn't delete chat", "error"); }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="chat-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} accessibilityLabel="Back">
        <Icon name="arrow-left" size={20} color={colors.onSurface} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Ask AI</Text>
        <Text style={styles.subtitle} numberOfLines={1}>Answers from live TraduSI data · {MODE_LABEL[mode]}</Text>
      </View>
      {allowed ? (
        <>
          <Pressable testID="chat-history-open" onPress={() => { setHistoryOpen(true); loadChats(); }} style={styles.iconBtn} accessibilityLabel="Chat history">
            <Icon name="clock" size={20} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="chat-new" onPress={newChat} style={styles.iconBtn} accessibilityLabel="New chat">
            <Icon name="edit" size={19} color={colors.onSurface} />
          </Pressable>
        </>
      ) : null}
    </View>
  );

  if (!allowed) {
    return (
      <View style={styles.root}>
        {header}
        <View testID="chat-locked" style={styles.locked}>
          <View style={styles.lockBadge}><Icon name="zap" size={26} color={colors.brandPrimary} /></View>
          <Text style={styles.lockTitle}>Ask AI is part of Advance & Expert</Text>
          <Text style={styles.lockText}>
            Chat with Claude about any ticker, strategy or your saved trades. Every answer uses TraduSI&apos;s live quotes, OptiScores, trade plans and backtests.
          </Text>
          <Button testID="chat-upgrade" label="See plans & upgrade" onPress={() => router.push("/upgrade" as any)} />
        </View>
        <ToastHost />
      </View>
    );
  }

  const left = usage ? Math.max(0, usage.limit - usage.used) : null;
  const deepLeft = usage ? Math.max(0, usage.deep_limit - usage.deep_used) : null;

  return (
    <View style={styles.root}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="translate-with-padding" keyboardVerticalOffset={0}>
        <FlatList
          ref={list}
          testID="chat-list"
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble m={item} />}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => messages.length && list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View testID="chat-empty">
              <View style={styles.hero}>
                <View style={styles.lockBadge}><Icon name="zap" size={24} color={colors.brandPrimary} /></View>
                <Text style={styles.heroTitle}>{pinned ? `Ask about ${pinned}` : "What would you like to know?"}</Text>
                <Text style={styles.heroText}>
                  I read live quotes, the engine&apos;s best idea, OptiScore, trade plan, backtest and your open trades before answering. Mention any ticker (e.g. $AAPL).
                </Text>
              </View>
              <Suggestions items={suggestionsFor(pinned)} onPick={(t) => send(t)} disabled={busy} />
            </View>
          }
        />

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.modeRow}>
            {(["quick", "deep"] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <Pressable key={m} testID={`chat-mode-${m}`} onPress={() => setMode(m)} disabled={busy} style={[styles.modeChip, active && styles.modeChipActive]}>
                  <Icon name={m === "quick" ? "zap" : "cpu"} size={13} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>{m === "quick" ? "Quick · Sonnet" : "Deep · Opus"}</Text>
                </Pressable>
              );
            })}
            <Text testID="chat-usage" style={styles.usage} numberOfLines={1}>
              {left != null ? `${left} left today${mode === "deep" ? ` · ${deepLeft} deep` : ""}` : ""}
            </Text>
          </View>
          {pinned ? (
            <View style={styles.pinRow}>
              <Icon name="paperclip" size={12} color={colors.brandPrimary} />
              <Text testID="chat-pinned" style={styles.pinText}>Live data for {pinned} included</Text>
              <Pressable testID="chat-unpin" onPress={() => setPinned(undefined)} hitSlop={10}><Icon name="x" size={14} color={colors.muted} /></Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              testID="chat-input"
              value={input}
              onChangeText={setInput}
              placeholder="Ask about a ticker, strategy or your trades…"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={2000}
              style={styles.input}
            />
            <Pressable testID="chat-send" onPress={() => send()} disabled={busy || !input.trim()}
              style={[styles.send, (busy || !input.trim()) && { opacity: 0.4 }]} accessibilityLabel="Send">
              {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Icon name="arrow-up" size={20} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
          <Text style={styles.disclaimer}>AI research, not financial advice. Numbers come from TraduSI&apos;s engine.</Text>
        </View>
      </KeyboardAvoidingView>

      <HistorySheet visible={historyOpen} chats={chats} loading={histLoading} onClose={() => setHistoryOpen(false)}
        onOpen={openChat} onDelete={deleteChat} bottom={insets.bottom} />
      <ToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  title: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  subtitle: { fontSize: 11, color: colors.muted, marginTop: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.md, flexGrow: 1 },
  hero: { alignItems: "center", marginTop: spacing.lg },
  heroTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, textAlign: "center", marginTop: spacing.md },
  heroText: { fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 19, marginTop: spacing.sm, paddingHorizontal: spacing.md },
  composer: { borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  modeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modeChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  modeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modeText: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary },
  modeTextActive: { color: colors.onBrandPrimary },
  usage: { flex: 1, textAlign: "right", fontSize: 11, color: colors.muted, fontVariant: ["tabular-nums"] },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  pinText: { flex: 1, fontSize: 12, color: colors.brandPrimary, fontWeight: "700" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: colors.surfaceTertiary, borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: colors.onSurface },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  disclaimer: { fontSize: 10, color: colors.muted, textAlign: "center", marginTop: 6 },
  locked: { flex: 1, padding: spacing.xl, justifyContent: "center", alignItems: "stretch", gap: spacing.md },
  lockBadge: { alignSelf: "center", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  lockText: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 20, marginBottom: spacing.md },
});
