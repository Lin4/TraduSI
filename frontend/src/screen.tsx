import React, { useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import Slider from "@react-native-community/slider";
import Icon from "@react-native-vector-icons/feather";

import { Input } from "./Input";
import { MetricRow, Badge } from "./parts";
import { colors, spacing, radius, themedStyles, useTheme } from "./theme";
import { LockedFeature } from "./plans";

export type ProfileId = "low_low" | "low_high" | "high_high";
export type Filters = {
  profile: ProfileId;
  bias: string;
  account_type: string;
  account_size: string;
  max_loss_pct: number;
  min_pop: number;
  min_roc: number;
  min_oi: number;
  max_spread_pct: number;
  min_iv_rank: number;
  exclude_earnings: boolean;
};

export const PROFILE_INFO: Record<ProfileId, { title: string; sub: string; icon: any; defaults: Partial<Filters> }> = {
  low_low: { title: "Low risk · Low reward", sub: "Covered calls, cash-secured puts, credit spreads, iron condors", icon: "shield", defaults: { min_pop: 70, max_loss_pct: 5, min_roc: 1 } },
  low_high: { title: "Low risk · Higher reward", sub: "Defined-risk credit spreads & iron condors · ROC 15%+ · Level 3+", icon: "target", defaults: { min_pop: 70, max_loss_pct: 3, min_roc: 15 } },
  high_high: { title: "High risk · High reward", sub: "Naked sell puts / calls, short strangles · Full access only", icon: "zap", defaults: { min_pop: 70, max_loss_pct: 10, min_roc: 0 } },
};

export const ACCOUNTS = [
  { id: "cash", label: "Cash" },
  { id: "reg_t", label: "Reg T margin" },
  { id: "portfolio_margin", label: "Portfolio margin" },
  { id: "ira", label: "IRA" },
];
export const accountLabel = (id: string) => ACCOUNTS.find((a) => a.id === id)?.label || id;

export const defaultFilters = (profile: ProfileId = "low_low"): Filters => ({
  profile, bias: "any", account_type: "reg_t", account_size: "25000",
  max_loss_pct: 5, min_pop: 70, min_roc: 1, min_oi: 100, max_spread_pct: 25, min_iv_rank: 0, exclude_earnings: false,
  ...PROFILE_INFO[profile].defaults,
});

export const filtersPayload = (f: Filters) => ({
  profile: f.profile, bias: f.bias, account_type: f.account_type,
  account_size: parseFloat(f.account_size) || undefined,
  max_loss_pct: f.max_loss_pct, min_pop: f.min_pop, min_roc: f.min_roc, min_oi: f.min_oi,
  max_spread_pct: f.max_spread_pct, min_iv_rank: f.min_iv_rank, exclude_earnings: f.exclude_earnings,
});

export function Chips({ options, value, onChange, testKey }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void; testKey: string }) {
  useTheme();
  return (
    <View style={s.chipsWrap}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Pressable key={o.id} testID={`${testKey}-${o.id}`} onPress={() => onChange(o.id)} style={[s.chip, active && s.chipActive]}>
            <Text style={[s.chipText, active && s.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  useTheme();
  return <Text style={s.label}>{children}</Text>;
}

export function ProfilePicker({ value, onChange, locked = {} }: { value: ProfileId; onChange: (p: ProfileId) => void; locked?: Record<string, boolean> }) {
  useTheme();
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      {(Object.keys(PROFILE_INFO) as ProfileId[]).map((id) => {
        const p = PROFILE_INFO[id];
        const active = value === id;
        const isLocked = !!locked[id];
        return (
          <Pressable key={id} testID={`profile-${id}`} disabled={isLocked} onPress={() => onChange(id)} style={[s.profile, active && s.profileActive, isLocked && { opacity: 0.5 }]}>
            <View style={[s.profileIcon, active && { backgroundColor: colors.brandPrimary }]}>
              <Icon name={p.icon} size={16} color={active ? colors.onBrandPrimary : colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileTitle}>{p.title}</Text>
              <Text style={s.profileSub}>{p.sub}</Text>
            </View>
            <Icon name={isLocked ? "lock" : active ? "check-circle" : "circle"} size={18} color={active ? colors.brandPrimary : colors.onSurfaceTertiary} />
          </Pressable>
        );
      })}
      <Text style={s.hint}>Every pick has at least 70% probability of profit. Locked profiles need a higher options approval level or more experience (edit your answers in Profile).</Text>
    </View>
  );
}

export function SliderRow({ label, value, min, max, step, suffix = "", onChange, testID }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void; testID: string }) {
  useTheme();
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={s.sliderHead}>
        <Text style={s.sliderLabel}>{label}</Text>
        <Text style={s.sliderVal}>{Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}{suffix}</Text>
      </View>
      <Slider
        testID={testID}
        style={{ width: "100%", height: 36 }}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onSlidingComplete={onChange}
        minimumTrackTintColor={colors.brandPrimary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.brandPrimary}
      />
    </View>
  );
}

