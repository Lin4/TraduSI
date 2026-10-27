"""Copy every collection + document (and indexes) from MONGO_URL/DB_NAME into SHARED_MONGO_URL/SHARED_DB_NAME.

Safe to re-run: documents are upserted by _id, so nothing is duplicated and source data is never modified.
Usage:  python scripts/migrate_to_atlas.py            -> dry run (counts + conflicts only)
        python scripts/migrate_to_atlas.py --apply    -> copy
"""
import sys
from pathlib import Path

from dotenv import dotenv_values
from pymongo import MongoClient, ReplaceOne

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from atlas import shared_mongo_url  # noqa: E402

env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
APPLY = "--apply" in sys.argv
BATCH = 500
NATURAL_KEYS = {"iv_history": ("ticker", "date"), "picks": ("key",)}

src = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
tgt = MongoClient(shared_mongo_url(env), serverSelectionTimeoutMS=20000)[env["SHARED_DB_NAME"]]

existing = set(tgt.list_collection_names())
print(f"{'APPLY' if APPLY else 'DRY RUN'}: {env['DB_NAME']} -> Atlas '{env['SHARED_DB_NAME']}'")
print("Collections already in Atlas:", {c: tgt[c].estimated_document_count() for c in sorted(existing)} or "none")

# Same email registered in both databases under different accounts would break login, so report it.
clashes = []
if "users" in existing:
    src_users = {u["email"]: u.get("user_id") for u in src.users.find({}, {"email": 1, "user_id": 1})}
    clashes = [u["email"] for u in tgt.users.find({"email": {"$in": list(src_users)}}, {"email": 1, "user_id": 1})
               if src_users.get(u["email"]) != u.get("user_id")]
    print(f"Email clashes (same email, different account): {len(clashes)}", clashes[:20])

    if APPLY and clashes:
        # Local account wins: drop the Atlas record with the same email (e.g. a password-less Google sign-in record)
        # and move that record's sign-in sessions to the local account so the web app stays signed in.
        for u in src.users.find({"email": {"$in": clashes}}, {"email": 1, "user_id": 1}):
            old_ids = [d["user_id"] for d in tgt.users.find({"email": u["email"], "_id": {"$ne": u["_id"]}}, {"user_id": 1})]
            r = tgt.users.delete_many({"email": u["email"], "_id": {"$ne": u["_id"]}})
            s = tgt.user_sessions.update_many({"user_id": {"$in": old_ids}}, {"$set": {"user_id": u["user_id"]}})
            print(f"  replaced Atlas record(s) for {u['email']}: removed {r.deleted_count}, sessions moved {s.modified_count}")

for name in sorted(src.list_collection_names()):
    col = src[name]
    total = col.count_documents({})
    if not APPLY:
        print(f"  {name}: {total} docs")
        continue
    copied, ops = 0, []
    natural = NATURAL_KEYS.get(name)
    for doc in col.find({}):
        if natural:  # match on the real key so the same day/pick isn't stored twice under different _ids
            body = {k: v for k, v in doc.items() if k != "_id"}
            ops.append(ReplaceOne({k: doc.get(k) for k in natural}, body, upsert=True))
        else:
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
        try:
            tgt[name].create_index(info["key"], name=idx_name, **opts)
        except Exception as e:  # an index the web app already created with other options; data is unaffected
            print(f"    index {idx_name} skipped: {getattr(e, 'code', '')} {str(e)[:120]}")
    print(f"  {name}: copied {copied}/{total}, Atlas now has {tgt[name].count_documents({})}")

if APPLY:
    bad = [n for n in src.list_collection_names() if tgt[n].count_documents({}) < src[n].count_documents({})]
    print("VERIFY:", "all collections copied" if not bad else f"short collections: {bad}")
