import { spacing, radius, themedStyles } from "./theme";

/** Shared look for the code-based auth screens (verify email, forgot password, change email). */
export const authStyles = themedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing["2xl"] },
  back: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary, marginBottom: spacing.lg },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: spacing.xl, lineHeight: 20 },
  email: { color: colors.onSurface, fontWeight: "700" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  muted: { fontSize: 13, color: colors.muted },
  link: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  change: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: spacing.xl, minHeight: 44 },
  label: { color: colors.onSurface, fontSize: 13, fontWeight: "600", marginBottom: spacing.xs, marginTop: spacing.lg },
}));
