"""One-off: move valuation-board docs saved by an older OptiIQ model to the 9-method model by refreshing only their
metrics (1 Finnhub call per stock, paced) and keeping the stored filings and estimates. python scripts/board_migrate_v8.py"""
import asyncio
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
import market  # noqa: E402
from atlas import shared_mongo_url  # noqa: E402
from valuation_board import MODEL_V, evaluate  # noqa: E402


async def main():
    db = AsyncIOMotorClient(shared_mongo_url(os.environ))[os.environ["SHARED_DB_NAME"]]
    col = db.valuation_board
    todo = [d async for d in col.find({"model_v": {"$ne": MODEL_V}, "financials.0": {"$exists": True}})]
    print(f"{len(todo)} stocks to move to model {MODEL_V}", flush=True)
    done = 0
    async with httpx.AsyncClient(timeout=30) as client:
        for d in todo:
            if (await col.find_one({"_id": d["_id"]}, {"model_v": 1}) or {}).get("model_v") == MODEL_V:
                continue  # the board loop got there first
            m = await market.get_metrics(client, d["_id"])
            if m.get("market_cap"):
                d["metrics"] = m
                upd = {"metrics": m, "model_v": MODEL_V}
                if d.get("price"):
                    upd.update({**evaluate(d, d["price"]), "price_ts": time.time()})
                await col.update_one({"_id": d["_id"]}, {"$set": upd})
                done += 1
            await asyncio.sleep(3)  # ~20 calls a minute, leaving the rest of the budget to the app
    print(f"moved {done}", flush=True)

asyncio.run(main())
