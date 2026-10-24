import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Icon from "@react-native-vector-icons/feather";

import { api } from "@/src/api";
import { Button } from "@/src/Button";
import { Input } from "@/src/Input";
import { ToastHost, toast } from "@/src/Toast";
import { MetricRow, Badge } from "@/src/parts";
import { PayoffChart, FreshnessPill, LoadingSkeleton } from "@/src/charts";
import { useTTS, useSTT } from "@/src/voice";
import { colors, spacing, radius, themedStyles, useTheme } from "@/src/theme";
import { PlanGate, usePlan } from "@/src/plans";
import { ACCOUNTS, Chips, Label, OptionInsights, accountLabel } from "@/src/screen";
import { FinancialsChart, ValuationMeasures, PeerComparison, BalanceSheet, OptiIQCard } from "@/src/financials";
import { OptiScoreCard, PlanCard, ValidationCard, ScanCard, PipelineStrip } from "@/src/quality";
import { money } from "@/src/quantcharts";
import { AskAIButton } from "@/src/ChatParts";
import { ValuationBoard } from "@/src/ValuationBoard";
import { BuyLevelsChart } from "@/src/BuyLevelsChart";

const STRATS = ["auto", "Cash Secured Put", "Covered Call", "Bull Put Spread", "Bear Call Spread", "Iron Condor", "Bull Call Spread", "Bear Put Spread", "Long Call Butterfly", "Long Call", "Long Put", "Long Straddle", "Long Strangle", "Sell Put", "Sell Call", "Short Strangle"];

type Lab = "day" | "swing" | "long" | "options";

export default function AnalyzeGated() {
  useTheme();
  return <PlanGate><Analyze /></PlanGate>;
}