/** Account + sliders shared by Discover (and partly Analyze). */
export function FilterPanel({ f, set }: { f: Filters; set: (p: Partial<Filters>) => void }) {
  useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Label>Direction</Label>
      <Chips testKey="bias" value={f.bias} onChange={(v) => set({ bias: v })}
        options={[{ id: "any", label: "Any" }, { id: "bullish", label: "Bullish" }, { id: "bearish", label: "Bearish" }, { id: "neutral", label: "Neutral" }]} />
      <Label>Account type</Label>
      <Chips testKey="acct" value={f.account_type} onChange={(v) => set({ account_type: v })} options={ACCOUNTS} />
      <Input testID="account-size" label="Account size ($)" value={f.account_size} onChangeText={(v) => set({ account_size: v.replace(/[^0-9.]/g, "") })} keyboardType="numeric" />

      <Pressable testID="toggle-finetune" onPress={() => setOpen((o) => !o)} style={s.fineToggle}>
        <Icon name="sliders" size={14} color={colors.brandPrimary} />
        <Text style={s.fineText}>Fine-tune risk numbers</Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
      </Pressable>
      {open ? (
        <View style={s.fineBox}>
          <SliderRow testID="sl-max-loss" label="Max loss (% of account)" value={f.max_loss_pct} min={0.5} max={25} step={0.5} suffix="%" onChange={(v) => set({ max_loss_pct: v })} />
          <SliderRow testID="sl-min-pop" label="Min probability of profit" value={Math.max(f.min_pop, 70)} min={70} max={95} step={1} suffix="%" onChange={(v) => set({ min_pop: v })} />
          <SliderRow testID="sl-min-roc" label="Min return on capital" value={f.min_roc} min={0} max={200} step={1} suffix="%" onChange={(v) => set({ min_roc: v })} />
          <SliderRow testID="sl-min-iv" label="Min IV rank" value={f.min_iv_rank} min={0} max={90} step={5} onChange={(v) => set({ min_iv_rank: v })} />
          <Label>Min open interest (est.)</Label>
          <Chips testKey="oi" value={String(f.min_oi)} onChange={(v) => set({ min_oi: parseInt(v) })}
            options={[{ id: "0", label: "Any" }, { id: "100", label: "100+" }, { id: "500", label: "500+" }, { id: "1000", label: "1,000+" }]} />
          <Label>Max bid-ask spread (% of premium)</Label>
          <Chips testKey="spread" value={String(f.max_spread_pct)} onChange={(v) => set({ max_spread_pct: parseFloat(v) })}
            options={[{ id: "8", label: "8%" }, { id: "15", label: "15%" }, { id: "25", label: "25%" }, { id: "50", label: "50%" }]} />
          <View style={s.switchRow}>
            <Text style={s.sliderLabel}>Skip setups with earnings before expiry</Text>
            <Switch testID="sw-earnings" value={f.exclude_earnings} onValueChange={(v) => set({ exclude_earnings: v })}
              trackColor={{ true: colors.brandPrimary, false: colors.border }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const money = (v: number | null | undefined) => (v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/** Deterministic engine details for one option idea. */
export function OptionInsights({ r, collateralLocked = false }: { r: any; collateralLocked?: boolean }) {
  useTheme();
  const v = r.volatility || {};
  const l = r.liquidity || {};
  const e = r.events || {};
  const p = r.pricing || {};
  return (
    <View>
      {(r.why?.length || r.risks?.length) ? (
        <View style={s.box}>
          <Text style={s.boxTitle}>Why this fits</Text>
          {(r.why || []).map((t: string, i: number) => <Bullet key={i} icon="check" color={colors.success} text={t} />)}
          <Text style={[s.boxTitle, { marginTop: spacing.sm }]}>What could go wrong</Text>
          {(r.risks || []).map((t: string, i: number) => <Bullet key={i} icon="alert-triangle" color={colors.warning} text={t} />)}
        </View>
      ) : null}

      <Text style={s.section}>Realistic pricing</Text>
      <MetricRow label="Net at mid" value={money(p.net_mid)} />
      <MetricRow label="Net after slippage" value={money(p.net_fill)} />
      <MetricRow label="Slippage cost" value={money(p.slippage_cost)} color={colors.error} />
      <MetricRow label={`Fees (${p.contracts} contracts)`} value={money(p.fees)} color={colors.error} />
      <Text style={s.hint}>{p.note}</Text>

      <Text style={s.section}>Collateral by account</Text>
      {collateralLocked ? <LockedFeature need="advance" label="Collateral & margin views" testID="locked-collateral" /> : (<>
      <View style={s.table}>
        <View style={[s.tr, s.th]}>
          <Text style={[s.td, s.tdHead, { flex: 1.4 }]}>Account</Text>
          <Text style={[s.td, s.tdHead]}>Collateral</Text>
          <Text style={[s.td, s.tdHead]}>ROC</Text>
          <Text style={[s.td, s.tdHead]}>Annual*</Text>
        </View>
        {ACCOUNTS.map((a) => {
          const c = r.collateral_by_account?.[a.id] || {};
          const sel = r.account_type === a.id;
          return (
            <View key={a.id} testID={`coll-${a.id}`} style={[s.tr, sel && { backgroundColor: colors.brandSecondary }]}>
              <Text style={[s.td, { flex: 1.4, fontWeight: sel ? "800" : "600" }]}>{a.label}</Text>
              {c.allowed ? (
                <>
                  <Text style={s.td}>{money(c.collateral)}</Text>
                  <Text style={s.td}>{c.roc_pct != null ? `${c.roc_pct}%` : "∞"}</Text>
                  <Text style={s.td}>{c.annualized_pct != null ? `${c.annualized_pct}%` : "∞"}</Text>
                </>
              ) : (
                <Text style={[s.td, { flex: 3, color: colors.error }]}>Not allowed</Text>
              )}
            </View>
          );
        })}
      </View>
      <Text style={s.hint}>*{r.annualized_note}</Text>
      </>)}

      <Text style={s.section}>Volatility</Text>
      <View style={s.grid}>
        <Stat label="IV (est.)" value={`${((v.iv || 0) * 100).toFixed(0)}%`} />
        <Stat label="HV 20d" value={`${((v.hv20 || 0) * 100).toFixed(0)}%`} />
        <Stat label="IV rank" value={`${Math.round(v.iv_rank ?? 0)}`} />
        <Stat label="IV / HV" value={v.iv_vs_hv != null ? `${v.iv_vs_hv}x` : "—"} />
      </View>
      <Text style={s.hint}>{v.method}</Text>

      <Text style={s.section}>Liquidity <Text style={s.estTag}> MODEL ESTIMATE</Text></Text>
      <View style={s.grid}>
        <Stat label="Grade" value={l.grade || "—"} tone={l.grade === "High" ? "good" : l.grade === "Low" ? "bad" : undefined} />
        <Stat label="Min OI" value={l.min_open_interest?.toLocaleString?.() ?? "—"} />
        <Stat label="Min volume" value={l.min_volume?.toLocaleString?.() ?? "—"} />
        <Stat label="Spread" value={l.spread_pct_of_premium != null ? `${l.spread_pct_of_premium}%` : "—"} />
      </View>
      <Text style={s.hint}>{l.note}</Text>

      <Text style={s.section}>Events & assignment</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
        <Badge text={e.earnings_in_window ? `Earnings ${e.earnings_date}` : "No earnings in window"} kind={e.earnings_in_window ? "warn" : "success"} />
        <Badge text={`Assignment: ${e.assignment_risk}`} kind={e.assignment_risk === "High" ? "error" : e.assignment_risk === "Moderate" ? "warn" : "info"} />
        {e.pays_dividend ? <Badge text="Pays dividend" kind="info" /> : null}
        {e.pin_risk ? <Badge text="Pin risk" kind="error" /> : null}
      </View>
      {(e.notes || []).map((t: string, i: number) => <Bullet key={i} icon="info" color={colors.info} text={t} />)}
      <Text style={s.hint}>POP: {r.pop_method}. EV: {r.ev_method} = {money(r.expected_value)}.</Text>
    </View>
  );
}

function Bullet({ icon, color, text }: { icon: any; color: string; text: string }) {
  useTheme();
  return (
    <View style={s.bullet}>
      <Icon name={icon} size={12} color={color} style={{ marginTop: 3 }} />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  useTheme();
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statVal, tone === "good" && { color: colors.success }, tone === "bad" && { color: colors.error }]}>{value}</Text>
    </View>
  );
}

const s = themedStyles((colors) => ({
  label: { fontSize: 12, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },
  profile: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  profileActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  profileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  profileTitle: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  profileSub: { fontSize: 11, color: colors.onSurfaceSecondary, marginTop: 2, lineHeight: 15 },
  hint: { color: colors.muted, fontSize: 11, fontStyle: "italic", marginTop: 4, lineHeight: 15 },
  sliderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sliderLabel: { fontSize: 13, color: colors.onSurface, fontWeight: "600", flex: 1 },
  sliderVal: { fontSize: 13, color: colors.brandPrimary, fontWeight: "800", fontVariant: ["tabular-nums"] },
  fineToggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, marginBottom: spacing.sm },
  fineText: { flex: 1, color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  fineBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: spacing.sm },
  section: { fontSize: 11, color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: 4 },
  estTag: { color: colors.warning, fontSize: 10, fontWeight: "800" },
  box: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  boxTitle: { fontSize: 12, fontWeight: "800", color: colors.onSurface, marginBottom: 4 },
  bullet: { flexDirection: "row", gap: 6, marginVertical: 2 },
  bulletText: { flex: 1, fontSize: 12, color: colors.onSurfaceSecondary, lineHeight: 17 },
  table: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  th: { backgroundColor: colors.surfaceTertiary, borderTopWidth: 0 },
  td: { flex: 1, fontSize: 12, color: colors.onSurface, fontVariant: ["tabular-nums"] },
  tdHead: { fontSize: 10, color: colors.muted, fontWeight: "800", textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: "22%", backgroundColor: colors.surfaceSecondary, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  statLabel: { fontSize: 9, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" },
  statVal: { fontSize: 14, fontWeight: "800", color: colors.onSurface, marginTop: 2, fontVariant: ["tabular-nums"] },
}));
