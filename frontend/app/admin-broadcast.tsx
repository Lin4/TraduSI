import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Switch, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Input } from "@/src/Input";
import { Button } from "@/src/Button";
import { ToastHost, toast } from "@/src/Toast";
import { Badge } from "@/src/parts";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

const AUD = [["all", "All users"], ["trial", "Trial"], ["simple", "Simple"], ["advance", "Advance"], ["expert", "Expert"], ["expired", "Expired"]];

export default function AdminBroadcast() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("all");
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    try { setItems((await api("/api/admin/broadcasts")).items || []); } catch (e: any) { toast(e.message || "Failed", "error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !message.trim()) { toast("Add a title and message", "error"); return; }
    setBusy(true);
    try {
      const r = await api("/api/admin/broadcasts", { method: "POST", body: JSON.stringify({ title, message, audience, push }) });
      toast(`Sent to ${r.reach} user${r.reach === 1 ? "" : "s"}${push ? (r.pushed ? " + push" : " (push needs a phone build)") : ""}`, "success");
      setTitle(""); setMessage(""); load();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setBusy(false); }
  };
  const end = async (id: string) => {
    try { await api(`/api/admin/broadcasts/${id}`, { method: "DELETE" }); toast("Announcement ended", "info"); load(); }
    catch (e: any) { toast(e.message || "Failed", "error"); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="broadcast-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin" as any))} style={s.back}>
          <Icon name="arrow-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Broadcast</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 60 }]} keyboardShouldPersistTaps="handled">
          <Input testID="broadcast-title" label="Title" value={title} onChangeText={setTitle} placeholder="e.g., New: live option chains" />
          <Input testID="broadcast-message" label="Message" value={message} onChangeText={setMessage} placeholder="What should users know?" />
          <Text style={s.label}>Audience</Text>
          <View style={s.chips}>
            {AUD.map(([id, label]) => (
              <Pressable key={id} testID={`broadcast-aud-${id}`} onPress={() => setAudience(id)} style={[s.chip, audience === id && s.chipOn]}>
                <Text style={[s.chipText, audience === id && s.chipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.pushRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.pushTitle}>Also send push notification</Text>
              <Text style={s.pushSub}>Works on installed phone builds only</Text>
            </View>
            <Switch testID="broadcast-push" value={push} onValueChange={setPush} trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }} />
          </View>
          {title || message ? (
            <View testID="broadcast-preview" style={s.preview}>
              <Text style={s.prevLabel}>Preview</Text>
              <Text style={s.prevTitle}>{title || "Title"}</Text>
              <Text style={s.prevMsg}>{message || "Message"}</Text>
            </View>
          ) : null}
          <Button testID="broadcast-send" label="Send announcement" onPress={send} loading={busy} />

          <Text style={[s.label, { marginTop: spacing.xl }]}>Sent · {items.length}</Text>
          {items.map((b) => (
            <View key={b.broadcast_id} testID={`broadcast-${b.broadcast_id}`} style={s.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text style={s.cardTitle} numberOfLines={1}>{b.title}</Text>
                <Badge text={b.active ? "LIVE" : "ENDED"} kind={b.active ? "success" : "info"} />
              </View>
              <Text style={s.cardMsg} numberOfLines={2}>{b.message}</Text>
              <Text style={s.meta}>{AUD.find((a) => a[0] === b.audience)?.[1]} · {b.reach} reached · {b.dismissed} dismissed{b.push ? " · push" : ""} · {new Date(b.created_at.endsWith("Z") || b.created_at.includes("+") ? b.created_at : b.created_at + "Z").toLocaleString()}</Text>
              {b.active ? (
                <Pressable testID={`broadcast-end-${b.broadcast_id}`} onPress={() => end(b.broadcast_id)} style={s.end}>
                  <Text style={s.endText}>End announcement</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
      <ToastHost />
    </View>
  );
}

const s = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  scroll: { padding: spacing.lg },
  label: { fontSize: 11, color: colors.muted, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  chip: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, justifyContent: "center" },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary },
  pushRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  pushTitle: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  pushSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  preview: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md, marginBottom: spacing.lg },
  prevLabel: { fontSize: 10, fontWeight: "800", color: colors.onBrandSecondary, textTransform: "uppercase", letterSpacing: 1 },
  prevTitle: { fontSize: 14, fontWeight: "800", color: colors.onBrandSecondary, marginTop: 4 },
  prevMsg: { fontSize: 13, color: colors.onBrandSecondary, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.onSurface },
  cardMsg: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  meta: { fontSize: 11, color: colors.muted, marginTop: 6 },
  end: { minHeight: 40, justifyContent: "center", alignItems: "flex-start", marginTop: 4 },
  endText: { color: colors.error, fontWeight: "700", fontSize: 13 },
}));
