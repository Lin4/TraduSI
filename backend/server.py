"""TradeSI backend - Option & Stock Screening."""
from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, UploadFile, File
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import random
import json
import re
import asyncio
import time
import bcrypt
import jwt as pyjwt
import httpx
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timedelta, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from integrations import (
    RegisterPushBody, register_push_token, send_push,
    TTSReq, tts_generate, stt_transcribe,
    paypal_create_order, paypal_capture_order, PLAN_PRICES,
)
from market import (
    UNIVERSE, UNIVERSE_INDEX, fetch_stock_bundle, get_quote, get_candles,
    sma as calc_sma, rsi as calc_rsi, support_resistance, detect_candle_patterns, detect_chart_patterns,
)
from market import get_earnings, get_metrics, get_quarterly_financials, get_peers
import extras
import billing
import tradier
import chain
import strategies
import broadcasts
import valuation_board
from valuation_board import fill_balance_gaps, optiiq_sector, buy_levels
from engine import (
    STRATEGIES, STRATEGY_META, PROFILES, ACCOUNT_TYPES, EXP_DAYS, MIN_POP_FLOOR, CREDIT_VARIANTS, LEVEL_NAMES, user_options_level,
    volatility_profile, build_idea, default_filters, passes, candidate_strategies, compact,
    trade_plan, price_scenarios, dcf_valuation, default_dcf_inputs, optiiq_value, apply_fit, apply_history, management_plan,
)
import quant
import market
import signup
import account
import assistant

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
market.CANDLE_STORE = db.candle_cache  # daily bars survive restarts

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret')

app = FastAPI(title="TradeSI API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("optiscreen")


# ========== MODELS ==========
class LoginReq(BaseModel):
    email: EmailStr
    password: str

class SessionReq(BaseModel):
    session_id: str

class PlanReq(BaseModel):
    plan: str  # free | simple | advance | expert

class QuestionnaireReq(BaseModel):
    answers: Dict[str, Any]

class ConsentReq(BaseModel):
    agreed: bool
    signature: str  # typed signature

class ScreenFilters(BaseModel):
    """Numeric risk profile + sliders. None = use profile default."""
    profile: Optional[str] = None  # low_low | low_high | high_high
    bias: Optional[str] = None  # bullish | bearish | neutral | any
    account_type: Optional[str] = None  # cash | ira | reg_t | portfolio_margin
    account_size: Optional[float] = Field(default=None, gt=0, le=1e9)
    max_loss_pct: Optional[float] = Field(default=None, gt=0, le=100)
    min_pop: Optional[float] = Field(default=None, ge=0, le=100)
    min_roc: Optional[float] = Field(default=None, ge=0, le=10000)
    min_oi: Optional[int] = Field(default=None, ge=0)
    max_spread_pct: Optional[float] = Field(default=None, gt=0, le=100)
    min_iv_rank: Optional[float] = Field(default=None, ge=0, le=100)
    exclude_earnings: Optional[bool] = None
    tier: Optional[str] = None  # effective membership tier (client merges App Store entitlement)

class FindStockReq(ScreenFilters):
    risk: Optional[str] = None  # legacy: high | low
    reward: Optional[str] = None  # legacy: high | low
    expiration: str = "week"  # daily | week | month | 3months
    sectors: List[str] = []
    limit: int = Field(default=5, ge=1, le=20)

class BestOptionsReq(ScreenFilters):
    risk: Optional[str] = None
    reward: Optional[str] = None
    period: str = "week"  # day | week | month | custom
    custom_days: Optional[int] = None
    limit: int = Field(default=5, ge=1, le=20)

class TickerOptionsReq(ScreenFilters):
    ticker: str
    expiration_range: str = "month"  # week | month | 3months
    strategy: Optional[str] = None  # auto | strategy name

class StockAnalysisReq(BaseModel):
    ticker: str
    purpose: str  # day | swing | long
    account_size: Optional[float] = Field(default=None, gt=0, le=1e9)
    risk_pct: float = Field(default=1.0, gt=0, le=10)
    min_rr: float = Field(default=2.0, ge=0.5, le=10)

class ExplainReq(BaseModel):
    ideas: List[Dict[str, Any]]
    context: str = ""

class ValuationReq(BaseModel):
    ticker: str
    growth_bull: float = Field(ge=-50, le=100)
    growth_base: float = Field(ge=-50, le=100)
    growth_bear: float = Field(ge=-50, le=100)
    discount_pct: float = Field(ge=1, le=30)
    terminal_pe: float = Field(ge=1, le=100)
    w_bull: float = Field(default=25, ge=0, le=100)
    w_base: float = Field(default=50, ge=0, le=100)
    w_bear: float = Field(default=25, ge=0, le=100)

class WatchlistAddReq(BaseModel):
    ticker: str

class AlertAddReq(BaseModel):
    ticker: str = Field(min_length=1, max_length=10)
    kind: Literal["price_above", "price_below", "earnings", "smart_setup"]
    threshold: Optional[float] = Field(default=None, gt=0, le=1e7, allow_inf_nan=False)  # for price alerts
    note: Optional[str] = Field(default=None, max_length=280)

    @model_validator(mode="after")
    def _check_threshold(self):
        if self.kind in ("price_above", "price_below") and self.threshold is None:
            raise ValueError("Price alerts need a positive numeric threshold")
        return self


# ========== UTIL ==========
def now_utc():
    return datetime.now(timezone.utc)

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str) -> str:
    payload = {"user_id": user_id, "exp": now_utc() + timedelta(days=7), "iat": now_utc(), "jti": uuid.uuid4().hex}
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def store_session(session_token: str, user_id: str):
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "created_at": now_utc(),
            "expires_at": now_utc() + timedelta(days=7),
        }},
        upsert=True,
    )

async def get_user_from_token(authorization: Optional[str]) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth header")
    token = authorization[7:]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:  # signed out, password reset, or expired -> the token is no longer valid
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")
    exp = session.get("expires_at")
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user_id = session["user_id"]
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    la = user.get("last_active_at")
    if la is not None and la.tzinfo is None:
        la = la.replace(tzinfo=timezone.utc)
    if not la or now_utc() - la > timedelta(minutes=10):  # activity tracking for admin insights (throttled)
        await db.users.update_one({"user_id": user_id}, {"$set": {"last_active_at": now_utc()}})
    return user
CAPITAL_MAP = {"< $5k": 5000, "$5k–$25k": 25000, "$25k–$100k": 100000, "> $100k": 250000}
ACCOUNT_MAP = {"Cash": "cash", "Margin (Reg T)": "reg_t", "Portfolio margin": "portfolio_margin", "IRA": "ira"}
_RESULT_CACHE: Dict[str, tuple] = {}


def cache_get(key: str, ttl: float):
    v = _RESULT_CACHE.get(key)
    if v and time.time() - v[0] < ttl:
        return v[1]
    return None


def cache_set(key: str, val: Any):
    _RESULT_CACHE[key] = (time.time(), val)
    if len(_RESULT_CACHE) > 500:
        for k in sorted(_RESULT_CACHE, key=lambda k: _RESULT_CACHE[k][0])[:100]:
            _RESULT_CACHE.pop(k, None)


