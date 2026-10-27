"""Ask AI: Claude chat assistant grounded in TraduSI's live data, with saved history and per-plan daily limits.
Quick answers use Claude Sonnet 5.5, deep analysis uses Claude Opus 5.5 (Emergent LLM key)."""
import asyncio
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
NY = ZoneInfo("America/New_York")
MODELS = {
    # effort caps Claude's hidden reasoning, which otherwise uses up max_tokens and cuts the visible answer off
    "quick": {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "max_tokens": 6000, "effort": "low"},
    "deep": {"id": "claude-opus-5-5", "label": "Claude Opus 5.5", "max_tokens": 16000, "effort": "medium"},
}
HISTORY_MESSAGES = 12
MAX_TICKERS = 2
# Universe tickers that are also everyday words: only matched when typed in capitals or with a $.
WORDY = {"COST", "CAT", "DIS", "KO", "HD", "GS", "BA", "V", "MU", "PEP", "WFC", "MCD"}

SYSTEM = """You are TraduSI AI, the options & stock research assistant inside the TraduSI app.
Rules:
- Use ONLY numbers from the LIVE DATA block in the latest message or from earlier answers in this chat. Never invent prices, premiums, Greeks, probabilities, targets or dates. If a number isn't available, say so and point to the right screen (Analyze, Chain, Portfolio, Track record).
- OptiScore, POP, trade plans, backtests and stress tests come from TraduSI's deterministic engine: explain and compare them, don't recompute them.
- Tailor every answer to the user's profile (experience, risk tolerance, options level, account size). Never push strategies above their approved options level.
- Be glanceable: short paragraphs, '- ' bullets, **bold** for key numbers. No tables. Use '### ' for at most a few section titles.
- Always name the main risk and what would invalidate the idea.
- Educational research, not financial advice: never say they must buy or sell.
"""
DEEP_NOTE = ("DEPTH: deep analysis. Structure the answer as: ### Thesis, ### The numbers, ### Risks, ### What would change my mind, "
             "### Plan (entry, take-profit, stop, size — from the engine's plan when available).")


class ChatReq(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    chat_id: Optional[str] = None
    mode: Literal["quick", "deep"] = "quick"
    ticker: Optional[str] = Field(default=None, max_length=10)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}


def find_tickers(text: str, universe: set) -> List[str]:
    out: List[str] = []
    for m in re.finditer(r"(\$)?\b([A-Za-z]{1,5})\b", text):
        dollar, word = m.group(1), m.group(2)
        up = word.upper()
        ok = (dollar and up.isalpha()) or (up in universe and (word.isupper() or (len(word) >= 3 and up not in WORDY)))
        if ok and up not in out:
            out.append(up)
    return out[:MAX_TICKERS]


