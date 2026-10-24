"""Plans, 7-day trial, feature matrix, usage counting, Stripe subscription checkout and the Stripe webhook."""
from __future__ import annotations
import asyncio
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import stripe
from dotenv import dotenv_values
from fastapi import HTTPException, Header, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

_ENV = dotenv_values(Path(__file__).parent / ".env")


def _secret(name: str) -> str:
    """backend/.env wins over inherited pod variables (the pod ships a test Stripe key)."""
    return _ENV.get(name) or os.environ.get(name, "")

TRIAL_DAYS = 7
PLAN_PRICES = {"simple": 9.0, "advance": 29.0, "expert": 79.0}
TIER_RANK = {"expired": 0, "trial": 1, "simple": 2, "advance": 3, "expert": 4}
INF = 100000

FEATURES: Dict[str, Dict[str, Any]] = {
    "expired": {"scans_per_day": 0, "alerts": 0, "smart_alerts": False, "custom_period": False, "collateral_views": False,
                "ai_explain": False, "backtest": False, "day_lab": False, "voice": False, "daily_push": False, "strategy_tier": 0,
                "ai_chat_per_day": 0, "ai_deep_per_day": 0},
    "trial": {"scans_per_day": 5, "alerts": 3, "smart_alerts": False, "custom_period": False, "collateral_views": False,
              "ai_explain": False, "backtest": False, "day_lab": False, "voice": False, "daily_push": False, "strategy_tier": 1,
              "ai_chat_per_day": 0, "ai_deep_per_day": 0},
    "simple": {"scans_per_day": 10, "alerts": 3, "smart_alerts": False, "custom_period": False, "collateral_views": False,
               "ai_explain": False, "backtest": False, "day_lab": False, "voice": False, "daily_push": False, "strategy_tier": 1,
              "ai_chat_per_day": 0, "ai_deep_per_day": 0},
    "advance": {"scans_per_day": INF, "alerts": 20, "smart_alerts": True, "custom_period": True, "collateral_views": True,
                "ai_explain": True, "backtest": True, "day_lab": False, "voice": False, "daily_push": False, "strategy_tier": 3,
                "ai_chat_per_day": 30, "ai_deep_per_day": 5},
    "expert": {"scans_per_day": INF, "alerts": INF, "smart_alerts": True, "custom_period": True, "collateral_views": True,
               "ai_explain": True, "backtest": True, "day_lab": True, "voice": True, "daily_push": True, "strategy_tier": 4,
               "ai_chat_per_day": 100, "ai_deep_per_day": 25},
}
# strategy_tier: 1 = covered calls + CSPs, 3 = + all spreads/condors/long options, 4 = + naked selling


def _aware(d):
    if isinstance(d, str):
        d = datetime.fromisoformat(d)
    if d and d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


async def log_plan_event(db, user_id: str, plan: Optional[str], source: Optional[str], by: Optional[str] = None) -> None:
    """Append-only plan history (admin user detail)."""
    await db.plan_events.insert_one({"user_id": user_id, "plan": plan, "source": source, "by": by,
                                     "at": datetime.now(timezone.utc)})


