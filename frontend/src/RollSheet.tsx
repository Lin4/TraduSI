import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { Button } from "./Button";
import { toast } from "./Toast";
import { money } from "./pnl";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

/** Pick a later expiration, preview live roll fills, confirm. */
export function RollSheet({ it, visible, onClose, onDone }: { it: any; visible: boolean; onClose: () => void; onDone: () => void }) {
  useTheme();
  const [exps, setExps] = useState<{ date: string; dte: number }[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPick(null); setPreview(null);
    api(`/api/chain/${it.ticker}/expirations`)
      .then((r) => setExps((r.expirations || []).filter((e: any) => e.date > it.expiration).slice(0, 12)))
      .catch((e) => toast(e.message || "Failed to load expirations", "error"));
  }, [visible, it.ticker, it.expiration]);

  const choose = async (d: string) => {
    setPick(d); setPreview(null); setBusy(true);
    try { setPreview((await api(`/api/strategies/${it.strategy_id}/roll`, { method: "POST", body: JSON.stringify({ expiration: d }) })).preview); }
    catch (e: any) { toast(e.message || "Preview failed", "error"); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api(`/api/strategies/${it.strategy_id}/roll`, { method: "POST", body: JSON.stringify({ expiration: pick, confirm: true }) });
      toast(`Rolled to ${pick}`, "success"); onClose(); onDone();
    } catch (e: any) { toast(e.message || "Roll failed", "error"); }
    finally { setBusy(false); }
  };

  const p = preview;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>Roll {it.name}</Text>
            <Pressable testID="roll-close" onPress={onClose} style={s.close}><Icon name="x" size={16} color={colors.muted} /></Pressable>
          </View>
          <Text style={s.sub}>Legs expiring {it.expiration} move to the nearest listed strikes on the new date at live bid/ask.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {exps.map((e) => (
              <Pressable key={e.date} testID={`roll-exp-${e.date}`} onPress={() => choose(e.date)} style={[s.chip, pick === e.date && s.chipOn]}>
                <Text style={[s.chipText, pick === e.date && s.chipTextOn]}>{e.date.slice(5).replace("-", "/")}</Text>
                <Text style={[s.chipDte, pick === e.date && s.chipTextOn]}>{e.dte}d</Text>
              </Pressable>
            ))}
          </ScrollView>
          {busy && !p ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} /> : null}
          {p ? (
            <View testID="roll-preview">
              <Text style={s.section}>Close</Text>
              {p.closing.map((l: any, i: number) => (
                <Text key={`c${i}`} style={s.leg}>{l.action === "Buy" ? "Sell" : "Buy"} {l.qty}× {l.type} {l.strike} · {l.expiration.slice(5)} @ ${l.exit_price}</Text>
              ))}
              <Text style={s.section}>Open</Text>
              {p.opening.map((l: any, i: number) => (
                <Text key={`o${i}`} style={s.leg}>{l.action} {l.qty}× {l.type} {l.strike} · {l.expiration.slice(5)} @ ${l.price}</Text>
              ))}
              <View style={s.kpis}>
                <View style={s.kpi}><Text style={s.kLabel}>Net {p.net_type}</Text>
                  <Text testID="roll-net" style={[s.kVal, { color: p.net >= 0 ? colors.success : colors.error }]}>{money(Math.abs(p.net))}</Text></View>
                <View style={s.kpi}><Text style={s.kLabel}>Realized on close</Text>
                  <Text style={[s.kVal, { color: p.realized_pnl >= 0 ? colors.success : colors.error }]}>{money(p.realized_pnl)}</Text></View>
                <View style={s.kpi}><Text style={s.kLabel}>Fees</Text><Text style={s.kVal}>${p.fees}</Text></View>
              </View>
              <Button testID="roll-confirm" label={`Roll to ${p.to}`} onPress={confirm} loading={busy} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = themedStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.sheet, padding: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.onSurface, flex: 1 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  sub: { fontSize: 12, color: colors.muted, marginTop: spacing.sm, lineHeight: 17 },
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", minWidth: 56 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  chipDte: { fontSize: 10, color: colors.muted },
  chipTextOn: { color: colors.onBrandPrimary },
  section: { fontSize: 11, fontWeight: "800", color: colors.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.sm, marginBottom: 4 },
  leg: { fontSize: 13, color: colors.onSurface, marginBottom: 2 },
  kpis: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.lg },
  kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  kLabel: { fontSize: 10, color: colors.muted, fontWeight: "700" },
  kVal: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
}));