def user_defaults(user: Dict[str, Any]) -> Dict[str, Any]:
    q = user.get("questionnaire") or {}
    return {
        "account_size": float(CAPITAL_MAP.get(q.get("capital"), 25000)),
        "account_type": ACCOUNT_MAP.get(q.get("account_type"), "reg_t"),
        "options_level": user_options_level(q),
    }


def sparkline_from_candles(candles: List[Dict], points: int = 20) -> List[float]:
    if not candles:
        return []
    return [round(float(c["c"]), 2) for c in candles[-points:]]


async def ticker_snapshot(client: httpx.AsyncClient, ticker: str) -> Optional[Dict[str, Any]]:
    """Cached quote + candles + earnings + metrics -> everything the engine needs."""
    q, c, e, m = await asyncio.gather(
        get_quote(client, ticker), get_candles(client, ticker, 250),
        get_earnings(client, ticker), get_metrics(client, ticker), return_exceptions=True,
    )
    if not isinstance(q, dict) or not q.get("price"):
        return None
    c = c if isinstance(c, list) else []
    e = e if isinstance(e, dict) else {}
    m = m if isinstance(m, dict) else {}
    return {
        "ticker": ticker, "quote": q, "price": q["price"], "candles": c,
        "info": UNIVERSE_INDEX.get(ticker, {"name": ticker, "sector": "Unknown"}),
        "earnings_date": e.get("date"), "dividend_yield": m.get("dividend_yield"),
        "vol": volatility_profile(c), "sparkline": sparkline_from_candles(c), "metrics": m,
    }


_IVH_CACHE: Dict[str, Any] = {}


async def iv_history(tickers: List[str]) -> Dict[str, List[float]]:
    """Daily ATM-IV snapshots (last 252 days) per ticker, cached 10 min."""
    key = ",".join(sorted(tickers))
    hit = _IVH_CACHE.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    since = (now_utc() - timedelta(days=370)).strftime("%Y-%m-%d")
    out: Dict[str, List[float]] = {t: [] for t in tickers}
    async for r in db.iv_history.find({"ticker": {"$in": tickers}, "date": {"$gte": since}}, {"_id": 0}).sort("date", 1):
        out.setdefault(r["ticker"], []).append(r["iv"])
    _IVH_CACHE[key] = (time.time(), out)
    return out


def apply_iv_rank(snap: Dict[str, Any], hist: List[float]) -> None:
    r = quant.iv_rank_from_history(hist, (snap.get("chain") or {}).get("atm_iv"))
    if r:
        snap["vol"] = {**snap["vol"], "iv_rank": r["iv_rank"], "iv_percentile": r["iv_percentile"],
                       "iv_rank_source": f"{r['days']} days of recorded implied vol"}


def enrich_idea(i: Dict[str, Any], snap: Dict[str, Any], hist: List[float], profile: str, account_size: float) -> None:
    """Stages 1, 3, 4 for a shortlisted idea: scan report, management plan, validation, calibrated POP."""
    i["scan"] = quant.scan_report(snap, hist)
    i["plan"] = management_plan(i, account_size, None, profile)
    i["validation"] = quant.validate_idea(i, snap.get("candles") or [], i["plan"])
    apply_history(i)
    cal = EXTRAS.get("calibrate") and EXTRAS["calibrate"](i["pop"])
    if cal:
        i["pop_calibrated"], i["calibration_n"] = cal


def ideas_for_snapshot(snap: Dict[str, Any], strategies: List[str], dte: int, account_type: str) -> List[Dict]:
    out = []
    for s in strategies:
        for scale in (CREDIT_VARIANTS if STRATEGY_META[s]["credit"] else (1.0,)):
            try:
                idea = build_idea(snap["ticker"], snap["info"], s, snap["price"], snap["vol"], dte, account_type,
                                  snap["earnings_date"], snap["dividend_yield"], scale, snap.get("chain"))
                idea["sparkline"] = snap["sparkline"]
                out.append(idea)
            except Exception as ex:
                logger.warning(f"idea {snap['ticker']} {s} failed: {ex}")
    return out


async def attach_chains(client: httpx.AsyncClient, snaps: List[Dict[str, Any]], dte: int) -> None:
    """Live Tradier chain for each snapshot (nearest listed expiration); None -> model fallback."""
    chains = await asyncio.gather(*[tradier.live_chain(client, s["ticker"], dte, s["price"]) for s in snaps],
                                  return_exceptions=True)
    for s, c in zip(snaps, chains):
        s["chain"] = c if isinstance(c, dict) else None


def data_source_block(idea: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    live = bool(idea and idea.get("live_quotes"))
    src = idea.get("quote_source") if live else None
    return {
        "quote": "Finnhub (real-time, delayed <= 1 min)",
        "option_pricing": f"{src} bid/ask mid + modeled slippage" if live else "Theoretical Black-Scholes mid + modeled slippage",
        "liquidity": f"{src} open interest, volume & spreads" if live else "Model estimate (live chain unavailable)",
        "options_live": live,
        "fetched_at": now_utc().isoformat(),
    }


async def record_iv(client: httpx.AsyncClient, snap: Optional[Dict[str, Any]]) -> None:
    """One ATM implied-vol snapshot per ticker per trading day (~30 DTE) -> true IV rank over time."""
    if not snap:
        return
    day = datetime.now(extras.NY).strftime("%Y-%m-%d")
    if datetime.now(extras.NY).weekday() >= 5 or await db.iv_history.find_one({"ticker": snap["ticker"], "date": day}, {"_id": 1}):
        return
    c = await tradier.live_chain(client, snap["ticker"], 30, snap["price"])
    if c and c.get("atm_iv"):
        await db.iv_history.update_one({"ticker": snap["ticker"], "date": day},
                                       {"$set": {"iv": c["atm_iv"], "dte": c["dte"], "price": snap["price"]}}, upsert=True)


async def warm_universe_loop():
    """Pre-compute scans: keep the universe snapshot cache warm so screens return in ~1-2s.
    Paced so Polygon (5/min) and Finnhub (55/min) budgets stay free for user requests; market._get enforces both."""
    await asyncio.sleep(3)
    while True:
        async with httpx.AsyncClient() as client:
            for s in UNIVERSE:
                before = market.CALL_COUNTS.get("api.polygon.io", 0)
                try:
                    snap = await ticker_snapshot(client, s["ticker"])
                    await record_iv(client, snap)
                except Exception as ex:
                    logger.warning(f"warm {s['ticker']} failed: {ex}")
                await asyncio.sleep(13 if market.CALL_COUNTS.get("api.polygon.io", 0) > before else 2)
        await asyncio.sleep(20)

# ========== AI ==========
async def call_claude(system: str, prompt: str) -> str:
    """Call Claude Sonnet 5.5 via emergentintegrations."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"optiscreen-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-5-5")
        resp = await chat.send_message(UserMessage(text=prompt))
        return resp if isinstance(resp, str) else str(resp)
    except Exception as e:
        logger.exception(f"Claude call failed: {e}")
        return ""

def extract_json(text: str) -> Optional[Dict]:
    if not text:
        return None
    m = re.search(r'\{[\s\S]*\}', text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ========== AUTH ROUTES ==========
async def start_user_session(user: Dict[str, Any]) -> Dict[str, Any]:
    token = make_token(user["user_id"])
    await store_session(token, user["user_id"])
    return {"session_token": token, "user": {k: v for k, v in user.items() if k not in ("password", "_id")}}

signup.register(api_router, db=db, hash_pw=hash_pw, start_session=start_user_session, logger=logger)
account.register(api_router, db=db, hash_pw=hash_pw, verify_pw=verify_pw, get_user=get_user_from_token,
                 start_session=start_user_session, logger=logger)

@api_router.post("/auth/login")
async def login(req: LoginReq):
    user = await db.users.find_one({"email": req.email.lower()}, {"_id": 0})
    if not user and await db.email_verifications.find_one({"email": req.email.lower()}, {"_id": 1}):
        raise HTTPException(status_code=403, detail="Your email isn't verified yet. Enter the code we emailed you to finish creating your account.")
    if not user or not user.get("password") or not verify_pw(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = make_token(user["user_id"])
    await store_session(token, user["user_id"])
    user.pop("password", None)
    return {"session_token": token, "user": user}

@api_router.post("/auth/session")
async def oauth_session(req: SessionReq):
    """Emergent Google OAuth exchange."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": req.session_id},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"OAuth exchange failed: {e}")
        raise HTTPException(status_code=401, detail="Auth service error")

    email = data.get("email", "").lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Incomplete auth data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"picture": picture, "name": name}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "password": None,
            "plan": None,
            "questionnaire_complete": False,
            "consent_signed": False,
            "created_at": now_utc(),
        })

    await store_session(session_token, user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    return {"session_token": session_token, "user": user}

@api_router.get("/auth/me")
async def me(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    raw = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    user["auth_method"] = "email" if (raw or {}).get("password") else "google"
    user["access"] = billing.compute_access(raw or user)
    return {"user": user}

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        await db.user_sessions.delete_many({"session_token": token})
    return {"ok": True}


# ========== PROFILE ==========
@api_router.post("/user/plan")
async def set_plan(req: PlanReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    if req.plan not in ("free", "simple", "advance", "expert"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    if req.plan != "free":
        raise HTTPException(status_code=402, detail="Paid plans require checkout (card, Apple Pay, Google Pay, PayPal or App Store)")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"plan": "free", "plan_source": None, "plan_expires_at": None}})
    await billing.log_plan_event(db, user["user_id"], "free", "user")
    return {"ok": True, "plan": req.plan}

@api_router.post("/user/questionnaire")
async def save_questionnaire(req: QuestionnaireReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"questionnaire": req.answers, "questionnaire_complete": True}},
    )
    return {"ok": True}

