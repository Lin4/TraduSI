"""Copy every collection + document (and indexes) from MONGO_URL/DB_NAME into SHARED_MONGO_URL/SHARED_DB_NAME.

Safe to re-run: documents are upserted by _id, so nothing is duplicated and source data is never modified.
Usage:  python scripts/migrate_to_atlas.py            -> dry run (counts + conflicts only)
        python scripts/migrate_to_atlas.py --apply    -> copy
"""
import sys
from pathlib import Path

from dotenv import dotenv_values
from pymongo import MongoClient, ReplaceOne

env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
APPLY = "--apply" in sys.argv
BATCH = 500

src = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
tgt = MongoClient(env["SHARED_MONGO_URL"], serverSelectionTimeoutMS=20000)[env["SHARED_DB_NAME"]]

existing = set(tgt.list_collection_names())
print(f"{'APPLY' if APPLY else 'DRY RUN'}: {env['DB_NAME']} -> Atlas '{env['SHARED_DB_NAME']}'")
print("Collections already in Atlas:", {c: tgt[c].estimated_document_count() for c in sorted(existing)} or "none")

# Same email registered in both databases under different accounts would break login, so report it.
if "users" in existing:
    src_users = {u["email"]: u.get("user_id") for u in src.users.find({}, {"email": 1, "user_id": 1})}
    clashes = [u["email"] for u in tgt.users.find({"email": {"$in": list(src_users)}}, {"email": 1, "user_id": 1})
               if src_users.get(u["email"]) != u.get("user_id")]
    print(f"Email clashes (same email, different account): {len(clashes)}", clashes[:20])

for name in sorted(src.list_collection_names()):
    col = src[name]
    total = col.count_documents({})
    if not APPLY:
        print(f"  {name}: {total} docs")
        continue
    copied, ops = 0, []
    for doc in col.find({}):
        ops.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
        if len(ops) >= BATCH:
            tgt[name].bulk_write(ops, ordered=False)
            copied += len(ops)
            ops = []
    if ops:
        tgt[name].bulk_write(ops, ordered=False)
        copied += len(ops)
    if name not in existing and not total:
        tgt.create_collection(name)
    for idx_name, info in col.index_information().items():
        if idx_name == "_id_":
            continue
        opts = {k: v for k, v in info.items() if k not in ("key", "v", "ns")}
        tgt[name].create_index(info["key"], name=idx_name, **opts)
    print(f"  {name}: copied {copied}/{total}, Atlas now has {tgt[name].count_documents({})}")

if APPLY:
    bad = [n for n in src.list_collection_names() if tgt[n].count_documents({}) < src[n].count_documents({})]
    print("VERIFY:", "all collections copied" if not bad else f"short collections: {bad}")
