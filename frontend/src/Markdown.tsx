import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "./theme";

/** Tiny markdown renderer for AI answers: ### headings, - bullets, 1. lists, **bold**. */
export function Markdown({ text, testID }: { text: string; testID?: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  return (
    <View testID={testID}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 6 }} />;
        const h = line.match(/^#{1,4}\s+(.*)/);
        if (h) return <Text key={i} style={s.h}>{inline(h[1].replace(/\*\*/g, ""))}</Text>;
        const b = line.match(/^\s*[-•*]\s+(.*)/);
        if (b) return (
          <View key={i} style={s.li}>
            <Text style={s.dot}>•</Text>
            <Text style={[s.p, s.liText]}>{inline(b[1])}</Text>
          </View>
        );
        const n = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (n) return (
          <View key={i} style={s.li}>
            <Text style={s.num}>{n[1]}.</Text>
            <Text style={[s.p, s.liText]}>{inline(n[2])}</Text>
          </View>
        );
        return <Text key={i} style={s.p}>{inline(line)}</Text>;
      })}
    </View>
  );
}

function inline(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <Text key={i} style={s.b}>{part.slice(2, -2)}</Text>
      : <Text key={i}>{part}</Text>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, marginBottom: 2 },
  // plain paragraphs must NOT flex: on native a column child with flex:1 grows into large empty gaps
  p: { fontSize: 14, lineHeight: 21, color: colors.onSurface },
  liText: { flex: 1 },
  b: { fontWeight: "800" },
  li: { flexDirection: "row", gap: 6, paddingLeft: 2, marginTop: 2 },
  dot: { fontSize: 14, lineHeight: 21, color: colors.brandPrimary, fontWeight: "900" },
  num: { fontSize: 14, lineHeight: 21, color: colors.brandPrimary, fontWeight: "800", minWidth: 16 },
});
