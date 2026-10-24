import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { ToastHost, toast } from "@/src/Toast";
import { Badge, MetricRow } from "@/src/parts";
import { PlanGate } from "@/src/plans";
import { PnLChart, PnLHeatmap, money } from "@/src/pnl";
import { Button } from "@/src/Button";
import { SaveStrategySheet } from "@/src/SaveStrategy";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";

type Side = { bid: number; ask: number; mid: number | null; iv: number | null; delta: number | null; oi: number; volume: number } | null;
type Row = { strike: number; call: Side; put: Side };
type Leg = { action: "Buy" | "Sell"; type: "Call" | "Put" | "Stock"; strike: number; qty: number; price: number; iv: number | null; expiration: string };

const TEMPLATES = ["Bull Call Spread", "Bear Put Spread", "Bull Put Spread", "Bear Call Spread", "Iron Condor",
  "Long Call Butterfly", "Long Straddle", "Long Strangle", "Covered Call", "Cash Secured Put", "Long Call", "Long Put",
  "Calendar Call Spread", "Calendar Put Spread", "Diagonal Call Spread", "Diagonal Put Spread"];

export default function ChainGated() {
  useTheme();
  return <PlanGate><ChainScreen /></PlanGate>;
}

function ChainScreen() {
  useTheme();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [exps, setExps] = useState<{ date: string; dte: number }[]>([]);
  const [exp, setExp] = useState<string | null>(null);
  const [chain, setChain] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<"chain" | "builder">("chain");
  const [legs, setLegs] = useState<Leg[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [tplLoading, setTplLoading] = useState<string | null>(null);
  const [tpl, setTpl] = useState<{ name: string; key: string } | null>(null);

  const loadChain = useCallback(async (tk: string, e: string) => {
    setLoading(true);
    try { setChain(await api(`/api/chain/${tk}?expiration=${e}`)); }
    catch (err: any) { toast(err.message || "Chain unavailable", "error"); }
    finally { setLoading(false); }
  }, []);

  const loadTicker = useCallback(async (tk: string) => {
    setLoading(true);
    try {
      const r = await api(`/api/chain/${tk}/expirations`);
      setTicker(tk);
      setExps(r.expirations);
      setLegs([]);
      setAnalysis(null);
      const first = r.expirations.find((x: any) => x.dte >= 7) || r.expirations[0];
      setExp(first.date);
      await loadChain(tk, first.date);
    } catch (err: any) {
      toast(err.message || "Ticker not found", "error");
      setLoading(false);
    }
  }, [loadChain]);

  useEffect(() => { loadTicker("AAPL"); }, [loadTicker]);

  const pickExp = (d: string) => {
    if (d === exp) return;
    setExp(d);
    loadChain(ticker, d);
  };

  const addLeg = (action: "Buy" | "Sell", type: "Call" | "Put", row: Row) => {
    const side = type === "Call" ? row.call : row.put;
    const price = action === "Buy" ? side?.ask : side?.bid;
    if (!side || !price || !exp) { toast("No live quote on that side", "error"); return; }
    setLegs((prev) => {
      const i = prev.findIndex((l) => l.action === action && l.type === type && l.strike === row.strike && l.expiration === exp);
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      if (prev.length >= 8) { toast("Max 8 legs", "error"); return prev; }
      return [...prev, { action, type, strike: row.strike, qty: 1, price, iv: side.iv, expiration: exp }];
    });
    toast(`${action} ${type} ${row.strike} ${exp.slice(5)} @ $${price} added`, "success");
  };

  const applyTemplate = async (t: string) => {
    if (!exp) return;
    setTplLoading(t);
    try {
      const r = await api("/api/chain/template", { method: "POST", body: JSON.stringify({ ticker, expiration: exp, template: t }) });
      setLegs(r.legs);
      setTpl({ name: t, key: JSON.stringify(r.legs) });
    } catch (err: any) { toast(err.message || "Template failed", "error"); }
    finally { setTplLoading(null); }
  };

  const timer = useRef<any>(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!legs.length || !exp) { setAnalysis(null); return; }
    timer.current = setTimeout(async () => {
      setAnalyzing(true);
      try { setAnalysis(await api("/api/chain/analyze", { method: "POST", body: JSON.stringify({ ticker, expiration: exp, legs }) })); }
      catch (err: any) { toast(err.message || "Analysis failed", "error"); }
      finally { setAnalyzing(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [legs, exp, ticker]);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = chain?.rows || [];
    if (showAll || !all.length) return all;
    const atm = all.reduce((b, r, i) => (Math.abs(r.strike - chain.price) < Math.abs(all[b].strike - chain.price) ? i : b), 0);
    return all.slice(Math.max(0, atm - 10), atm + 11);
  }, [chain, showAll]);

  const submit = () => {
    const tk = input.trim().toUpperCase();
    if (tk) loadTicker(tk);
  };

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <Text style={st.title}>Option Chain</Text>
        <View style={st.searchRow}>
          <TextInput testID="chain-ticker-input" value={input} onChangeText={setInput} autoCapitalize="characters"
            placeholder="Ticker" placeholderTextColor={colors.muted} style={st.search} onSubmitEditing={submit} returnKeyType="search" />
          <Pressable testID="chain-search" onPress={submit} style={st.searchBtn}>
            <Icon name="search" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        {chain ? (
          <View style={st.metaRow}>
            <Text style={st.tk}>{chain.ticker} <Text style={st.px}>${chain.price}</Text></Text>
            <Badge testID="chain-source" text={`Live · ${chain.source}`} kind="success" />
            {chain.atm_iv ? <Text style={st.meta}>ATM IV {(chain.atm_iv * 100).toFixed(1)}%</Text> : null}
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.expRow}>
          {exps.map((e) => (
            <Pressable key={e.date} testID={`exp-${e.date}`} onPress={() => pickExp(e.date)} style={[st.expChip, exp === e.date && st.expChipOn]}>
              <Text style={[st.expText, exp === e.date && st.expTextOn]}>{e.date.slice(5).replace("-", "/")}</Text>
              <Text style={[st.expDte, exp === e.date && st.expTextOn]}>{e.dte}d</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={st.seg}>
          {(["chain", "builder"] as const).map((v) => (
            <Pressable key={v} testID={`view-${v}`} onPress={() => setView(v)} style={[st.segBtn, view === v && st.segOn]}>
              <Text style={[st.segText, view === v && st.segTextOn]}>{v === "chain" ? "Chain" : `Strategy (${legs.length})`}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={st.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => exp && loadChain(ticker, exp)} />}>
        {view === "chain" ? (
          <ChainTable rows={rows} price={chain?.price} loading={loading} onTap={addLeg}
            showAll={showAll} toggleAll={() => setShowAll((v) => !v)} />
        ) : (
          <Builder ticker={ticker} exp={exp} tplName={tpl && tpl.key === JSON.stringify(legs) ? tpl.name : null} legs={legs} setLegs={setLegs} analysis={analysis} analyzing={analyzing}
            applyTemplate={applyTemplate} tplLoading={tplLoading} goChain={() => setView("chain")} />
        )}
      </ScrollView>
      <ToastHost />
    </View>
  );
}

function ChainTable({ rows, price, loading, onTap, showAll, toggleAll }: {
  rows: Row[]; price?: number; loading: boolean; onTap: (a: "Buy" | "Sell", t: "Call" | "Put", r: Row) => void;
  showAll: boolean; toggleAll: () => void;
}) {
  useTheme();
  if (loading && !rows.length) return <ActivityIndicator style={{ marginTop: spacing["2xl"] }} color={colors.brandPrimary} />;
  if (!rows.length) return <Text style={st.empty}>No chain loaded.</Text>;
  const Cell = ({ v, onPress, itm, id, kind }: { v?: number; onPress: () => void; itm: boolean; id: string; kind: "bid" | "ask" }) => (
    <Pressable testID={id} onPress={onPress} style={[st.cell, itm && st.itm]}>
      <Text style={[st.cellText, { color: kind === "bid" ? colors.error : colors.success }]}>{v ? v.toFixed(2) : "—"}</Text>
    </Pressable>
  );
  let priceShown = false;
  return (
    <View testID="chain-table">
      <Text style={st.hint}>Tap a <Text style={{ color: colors.error, fontWeight: "800" }}>bid</Text> to sell, an{" "}
        <Text style={{ color: colors.success, fontWeight: "800" }}>ask</Text> to buy. Shaded = in the money.</Text>
      <View style={st.thead}>
        <Text style={[st.th, { flex: 2 }]}>CALLS</Text><Text style={st.thStrike}>Strike</Text><Text style={[st.th, { flex: 2 }]}>PUTS</Text>
      </View>
      <View style={st.thead}>
        <Text style={st.th}>Bid</Text><Text style={st.th}>Ask</Text><Text style={st.thStrike}>IV · OI</Text><Text style={st.th}>Bid</Text><Text style={st.th}>Ask</Text>
      </View>
      {rows.map((r) => {
        const showLine = !priceShown && price != null && r.strike >= price;
        if (showLine) priceShown = true;
        return (
          <React.Fragment key={r.strike}>
            {showLine ? (
              <View style={st.priceLine}><View style={st.priceRule} /><Text style={st.priceTag}>${price}</Text><View style={st.priceRule} /></View>
            ) : null}
            <View style={st.tr}>
              <Cell id={`c-bid-${r.strike}`} kind="bid" v={r.call?.bid} itm={price != null && r.strike < price} onPress={() => onTap("Sell", "Call", r)} />
              <Cell id={`c-ask-${r.strike}`} kind="ask" v={r.call?.ask} itm={price != null && r.strike < price} onPress={() => onTap("Buy", "Call", r)} />
              <View style={st.strike}>
                <Text style={st.strikeText}>{r.strike}</Text>
                <Text style={st.strikeSub}>{r.call?.iv ? `${Math.round(r.call.iv * 100)}%` : "—"} · {(r.call?.oi ?? 0) + (r.put?.oi ?? 0)}</Text>
              </View>
              <Cell id={`p-bid-${r.strike}`} kind="bid" v={r.put?.bid} itm={price != null && r.strike > price} onPress={() => onTap("Sell", "Put", r)} />
              <Cell id={`p-ask-${r.strike}`} kind="ask" v={r.put?.ask} itm={price != null && r.strike > price} onPress={() => onTap("Buy", "Put", r)} />
            </View>
          </React.Fragment>
        );
      })}
      <Pressable testID="toggle-all-strikes" onPress={toggleAll} style={st.more}>
        <Text style={st.moreText}>{showAll ? "Show strikes near the money" : "Show all strikes"}</Text>
      </Pressable>
    </View>
  );
}

function Builder({ ticker, exp, tplName, legs, setLegs, analysis, analyzing, applyTemplate, tplLoading, goChain }: {
  ticker: string; exp: string | null; tplName: string | null; legs: Leg[]; setLegs: React.Dispatch<React.SetStateAction<Leg[]>>; analysis: any; analyzing: boolean;
  applyTemplate: (t: string) => void; tplLoading: string | null; goChain: () => void;
}) {
  useTheme();
  const setQty = (i: number, d: number) => setLegs((p) => p.map((l, j) => (j === i ? { ...l, qty: Math.max(1, Math.min(100, l.qty + d)) } : l)));
  const remove = (i: number) => setLegs((p) => p.filter((_, j) => j !== i));
  const a = analysis;
  const [saveOpen, setSaveOpen] = useState(false);
  const multi = new Set(legs.filter((l) => l.type !== "Stock").map((l) => l.expiration)).size > 1;
  return (
    <View>
      <Text style={st.section}>Quick templates</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        {TEMPLATES.map((t) => (
          <Pressable key={t} testID={`tpl-${t.replace(/ /g, "-")}`} onPress={() => applyTemplate(t)} style={st.tpl}>
            {tplLoading === t ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={st.tplText}>{t}</Text>}
          </Pressable>
        ))}
      </ScrollView>

      <View style={st.legHead}>
        <Text style={st.section}>Legs</Text>
        {legs.length ? <Pressable testID="clear-legs" onPress={() => setLegs([])}><Text style={st.link}>Clear</Text></Pressable> : null}
      </View>
      {!legs.length ? (
        <Pressable onPress={goChain} style={st.emptyBox}>
          <Icon name="plus-circle" size={20} color={colors.brandPrimary} />
          <Text style={st.emptyText}>Pick a template above or tap bid/ask prices in the chain</Text>
        </Pressable>
      ) : legs.map((l, i) => (
        <View key={`${l.action}-${l.type}-${l.strike}-${l.expiration}`} testID={`leg-${i}`} style={st.leg}>
          <Badge text={l.action} kind={l.action === "Buy" ? "success" : "error"} />
          <View style={{ flex: 1 }}>
            <Text style={st.legText}>{l.type === "Stock" ? "100 shares" : `${l.type} ${l.strike}`} <Text style={st.legPx}>@ ${l.price}</Text></Text>
            {l.type !== "Stock" ? <Text style={st.legExp}>exp {l.expiration}</Text> : null}
          </View>
          <View style={st.qty}>
            <Pressable testID={`qty-minus-${i}`} onPress={() => setQty(i, -1)} style={st.qtyBtn}><Icon name="minus" size={14} color={colors.onSurface} /></Pressable>
            <Text style={st.qtyText}>{l.qty}</Text>
            <Pressable testID={`qty-plus-${i}`} onPress={() => setQty(i, 1)} style={st.qtyBtn}><Icon name="plus" size={14} color={colors.onSurface} /></Pressable>
          </View>
          <Pressable testID={`remove-leg-${i}`} onPress={() => remove(i)} hitSlop={8}><Icon name="x" size={16} color={colors.muted} /></Pressable>
        </View>
      ))}

      {analyzing && !a ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.brandPrimary} /> : null}
      {a && legs.length ? (
        <View testID="strategy-analysis" style={{ opacity: analyzing ? 0.6 : 1 }}>
          <View style={st.kpis}>
            <Kpi label={a.premium_type === "credit" ? "Net credit" : "Net debit"} value={money(Math.abs(a.net_premium))} color={a.premium_type === "credit" ? colors.success : colors.onSurface} />
            <Kpi label="Max profit" value={a.unlimited_profit ? "Unlimited" : money(a.max_profit)} color={colors.success} />
            <Kpi label="Max loss" value={a.unlimited_loss ? "Unlimited" : money(a.max_loss)} color={colors.error} />
            <Kpi label="POP" value={`${a.pop}%`} color={a.pop >= 50 ? colors.success : colors.warning} />
          </View>
          {a.multi_expiry ? <Text testID="multi-expiry-note" style={st.multiNote}>Mixed expirations: payoff shown at the nearest expiry ({a.expiration}); later legs valued with their remaining time.</Text> : null}
          <Text style={st.section}>Profit / loss by price</Text>
          <PnLChart curve={a.curve} price={a.price} breakevens={a.breakevens} />
          <Text style={st.section}>Profit / loss by date & price move</Text>
          <PnLHeatmap data={a.heatmap} />
          <MetricRow label="Breakevens" value={a.breakevens.length ? a.breakevens.map((b: number) => `$${b}`).join(" · ") : "—"} />
          <MetricRow label="Expected value (model)" value={money(a.expected_value)} color={a.expected_value >= 0 ? colors.success : colors.error} />
          <MetricRow label="Fees" value={`$${a.fees}`} />
          <Text style={st.section}>Net Greeks (position)</Text>
          <View style={st.kpis}>
            <Kpi label="Delta" value={String(a.greeks.delta)} />
            <Kpi label="Gamma" value={String(a.greeks.gamma)} />
            <Kpi label="Theta/day" value={money(a.greeks.theta)} color={a.greeks.theta >= 0 ? colors.success : colors.error} />
            <Kpi label="Vega" value={String(a.greeks.vega)} />
          </View>
          <View style={{ marginTop: spacing.lg }}>
            <Button testID="save-strategy" label="Save strategy & track P&L" icon={<Icon name="bookmark" size={16} color={colors.onBrandPrimary} />} onPress={() => setSaveOpen(true)} />
          </View>
          <Text style={st.disc}>Entry at live bid/ask. Future values modeled with each leg&apos;s implied vol. Research only — not investment advice.</Text>
        </View>
      ) : null}
      <SaveStrategySheet visible={saveOpen} onClose={() => setSaveOpen(false)} ticker={ticker} expiration={exp}
        legs={legs} strategyType={tplName} defaultName={`${ticker} ${multi ? "multi-expiry" : ""} strategy`.replace("  ", " ")} />
    </View>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  useTheme();
  return (
    <View style={st.kpi}>
      <Text style={st.kpiLabel}>{label}</Text>
      <Text style={[st.kpiValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const st = themedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5, marginBottom: spacing.md },
  searchRow: { flexDirection: "row", gap: spacing.sm },
  search: { flex: 1, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, fontSize: 16, fontWeight: "700", color: colors.onSurface },
  searchBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  tk: { fontSize: 18, fontWeight: "800", color: colors.onSurface },
  px: { fontSize: 16, fontWeight: "600", color: colors.onSurfaceSecondary },
  meta: { fontSize: 12, color: colors.muted },
  expRow: { gap: spacing.sm, paddingVertical: spacing.md },
  expChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", minWidth: 56 },
  expChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  expText: { fontSize: 13, fontWeight: "700", color: colors.onSurface },
  expDte: { fontSize: 10, color: colors.muted },
  expTextOn: { color: colors.onBrandPrimary },
  seg: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 3, marginBottom: spacing.md },
  segBtn: { flex: 1, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surface },
  segText: { fontSize: 13, fontWeight: "700", color: colors.muted },
  segTextOn: { color: colors.onSurface },
  scroll: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  hint: { fontSize: 12, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  thead: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  th: { flex: 1, textAlign: "center", fontSize: 10, fontWeight: "800", color: colors.muted, letterSpacing: 0.5 },
  thStrike: { width: 78, textAlign: "center", fontSize: 10, fontWeight: "800", color: colors.muted },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.divider },
  cell: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  itm: { backgroundColor: colors.surfaceTertiary },
  cellText: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  strike: { width: 78, alignItems: "center", justifyContent: "center", height: 44, backgroundColor: colors.surfaceSecondary },
  strikeText: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  strikeSub: { fontSize: 9, color: colors.muted },
  priceLine: { flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 2 },
  priceRule: { flex: 1, height: 2, backgroundColor: colors.brandPrimary },
  priceTag: { fontSize: 11, fontWeight: "800", color: colors.onBrandPrimary, backgroundColor: colors.brandPrimary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  more: { alignItems: "center", paddingVertical: spacing.lg },
  moreText: { color: colors.brandPrimary, fontWeight: "700" },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xl },
  section: { fontSize: 12, fontWeight: "800", color: colors.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.md, marginBottom: spacing.sm },
  tpl: { paddingHorizontal: spacing.md, height: 36, justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.brandSecondary },
  tplText: { fontSize: 12, fontWeight: "700", color: colors.onBrandSecondary },
  legHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.brandPrimary, fontWeight: "700", marginTop: spacing.md },
  emptyBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong },
  emptyText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13 },
  leg: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  legText: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  legExp: { fontSize: 11, color: colors.muted, marginTop: 1 },
  multiNote: { fontSize: 12, color: colors.onBrandSecondary, backgroundColor: colors.brandSecondary, padding: spacing.sm, borderRadius: radius.sm, marginTop: spacing.md, lineHeight: 16 },
  legPx: { fontWeight: "500", color: colors.onSurfaceSecondary },
  qty: { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyBtn: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  qtyText: { minWidth: 18, textAlign: "center", fontWeight: "800", color: colors.onSurface },
  kpis: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  kpi: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  kpiLabel: { fontSize: 10, color: colors.muted, fontWeight: "700" },
  kpiValue: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: 2, fontVariant: ["tabular-nums"] },
  disc: { fontSize: 10, color: colors.muted, marginTop: spacing.md, lineHeight: 14 },
}));
