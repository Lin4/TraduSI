import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { toast } from "./Toast";
import { money } from "./quantcharts";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

const shortDate = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/** Shared card: one tap creates the alerts, then the same button opens where they live. */
function OneTapCard({ testID, title, lines, done, busy, onPress, doneLabel, cta }: {
  testID: string; title: string; lines: string[]; done: boolean; busy: boolean; onPress: () => void; doneLabel: string; cta: string;
}) {
  useTheme();
  return (
    <View testID={testID} style={s.card}>
      <View style={s.head}>
        <View style={s.icon}><Icon name={done ? "check" : "bell"} size={15} color={colors.brandPrimary} /></View>
        <Text style={s.title}>{title}</Text>
      </View>
      {lines.map((t) => <Text key={t} style={s.line}>• {t}</Text>)}
      <Pressable testID={`${testID}-btn`} onPress={onPress} disabled={busy} accessibilityRole="button"
        style={[s.btn, done && s.btnDone, busy && { opacity: 0.7 }]}>
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
          <>
            <Icon name={done ? "arrow-right" : "zap"} size={15} color={done ? colors.brandPrimary : colors.onBrandPrimary} />
            <Text style={[s.btnText, done && { color: colors.brandPrimary }]}>{done ? doneLabel : cta}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

/** Options trade plan -> saved strategy with take-profit, stop, invalidation and time-exit alerts. */
export function TrackPlanButton({ r }: { r: any }) {
  useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const p = r?.plan;
  if (!p || !(r.legs || []).length) return null;
  const n = Math.max(1, p.sizing?.contracts || 0);
  const gain = Math.round(p.take_profit.gain * n * 100) / 100;
  const loss = Math.round(p.stop.loss * n * 100) / 100;
  const inv = p.invalidation?.levels || {};
  const lines = [
    `${n} contract${n === 1 ? "" : "s"} tracked live in Portfolio`,
    `Take profit at ${money(gain)} · stop at ${money(-loss)}`,
    ...(inv.below || inv.above ? [`Plan invalidated if ${r.ticker} trades ${inv.below ? `below $${inv.below}` : ""}${inv.below && inv.above ? " or " : ""}${inv.above ? `above $${inv.above}` : ""}`] : []),
    `Reminder to close on ${shortDate(p.time_exit?.date)}`,
  ];

  const track = async () => {
    if (saved) { router.push("/(tabs)/portfolio" as any); return; }
    setBusy(true);
    try {
      const legs = r.legs.map((l: any) => ({
        action: l.action, type: l.type, strike: l.strike, qty: (l.qty || 1) * n, price: l.fill ?? r.price,
        iv: l.iv > 0 ? l.iv : undefined, expiration: l.exp || r.expiration,
      }));
      await api("/api/strategies", { method: "POST", body: JSON.stringify({
        name: `${r.ticker} ${r.strategy}`.slice(0, 60), ticker: r.ticker, expiration: r.expiration, legs, strategy_type: r.strategy,
        target: gain > 0 ? { mode: "usd", value: gain } : null, stop: loss > 0 ? { mode: "usd", value: loss } : null,
        time_exit: p.time_exit?.date || null,
        invalidation: inv.below || inv.above ? { below: inv.below || null, above: inv.above || null } : null,
        source: "trade_plan",
      }) });
      setSaved(true);
      const count = (gain > 0 ? 1 : 0) + (loss > 0 ? 1 : 0) + (inv.below || inv.above ? 1 : 0) + (p.time_exit?.date ? 1 : 0);
      toast(`Plan saved with ${count} alert${count === 1 ? "" : "s"} — see Portfolio`, "success");
    } catch (e: any) { toast(e.message || "Couldn't save the plan", "error"); }
    finally { setBusy(false); }
  };

  return <OneTapCard testID="track-plan" title="Track this plan in one tap" lines={lines} done={saved} busy={busy} onPress={track}
    cta="Save plan & set alerts" doneLabel="Tracking · open Portfolio" />;
}

/** Stock trade plan (day / swing) -> two linked price alerts: target and stop (one firing closes the other). */
export function StockPlanAlerts({ r }: { r: any }) {
  useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const p = r?.trade_plan;
  if (!p?.target || !p?.stop) return null;
  const long = p.direction === "long";
  const label = r.purpose === "day" ? "Day plan" : "Swing plan";

  const create = async () => {
    if (saved) { router.push("/(tabs)/alerts" as any); return; }
    setBusy(true);
    try {
      const res = await api("/api/alerts/plan", { method: "POST", body: JSON.stringify({ ticker: r.ticker, direction: p.direction, target: p.target, stop: p.stop, label }) });
      setSaved(true);
      toast(res?.existing ? "These alerts are already set" : "Target & stop alerts set", "success");
    } catch (e: any) { toast(e.message || "Couldn't set the alerts", "error"); }
    finally { setBusy(false); }
  };

  return <OneTapCard testID="stock-plan-alerts" title="Alert me at the target and stop" busy={busy} done={saved} onPress={create}
    lines={[`Target: ${r.ticker} ${long ? "rises to" : "falls to"} $${p.target}`, `Stop: ${r.ticker} ${long ? "falls to" : "rises to"} $${p.stop}`,
      "When one fires, the other closes · checked every 2 min in market hours"]}
    cta="Set both alerts" doneLabel="Alerts set · open Alerts" />;
}

const s = themedStyles((colors) => ({
  card: { backgroundColor: colors.brandSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md, marginTop: spacing.md, gap: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  icon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.onBrandSecondary },
  line: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, marginTop: spacing.sm },
  btnDone: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandPrimary },
  btnText: { fontSize: 14, fontWeight: "800", color: colors.onBrandPrimary },
}));