def compute_access(user: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    created = _aware(user.get("created_at")) or now
    trial_end = created + timedelta(days=TRIAL_DAYS)
    plan = user.get("plan")
    exp = _aware(user.get("plan_expires_at"))
    paid_active = plan in PLAN_PRICES and (exp is None or exp > now)
    if paid_active:
        tier = plan
    elif now < trial_end:
        tier = "trial"
    else:
        tier = "expired"
    days_left = max(0, (trial_end - now).days + (1 if (trial_end - now).seconds > 0 else 0)) if tier == "trial" else 0
    return {
        "tier": tier, "plan": plan, "source": user.get("plan_source"),
        "trial_ends_at": trial_end.isoformat(), "trial_days_left": days_left,
        "renews_at": exp.isoformat() if exp else None, "features": FEATURES[tier], "prices": PLAN_PRICES,
    }


def strategy_tier_for(tier: str) -> int:
    return FEATURES.get(tier, FEATURES["expired"])["strategy_tier"]


class StripeCheckoutReq(BaseModel):
    plan: str
    return_url: Optional[str] = None  # web: app page to come back to


def register(api_router, *, db, get_user: Callable, logger):
    stripe.api_key = _secret("STRIPE_API_KEY")
    if "sk_test_emergent" in stripe.api_key:
        stripe.api_base = "https://integrations.emergentagent.com/stripe"

    def _plain(o) -> Dict[str, Any]:
        return o.to_dict() if hasattr(o, "to_dict") else json.loads(str(o))

    def _period_end(sub: Dict[str, Any]) -> Optional[datetime]:
        end = sub.get("current_period_end")
        if not end:  # newer Stripe API versions keep the period on subscription items
            end = max((it.get("current_period_end") or 0 for it in (sub.get("items") or {}).get("data") or []), default=0)
        return datetime.fromtimestamp(int(end), tz=timezone.utc) if end else None

    def _expiry(sub: Optional[Dict[str, Any]]) -> datetime:
        end = _period_end(sub) if sub else None
        return (end + timedelta(days=2)) if end else datetime.now(timezone.utc) + timedelta(days=31)  # 2-day renewal grace

    def _invoice_sub_id(inv: Dict[str, Any]) -> Optional[str]:
        sid = inv.get("subscription") or (((inv.get("parent") or {}).get("subscription_details") or {}).get("subscription"))
        return sid.get("id") if isinstance(sid, dict) else sid

    async def _cancel_sub(sid: str) -> None:
        try:
            await asyncio.to_thread(stripe.Subscription.cancel, sid)
        except stripe.InvalidRequestError:
            pass  # already cancelled / not found

    async def grant(user_id: str, plan: str, sid: Optional[str], sub: Optional[Dict[str, Any]]) -> None:
        raw = await db.users.find_one({"user_id": user_id}, {"_id": 0, "stripe_subscription_id": 1})
        old = (raw or {}).get("stripe_subscription_id")
        if old and old != sid:  # plan change: stop billing the previous subscription
            try:
                await _cancel_sub(old)
            except Exception as ex:
                logger.error(f"could not cancel old subscription {old}: {ex}")
        await db.users.update_one({"user_id": user_id}, {"$set": {
            "plan": plan, "plan_source": "stripe", "stripe_subscription_id": sid, "plan_expires_at": _expiry(sub),
            "stripe_payment_failed": False, "stripe_cancel_at_period_end": bool((sub or {}).get("cancel_at_period_end"))}})
        await log_plan_event(db, user_id, plan, "stripe")

    async def activate_session(session_id: str):
        """Verify a Checkout Session with Stripe and grant the plan once (shared by polling and the webhook)."""
        s = _plain(await asyncio.to_thread(stripe.checkout.Session.retrieve, session_id))
        tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        paid = s.get("status") == "complete" and s.get("payment_status") in ("paid", "no_payment_required")
        if tx and paid and tx["status"] != "paid":
            sid = s.get("subscription")
            sid = sid.get("id") if isinstance(sid, dict) else sid
            res = await db.payment_transactions.update_one({"session_id": session_id, "status": {"$ne": "paid"}},
                                                           {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc),
                                                                     "subscription_id": sid}})
            if res.modified_count:  # only the first verified completion grants the plan (idempotent)
                sub = _plain(await asyncio.to_thread(stripe.Subscription.retrieve, sid)) if sid else None
                await grant(tx["user_id"], tx["plan"], sid, sub)
        elif tx and s.get("status") == "expired" and tx["status"] == "initiated":
            await db.payment_transactions.update_one({"session_id": session_id}, {"$set": {"status": "expired"}})
        return s, tx, paid

    async def sync_subscription(sid: str, deleted: bool = False) -> None:
        """Mirror a subscription's current state (renewal, past due, cancel) onto its user."""
        sub = _plain(await asyncio.to_thread(stripe.Subscription.retrieve, sid))
        meta = sub.get("metadata") or {}
        uid, plan, status = meta.get("user_id"), meta.get("plan"), sub.get("status")
        if not uid or plan not in PLAN_PRICES:
            return
        if deleted or status in ("canceled", "unpaid", "incomplete_expired"):
            res = await db.users.update_one({"user_id": uid, "stripe_subscription_id": sid}, {
                "$set": {"plan": "free", "plan_source": "stripe_ended", "plan_expires_at": None},
                "$unset": {"stripe_subscription_id": ""}})
            if res.modified_count:
                await log_plan_event(db, uid, "free", "stripe_ended")
        elif status in ("active", "trialing", "past_due"):
            await db.users.update_one(
                {"user_id": uid, "$or": [{"stripe_subscription_id": sid}, {"stripe_subscription_id": None},
                                         {"stripe_subscription_id": {"$exists": False}}]},
                {"$set": {"plan": plan, "plan_source": "stripe", "stripe_subscription_id": sid, "plan_expires_at": _expiry(sub),
                          "stripe_payment_failed": status == "past_due",
                          "stripe_cancel_at_period_end": bool(sub.get("cancel_at_period_end"))}})

    async def handle_event(event: Dict[str, Any]) -> None:
        kind, obj = event["type"], event["data"]["object"]
        if kind == "checkout.session.completed":
            if obj.get("mode") == "subscription":
                await activate_session(obj["id"])
        elif kind in ("invoice.paid", "invoice.payment_succeeded"):
            sid = _invoice_sub_id(obj)
            if sid:
                await sync_subscription(sid)
        elif kind == "invoice.payment_failed":
            sid = _invoice_sub_id(obj)
            if sid:  # keep access until the paid period ends; Stripe retries the card
                await db.users.update_one({"stripe_subscription_id": sid}, {"$set": {"stripe_payment_failed": True}})
        elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
            await sync_subscription(obj["id"], deleted=kind.endswith("deleted"))

    async def bump_scan(user_id: str) -> int:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = await db.usage.find_one_and_update({"user_id": user_id, "day": day}, {"$inc": {"scans": 1}},
                                               upsert=True, return_document=True)
        return int((r or {}).get("scans", 1))

    async def scans_today(user_id: str) -> int:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = await db.usage.find_one({"user_id": user_id, "day": day})
        return int((r or {}).get("scans", 0))

    @api_router.get("/billing/status")
    async def billing_status(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        raw = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password": 0})
        a = compute_access(raw or user)
        a["scans_today"] = await scans_today(user["user_id"])
        a["alerts_count"] = await db.alerts.count_documents({"user_id": user["user_id"]})
        return a

    @api_router.post("/billing/stripe/checkout")
    async def stripe_checkout(req: StripeCheckoutReq, request: Request, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        if req.plan not in PLAN_PRICES:
            raise HTTPException(status_code=400, detail="Invalid plan")
        base = str(request.base_url).rstrip("/").replace("http://", "https://")
        fwd = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if fwd:
            base = f"https://{fwd}"
        if req.return_url:
            success = f"{req.return_url.split('?')[0]}?session_id={{CHECKOUT_SESSION_ID}}"
            cancel = req.return_url.split("?")[0] + "?cancelled=1"
        else:
            success = f"{base}/api/billing/stripe/return?session_id={{CHECKOUT_SESSION_ID}}"
            cancel = f"{base}/api/billing/stripe/return?cancelled=1"
        raw = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password": 0}) or user
        if raw.get("plan_source") == "stripe" and compute_access(raw)["tier"] == req.plan:
            raise HTTPException(status_code=400, detail=f"You're already on the {req.plan.capitalize()} plan.")
        try:
            session = await asyncio.to_thread(
                stripe.checkout.Session.create,
                mode="subscription",
                line_items=[{"price_data": {"currency": "usd", "unit_amount": int(PLAN_PRICES[req.plan] * 100),
                                            "recurring": {"interval": "month"},
                                            "product_data": {"name": f"TraduSI {req.plan.capitalize()}"}}, "quantity": 1}],
                success_url=success, cancel_url=cancel,
                customer_email=user.get("email"), client_reference_id=user["user_id"],
                metadata={"user_id": user["user_id"], "plan": req.plan},
                subscription_data={"metadata": {"user_id": user["user_id"], "plan": req.plan}},
            )
        except stripe.StripeError as ex:
            logger.error(f"stripe checkout failed: {ex}")
            # 400 not 502: the ingress replaces 5xx bodies with an HTML page, hiding this message from the app
            raise HTTPException(status_code=400, detail="Card payments are temporarily unavailable. Please try PayPal or try again later.")
        await db.payment_transactions.insert_one({
            "tx_id": f"tx_{uuid.uuid4().hex[:12]}", "provider": "stripe", "session_id": session.id,
            "user_id": user["user_id"], "plan": req.plan, "amount": PLAN_PRICES[req.plan], "currency": "usd",
            "status": "initiated", "created_at": datetime.now(timezone.utc),
        })
        return {"url": session.url, "session_id": session.id}

    @api_router.get("/billing/stripe/status/{session_id}")
    async def stripe_status(session_id: str, authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        tx = await db.payment_transactions.find_one({"session_id": session_id, "user_id": user["user_id"]}, {"_id": 0})
        if not tx:
            raise HTTPException(status_code=404, detail="Unknown checkout session")
        s, tx, paid = await activate_session(session_id)
        return {"status": s.get("status"), "payment_status": s.get("payment_status"), "paid": paid, "plan": tx["plan"]}

    @api_router.post("/billing/stripe/webhook")
    async def stripe_webhook(request: Request):
        """Stripe -> us: renewals, failed payments, cancellations. Signature-verified and de-duplicated by event id."""
        secret = _secret("STRIPE_WEBHOOK_SECRET")
        if not secret:
            raise HTTPException(status_code=503, detail="Webhook not configured")
        payload = await request.body()  # raw bytes: the signature covers the exact body
        try:
            stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature", ""), secret)
        except (ValueError, stripe.SignatureVerificationError):
            raise HTTPException(status_code=400, detail="Invalid signature")
        event = json.loads(payload)
        try:
            await db.stripe_events.insert_one({"_id": event["id"], "type": event["type"], "at": datetime.now(timezone.utc)})
        except DuplicateKeyError:
            return {"received": True, "duplicate": True}
        try:
            await handle_event(event)
        except Exception as ex:
            await db.stripe_events.delete_one({"_id": event["id"]})  # let Stripe retry it
            logger.exception(f"stripe webhook {event['type']} failed: {ex}")
            raise HTTPException(status_code=500, detail="Webhook processing failed")
        logger.info(f"stripe webhook {event['type']} processed")
        return {"received": True}

    @api_router.get("/billing/stripe/return", response_class=HTMLResponse)
    async def stripe_return(session_id: Optional[str] = None, cancelled: Optional[str] = None):
        msg = "Payment cancelled." if cancelled else "Payment received — return to TraduSI to finish activating your plan."
        return HTMLResponse(f"<html><body style='font-family:sans-serif;text-align:center;padding:48px'><h2>TraduSI</h2><p>{msg}</p><p>You can close this window.</p></body></html>")

    @api_router.post("/billing/downgrade")
    async def billing_downgrade(authorization: Optional[str] = Header(default=None)):
        user = await get_user(authorization)
        raw = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "stripe_subscription_id": 1})
        sid = (raw or {}).get("stripe_subscription_id")
        if sid:  # stop future Stripe charges
            try:
                await _cancel_sub(sid)
            except Exception as ex:
                logger.error(f"cancel subscription {sid} failed: {ex}")
                raise HTTPException(status_code=400, detail="Couldn't cancel your Stripe subscription. Please try again.")
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"plan": "free", "plan_source": None, "plan_expires_at": None},
                                                                 "$unset": {"stripe_subscription_id": ""}})
        await log_plan_event(db, user["user_id"], "free", "user")
        return {"ok": True}

    return {"bump_scan": bump_scan, "scans_today": scans_today}