@api_router.post("/user/consent")
async def save_consent(req: ConsentReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    if not req.agreed or not req.signature.strip():
        raise HTTPException(status_code=400, detail="Must agree & sign")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"consent_signed": True, "consent": {"signature": req.signature, "at": now_utc().isoformat()}}},
    )
    return {"ok": True}


# ========== SCREENER ROUTES ==========
def _tier_allows(tier: str, strategy: str) -> bool:
    st = billing.strategy_tier_for(tier)
    if st >= 4:
        return True
    if st >= 3:
        return not STRATEGY_META[strategy]["naked"]
    return strategy in ("Cash Secured Put", "Covered Call")

def _resolve_profile(req) -> str:
    if req.profile in PROFILES:
        return req.profile
    risk, reward = (req.risk or "low"), (req.reward or "low")
    if risk == "high" and reward == "high":
        return "high_high"
    if risk == "low" and reward == "high":
        return "low_high"
    return "low_low"  # high risk / low reward is excluded by design


def _resolve_filters(req, profile: str) -> Dict[str, Any]:
    f = default_filters(profile)
    for k in f:
        v = getattr(req, k, None)
        if v is not None:
            f[k] = v
    return f


async def run_scan(req, user: Dict[str, Any], dte: int, pool: List[Dict]) -> Dict[str, Any]:
    d = user_defaults(user)
    profile = _resolve_profile(req)
    filters = _resolve_filters(req, profile)
    filters["min_pop"] = max(float(filters["min_pop"]), MIN_POP_FLOOR)
    account_type = req.account_type if req.account_type in ACCOUNT_TYPES else d["account_type"]
    account_size = float(req.account_size or d["account_size"])
    bias = req.bias or "any"
    level = d["options_level"]
    tier = req.tier if req.tier in billing.TIER_RANK else billing.compute_access(
        await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}) or user)["tier"]
    usage = await BILLING["bump_scan"](user["user_id"])
    key = json.dumps({"t2": tier, "p": profile, "f": filters, "a": account_type, "s": account_size, "b": bias, "d": dte, "lv": level,
                      "t": [x["ticker"] for x in pool], "l": req.limit}, sort_keys=True)
    hit = cache_get(key, 60)
    if hit:
        return {**hit, "scans_today": usage}
    strategies = [x for x in candidate_strategies(profile, bias, level) if _tier_allows(tier, x)]
    async with httpx.AsyncClient() as client:
        snaps = await asyncio.gather(*[ticker_snapshot(client, x["ticker"]) for x in pool])
        snaps = [s for s in snaps if s]
        await attach_chains(client, snaps, dte)
    hist = await iv_history([s["ticker"] for s in snaps])
    for s in snaps:
        apply_iv_rank(s, hist.get(s["ticker"], []))
    by_tk = {s["ticker"]: s for s in snaps}

    def compute():
        best, rejected, evaluated = [], {}, 0
        for s in snaps:
            ideas = ideas_for_snapshot(s, strategies, dte, account_type)
            evaluated += len(ideas)
            ok = []
            for i in ideas:
                apply_fit(i, profile, account_size, filters)
                fails = passes(i, filters, profile, account_size, level)
                for r in fails:
                    rejected[r] = rejected.get(r, 0) + 1
                if not fails:
                    ok.append(i)
            if ok:
                top = max(ok, key=lambda i: i["score"])
                top["alternatives"] = [compact(i) for i in sorted(ok, key=lambda i: -i["score"]) if i is not top][:3]
                best.append(top)
        best.sort(key=lambda i: -i["score"])
        return best, rejected, evaluated

    results, rejected, evaluated = await asyncio.to_thread(compute)
    results = results[: req.limit]

    def enrich_all():
        for r in results:
            enrich_idea(r, by_tk[r["ticker"]], hist.get(r["ticker"], []), profile, account_size)
        results.sort(key=lambda r: -r["score"])  # re-rank with the own-history edge included
    await asyncio.to_thread(enrich_all)
    for r in results:
        r["data_source"] = data_source_block(r)
    out = {
        "results": results, "profile": profile, "profile_label": PROFILES[profile]["label"],
        "filters": filters, "account_type": account_type, "account_size": account_size, "bias": bias,
        "options_level": level, "options_level_label": LEVEL_NAMES.get(level), "allowed_strategies": strategies,
        "min_pop_floor": MIN_POP_FLOOR,
        "stats": {"tickers_scanned": len(snaps), "universe": len(pool), "ideas_evaluated": evaluated, "passed": len(results),
                  "rejected_by": rejected},
        "fetched_at": now_utc().isoformat(),
    }
    out["tier"] = tier
    cache_set(key, out)
    if EXTRAS.get("log_picks") and results:
        asyncio.create_task(EXTRAS["log_picks"](results, profile))
    return {**out, "scans_today": usage}


