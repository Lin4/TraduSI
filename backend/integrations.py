"""Push, ElevenLabs TTS/STT, and PayPal integrations."""
import os
import logging
import base64
import io
import asyncio
from typing import Optional, List
import httpx
from fastapi import APIRouter, HTTPException, Header, UploadFile, File
from pydantic import BaseModel

logger = logging.getLogger("optiscreen.integrations")

# ========== PUSH NOTIFICATIONS (Emergent-managed SuprSend) ==========
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


async def register_push_token(body: RegisterPushBody):
    resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def send_push(
    recipients: List[str],
    data: dict,
    idempotency_key: Optional[str] = None,
    _attempt: int = 0,
) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    code = ""
    try:
        if resp.headers.get("content-type", "").startswith("application/json"):
            code = resp.json().get("code", "")
    except Exception:
        pass
    if code == "idempotency_key_in_progress" and idempotency_key and _attempt < 3:
        await asyncio.sleep(3)
        return await send_push(recipients, data, idempotency_key=idempotency_key, _attempt=_attempt + 1)
    if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
        logger.warning(f"Push paused: {code} ({resp.status_code})")
        return
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


# ========== ELEVENLABS TTS / STT ==========
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # George - warm storyteller

try:
    from elevenlabs.client import ElevenLabs
    _el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY) if ELEVENLABS_API_KEY else None
except Exception as e:
    logger.warning(f"ElevenLabs init failed: {e}")
    _el_client = None


class TTSReq(BaseModel):
    text: str
    voice_id: Optional[str] = None


def tts_generate(req: TTSReq) -> dict:
    if not _el_client:
        raise HTTPException(500, "ElevenLabs not configured")
    try:
        audio_iter = _el_client.text_to_speech.convert(
            text=req.text[:2000],
            voice_id=req.voice_id or DEFAULT_VOICE_ID,
            model_id="eleven_turbo_v2_5",
            output_format="mp3_44100_128",
        )
        audio_bytes = b"".join(chunk for chunk in audio_iter if chunk)
        b64 = base64.b64encode(audio_bytes).decode()
        return {"audio_url": f"data:audio/mpeg;base64,{b64}", "voice_id": req.voice_id or DEFAULT_VOICE_ID}
    except Exception as e:
        logger.exception("TTS failed")
        raise HTTPException(500, f"TTS failed: {str(e)[:120]}")


def stt_transcribe(file_bytes: bytes, filename: str) -> dict:
    if not _el_client:
        raise HTTPException(500, "ElevenLabs not configured")
    try:
        resp = _el_client.speech_to_text.convert(
            file=io.BytesIO(file_bytes),
            model_id="scribe_v1",
        )
        text = resp.text if hasattr(resp, "text") else str(resp)
        return {"text": text, "filename": filename}
    except Exception as e:
        logger.exception("STT failed")
        raise HTTPException(500, f"STT failed: {str(e)[:120]}")


# ========== PAYPAL ==========
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "")
PAYPAL_CLIENT_SECRET = os.environ.get("PAYPAL_CLIENT_SECRET", "")
PAYPAL_MODE = os.environ.get("PAYPAL_MODE", "sandbox")
PAYPAL_BASE = "https://api-m.sandbox.paypal.com" if PAYPAL_MODE == "sandbox" else "https://api-m.paypal.com"

PLAN_PRICES = {
    "simple": "9.00",
    "advance": "29.00",
    "expert": "79.00",
}


async def _paypal_token() -> str:
    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET:
        raise HTTPException(500, "PayPal not configured")
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.post(
            f"{PAYPAL_BASE}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json", "Accept-Language": "en_US"},
        )
        if r.status_code != 200:
            logger.error(f"PayPal token error: {r.status_code} {r.text[:200]}")
            raise HTTPException(400, "PayPal is unavailable right now. Please try again later.")
        return r.json()["access_token"]


async def paypal_create_order(plan: str, user_id: str) -> dict:
    if plan not in PLAN_PRICES:
        raise HTTPException(400, "Invalid plan")
    price = PLAN_PRICES[plan]
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.post(
            f"{PAYPAL_BASE}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "intent": "CAPTURE",
                "purchase_units": [{
                    "reference_id": f"{user_id}:{plan}",
                    "description": f"TraduSI {plan.title()} plan - 1 month",
                    "amount": {"currency_code": "USD", "value": price},
                }],
                "application_context": {
                    "brand_name": "TraduSI",
                    "shipping_preference": "NO_SHIPPING",
                    "user_action": "PAY_NOW",
                    "return_url": "https://optionscope.preview.emergentagent.com/paypal-return",
                    "cancel_url": "https://optionscope.preview.emergentagent.com/paypal-cancel",
                },
            },
        )
    if r.status_code not in (200, 201):
        logger.error(f"PayPal create order: {r.status_code} {r.text[:200]}")
        raise HTTPException(400, "PayPal order failed. Please try again.")
    data = r.json()
    approve_url = next((l["href"] for l in data.get("links", []) if l.get("rel") in ("approve", "payer-action")), None)
    return {"order_id": data["id"], "approve_url": approve_url, "plan": plan, "amount": price}


async def paypal_capture_order(order_id: str) -> dict:
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=15.0) as cli:
        r = await cli.post(
            f"{PAYPAL_BASE}/v2/checkout/orders/{order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if r.status_code not in (200, 201):
        logger.error(f"PayPal capture: {r.status_code} {r.text[:200]}")
        raise HTTPException(400, "PayPal payment could not be completed. Please try again.")
    data = r.json()
    status = data.get("status")
    pu = (data.get("purchase_units") or [{}])[0]
    ref = pu.get("reference_id", "")
    plan = ref.split(":", 1)[1] if ":" in ref else None
    return {"status": status, "order_id": order_id, "plan": plan, "raw": data}
