import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import Icon from "@react-native-vector-icons/feather";

import { api } from "./api";
import { Button } from "./Button";
import { toast } from "./Toast";
import { Badge } from "./parts";
import { money, DailyPnLChart } from "./pnl";
import { RollSheet } from "./RollSheet";
import { ThresholdField, toThreshold, Thr } from "./SaveStrategy";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";

const usd = (v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const thrText = (t: any, val: number | null) =>
  t ? `${t.mode === "pct" ? `${t.value}%` : usd(t.value)}${val != null && t.mode === "pct" ? ` (${usd(Math.round(val))})` : ""}` : "—";
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Saved strategies with live P&L, progress between stop and target, inline edit/delete. */
export function StrategiesList({ items, total, onChanged }: { items: any[]; total: number; onChanged: () => void }) {
  useTheme();
  if (!items.length) return null;
  return (
    <View testID="strategies-section">
      <View style={s.head}>
        <Text style={s.label}>Strategies · {items.length}</Text>
        <Text testID="strategies-total" style={[s.total, { color: total >= 0 ? colors.success : colors.error }]}>{money(total)}</Text>
      </View>
      {items.map((it) => <StrategyCard key={it.strategy_id} it={it} onChanged={onChanged} />)}
    </View>
  );
}

function StrategyCard({ it, onChanged }: { it: any; onChanged: () => void }) {
  useTheme();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Thr>({ mode: it.target?.mode || "pct", value: it.target ? String(it.target.value) : "" });
  const [stop, setStop] = useState<Thr>({ mode: it.stop?.mode || "pct", value: it.stop ? String(it.stop.value) : "" });
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const m = it.mark || {};
  const pnl = m.pnl ?? 0;
  const up = pnl >= 0;
  // progress: -stop .. 0 .. +target
  const lo = -(m.stop_usd || Math.abs(it.max_loss || it.cost_basis || 1));
  const hi = m.target_usd || it.max_profit || Math.abs(it.cost_basis || 1);
  const pos = Math.max(0, Math.min(1, (pnl - lo) / (hi - lo || 1)));
  const zero = Math.max(0, Math.min(1, -lo / (hi - lo || 1)));

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/strategies/${it.strategy_id}`, { method: "PATCH", body: JSON.stringify({ target: toThreshold(target), stop: toThreshold(stop) }) });
      toast("Alerts updated", "success"); setOpen(false); onChanged();
    } catch (e: any) { toast(e.message || "Failed", "error"); } finally { setBusy(false); }
  };
  const close = async () => {
    if (!confirmClose) { setConfirmClose(true); setTimeout(() => setConfirmClose(false), 4000); return; }
    setBusy(true);
    try {
      const r = await api(`/api/strategies/${it.strategy_id}/close`, { method: "POST" });
      toast(`Closed at live prices: ${money(r.final_pnl)}`, r.final_pnl >= 0 ? "success" : "info");
      onChanged();
    } catch (e: any) { toast(e.message || "Close failed", "error"); } finally { setBusy(false); setConfirmClose(false); }
  };
  const del = async () => {
    try { await api(`/api/strategies/${it.strategy_id}`, { method: "DELETE" }); toast("Strategy removed", "info"); onChanged(); }
    catch (e: any) { toast(e.message || "Failed", "error"); }
  };

  return (
    <View testID={`strategy-${it.strategy_id}`} style={s.card}>
      <Pressable testID={`strategy-toggle-${it.strategy_id}`} onPress={() => setOpen((v) => !v)}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{it.name}</Text>
            <Text style={s.sub}>{it.ticker} · {it.legs.length} legs · exp {it.expiration}{it.multi_expiry ? " (multi)" : ""}</Text>
            {it.source === "trade_plan" ? (
              <Text testID={`strategy-plan-${it.strategy_id}`} style={s.sub}>
                Trade plan{it.time_exit ? ` · close by ${shortDate(it.time_exit)}` : ""}{it.invalidation?.below ? ` · invalid below $${it.invalidation.below}` : ""}{it.invalidation?.above ? ` · invalid above $${it.invalidation.above}` : ""}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text testID={`strategy-pnl-${it.strategy_id}`} style={[s.pnl, { color: up ? colors.success : colors.error }]}>{m.error ? "—" : money(pnl)}</Text>
            {m.pnl_pct != null ? <Text style={[s.pct, { color: up ? colors.success : colors.error }]}>{up ? "+" : ""}{m.pnl_pct}% of risk</Text> : null}
          </View>
        </View>
        <View style={s.track}>
          <View style={[s.zero, { left: `${zero * 100}%` as any }]} />
          <View style={[s.knob, { left: `${pos * 100}%` as any, backgroundColor: up ? colors.success : colors.error }]} />
        </View>
        <View style={s.row}>
          <Text style={[s.small, { color: colors.error }]}>Stop {thrText(it.stop, m.stop_usd)}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {it.fired?.target ? <Badge text="Target hit" kind="success" /> : null}
            {it.fired?.stop ? <Badge text="Stop hit" kind="error" /> : null}
            {it.fired?.invalid ? <Badge text="Invalidated" kind="warn" /> : null}
            {it.fired?.time ? <Badge text="Time to close" kind="warn" /> : null}
            {m.live === false ? <Badge text="Model mark" kind="warn" /> : null}
          </View>
          <Text style={[s.small, { color: colors.success }]}>Target {thrText(it.target, m.target_usd)}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={s.detail}>
          {it.history?.length ? <DailyPnLChart points={it.history} /> : null}
          {it.realized_pnl ? <Text style={s.leg}>Realized from rolls: <Text style={{ fontWeight: "800", color: it.realized_pnl >= 0 ? colors.success : colors.error }}>{money(it.realized_pnl)}</Text> ({it.rolls?.length || 0} roll{it.rolls?.length === 1 ? "" : "s"})</Text> : null}
          <View style={s.actions}>
            <Pressable testID={`strategy-close-${it.strategy_id}`} onPress={close} disabled={busy} style={[s.actBtn, confirmClose && { backgroundColor: colors.error, borderColor: colors.error }]}>
              <Icon name="check-square" size={14} color={confirmClose ? colors.onError : colors.onSurface} />
              <Text style={[s.actText, confirmClose && { color: colors.onError }]}>{confirmClose ? "Tap to confirm" : "Close at live"}</Text>
            </Pressable>
            <Pressable testID={`strategy-roll-${it.strategy_id}`} onPress={() => setRollOpen(true)} style={s.actBtn}>
              <Icon name="refresh-cw" size={14} color={colors.onSurface} />
              <Text style={s.actText}>Roll</Text>
            </Pressable>
          </View>
          {it.legs.map((l: any, i: number) => (
            <Text key={i} style={s.leg}>{l.action} {l.qty}× {l.type === "Stock" ? "shares" : `${l.type} ${l.strike} · ${l.expiration}`} @ ${l.price}</Text>
          ))}
          <Text style={s.leg}>Entry {it.premium_type} {money(Math.abs(it.net_premium))} · underlying ${it.entry_underlying} → ${m.price ?? "—"}</Text>
          <View style={{ height: spacing.md }} />
          <ThresholdField label="Profit target" idPrefix={`edit-target-${it.strategy_id}`} value={target} onChange={setTarget} pctHint="% of max profit" />
          <ThresholdField label="Stop loss" idPrefix={`edit-stop-${it.strategy_id}`} value={stop} onChange={setStop} pctHint="% of max risk" />
          <Button testID={`strategy-save-${it.strategy_id}`} label="Update alerts" onPress={save} loading={busy} />
          <Pressable testID={`strategy-delete-${it.strategy_id}`} onPress={del} style={s.delete}>
            <Icon name="trash-2" size={14} color={colors.error} />
            <Text style={s.deleteText}>Delete strategy</Text>
          </Pressable>
        </View>
      ) : null}
      <RollSheet it={it} visible={rollOpen} onClose={() => setRollOpen(false)} onDone={onChanged} />
    </View>
  );
}

/** Closed trades: insights (overall + by strategy type), list with archive/delete, archived toggle. */
export function ClosedHistory({ items, archived, insights, total, onChanged }: {
  items: any[]; archived: any[]; insights: any; total: number; onChanged: () => void;
}) {
  useTheme();
  const [showArchived, setShowArchived] = useState(false);
  if (!items.length && !archived.length) return null;
  const list = showArchived ? archived : items;
  return (
    <View testID="closed-history" style={{ marginTop: spacing.md }}>
      <View style={s.head}>
        <Text style={s.label}>History · {items.length + archived.length} closed</Text>
        <Text testID="realized-total" style={[s.total, { color: total >= 0 ? colors.success : colors.error }]}>{money(total)}</Text>
      </View>
      {insights ? <HistoryInsights ins={insights} /> : null}
      {archived.length ? (
        <View style={s.seg}>
          {[false, true].map((a) => (
            <Pressable key={String(a)} testID={a ? "history-archived-tab" : "history-active-tab"} onPress={() => setShowArchived(a)} style={[s.segBtn, showArchived === a && s.segOn]}>
              <Text style={[s.segText, showArchived === a && s.segTextOn]}>{a ? `Archived (${archived.length})` : `Trades (${items.length})`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {list.map((c) => <ClosedRow key={c.strategy_id} c={c} onChanged={onChanged} />)}
      {!list.length ? <Text style={s.sub}>Nothing here.</Text> : null}
    </View>
  );
}

function ClosedRow({ c, onChanged }: { c: any; onChanged: () => void }) {
  useTheme();
  const [armed, setArmed] = useState(false);
  const archive = async () => {
    try {
      await api(`/api/strategies/${c.strategy_id}/archive`, { method: "POST", body: JSON.stringify({ archived: !c.archived }) });
      toast(c.archived ? "Moved back to History" : "Archived — still counted in insights", "info"); onChanged();
    } catch (e: any) { toast(e.message || "Failed", "error"); }
  };
  const del = async () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    try { await api(`/api/strategies/${c.strategy_id}`, { method: "DELETE" }); toast("Trade deleted", "info"); onChanged(); }
    catch (e: any) { toast(e.message || "Failed", "error"); }
  };
  return (
    <View testID={`closed-${c.strategy_id}`} style={s.closedRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.closedName} numberOfLines={1}>{c.name}</Text>
        <Text style={s.sub}>{c.strategy_type} · {c.ticker} · {c.closed_at ? new Date(c.closed_at).toLocaleDateString() : ""}{c.rolls?.length ? ` · ${c.rolls.length} roll${c.rolls.length > 1 ? "s" : ""}` : ""}</Text>
      </View>
      <Text style={[s.closedPnl, { color: (c.final_pnl ?? 0) >= 0 ? colors.success : colors.error }]}>{money(c.final_pnl)}</Text>
      <Pressable testID={`archive-${c.strategy_id}`} onPress={archive} hitSlop={6} style={s.iconBtn}>
        <Icon name={c.archived ? "corner-up-left" : "archive"} size={15} color={colors.onSurfaceSecondary} />
      </Pressable>
      <Pressable testID={`delete-closed-${c.strategy_id}`} onPress={del} hitSlop={6} style={[s.iconBtn, armed && { backgroundColor: colors.error }]}>
        <Icon name={armed ? "check" : "trash-2"} size={15} color={armed ? colors.onError : colors.error} />
      </Pressable>
    </View>
  );
}

function HistoryInsights({ ins }: { ins: any }) {
  useTheme();
  const o = ins.overall;
  const c = (v: number | null) => (v == null ? colors.muted : v >= 0 ? colors.success : colors.error);
  return (
    <View testID="history-insights" style={s.insBox}>
      <View style={s.insKpis}>
        <View style={s.insKpi}><Text style={s.insLabel}>Win rate</Text><Text testID="ins-winrate" style={[s.insVal, { color: o.win_rate >= 50 ? colors.success : colors.error }]}>{o.win_rate}%</Text></View>
        <View style={s.insKpi}><Text style={s.insLabel}>Avg P&L</Text><Text testID="ins-avg" style={[s.insVal, { color: c(o.avg_pnl) }]}>{money(o.avg_pnl)}</Text></View>
        <View style={s.insKpi}><Text style={s.insLabel}>Avg win</Text><Text style={[s.insVal, { color: colors.success }]}>{o.avg_win == null ? "—" : money(o.avg_win)}</Text></View>
        <View style={s.insKpi}><Text style={s.insLabel}>Avg loss</Text><Text style={[s.insVal, { color: colors.error }]}>{o.avg_loss == null ? "—" : money(o.avg_loss)}</Text></View>
      </View>
      <View style={s.bw}>
        <Text style={s.bwText} numberOfLines={1}><Text style={{ color: colors.success, fontWeight: "800" }}>Best </Text>{o.best.name} {money(o.best.pnl)}</Text>
        <Text style={s.bwText} numberOfLines={1}><Text style={{ color: colors.error, fontWeight: "800" }}>Worst </Text>{o.worst.name} {money(o.worst.pnl)}</Text>
      </View>
      <Text style={[s.label, { marginTop: spacing.md, marginBottom: 4 }]}>By strategy type</Text>
      <View style={s.typeHead}>
        <Text style={[s.th, { flex: 1, textAlign: "left" }]}>Type</Text><Text style={s.th}>Trades</Text><Text style={s.th}>Win</Text><Text style={s.th}>Avg</Text><Text style={s.th}>Best</Text><Text style={s.th}>Worst</Text>
      </View>
      {ins.by_type.map((t: any) => (
        <View key={t.type} testID={`ins-type-${t.type.replace(/ /g, "-")}`} style={s.typeRow}>
          <Text style={[s.td, { flex: 1, textAlign: "left", fontWeight: "700" }]} numberOfLines={1}>{t.type}</Text>
          <Text style={s.td}>{t.count}</Text>
          <Text style={[s.td, { color: t.win_rate >= 50 ? colors.success : colors.error }]}>{Math.round(t.win_rate)}%</Text>
          <Text style={[s.td, { color: c(t.avg_pnl) }]}>{money(t.avg_pnl)}</Text>
          <Text style={[s.td, { color: c(t.best.pnl) }]}>{money(t.best.pnl)}</Text>
          <Text style={[s.td, { color: c(t.worst.pnl) }]}>{money(t.worst.pnl)}</Text>
        </View>
      ))}
    </View>
  );
}

const s = themedStyles((colors) => ({
  seg: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 3, marginVertical: spacing.sm },
  segBtn: { flex: 1, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surface },
  segText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  segTextOn: { color: colors.onSurface },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  insBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  insKpis: { flexDirection: "row", gap: spacing.sm },
  insKpi: { flex: 1 },
  insLabel: { fontSize: 10, color: colors.muted, fontWeight: "700" },
  insVal: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
  bw: { marginTop: spacing.sm, gap: 2 },
  bwText: { fontSize: 12, color: colors.onSurface },
  typeHead: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  typeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  th: { width: 46, fontSize: 9, fontWeight: "800", color: colors.muted, textAlign: "right" },
  td: { width: 46, fontSize: 11, color: colors.onSurface, textAlign: "right", fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  actText: { fontWeight: "800", color: colors.onSurface, fontSize: 13 },
  closedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  closedName: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  closedPnl: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  label: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  total: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  name: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  pnl: { fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pct: { fontSize: 11, fontWeight: "700" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, marginVertical: spacing.sm },
  zero: { position: "absolute", top: -3, width: 2, height: 12, backgroundColor: colors.borderStrong },
  knob: { position: "absolute", top: -4, width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: colors.surface },
  small: { fontSize: 11, fontWeight: "700" },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  leg: { fontSize: 12, color: colors.onSurfaceSecondary, marginBottom: 3 },
  delete: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: spacing.sm },
  deleteText: { color: colors.error, fontWeight: "700" },
}));