@api_router.get("/screener/profiles")
async def screener_profiles(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    lvl = user_defaults(user)["options_level"]
    return {
        "profiles": {k: {**v, "filters": default_filters(k), "strategies": candidate_strategies(k, "any", lvl),
                         "locked": not candidate_strategies(k, "any", lvl)} for k, v in PROFILES.items()},
        "strategies": STRATEGY_META, "account_types": list(ACCOUNT_TYPES), "defaults": user_defaults(user),
        "min_pop_floor": MIN_POP_FLOOR, "level_names": LEVEL_NAMES, "options_level": lvl,
        "options_level_label": LEVEL_NAMES.get(lvl),
    }


@api_router.post("/screener/find-stocks")
async def find_stocks(req: FindStockReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    pool = [s for s in UNIVERSE if not req.sectors or s["sector"] in req.sectors] or UNIVERSE[:]
    return await run_scan(req, user, EXP_DAYS.get(req.expiration, 30), pool)


@api_router.post("/screener/best-options")
async def best_options(req: BestOptionsReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    dte = req.custom_days if req.period == "custom" and req.custom_days else EXP_DAYS.get(req.period, 7)
    out = await run_scan(req, user, max(1, min(int(dte), 365)), UNIVERSE[:])
    return {**out, "top_pick": out["results"][0]["ticker"] if out["results"] else None}


@api_router.post("/screener/explain")
async def screener_explain(req: ExplainReq, authorization: Optional[str] = Header(default=None)):
    """AI layer: ranks/explains engine output. Never produces numbers of its own."""
    await get_user_from_token(authorization)
    ideas = req.ideas[:10]
    key = "explain:" + json.dumps({"i": ideas, "c": req.context}, sort_keys=True, default=str)
    hit = cache_get(key, 1800)
    if hit:
        return hit
    system = (
        "You are an options research assistant. You NEVER invent prices, premiums or probabilities; "
        "you only quote numbers given to you. Educational research, not investment advice. Reply ONLY valid JSON."
    )
    prompt = (
        f"Context: {req.context}. Engine output (deterministic): {json.dumps(ideas, default=str)}.\n"
        "For each ticker write: why this setup fits / why now (1 sentence) and the key thing that could go wrong (1 sentence). "
        "Then a one-line overall summary.\n"
        '{"summary":"...","picks":[{"ticker":"XX","why":"...","risk":"..."}]}'
    )
    ai = extract_json(await call_claude(system, prompt)) or {}
    out = {"summary": ai.get("summary", ""), "picks": ai.get("picks", []), "generated_at": now_utc().isoformat()}
    if out["summary"] or out["picks"]:
        cache_set(key, out)
    return out


@api_router.post("/screener/ticker-options")
async def ticker_options(req: TickerOptionsReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    tk = req.ticker.upper().strip()
    async with httpx.AsyncClient() as client:
        snap = await ticker_snapshot(client, tk)
        if snap:
            await attach_chains(client, [snap], EXP_DAYS.get(req.expiration_range, 30))
    if not snap:
        raise HTTPException(status_code=404, detail=f"No live quote found for {tk}")
    d = user_defaults(user)
    profile = req.profile if req.profile in PROFILES else "any"
    account_type = req.account_type if req.account_type in ACCOUNT_TYPES else d["account_type"]
    account_size = float(req.account_size or d["account_size"])
    filters = _resolve_filters(req, profile if profile != "any" else "high_high")
    dte = EXP_DAYS.get(req.expiration_range, 30)
    strategies = STRATEGIES if (not req.strategy or req.strategy == "auto") else [req.strategy]
    if req.strategy and req.strategy != "auto" and req.strategy not in STRATEGY_META:
        raise HTTPException(status_code=400, detail="Unknown strategy")
    level = d["options_level"]
    if not req.strategy or req.strategy == "auto":
        strategies = candidate_strategies(profile, "any", level) or candidate_strategies(profile, "any")
    hist = (await iv_history([tk])).get(tk, [])
    apply_iv_rank(snap, hist)
    ideas = await asyncio.to_thread(ideas_for_snapshot, snap, strategies, dte, account_type)
    if not ideas:
        raise HTTPException(status_code=500, detail="Engine could not price this ticker")
    fit_profile = profile if profile != "any" else d.get("profile") or "low_low"
    for i in ideas:
        apply_fit(i, fit_profile, account_size, filters)
    graded = [(i, passes(i, filters, profile if profile != "any" else "high_high", account_size, level)) for i in ideas]
    ok = [i for i, f in graded if not f]
    chosen = max(ok or ideas, key=lambda i: i["score"])
    chosen["passes_filters"] = bool(ok) and chosen in ok
    chosen["failed_filters"] = next(f for i, f in graded if i is chosen)
    chosen["alternatives"] = [compact(i, f) for i, f in sorted(graded, key=lambda x: -x[0]["score"]) if i is not chosen]
    await asyncio.to_thread(enrich_idea, chosen, snap, hist, fit_profile, account_size)
    chosen["data_source"] = data_source_block(chosen)
    chosen["account_size"] = account_size
    chosen["filters"] = filters
    chosen["options_level"] = level
    chosen["options_level_label"] = LEVEL_NAMES.get(level)
    return {"result": chosen}


@api_router.post("/screener/stock-analysis")
async def stock_analysis(req: StockAnalysisReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    tk = req.ticker.upper().strip()
    bundle = await fetch_stock_bundle(tk)
    if not bundle.get("price"):
        raise HTTPException(status_code=404, detail=f"No live quote found for {tk}")
    d = user_defaults(user)
    account_size = float(req.account_size or d["account_size"])
    price = bundle["price"]
    candles = bundle["candles"]
    sma_20 = bundle["sma_20"] or round(price, 2)
    sma_50 = bundle["sma_50"] or round(price, 2)
    rsi_val = bundle["rsi"] or 50
    sup = bundle["support"] or round(price * 0.94, 2)
    res = bundle["resistance"] or round(price * 1.07, 2)
    vol = volatility_profile(candles)

    if req.purpose in ("day", "swing"):
        plan = trade_plan(candles, price, sup, res, bundle["trend"], rsi_val, req.purpose, account_size, req.risk_pct, req.min_rr)
        sent = bundle.get("news_sentiment") or {}
        if sent and sent.get("bullish", 0) > sent.get("bearish", 0):
            market_sentiment = "Bullish"
        elif sent and sent.get("bearish", 0) > sent.get("bullish", 0):
            market_sentiment = "Bearish"
        else:
            market_sentiment = "Neutral"
        long_side = plan["direction"] == "long"
        resp = {
            "ticker": tk, "name": bundle["name"], "price": price, "purpose": req.purpose, "candles": candles,
            "trade_plan": plan,
            "buy_point": plan["entry"] if long_side else plan["target"],
            "sell_point": plan["target"] if long_side else plan["entry"],
            "stop_loss": plan["stop"],
            "scenarios": price_scenarios(price, vol["hv20"], 1 if req.purpose == "day" else 10, plan),
            "support": sup, "resistance": res, "sma_20": sma_20, "sma_50": sma_50, "rsi": rsi_val,
            "trend": bundle["trend"], "volatility": vol,
            "short_float_pct": None, "short_interest": None, "option_volume": None,
            "short_data_note": "Short interest is exchange-reported twice a month (delayed); real-time borrow data needs a paid vendor.",
            "candlestick_patterns": bundle["candlestick_patterns"], "chart_patterns": bundle["chart_patterns"],
            "market_sentiment": market_sentiment,
            "pdt_note": "Check current FINRA pattern-day-trader rules before frequent day trades in a small margin account." if req.purpose == "day" else None,
        }
        system = "You are a short-term trading research assistant. Quote only the numbers given. Not investment advice. Reply ONLY valid JSON."
        prompt = (
            f"Explain this {req.purpose} {plan['direction']} setup for {tk}. Engine data: price ${price}, SMA20 ${sma_20}, SMA50 ${sma_50}, "
            f"RSI {rsi_val}, support ${sup}, resistance ${res}, trend {bundle['trend']}, patterns {bundle['candlestick_patterns'] + bundle['chart_patterns']}, "
            f"plan entry ${plan['entry']} stop ${plan['stop']} target ${plan['target']} R:R {plan['reward_risk']}. "
            f'JSON: {{"summary":"...","verdict":"BUY|SELL|HOLD","confidence":"low|med|high"}}'
        )
    else:
        metrics = bundle.get("metrics") or {}
        earnings = bundle.get("earnings") or {}
        pt = bundle.get("price_target")
        eps = metrics.get("eps_ttm") or 0
        pe = metrics.get("pe_ttm") or 0
        async with httpx.AsyncClient() as client:
            try:
                financials = await get_quarterly_financials(client, tk, 8)
            except Exception as ex:
                logger.warning(f"financials {tk}: {ex}")
                financials = []
            history = await get_candles(client, tk, 504)  # ~2 years for the buy-level chart
        if len(history) < len(candles):
            history = candles
        fill_balance_gaps(financials, metrics, price)
        dcf_in = default_dcf_inputs(metrics)
        valuation = dcf_valuation(price, eps, dcf_in["growth"], dcf_in["discount_pct"], dcf_in["terminal_pe"], dcf_in["weights"])
        optiiq = optiiq_value(price, metrics, financials, optiiq_sector(tk, bundle.get("sector") or UNIVERSE_INDEX.get(tk, {}).get("sector")))
        iv_line = (optiiq["value"], "OptiIQ Value") if optiiq.get("available") else \
            ((valuation["weighted_value"], "Probability-weighted DCF") if valuation and valuation.get("weighted_value") else (None, None))
        resp = {
            "ticker": tk, "name": bundle["name"], "price": price, "purpose": "long", "candles": candles,
            "valuation": valuation, "valuation_inputs": dcf_in,
            "intrinsic_value": valuation["weighted_value"] if valuation else None,
            "price_target": pt, "stock_trend": bundle["trend"],
            "earnings_date": earnings.get("date"), "earnings_eps_estimate": earnings.get("eps_estimate"),
            "pe_ratio": pe, "eps_ttm": eps, "roe": metrics.get("roe_ttm"),
            "revenue_growth_pct": metrics.get("revenue_growth_ttm"), "net_margin_pct": metrics.get("net_profit_margin"),
            "beta": metrics.get("beta"), "dividend_yield": metrics.get("dividend_yield"),
            "fifty_two_week_high": metrics.get("52w_high"), "fifty_two_week_low": metrics.get("52w_low"),
            "business_moat": "Wide" if (metrics.get("roe_ttm") or 0) > 20 else ("Narrow" if (metrics.get("roe_ttm") or 0) > 10 else "None"),
            "competitors": bundle["peers"][:4],
            "analyst_ratings": bundle["analyst_ratings"] or {"buy": 0, "hold": 0, "sell": 0},
            "valuation_measures": {k: metrics.get(k) for k in (
                "market_cap", "enterprise_value", "trailing_pe", "forward_pe", "peg_ratio",
                "price_to_sales", "price_to_book", "ev_to_revenue", "ev_to_ebitda")},
            "financials": financials,
            "optiiq": optiiq,
            "intrinsic_line": {"value": iv_line[0], "source": iv_line[1]},
            "buy_levels": buy_levels(history, price, iv_line[0]),
            "price_history": [[c.get("t"), round(c["c"], 2)] for c in history],
            "financials_source": "SEC 10-Q/10-K filings via Finnhub (quarterly values derived from year-to-date figures)",
            "buy_point": valuation["buy_zone_below"] if valuation else None,
            "sell_point": valuation["sell_zone_above"] if valuation else None,
        }
        system = "You are a long-term research assistant. Quote only the numbers given. Not investment advice. Reply ONLY valid JSON."
        prompt = (
            f"Give a long-term thesis for {tk}. Data: price ${price}, P/E {pe}, EPS ${eps}, ROE {metrics.get('roe_ttm')}%, "
            f"revenue growth {metrics.get('revenue_growth_ttm')}%, analyst target ${pt}, peers {bundle['peers'][:3]}, "
            f"ratings {bundle['analyst_ratings']}, DCF weighted value {valuation['weighted_value'] if valuation else 'n/a'}. "
            f'JSON: {{"summary":"...","verdict":"BUY|SELL|HOLD","confidence":"low|med|high","moat_note":"..."}}'
        )

    ai_key = f"sa:{tk}:{req.purpose}"
    ai = cache_get(ai_key, 600)
    if ai is None:
        ai = extract_json(await call_claude(system, prompt)) or {}
        if ai:
            cache_set(ai_key, ai)
    resp["ai_summary"] = ai.get("summary", f"{tk} engine readout for the {req.purpose} horizon.")
    resp["verdict"] = ai.get("verdict", "HOLD")
    resp["confidence"] = ai.get("confidence", "med")
    if req.purpose == "long":
        resp["moat_note"] = ai.get("moat_note", "")
    resp["data_source"] = data_source_block()
    return {"result": resp}


VALUATION_KEYS = ("market_cap", "enterprise_value", "trailing_pe", "forward_pe", "peg_ratio",
                  "price_to_sales", "price_to_book", "ev_to_revenue", "ev_to_ebitda")


@api_router.get("/screener/peers/{ticker}")
async def peer_comparison(ticker: str, authorization: Optional[str] = Header(default=None)):
    """Valuation measures for the ticker vs up to 3 industry peers (Finnhub peers)."""
    await get_user_from_token(authorization)
    tk = ticker.upper().strip()
    hit = cache_get(f"peers:{tk}", 3600)
    if hit:
        return hit
    async with httpx.AsyncClient() as client:
        peers = (await get_peers(client, tk))[:3]
        metrics = await asyncio.gather(*[get_metrics(client, t) for t in [tk] + peers], return_exceptions=True)
    rows = []
    for t, m in zip([tk] + peers, metrics):
        if isinstance(m, dict) and any(m.get(k) is not None for k in VALUATION_KEYS):
            rows.append({"ticker": t, "is_target": t == tk, **{k: m.get(k) for k in VALUATION_KEYS}})
    verdict = {}
    for k in VALUATION_KEYS[2:]:  # ratio measures: lower = cheaper
        others = [r[k] for r in rows if not r["is_target"] and r.get(k) is not None and r[k] > 0]
        mine = next((r[k] for r in rows if r["is_target"]), None)
        if others and mine is not None and mine > 0:
            med = sorted(others)[len(others) // 2]
            verdict[k] = {"peer_median": round(med, 2), "cheaper": mine < med, "diff_pct": round((mine / med - 1) * 100, 1)}
    cheaper = sum(1 for v in verdict.values() if v["cheaper"])
    out = {"ticker": tk, "rows": rows, "verdict": verdict,
           "summary": f"{tk} looks cheaper than its peers on {cheaper} of {len(verdict)} ratios" if verdict else "Not enough peer data",
           "source": "Finnhub peers & basic financials"}
    cache_set(f"peers:{tk}", out)
    return out


@api_router.post("/screener/valuation")
async def valuation_route(req: ValuationReq, authorization: Optional[str] = Header(default=None)):
    await get_user_from_token(authorization)
    tk = req.ticker.upper().strip()
    async with httpx.AsyncClient() as client:
        q, m = await asyncio.gather(get_quote(client, tk), get_metrics(client, tk))
    if not q:
        raise HTTPException(status_code=404, detail=f"No live quote found for {tk}")
    v = dcf_valuation(q["price"], (m or {}).get("eps_ttm"),
                      {"bull": req.growth_bull, "base": req.growth_base, "bear": req.growth_bear},
                      req.discount_pct, req.terminal_pe, {"bull": req.w_bull, "base": req.w_base, "bear": req.w_bear})
    if not v:
        raise HTTPException(status_code=400, detail="DCF needs positive earnings (EPS)")
    return {"valuation": v, "price": q["price"]}

@api_router.get("/screener/stocks")
async def list_stocks():
    return {"stocks": UNIVERSE}

@api_router.get("/screener/quote/{ticker}")
async def live_quote(ticker: str, authorization: Optional[str] = Header(default=None)):
    await get_user_from_token(authorization)
    async with httpx.AsyncClient() as client:
        q = await get_quote(client, ticker.upper())
    if not q:
        raise HTTPException(status_code=404, detail=f"No quote for {ticker}")
    return {"ticker": ticker.upper(), **q, "fetched_at": now_utc().isoformat(), "source": "Finnhub"}


# ========== WATCHLIST ==========
@api_router.post("/watchlist/add")
async def watchlist_add(req: WatchlistAddReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    tk = req.ticker.upper()
    await db.watchlist.update_one(
        {"user_id": user["user_id"], "ticker": tk},
        {"$set": {"user_id": user["user_id"], "ticker": tk, "added_at": now_utc()}},
        upsert=True,
    )
    return {"ok": True, "ticker": tk}

@api_router.delete("/watchlist/{ticker}")
async def watchlist_remove(ticker: str, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    await db.watchlist.delete_one({"user_id": user["user_id"], "ticker": ticker.upper()})
    return {"ok": True}

@api_router.get("/watchlist")
async def watchlist_list(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    rows = await db.watchlist.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(100)
    tickers = [r["ticker"] for r in rows]
    quotes: Dict[str, Dict] = {}
    async with httpx.AsyncClient() as client:
        qs = await asyncio.gather(*[get_quote(client, t) for t in tickers], return_exceptions=True)
    for t, q in zip(tickers, qs):
        if isinstance(q, dict):
            quotes[t] = q
    items = []
    for r in rows:
        tk = r["ticker"]
        q = quotes.get(tk)
        items.append({
            "ticker": tk,
            "added_at": r["added_at"].isoformat() if hasattr(r["added_at"], "isoformat") else r["added_at"],
            "quote": q,
            "name": UNIVERSE_INDEX.get(tk, {}).get("name", tk),
            "sector": UNIVERSE_INDEX.get(tk, {}).get("sector"),
        })
    return {"items": items, "fetched_at": now_utc().isoformat()}


# ========== ALERTS ==========
@api_router.post("/alerts/add")
async def alerts_add(req: AlertAddReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    alert = {
        "alert_id": f"alert_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "ticker": req.ticker.upper(),
        "kind": req.kind,
        "threshold": req.threshold,
        "note": req.note,
        "active": True,
        "created_at": now_utc(),
    }
    await db.alerts.insert_one(alert)
    alert.pop("_id", None)
    alert.pop("user_id", None)
    alert["created_at"] = alert["created_at"].isoformat()
    return alert

@api_router.get("/alerts")
async def alerts_list(authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    rows = await db.alerts.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(200)
    for r in rows:
        if hasattr(r.get("created_at"), "isoformat"):
            r["created_at"] = r["created_at"].isoformat()
    return {"items": rows}

@api_router.delete("/alerts/{alert_id}")
async def alerts_remove(alert_id: str, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    await db.alerts.delete_one({"user_id": user["user_id"], "alert_id": alert_id})
    return {"ok": True}


# ========== LEARN ==========
LEARN_CARDS = [
    {
        "id": "cash-secured-put",
        "category": "Options Strategy",
        "title": "Cash-Secured Put",
        "outlook": "Mildly bullish / neutral",
        "summary": "Sell a put, hold enough cash to buy the shares if assigned. Earn premium while waiting for a buy price you like.",
        "pros": ["Fixed max loss", "Income while waiting", "Lower cost basis if assigned"],
        "cons": ["Full stock downside below strike minus premium", "Ties up capital as collateral"],
        "when": "When you'd happily own the stock at the strike price",
    },
    {
        "id": "covered-call",
        "category": "Options Strategy",
        "title": "Covered Call",
        "outlook": "Neutral to mildly bullish",
        "summary": "Own 100 shares and sell a call above market. Generate income and cap upside.",
        "pros": ["Income on stock you already own", "Reduces cost basis"],
        "cons": ["Caps upside above strike", "Still full downside risk"],
        "when": "When the stock looks range-bound and you're happy to sell at the strike",
    },
    {
        "id": "bull-put-spread",
        "category": "Options Strategy",
        "title": "Bull Put Spread (Credit)",
        "outlook": "Bullish",
        "summary": "Sell a put, buy a lower-strike put. Defined-risk income trade.",
        "pros": ["Defined max loss", "High probability setups possible", "Less capital than CSP"],
        "cons": ["Capped profit", "Early assignment risk on short leg"],
        "when": "When you want bullish income with a fixed worst case",
    },
    {
        "id": "iron-condor",
        "category": "Options Strategy",
        "title": "Iron Condor",
        "outlook": "Neutral / range-bound",
        "summary": "Sell OTM put + call, buy further OTM protection on both sides.",
        "pros": ["Defined risk", "Profits from time decay if stock stays in range"],
        "cons": ["Both sides can lose on big moves", "Multiple legs = commissions"],
        "when": "Low volatility environments with a defined range",
    },
    {
        "id": "risk-vs-reward",
        "category": "Risk Primer",
        "title": "Risk tolerance vs. risk capacity",
        "outlook": "",
        "summary": "Tolerance is how comfortable you are with losses emotionally. Capacity is how much you can afford to lose financially. Build portfolios around whichever is lower.",
        "pros": [],
        "cons": [],
        "when": "Before every strategy decision",
    },
    {
        "id": "position-sizing",
        "category": "Risk Primer",
        "title": "Position sizing basics",
        "outlook": "",
        "summary": "Risk no more than 1-2% of your portfolio on any single trade. Size positions by distance to stop-loss, not by conviction.",
        "pros": [],
        "cons": [],
        "when": "Every entry",
    },
    {
        "id": "intrinsic-value",
        "category": "Fundamentals",
        "title": "Intrinsic value is a range, not a point",
        "outlook": "",
        "summary": "Always express intrinsic value as a range of scenarios (bear / base / bull) with explicit growth and discount-rate assumptions.",
        "pros": [],
        "cons": [],
        "when": "Long-term investment decisions",
    },
    {
        "id": "greeks",
        "category": "Options Glossary",
        "title": "The Greeks (Delta, Gamma, Theta, Vega)",
        "outlook": "",
        "summary": "Delta = price sensitivity to the stock. Gamma = delta's rate of change. Theta = time decay per day. Vega = sensitivity to implied volatility.",
        "pros": [],
        "cons": [],
        "when": "Every options trade",
    },
]

@api_router.get("/learn/cards")
async def learn_cards():
    return {"cards": LEARN_CARDS}


# ========== PUSH NOTIFICATIONS ==========
@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    return await register_push_token(body)


class PushTestReq(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None

@api_router.post("/push/test")
async def push_test(req: PushTestReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    try:
        await send_push(
            recipients=[user["user_id"]],
            data={
                "title": req.title or "TradeSI",
                "message": req.message or "Your daily top pick is ready - open to view",
                "action_url": "/(tabs)",
            },
        )
    except Exception as e:
        logger.warning(f"push_test failed: {e}")
        return {"ok": False, "error": str(e)}
    return {"ok": True}


@api_router.post("/push/daily-pick")
async def push_daily_pick(authorization: Optional[str] = Header(default=None)):
    """Simulate the daily top AI pick push for the current user."""
    user = await get_user_from_token(authorization)
    base = random.choice(UNIVERSE)
    async with httpx.AsyncClient() as client:
        q = await get_quote(client, base["ticker"])
    price_str = f"${q['price']:.2f}" if q else "live price"
    try:
        await send_push(
            recipients=[user["user_id"]],
            data={
                "title": f"Today's top pick: {base['ticker']}",
                "message": f"{base['name']} shows strong setup at {price_str}. Tap to analyze.",
                "action_url": f"/ticker/{base['ticker']}",
            },
        )
    except Exception as e:
        logger.warning(f"daily pick push failed: {e}")
        return {"ok": False, "ticker": base["ticker"], "error": str(e)}
    return {"ok": True, "ticker": base["ticker"]}


class EarningsReminderReq(BaseModel):
    ticker: str
    earnings_date: str  # YYYY-MM-DD

@api_router.post("/push/earnings-reminder")
async def push_earnings_reminder(req: EarningsReminderReq, authorization: Optional[str] = Header(default=None)):
    """Send a reminder that an earnings date is approaching for a ticker."""
    user = await get_user_from_token(authorization)
    try:
        await send_push(
            recipients=[user["user_id"]],
            data={
                "title": f"{req.ticker} earnings approaching",
                "message": f"Earnings on {req.earnings_date} - review your position",
                "action_url": f"/ticker/{req.ticker}",
            },
        )
    except Exception as e:
        logger.warning(f"earnings push failed: {e}")
        return {"ok": False, "error": str(e)}
    return {"ok": True}


# ========== ELEVENLABS TTS / STT ==========
@api_router.post("/tts/generate")
async def tts_route(req: TTSReq, authorization: Optional[str] = Header(default=None)):
    await get_user_from_token(authorization)
    return tts_generate(req)


@api_router.post("/stt/transcribe")
async def stt_route(audio: UploadFile = File(...), authorization: Optional[str] = Header(default=None)):
    await get_user_from_token(authorization)
    content = await audio.read()
    return stt_transcribe(content, audio.filename or "audio")


# ========== PAYPAL ==========
class CreateOrderReq(BaseModel):
    plan: str

@api_router.post("/paypal/create-order")
async def paypal_create(req: CreateOrderReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    return await paypal_create_order(req.plan, user["user_id"])


class CaptureOrderReq(BaseModel):
    order_id: str

@api_router.post("/paypal/capture-order")
async def paypal_capture(req: CaptureOrderReq, authorization: Optional[str] = Header(default=None)):
    user = await get_user_from_token(authorization)
    res = await paypal_capture_order(req.order_id)
    if res.get("status") == "COMPLETED" and res.get("plan"):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"plan": res["plan"], "plan_source": "paypal", "plan_expires_at": now_utc() + timedelta(days=30)}},
        )
        await billing.log_plan_event(db, user["user_id"], res["plan"], "paypal")
        await db.payments.insert_one({
            "user_id": user["user_id"],
            "order_id": req.order_id,
            "plan": res["plan"],
            "amount": PLAN_PRICES.get(res["plan"]),
            "status": res["status"],
            "created_at": now_utc(),
        })
    return {"status": res.get("status"), "plan": res.get("plan"), "order_id": req.order_id}


@api_router.get("/paypal/config")
async def paypal_config():
    return {"client_id": os.environ.get("PAYPAL_CLIENT_ID", ""), "mode": os.environ.get("PAYPAL_MODE", "sandbox")}


# ========== STARTUP ==========
@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await signup.ensure_indexes(db)
        await assistant.ensure_indexes(db)
        await db.users.create_index("stripe_subscription_id", sparse=True)
        await db.watchlist.create_index([("user_id", 1), ("ticker", 1)], unique=True)
        await db.alerts.create_index("user_id")
        await db.alerts.create_index("alert_id", unique=True)
        await db.picks.create_index("key", unique=True)
        await db.picks.create_index([("status", 1), ("expiration", 1)])
        await db.alert_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.lesson_progress.create_index([("user_id", 1), ("level", 1)], unique=True)
    except Exception as e:
        logger.warning(f"index: {e}")
    asyncio.create_task(warm_universe_loop())
    asyncio.create_task(EXTRAS["track_loop"]())
    asyncio.create_task(EXTRAS["smart_loop"]())
    asyncio.create_task(STRATS["loop"]())
    asyncio.create_task(BOARD["fundamentals_loop"]())
    asyncio.create_task(BOARD["price_loop"]())
    asyncio.create_task(BOARD["price_alert_loop"]())
    logger.info("TradeSI API ready")

@app.on_event("shutdown")
async def shutdown():
    client.close()


@api_router.get("/")
async def root():
    return {"service": "TradeSI API", "ok": True}


async def _scan_for_user(user: Dict[str, Any], profile: str) -> Dict[str, Any]:
    req = BestOptionsReq(period="month", profile=profile, limit=5)
    return await run_scan(req, user, 30, UNIVERSE[:])


BILLING: Dict[str, Any] = billing.register(api_router, db=db, get_user=get_user_from_token, logger=logger)

EXTRAS: Dict[str, Any] = extras.register(
    api_router, db=db, get_user=get_user_from_token, user_defaults=user_defaults, scan_for_user=_scan_for_user,
    send_push=send_push, universe=UNIVERSE, universe_index=UNIVERSE_INDEX, logger=logger, ticker_snapshot=ticker_snapshot,
)

chain.register(api_router, get_user=get_user_from_token, get_quote=get_quote)
broadcasts.register(api_router, db=db, get_user=get_user_from_token, send_push=send_push, logger=logger)
STRATS = strategies.register(api_router, db=db, get_user=get_user_from_token, get_quote=get_quote, send_push=send_push,
                             logger=logger, market_open_now=extras.market_open_now)
BOARD = valuation_board.register(api_router, db=db, get_user=get_user_from_token, send_push=send_push,
                                 market_open_now=extras.market_open_now, logger=logger)


# ========== ASK AI (Claude) ==========
_r1 = lambda v, n=1: round(v, n) if isinstance(v, (int, float)) else v


async def ai_ticker_context(tk: str, authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    """Live numbers for the AI assistant: quote, fundamentals, scan, and the engine's best idea (the model may only quote these)."""
    try:
        r = (await ticker_options(TickerOptionsReq(ticker=tk), authorization))["result"]
    except Exception:
        r = None
    async with httpx.AsyncClient() as client:
        q, m, e = await asyncio.gather(get_quote(client, tk), get_metrics(client, tk), get_earnings(client, tk), return_exceptions=True)
    q = q if isinstance(q, dict) else {}
    if not q.get("price"):
        return None
    m = m if isinstance(m, dict) else {}
    e = e if isinstance(e, dict) else {}
    out: Dict[str, Any] = {
        "ticker": tk, "name": UNIVERSE_INDEX.get(tk, {}).get("name", tk), "sector": UNIVERSE_INDEX.get(tk, {}).get("sector"),
        "price": q["price"], "change_pct": _r1(q.get("change_pct"), 2), "day_range": [q.get("low"), q.get("high")],
        "fundamentals": {k: _r1(m.get(k), 2) for k in ("pe_ttm", "forward_pe", "eps_ttm", "revenue_growth_ttm", "net_profit_margin",
                                                        "roe_ttm", "debt_to_equity", "dividend_yield", "beta", "52w_high", "52w_low", "market_cap")},
        "next_earnings": e.get("date"),
    }
    if r:
        sc, v = r.get("scan") or {}, r.get("validation") or {}
        bt = v.get("backtest") or {}
        p = r.get("plan") or {}
        vol = sc.get("volatility") or {}
        flow = sc.get("options_activity") or {}
        out["scan"] = {
            "liquidity": (sc.get("liquidity") or {}).get("grade"),
            "volatility": {k: vol.get(k) for k in ("atm_iv", "hv20", "hv60", "iv_hv_ratio", "iv_rank", "iv_rank_source")},
            "options_flow": {k: flow.get(k) for k in ("activity", "tone", "put_call_volume", "unusual")} if flow else None,
            "fundamentals_score": (sc.get("fundamentals") or {}).get("score"), "trend": sc.get("trend"), "flags": sc.get("flags"),
        }
        out["best_idea"] = {
            "strategy": r["strategy"], "expiration": r.get("expiration"),
            "legs": [f"{l['action']} {l.get('qty', 1)} {l['type']} ${l['strike']} exp {l.get('exp')} @ ${l.get('fill')}" for l in r.get("legs") or [] if l.get("type") != "Stock"]
                    + [f"{l['action']} {l.get('qty', 100)} shares" for l in r.get("legs") or [] if l.get("type") == "Stock"],
            "premium": r.get("premium"), "premium_type": r.get("premium_type"), "max_profit": r.get("max_profit"),
            "max_loss": r.get("max_loss"), "breakevens": r.get("breakevens"), "pop_pct": r.get("pop"),
            "pop_calibrated_pct": r.get("pop_calibrated"), "optiscore": r.get("optiscore"), "optiscore_grade": r.get("optiscore_grade"),
            "pillars": {k: _r1((r.get("pillars") or {}).get(k)) for k in ("expected_return", "risk", "premium_quality", "user_fit")},
            "passes_user_filters": r.get("passes_filters"), "failed_filters": r.get("failed_filters"),
            "plan": {"entry": (p.get("entry") or {}).get("conditions"), "take_profit": (p.get("take_profit") or {}).get("text"),
                     "stop": (p.get("stop") or {}).get("text"), "invalidation": (p.get("invalidation") or {}).get("text"),
                     "time_exit": (p.get("time_exit") or {}).get("text"),
                     "contracts": (p.get("sizing") or {}).get("contracts"), "risk_budget": (p.get("sizing") or {}).get("risk_budget")},
            "backtest_on_this_ticker": {k: bt.get(k) for k in ("hold_to_expiry", "managed")} if bt else None,
            "costs": {k: (v.get("costs") or {}).get(k) for k in ("pct_of_max_profit", "grade")},
            "worst_stress_test": (v.get("stress") or {}).get("worst"),
            "risks": (r.get("risks") or [])[:3], "why": r.get("why"),
        }
        out["alternatives"] = [{k: a.get(k) for k in ("strategy", "pop", "optiscore", "max_profit", "max_loss", "passes")}
                               for a in (r.get("alternatives") or [])[:4]]
    return out


async def ai_user_context(user: Dict[str, Any]) -> Dict[str, Any]:
    q = user.get("questionnaire") or {}
    d = user_defaults(user)
    rows = await db.strategies.find({"user_id": user["user_id"]}, {"_id": 0, "history": 0, "rolls": 0, "exit_legs": 0}) \
        .sort("created_at", -1).to_list(100)
    open_rows = [s for s in rows if s.get("status") == "open"][:12]
    closed = [s for s in rows if s.get("status") == "closed"]
    return {
        "plan": billing.compute_access(user)["tier"], "experience": q.get("experience"), "risk_tolerance": q.get("risk_tolerance"),
        "account_size": d["account_size"], "account_type": q.get("account_type"),
        "options_level": d["options_level"], "options_level_label": LEVEL_NAMES.get(d["options_level"]),
        "open_strategies": [{
            "name": s.get("name"), "ticker": s.get("ticker"), "type": s.get("strategy_type"),
            "legs": [f"{l['action']} {l['qty']} {l['type']} ${l['strike']} exp {l['expiration']} @ ${l['price']}" for l in s.get("legs") or []],
            "opened_at_underlying": s.get("entry_underlying"), "net_premium": s.get("net_premium"), "premium_type": s.get("premium_type"),
            "max_profit": s.get("max_profit"), "max_loss": s.get("max_loss"), "pop_at_entry": s.get("pop"), "expiration": s.get("expiration"),
            "target": s.get("target"), "stop": s.get("stop"),
            "last_mark": {k: (s.get("last_mark") or {}).get(k) for k in ("price", "pnl", "pnl_pct")} if s.get("last_mark") else None,
        } for s in open_rows],
        "closed_summary": {"count": len(closed), "wins": sum(1 for s in closed if (s.get("realized_pnl") or 0) > 0),
                           "total_realized_pnl": round(sum(s.get("realized_pnl") or 0 for s in closed), 2)},
    }


assistant.register(api_router, db=db, get_user=get_user_from_token, access_for=billing.compute_access,
                   ticker_context=ai_ticker_context, user_context=ai_user_context, universe=set(UNIVERSE_INDEX), logger=logger)


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
