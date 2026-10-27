import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { getToken } from "./api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type ChatEvent =
  | { type: "meta"; chat_id: string; model: string; mode: string; user_message_id: string; message_id: string; tickers: { ticker: string; price: number; change_pct?: number }[] }
  | { type: "delta"; text: string }
  | { type: "done"; message_id: string; usage: Usage }
  | { type: "error"; detail: string };

export type Usage = { used: number; limit: number; deep_used: number; deep_limit: number };

/** POST /api/assistant/chat and feed each server-sent event to `onEvent` as it arrives. */
export async function streamChat(body: { message: string; chat_id?: string | null; mode: "quick" | "deep"; ticker?: string }, onEvent: (e: ChatEvent) => void) {
  const token = await getToken();
  const doFetch: any = Platform.OS === "web" ? fetch : expoFetch; // expo/fetch streams response bodies on native
  const res = await doFetch(`${BASE}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch {}
    const err: any = new Error(detail);
    err.status = res.status;
    throw err;
  }
  let buf = "";
  const feed = (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        try { onEvent(JSON.parse(line.slice(6))); } catch {}
      }
    }
  };
  if (!res.body?.getReader) { feed(await res.text()); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(dec.decode(value, { stream: true }));
  }
  feed("\n\n");
}