function Analyze() {
  useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [lab, setLab] = useState<Lab>("options");
  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [onWatchlist, setOnWatchlist] = useState(false);
  const [strategy, setStrategy] = useState("auto");
  const [acct, setAcct] = useState("reg_t");
  const [acctSize, setAcctSize] = useState(""); // empty -> server uses the profile account size
  const [riskPct, setRiskPct] = useState("1");
  const [minRR, setMinRR] = useState("2");
  const plan = usePlan();
  const scrollRef = useRef<ScrollView>(null);
  const params = useLocalSearchParams<{ ticker?: string; strategy?: string; range?: string }>();

  useEffect(() => {
    api("/api/screener/profiles").then((r) => {
      if (r?.defaults) { setAcct(r.defaults.account_type); setAcctSize(String(r.defaults.account_size)); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.ticker) {
      setLab("options"); setTicker(String(params.ticker));
      if (params.strategy) setStrategy(String(params.strategy));
      if (params.range) setRange(String(params.range));
      run({ tk: String(params.ticker), strat: params.strategy ? String(params.strategy) : undefined, rng: params.range ? String(params.range) : undefined, l: "options" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ticker, params.strategy, params.range]);

  const run = async (o: { tk?: string; strat?: string; rng?: string; l?: Lab } = {}) => {
    const tk = (o.tk || ticker).trim().toUpperCase();
    if (!tk) { toast("Enter a ticker", "error"); return; }
    const which = o.l || lab;
    setLoading(true); setData(null);
    try {
      if (which === "options") {
        const r = await api("/api/screener/ticker-options", { method: "POST", body: JSON.stringify({
          ticker: tk, expiration_range: o.rng || range, strategy: plan.strategyAllowed(o.strat || strategy) ? (o.strat || strategy) : "auto", account_type: acct, tier: plan.tier,
          account_size: parseFloat(acctSize) || undefined,
        }) });
        setData(r.result);
        if (plan.features.ai_explain) explainOne(r.result);
      } else {
        const r = await api("/api/screener/stock-analysis", { method: "POST", body: JSON.stringify({
          ticker: tk, purpose: which, account_size: parseFloat(acctSize) || undefined,
          risk_pct: parseFloat(riskPct) || 1, min_rr: parseFloat(minRR) || 2,
        }) });
        setData(r.result);
      }
    } catch (e: any) { toast(e.message || "Failed", "error"); }
    finally { setLoading(false); }
  };

  const explainOne = async (r: any) => {
    try {
      const a = await api("/api/screener/explain", { method: "POST", body: JSON.stringify({
        ideas: [{ ticker: r.ticker, strategy: r.strategy, price: r.price, pop: r.pop, roc_pct: r.roc_pct, max_profit: r.max_profit,
          max_loss: r.max_loss, breakevens: r.breakevens, iv_rank: r.volatility?.iv_rank, liquidity: r.liquidity?.grade,
          earnings_in_window: r.events?.earnings_in_window, dte: r.expiration_days, account: r.account_type }],
        context: `Single-ticker options analysis, ${accountLabel(r.account_type)} account`,
      }) });
      setData((d: any) => d && d.ticker === r.ticker ? { ...d, ai_summary: a.summary || a.picks?.[0]?.why, risk_note: a.picks?.[0]?.risk } : d);
    } catch {}
  };

  const addToWatchlist = async () => {
    if (!data?.ticker) return;
    try { await api("/api/watchlist/add", { method: "POST", body: JSON.stringify({ ticker: data.ticker }) }); setOnWatchlist(true); toast(`${data.ticker} added`, "success"); }
    catch (e: any) { toast(e.message || "Failed", "error"); }
  };

  const pickFromBoard = (tk: string) => {
    setTicker(tk);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    run({ tk, l: "long" });
  };

  const labs: { id: Lab; label: string }[] = [
    { id: "options", label: "Options Lab" },
    { id: "day", label: "Day" },
    { id: "swing", label: "Swing" },
    { id: "long", label: "Long-term" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Analyze</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
          {labs.map((l) => {
            const active = lab === l.id;
            return (
              <Pressable key={l.id} testID={`lab-${l.id}`} onPress={() => { if (l.id === "day" && !plan.features.day_lab) { router.push("/upgrade" as any); return; } setLab(l.id); setData(null); }} style={[styles.modeChip, active && styles.modeChipActive]}>
                <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{l.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.filterCard}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Input testID="analyze-ticker" label="Ticker" value={ticker} onChangeText={(v) => setTicker(v.toUpperCase())} placeholder="e.g., AAPL" autoCapitalize="characters" />
            </View>
            <MicButton onText={(t) => { const m = t.toUpperCase().match(/[A-Z]{1,5}/); if (m) setTicker(m[0]); }} />
          </View>
          {lab === "options" ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={styles.chipLabel}>Expiration range</Text>
              <View style={styles.chipsWrap}>
                {["week", "month", "3months"].map((o) => {
                  const active = range === o;
                  return (
                    <Pressable key={o} testID={`range-${o}`} onPress={() => setRange(o)} style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{o}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {lab === "options" ? (
            <>
              <Label>Strategy</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
                {STRATS.map((o) => {
                  const active = strategy === o;
                  const ok = plan.strategyAllowed(o);
                  return (
                    <Pressable key={o} testID={`strat-${o}`} onPress={() => (ok ? setStrategy(o) : router.push("/upgrade" as any))} style={[styles.chip, active && styles.chipActive, !ok && { opacity: 0.45 }]}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{o === "auto" ? "Auto (best fit)" : o}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Label>Account type</Label>
              <Chips testKey="an-acct" value={acct} onChange={setAcct} options={ACCOUNTS} />
            </>
          ) : null}
          {lab === "day" || lab === "swing" ? (
            <>
              <Input testID="an-account-size" label="Account size ($)" value={acctSize} onChangeText={(v) => setAcctSize(v.replace(/[^0-9.]/g, ""))} keyboardType="numeric" />
              <Label>Risk per trade (% of account)</Label>
              <Chips testKey="risk-pct" value={riskPct} onChange={setRiskPct} options={["0.5", "1", "2", "3"].map((v) => ({ id: v, label: `${v}%` }))} />
              <Label>Minimum reward : risk</Label>
              <Chips testKey="min-rr" value={minRR} onChange={setMinRR} options={["1.5", "2", "3"].map((v) => ({ id: v, label: `${v}:1` }))} />
            </>
          ) : null}
          <Button testID="analyze-run" label={loading ? "Analyzing…" : "Analyze"} onPress={() => run()} loading={loading} />
        </View>

        {loading && <View style={{ padding: spacing.xl }}><LoadingSkeleton lines={5} /></View>}

        {data && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Pressable onPress={() => router.push(`/ticker/${data.ticker}` as any)}>
                <Text style={styles.ticker}>{data.ticker}</Text>
                <Text style={styles.company}>{data.name}</Text>
              </Pressable>
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                <Text style={styles.price}>${Number(data.price).toFixed(2)}</Text>
                <Pressable testID="add-watchlist" onPress={addToWatchlist} style={styles.iconBtn}>
                  <Icon name={onWatchlist ? "check" : "plus"} size={16} color={colors.brandPrimary} />
                </Pressable>
              </View>
            </View>
            {data.ai_summary ? <SpeakAi text={data.ai_summary} /> : null}
            {data.data_source ? <ProvenanceBar src={data.data_source} /> : null}

            {lab === "options" ? <OptionsLab r={data} /> : lab === "long" ? <LongForm r={data} /> : <ShortForm r={data} />}
          </View>
        )}
        {lab === "long" ? <ValuationBoard onSelect={pickFromBoard} /> : null}
      </ScrollView>
      <ToastHost />
    </View>
  );
}

function ProvenanceBar({ src }: { src: any }) {
  useTheme();
  return (
    <View style={{ marginVertical: spacing.sm }}>
      <FreshnessPill source={src.quote} timestamp={src.fetched_at} />
    </View>
  );
}

function SpeakAi({ text }: { text: string }) {
  useTheme();
  const { play, stop, loading, playing } = useTTS();
  const { features } = usePlan();
  return (
    <View style={styles.aiRow}>
      <Text style={styles.aiText}>{text}</Text>
      {features.voice ? <Pressable testID="speak-btn" onPress={() => (playing ? stop() : play(text))} style={styles.speakBtn}>
        <Icon name={loading ? "loader" : playing ? "pause" : "volume-2"} size={14} color={colors.brandPrimary} />
      </Pressable> : null}
    </View>
  );
}

function MicButton({ onText }: { onText: (t: string) => void }) {
  useTheme();
  const { start, stop, recording, loading } = useSTT(onText);
  return (
    <Pressable testID="mic-btn" onPress={() => (recording ? stop() : start())} style={[styles.micBtn, recording && styles.micBtnActive]}>
      <Icon name={loading ? "loader" : recording ? "square" : "mic"} size={18} color={recording ? colors.onError : colors.brandPrimary} />
    </Pressable>
  );
}

function OptionsLab({ r }: { r: any }) {
  useTheme();
  const plan = usePlan();
  const [expanded, setExpanded] = useState<"basic" | "greeks" | "scenarios">("basic");
  return (
    <View>
      <View style={styles.strategyRow}>
        <Badge text={r.strategy} kind="brand" />
        <Badge text={`exp ${r.expiration}`} kind="info" />
        <Badge testID="quote-source-badge" text={r.live_quotes ? `Live · ${r.quote_source}` : "Model estimate"} kind={r.live_quotes ? "success" : "warn"} />
      </View>

      {r.passes_filters === false ? <Text style={[styles.rationale, { color: colors.warning }]}>Doesn&apos;t pass your filters: {(r.failed_filters || []).join(", ")}</Text> : null}
      {/* Hero numbers */}
      <View style={styles.heroRow}>
        <View style={styles.heroBox}>
          <Text style={styles.heroLabel}>Max profit</Text>
          <Text style={[styles.heroVal, { color: colors.success }]}>
            {r.max_profit != null ? money(r.max_profit) : "Unlimited"}
          </Text>
        </View>
        <View style={styles.heroBox}>
          <Text style={styles.heroLabel}>Max loss</Text>
          <Text style={[styles.heroVal, { color: colors.error }]}>
            {r.max_loss != null ? money(-Math.abs(r.max_loss)) : "Undefined"}
          </Text>
        </View>
        <View testID="hero-pop" style={styles.heroBox}>
          <Text style={styles.heroLabel}>{r.pop_calibrated != null ? "POP (calibrated)" : "POP"}</Text>
          <Text style={styles.heroVal}>{r.pop_calibrated ?? r.pop}%</Text>
          {r.pop_calibrated != null ? <Text style={styles.legTheo}>model {r.pop}%</Text> : null}
        </View>
      </View>

      <PipelineStrip r={r} />
      <OptiScoreCard r={r} />
      <PlanCard plan={r.plan} pop={r.pop_calibrated ?? r.pop} />
      <ValidationCard v={r.validation} pop={r.pop} />
      <ScanCard scan={r.scan} />
      <AskAIButton testID="analyze-ask-ai" ticker={r.ticker} label={`Ask AI about this ${r.ticker} ${r.strategy}`}
        prompt={`Explain this ${r.ticker} ${r.strategy}: is it worth taking, and what's the biggest risk?`} />

      {/* Payoff chart */}
      <Text style={styles.sectionLabel}>Payoff at expiration</Text>
      <PayoffChart
        legs={r.legs || []}
        premiumNet={r.premium_net || 0}
        currentPrice={r.price}
        breakevens={r.breakevens || []}
        maxProfit={r.max_profit}
        maxLoss={r.max_loss}
      />

      <Text style={styles.sectionLabel}>Metrics</Text>
      <MetricRow label="Breakevens" value={(r.breakevens || []).map((b: number) => `$${b}`).join(" / ") || "—"} />
      <MetricRow label="Premium (net)" value={`${r.premium_net > 0 ? "+" : ""}$${r.premium_net}`} color={r.premium_net > 0 ? colors.success : colors.error} />
      <MetricRow label={`Collateral (${accountLabel(r.account_type)})`} value={r.collateral != null ? `$${r.collateral}` : "Not allowed"} />
      <MetricRow label="Return on capital" value={r.roc_pct != null ? `${r.roc_pct}%` : "Unlimited"} color={colors.success} />
      <MetricRow label="Annualized (hypothetical)" value={r.annualized_pct != null ? `${r.annualized_pct}%` : "—"} />
      <MetricRow label="Expires" value={`${r.expiration} (${r.expiration_days}d)`} />

      <View style={styles.subTabs}>
        {(["basic", "greeks", "scenarios"] as const).map((t) => (
          <Pressable key={t} testID={`sub-${t}`} onPress={() => setExpanded(t)} style={[styles.subTab, expanded === t && styles.subTabActive]}>
            <Text style={[styles.subTabText, expanded === t && styles.subTabTextActive]}>
              {t === "basic" ? "Legs" : t === "greeks" ? "Greeks" : "Scenarios"}
            </Text>
          </Pressable>
        ))}
      </View>

      {expanded === "basic" && (
        <View>
          {(r.legs || []).map((l: any, i: number) => (
            <View key={i} style={styles.legRow}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Badge text={l.action} kind={l.action === "Buy" ? "success" : "error"} />
                <Text style={styles.legText}>{l.qty > 1 ? `${l.qty}× ` : ""}{l.type} @ ${l.strike}</Text>
              </View>
              <Text style={styles.legTheo}>{l.type === "Stock" ? "100 shares" : l.live ? `bid $${l.bid} / ask $${l.ask} · fill $${l.fill}` : `mid $${l.mid} · fill $${l.fill}`}</Text>
            </View>
          ))}
        </View>
      )}

      {expanded === "greeks" && (
        <View>
          <View style={styles.greekGrid}>
            <GreekBox label="Delta" value={String(r.greeks?.delta ?? "—")} />
            <GreekBox label="Gamma" value={String(r.greeks?.gamma ?? "—")} />
            <GreekBox label="Theta/day" value={String(r.greeks?.theta ?? "—")} />
            <GreekBox label="Vega" value={String(r.greeks?.vega ?? "—")} />
          </View>
          <MetricRow label={r.live_quotes ? "ATM implied vol (live)" : "IV assumed"} value={`${((r.iv_assumed ?? 0) * 100).toFixed(0)}%`} />
          <Text style={styles.disclaimer}>{r.live_quotes ? `Greeks from ${r.quote_source} (ORATS).` : "Theoretical values from Black-Scholes with the IV assumption above. Real quotes may differ."}</Text>
        </View>
      )}

      {expanded === "scenarios" && (
        <View>
          <Text style={styles.disclaimer}>Estimated P&L (per contract) across price moves and time elapsed.</Text>
          {(r.scenario_matrix || []).map((row: any, i: number) => (
            <View key={i} style={styles.scenarioRow}>
              <Text style={styles.scenarioLabel}>Day {row.days_elapsed}</Text>
              <View style={styles.scenarioCells}>
                {Object.entries(row.pnl).map(([mv, p]: any) => (
                  <View key={mv} style={[styles.scenarioCell, { backgroundColor: p >= 0 ? colors.gainBg : colors.lossBg }]}>
                    <Text style={styles.scenarioMv}>{mv}</Text>
                    <Text style={[styles.scenarioPnl, { color: p >= 0 ? colors.success : colors.error }]}>${p}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      <OptionInsights r={r} collateralLocked={!plan.features.collateral_views} />
      {r.risk_note ? <Text style={styles.rationale}>AI risk note: {r.risk_note}</Text> : null}
      {(r.alternatives || []).length ? (
        <>
          <Text style={styles.sectionLabel}>Other strategies compared</Text>
          {r.alternatives.slice(0, 6).map((a: any, i: number) => (
            <View key={`${a.strategy}-${i}`} style={styles.altRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.legText}>{a.strategy}</Text>
                <Text style={styles.legTheo}>POP {a.pop}% · ROC {a.roc_pct != null ? `${a.roc_pct}%` : "∞"} · max loss {a.max_loss != null ? `$${a.max_loss}` : "undef"}</Text>
              </View>
              <Badge text={a.passes ? "passes" : a.failed?.[0] || "filtered"} kind={a.passes ? "success" : "warn"} />
            </View>
          ))}
        </>
      ) : null}
      {r.assumptions ? (
        <Text style={styles.disclaimer}>Assumptions: {r.assumptions.model} • IV {r.assumptions.iv_assumed_pct}% • risk-free {r.assumptions.risk_free_rate_pct}%.</Text>
      ) : null}
    </View>
  );
}

function GreekBox({ label, value }: { label: string; value: string }) {
  useTheme();
  return (
    <View style={styles.greekBox}>
      <Text style={styles.greekLabel}>{label}</Text>
      <Text style={styles.greekVal}>{value}</Text>
    </View>
  );
}

function ShortForm({ r }: { r: any }) {
  useTheme();
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 6, marginVertical: spacing.sm }}>
        <Badge text={r.verdict || "HOLD"} kind={r.verdict === "BUY" ? "success" : r.verdict === "SELL" ? "error" : "warn"} />
        {r.confidence ? <Badge text={`${r.confidence} conf.`} kind="info" /> : null}
      </View>
      <TradePlan r={r} />
      <Text style={styles.sectionLabel}>Technicals</Text>
      <MetricRow label="SMA 20 / 50" value={`$${r.sma_20} / $${r.sma_50}`} />
      <MetricRow label="RSI (14)" value={String(r.rsi)} />
      <MetricRow label="Support / Resistance" value={`$${r.support} / $${r.resistance}`} />
      <MetricRow label="Market sentiment" value={r.market_sentiment} />
      <Text style={styles.sectionLabel}>Patterns</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(r.candlestick_patterns || []).map((p: string) => <Badge key={p} text={p} kind="brand" />)}
        {(r.chart_patterns || []).map((p: string) => <Badge key={p} text={p} kind="success" />)}
      </View>
    </View>
  );
}

function TradePlan({ r }: { r: any }) {
  useTheme();
  const p = r.trade_plan;
  if (!p) return null;
  const long = p.direction === "long";
  return (
    <View>
      <Text style={styles.sectionLabel}>{long ? "Trade plan · long" : "Trade plan · short side"}</Text>
      <View style={styles.heroRow}>
        <View style={styles.heroBox}><Text style={styles.heroLabel}>{long ? "Buy" : "Sell short"}</Text><Text style={styles.heroValSm}>${p.entry}</Text></View>
        <View style={styles.heroBox}><Text style={styles.heroLabel}>Stop</Text><Text style={[styles.heroValSm, { color: colors.error }]}>${p.stop}</Text></View>
        <View style={styles.heroBox}><Text style={styles.heroLabel}>{long ? "Target" : "Cover"}</Text><Text style={[styles.heroValSm, { color: colors.success }]}>${p.target}</Text></View>
      </View>
      <MetricRow label="Reward : risk" value={`${p.reward_risk}:1`} />
      <MetricRow label="ATR (14)" value={`$${p.atr}`} />
      {p.entry_trigger ? (
        <View testID="stock-trigger" style={styles.triggerBox}>
          <View style={styles.triggerRow}>
            <Icon name="log-in" size={14} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.triggerTitle}>Entry trigger · {p.entry_trigger.type}</Text>
              <Text style={styles.triggerText}>{p.entry_trigger.text}</Text>
            </View>
          </View>
          <View style={styles.triggerRow}>
            <Icon name="alert-octagon" size={14} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.triggerTitle}>Invalidation</Text>
              <Text style={styles.triggerText}>{p.invalidation.text}</Text>
            </View>
          </View>
          <View style={styles.triggerRow}>
            <Icon name="clock" size={14} color={colors.onSurfaceSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.triggerTitle}>Time stop</Text>
              <Text style={styles.triggerText}>{p.time_stop}</Text>
            </View>
          </View>
        </View>
      ) : null}
      <Text style={styles.sectionLabel}>Position sizing</Text>
      <MetricRow label="Shares" value={String(p.shares)} />
      <MetricRow label="Position value" value={`$${p.position_value.toLocaleString()}`} />
      <MetricRow label={`Max loss (${p.risk_pct}% of account)`} value={`$${p.max_loss_dollars.toLocaleString()}`} color={colors.error} />
      <MetricRow label="Potential gain" value={`$${p.potential_gain_dollars.toLocaleString()}`} color={colors.success} />
      <View style={styles.logicBox}>
        <Text style={styles.logicTitle}>How these levels were calculated</Text>
        {(p.logic || []).map((t: string, i: number) => <Text key={i} style={styles.logicText}>{i + 1}. {t}</Text>)}
      </View>
      {r.pdt_note ? <Text style={styles.disclaimer}>{r.pdt_note}</Text> : null}
      <Text style={styles.sectionLabel}>Bull · base · bear</Text>
      <ScenarioCards rows={r.scenarios || []} pnlKey="plan_pnl" />
      <Text style={styles.disclaimer}>±1 standard deviation moves from 20-day historical volatility over the holding period. Probabilities are model estimates, not predictions.</Text>
    </View>
  );
}

function ScenarioCards({ rows, pnlKey }: { rows: any[]; pnlKey?: string }) {
  useTheme();
  return (
    <View style={styles.heroRow}>
      {rows.map((s) => {
        const tone = s.name === "Bull" ? colors.success : s.name === "Bear" ? colors.error : colors.onSurface;
        return (
          <View key={s.name} testID={`scen-${s.name}`} style={styles.heroBox}>
            <Text style={[styles.heroLabel, { color: tone }]}>{s.name}</Text>
            <Text style={styles.heroValSm}>${s.price ?? s.value}</Text>
            <Text style={styles.legTheo}>{s.move_pct ?? s.upside_pct}% · {s.probability_pct ?? s.weight_pct}%</Text>
            {pnlKey && s[pnlKey] != null ? <Text style={[styles.legTheo, { color: s[pnlKey] >= 0 ? colors.success : colors.error }]}>P&L ${s[pnlKey]}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function ValuationEditor({ r }: { r: any }) {
  useTheme();
  const inp = r.valuation_inputs;
  const [v, setV] = useState<any>(r.valuation);
  const [g, setG] = useState({ bull: String(inp?.growth?.bull ?? 15), base: String(inp?.growth?.base ?? 8), bear: String(inp?.growth?.bear ?? 0) });
  const [disc, setDisc] = useState(String(inp?.discount_pct ?? 9));
  const [tpe, setTpe] = useState(String(inp?.terminal_pe ?? 18));
  const [busy, setBusy] = useState(false);
  const recalc = async () => {
    setBusy(true);
    try {
      const res = await api("/api/screener/valuation", { method: "POST", body: JSON.stringify({
        ticker: r.ticker, growth_bull: parseFloat(g.bull), growth_base: parseFloat(g.base), growth_bear: parseFloat(g.bear),
        discount_pct: parseFloat(disc), terminal_pe: parseFloat(tpe),
      }) });
      setV(res.valuation);
    } catch (e: any) { toast(e.message || "Failed", "error"); } finally { setBusy(false); }
  };
  if (!v) return <Text style={styles.disclaimer}>DCF valuation needs positive earnings — not available for {r.ticker}.</Text>;
  return (
    <View>
      <Text style={styles.sectionLabel}>Intrinsic value · scenarios</Text>
      <ScenarioCards rows={v.scenarios} />
      <MetricRow label="Probability-weighted value" value={`$${v.weighted_value} (${v.weighted_upside_pct > 0 ? "+" : ""}${v.weighted_upside_pct}%)`} color={v.weighted_upside_pct >= 0 ? colors.success : colors.error} />
      <MetricRow label="Buy zone (below)" value={`$${v.buy_zone_below}`} color={colors.success} />
      <MetricRow label="Sell zone (above)" value={`$${v.sell_zone_above}`} color={colors.brandPrimary} />
      <View style={styles.logicBox}>
        <Text style={styles.logicTitle}>Edit assumptions</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Input testID="dcf-bull" label="Bull growth %" value={g.bull} onChangeText={(t) => setG({ ...g, bull: t })} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input testID="dcf-base" label="Base %" value={g.base} onChangeText={(t) => setG({ ...g, base: t })} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input testID="dcf-bear" label="Bear %" value={g.bear} onChangeText={(t) => setG({ ...g, bear: t })} keyboardType="numeric" /></View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Input testID="dcf-disc" label="Discount rate %" value={disc} onChangeText={setDisc} keyboardType="numeric" /></View>
          <View style={{ flex: 1 }}><Input testID="dcf-tpe" label="Terminal P/E" value={tpe} onChangeText={setTpe} keyboardType="numeric" /></View>
        </View>
        <Button testID="dcf-recalc" label="Recalculate" onPress={recalc} loading={busy} />
        <Text style={styles.disclaimer}>{v.method}. EPS (TTM) ${v.assumptions.eps_ttm}. Weights 25/50/25.</Text>
      </View>
    </View>
  );
}

function LongForm({ r }: { r: any }) {
  useTheme();
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 6, marginVertical: spacing.sm }}>
        <Badge text={r.verdict || "HOLD"} kind={r.verdict === "BUY" ? "success" : r.verdict === "SELL" ? "error" : "warn"} />
        {r.confidence ? <Badge text={`${r.confidence} conf.`} kind="info" /> : null}
      </View>
      <OptiIQCard o={r.optiiq} />
      <BuyLevelsChart r={r} />
      <ValuationEditor r={r} />
      <Text style={styles.sectionLabel}>Fundamentals</Text>
      <ValuationMeasures m={r.valuation_measures || {}} buy={r.buy_point} sell={r.sell_point} />
      <MetricRow label="Analyst target (avg)" value={r.price_target ? `$${r.price_target}` : "—"} color={colors.success} />
      {r.eps_ttm != null ? <MetricRow label="EPS (TTM)" value={`$${Number(r.eps_ttm).toFixed(2)}`} /> : null}
      {r.roe != null ? <MetricRow label="ROE" value={`${Number(r.roe).toFixed(1)}%`} /> : null}
      {r.revenue_growth_pct != null ? <MetricRow label="Rev growth" value={`${Number(r.revenue_growth_pct).toFixed(1)}%`} /> : null}
      {r.beta != null ? <MetricRow label="Beta" value={Number(r.beta).toFixed(2)} /> : null}
      <Text style={styles.sectionLabel}>Peer comparison</Text>
      <PeerComparison ticker={r.ticker} />
      <Text style={styles.sectionLabel}>Financials · quarterly</Text>
      <FinancialsChart rows={r.financials || []} source={r.financials_source} />
      <Text style={styles.sectionLabel}>Balance sheet · debt vs equity</Text>
      <BalanceSheet rows={r.financials || []} />
      <Text style={styles.sectionLabel}>Earnings</Text>
      <MetricRow label="Next date" value={r.earnings_date || "TBA"} />
      {r.earnings_eps_estimate != null ? <MetricRow label="EPS estimate" value={`$${Number(r.earnings_eps_estimate).toFixed(2)}`} /> : null}
      <Text style={styles.sectionLabel}>Business</Text>
      <MetricRow label="Moat" value={r.business_moat} />
      {r.moat_note ? <Text style={styles.rationale}>{r.moat_note}</Text> : null}
      <Text style={styles.sectionLabel}>Competitors</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(r.competitors || []).map((c: string) => <Badge key={c} text={c} kind="brand" />)}
      </View>
      <Text style={styles.sectionLabel}>Analyst ratings</Text>
      <View style={styles.ratings}>
        <View style={[styles.ratingBar, { flex: Math.max(r.analyst_ratings?.buy || 0, 1), backgroundColor: colors.success }]}><Text style={[styles.ratingText, { color: colors.onSuccess }]}>Buy {r.analyst_ratings?.buy || 0}</Text></View>
        <View style={[styles.ratingBar, { flex: Math.max(r.analyst_ratings?.hold || 0, 1), backgroundColor: colors.warning }]}><Text style={[styles.ratingText, { color: colors.onWarning }]}>Hold {r.analyst_ratings?.hold || 0}</Text></View>
        <View style={[styles.ratingBar, { flex: Math.max(r.analyst_ratings?.sell || 0, 1), backgroundColor: colors.error }]}><Text style={[styles.ratingText, { color: colors.onError }]}>Sell {r.analyst_ratings?.sell || 0}</Text></View>
      </View>
    </View>
  );
}

const styles = themedStyles((colors) => ({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  modeRow: { gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.lg },
  modeChip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0, borderWidth: 1, borderColor: colors.border },
  modeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modeChipText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  modeChipTextActive: { color: colors.onBrandPrimary },

  scroll: { padding: spacing.lg, paddingBottom: 100 },
  filterCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  chipLabel: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },
  micBtn: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  micBtnActive: { backgroundColor: colors.error, borderColor: colors.error },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  ticker: { fontSize: 22, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  company: { fontSize: 12, color: colors.muted },
  price: { fontSize: 18, fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },

  provenance: { flexDirection: "row", alignItems: "center", gap: 6, marginVertical: spacing.sm },
  provText: { fontSize: 11, color: colors.muted },

  heroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  heroBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  heroLabel: { fontSize: 10, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  heroValSm: { fontSize: 16, fontWeight: "800", marginTop: 4, color: colors.onSurface, fontVariant: ["tabular-nums"] },
  logicBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  logicTitle: { fontSize: 12, fontWeight: "800", color: colors.onSurface, marginBottom: 6 },
  logicText: { fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 18 },
  heroVal: { fontSize: 20, fontWeight: "800", marginTop: 4, color: colors.onSurface, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },

  greekGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
  greekBox: { flexGrow: 1, flexBasis: "22%", backgroundColor: colors.surfaceSecondary, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  greekLabel: { fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" },
  greekVal: { fontSize: 15, fontWeight: "700", color: colors.onSurface, marginTop: 4, fontVariant: ["tabular-nums"] },

  aiRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.brandSecondary, padding: spacing.sm, borderRadius: radius.md, marginVertical: spacing.sm },
  aiText: { flex: 1, color: colors.onBrandSecondary, fontSize: 13, lineHeight: 18 },
  speakBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },

  strategyRow: { flexDirection: "row", gap: 6, marginVertical: spacing.sm },
  sectionLabel: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md, marginBottom: 4 },
  disclaimer: { color: colors.muted, fontSize: 11, fontStyle: "italic", marginTop: 4, lineHeight: 15 },
  rationale: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: spacing.sm, fontStyle: "italic" },

  subTabs: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md, marginBottom: spacing.sm },
  subTab: { flex: 1, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  subTabActive: { backgroundColor: colors.brandPrimary },
  subTabText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  subTabTextActive: { color: colors.onBrandPrimary },

  legRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  legText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  altRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  legTheo: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },

  scenarioRow: { marginVertical: spacing.sm },
  scenarioLabel: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
  scenarioCells: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  scenarioCell: { flexBasis: "13%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, padding: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  scenarioMv: { fontSize: 10, color: colors.muted, fontVariant: ["tabular-nums"] },
  scenarioPnl: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },

  ratings: { flexDirection: "row", height: 32, borderRadius: radius.md, overflow: "hidden", gap: 2 },
  ratingBar: { alignItems: "center", justifyContent: "center" },
  ratingText: { fontWeight: "700", fontSize: 11 },
  triggerBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md, gap: spacing.md },
  triggerRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  triggerTitle: { fontSize: 12, fontWeight: "800", color: colors.onSurface, textTransform: "capitalize" },
  triggerText: { fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 17 },
}));
