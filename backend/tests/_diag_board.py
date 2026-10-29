"""Diagnostic: compare stored board value vs recomputed optiiq for a few tickers."""
import asyncio, os, time, sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from valuation_board import evaluate, MODEL_V
from atlas import shared_mongo_url


async def main():
    db = AsyncIOMotorClient(shared_mongo_url(os.environ))[os.environ["SHARED_DB_NAME"]]
    print("MODEL_V", MODEL_V)
    for tk in ["AAPL", "MSFT", "CCI", "BAC"]:
        d = await db.valuation_board.find_one({"_id": tk})
        ev = evaluate(d, d["price"])
        print(tk, "stored v", d.get("value"), "recomputed", ev["value"], "price", d["price"], "model_v", d.get("model_v"),
              "price_age_min", round((time.time() - (d.get("price_ts") or 0)) / 60), "fund_age_h", round((time.time() - (d.get("fund_ts") or 0)) / 3600, 1),
              "keys", sorted(k for k in d.keys() if k not in ("metrics", "financials", "estimates")))
    n = await db.valuation_board.count_documents({})
    ages = [time.time() - (x.get("price_ts") or 0) async for x in db.valuation_board.find({}, {"price_ts": 1})]
    print("docs", n, "min price age min", round(min(ages) / 60), "max", round(max(ages) / 60))
    from collections import Counter
    print(Counter([x.get("model_v") async for x in db.valuation_board.find({}, {"model_v": 1})]))

asyncio.run(main())