def register(router, *, db, get_user, access_for, ticker_context, user_context, universe: set, logger):
    chats, msgs = db.ai_chats, db.ai_messages
    running: set = set()  # strong refs so answers keep generating after the client's connection drops

    async def usage(user: Dict[str, Any]) -> Dict[str, Any]:
        f = access_for(user)["features"]
        start = datetime.now(NY).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        q = {"user_id": user["user_id"], "role": "user", "failed": {"$ne": True}, "created_at": {"$gte": start}}
        used = await msgs.count_documents(q)
        deep = await msgs.count_documents({**q, "mode": "deep"})
        return {"used": used, "limit": f.get("ai_chat_per_day", 0), "deep_used": deep, "deep_limit": f.get("ai_deep_per_day", 0)}

    async def own_chat(user, chat_id: str) -> Dict[str, Any]:
        c = await chats.find_one({"chat_id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Chat not found")
        return c

    @router.get("/assistant/chats")
    async def list_chats(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        rows = await chats.find({"user_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(50)
        return {"chats": [_iso(r) for r in rows], "usage": await usage(user),
                "models": {k: v["label"] for k, v in MODELS.items()}}

    @router.get("/assistant/chats/{chat_id}")
    async def get_chat(chat_id: str, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        c = await own_chat(user, chat_id)
        rows = await msgs.find({"chat_id": chat_id, "failed": {"$ne": True}}, {"_id": 0}).sort("created_at", 1).to_list(500)
        return {"chat": _iso(c), "messages": [_iso(r) for r in rows], "usage": await usage(user)}

    @router.delete("/assistant/chats/{chat_id}")
    async def delete_chat(chat_id: str, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        await own_chat(user, chat_id)
        await msgs.delete_many({"chat_id": chat_id})
        await chats.delete_one({"chat_id": chat_id})
        return {"ok": True}

    @router.get("/assistant/messages/{message_id}")
    async def get_message(message_id: str, authorization: Optional[str] = Header(default=None)):
        """Lets the app pick up the rest of an answer when the streaming connection was cut (e.g. 60s proxy limit)."""
        user = await get_user(authorization)
        m = await msgs.find_one({"message_id": message_id, "user_id": user["user_id"]}, {"_id": 0})
        if not m:
            raise HTTPException(404, "Message not found")
        out = {"message_id": message_id, "status": m.get("status", "done"), "content": m.get("content", "")}
        if out["status"] != "streaming":
            out["usage"] = await usage(user)
        return out

    @router.post("/assistant/chat")
    async def chat(req: ChatReq, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        u = await usage(user)
        if u["limit"] <= 0:
            raise HTTPException(403, "Ask AI is part of the Advance and Expert plans.")
        if u["used"] >= u["limit"]:
            raise HTTPException(429, f"You've used all {u['limit']} AI questions for today. Your limit resets at midnight ET.")
        if req.mode == "deep" and u["deep_used"] >= u["deep_limit"]:
            raise HTTPException(429, f"You've used all {u['deep_limit']} deep analyses for today. Switch to Quick or upgrade for more.")
        text = req.message.strip()
        if not text:
            raise HTTPException(422, "Message is empty")

        t = _now()
        if req.chat_id:
            c = await own_chat(user, req.chat_id)
        else:
            c = {"chat_id": f"chat_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "title": text[:60],
                 "tickers": [], "created_at": t, "updated_at": t}
            await chats.insert_one(dict(c))
        chat_id = c["chat_id"]
        tickers = find_tickers(text, universe)
        if req.ticker and req.ticker.upper() not in tickers:
            tickers = [req.ticker.upper().strip()] + tickers
        tickers = tickers[:MAX_TICKERS] or (c.get("tickers") or [])[-1:]  # follow-ups reuse the chat's last ticker

        history = await msgs.find({"chat_id": chat_id, "failed": {"$ne": True}, "status": {"$ne": "streaming"}},
                                  {"_id": 0, "role": 1, "content": 1}).sort("created_at", -1).to_list(HISTORY_MESSAGES)
        history.reverse()
        user_msg = {"message_id": f"msg_{uuid.uuid4().hex[:12]}", "chat_id": chat_id, "user_id": user["user_id"],
                    "role": "user", "content": text, "mode": req.mode, "tickers": tickers, "created_at": t}
        await msgs.insert_one(dict(user_msg))
        model = MODELS[req.mode]
        reply_id = f"msg_{uuid.uuid4().hex[:12]}"
        await msgs.insert_one({"message_id": reply_id, "chat_id": chat_id, "user_id": user["user_id"], "role": "assistant",
                               "content": "", "status": "streaming", "mode": req.mode, "model": model["label"],
                               "tickers": [], "created_at": _now()})
        queue: asyncio.Queue = asyncio.Queue()

        async def generate():
            """Runs independently of the HTTP response, so the answer is finished and saved even if the connection drops."""
            answer, saved_at = "", time.monotonic()
            try:
                contexts = [x for x in [await ticker_context(tk, authorization) for tk in tickers] if x]
                live = {"as_of_utc": _now().strftime("%Y-%m-%d %H:%M"), "user": await user_context(user), "tickers": contexts}
                queue.put_nowait({"type": "meta", "chat_id": chat_id, "model": model["label"], "mode": req.mode,
                                  "user_message_id": user_msg["message_id"], "message_id": reply_id,
                                  "tickers": [{"ticker": x["ticker"], "price": x.get("price"), "change_pct": x.get("change_pct")} for x in contexts]})
                prompt = (f"{text}\n\n{DEEP_NOTE if req.mode == 'deep' else ''}\n---\nLIVE DATA (JSON):\n"
                          f"{json.dumps(live, default=str, separators=(',', ':'))}\n---")
                llm = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=chat_id, system_message=SYSTEM,
                              initial_messages=[{"role": "system", "content": SYSTEM}] + history) \
                    .with_model("anthropic", model["id"]).with_params(
                        max_tokens=model["max_tokens"], extra_body={"output_config": {"effort": model["effort"]}})
                async for ev in llm.stream_message(UserMessage(text=prompt)):
                    if isinstance(ev, TextDelta):
                        answer += ev.content
                        queue.put_nowait({"type": "delta", "text": ev.content})
                        if time.monotonic() - saved_at > 2:  # partial answer for the app to fetch after a dropped connection
                            saved_at = time.monotonic()
                            await msgs.update_one({"message_id": reply_id}, {"$set": {"content": answer}})
                    elif isinstance(ev, StreamDone):
                        if ev.finish_reason == "length" and answer.strip():
                            note = "\n\n_…answer hit the length limit. Ask \"continue\" for the rest._"
                            answer += note
                            queue.put_nowait({"type": "delta", "text": note})
                        break
                if not answer.strip():
                    raise RuntimeError("empty answer")
                await msgs.update_one({"message_id": reply_id}, {"$set": {"content": answer, "status": "done",
                                                                          "tickers": [x["ticker"] for x in contexts]}})
                await chats.update_one({"chat_id": chat_id}, {"$set": {"updated_at": _now(), "last_model": model["label"],
                                                                          "tickers": tickers or c.get("tickers") or []}})
                queue.put_nowait({"type": "done", "message_id": reply_id, "usage": await usage(user)})
            except Exception as ex:
                logger.exception(f"assistant chat failed: {ex}")
                await msgs.update_one({"message_id": user_msg["message_id"]}, {"$set": {"failed": True}})
                await msgs.update_one({"message_id": reply_id}, {"$set": {"status": "failed", "failed": True}})
                queue.put_nowait({"type": "error", "detail": "The AI couldn't answer right now. Please try again — this question wasn't counted."})
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(generate())
        running.add(task)
        task.add_done_callback(running.discard)

        async def events():
            while (ev := await queue.get()) is not None:
                yield _sse(ev)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(obj: Dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


async def ensure_indexes(db):
    await db.ai_chats.create_index([("user_id", 1), ("updated_at", -1)])
    await db.ai_chats.create_index("chat_id", unique=True)
    await db.ai_messages.create_index([("chat_id", 1), ("created_at", 1)])
    await db.ai_messages.create_index([("user_id", 1), ("created_at", -1)])
