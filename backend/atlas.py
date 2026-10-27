"""Connection string for the shared MongoDB Atlas database used by both the web and the mobile app."""
from urllib.parse import quote_plus, urlsplit, urlunsplit


def shared_mongo_url(env) -> str:
    """SHARED_MONGO_URL with SHARED_MONGO_USER / SHARED_MONGO_PASSWORD filled in (URL-encoded) when both are set."""
    url = env["SHARED_MONGO_URL"]
    user, pw = env.get("SHARED_MONGO_USER"), env.get("SHARED_MONGO_PASSWORD")
    if not (user and pw):
        return url
    p = urlsplit(url)
    host = p.netloc.rsplit("@", 1)[-1]
    return urlunsplit((p.scheme, f"{quote_plus(user.strip())}:{quote_plus(pw.strip())}@{host}", p.path, p.query, p.fragment))
