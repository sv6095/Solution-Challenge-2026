"""
worldmonitor_fetcher.py
=======================
Cron-driven background service that fetches every category of data that
worldmonitor.app exposes — conflict events, chokepoints, shipping rates,
market data, weather hazards, seismic events, maritime vessel data,
radiation readings, disease outbreaks, etc. — and caches it locally so
the Praecantator frontend can poll `/global/*` endpoints in real-time.

Architecture
------------
  • APScheduler triggers each fetcher on its own cadence.
  • Results are stored in Firestore.
  • Every route is independently resilient — failure of one source never
    blocks others.
  • All external API keys come from environment variables matching the
    worldmonitor .env.example naming convention so secrets are portable.

Data Sources (all free / no-key or free-tier)
----------------------------------------------
  Tier 0 — No key required:
    NASA EONET       → wildfires, storms, floods
    USGS             → earthquakes
    GDACS            → global disaster alerts
    OpenMeteo        → weather data
    GDELT            → geopolitical events
    OpenSky          → aircraft positions
    AIS (public)     → vessel positions
    RADON / OpenRadiation → radiation

  Tier 1 — Free API key:
    ACLED            → armed conflict events
    NewsAPI          → supply-chain news
    GNews            → regional news
    NASA FIRMS       → active fires
    Finnhub          → market quotes
    EIA              → energy prices
    FRED             → macro indicators
    OpenAQ           → air quality (requires OPENAQ_API_KEY on v3)
    AviationStack    → flight data

  Tier 2 — Optional / premium:
    AISStream        → live AIS
    Cloudflare Radar → internet outages
"""

import asyncio
import json
import logging
import os
import time
from uuid import uuid4
from threading import Lock
from datetime import datetime, timezone
from typing import Any

import httpx
from google.cloud.firestore_v1.base_query import FieldFilter

from services.firestore_store import _client, _safe_doc_id

logger = logging.getLogger(__name__)
_GDELT_RATE_LIMIT_UNTIL: float = 0.0
_READ_CACHE_TTL_SECONDS = max(30, int(os.getenv("WORLDMONITOR_READ_CACHE_SECONDS", "300")))
_READ_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_READ_CACHE_LOCK = Lock()
_READ_FETCH_LOCKS: dict[str, Lock] = {}
_READ_FETCH_LOCKS_LOCK = Lock()
_REDIS_CLIENT: Any | None = None
_REDIS_CLIENT_LOCK = Lock()
_REDIS_CACHE_PREFIX = "worldmonitor:cache:"
_REDIS_LOCK_PREFIX = "worldmonitor:lock:"
_REDIS_LOCK_TTL_SECONDS = max(2, int(os.getenv("WORLDMONITOR_REDIS_LOCK_SECONDS", "10")))
_REDIS_LOCK_WAIT_SECONDS = max(0.2, float(os.getenv("WORLDMONITOR_REDIS_LOCK_WAIT_SECONDS", "3")))

# ── API keys from environment (worldmonitor conventions) ─────────────────────

ACLED_API_KEY    = os.getenv("ACLED_API_KEY", "")
ACLED_EMAIL      = os.getenv("ACLED_EMAIL", "")
ACLED_PASSWORD   = os.getenv("ACLED_PASSWORD", "")
ACLED_ACCESS_TOKEN = os.getenv("ACLED_ACCESS_TOKEN", "")
NEWSAPI_KEY      = os.getenv("NEWSAPI_API_KEY", os.getenv("NEWSAPI_KEY", ""))
GNEWS_KEY        = os.getenv("GNEWS_API_KEY", "")
NASA_FIRMS_KEY   = os.getenv("NASA_FIRMS_MAP_KEY", os.getenv("NASA_FIRMS_API_KEY", ""))
FINNHUB_KEY      = os.getenv("FINNHUB_API_KEY", "")
EIA_KEY          = os.getenv("EIA_API_KEY", "")
FRED_KEY         = os.getenv("FRED_API_KEY", "")
OPENAQ_KEY       = os.getenv("OPENAQ_API_KEY", "")
AVIATION_KEY     = os.getenv("AVIATIONSTACK_API", "")
CLOUDFLARE_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN", "")
AISSTREAM_KEY    = os.getenv("AISSTREAM_API_KEY", "")
GROQ_KEY         = os.getenv("GROQ_API_KEY", "")

PORTWATCH_TRANSIT_URL = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/"
    "Daily_Chokepoints_Data/FeatureServer/0/query"
)

# ── Canonical chokepoints (worldmonitor chokepoint-registry.ts) ───────────────

CHOKEPOINTS = [
    {"id": "suez",              "name": "Suez Canal",           "lng": 32.3,   "lat": 30.5,   "traffic_pct": 12, "category": "trade",          "portwatch_name": "Suez Canal"},
    {"id": "malacca_strait",    "name": "Strait of Malacca",    "lng": 101.5,  "lat": 2.5,    "traffic_pct": 30, "category": "trade",          "portwatch_name": "Malacca Strait"},
    {"id": "hormuz_strait",     "name": "Strait of Hormuz",     "lng": 56.5,   "lat": 26.5,   "traffic_pct": 22, "category": "oil",            "portwatch_name": "Strait of Hormuz"},
    {"id": "bab_el_mandeb",     "name": "Bab el-Mandeb",        "lng": 43.3,   "lat": 12.5,   "traffic_pct": 9,  "category": "oil",            "portwatch_name": "Bab el-Mandeb Strait"},
    {"id": "panama",            "name": "Panama Canal",         "lng": -79.7,  "lat": 9.1,    "traffic_pct": 5,  "category": "trade",          "portwatch_name": "Panama Canal"},
    {"id": "taiwan_strait",     "name": "Taiwan Strait",        "lng": 119.5,  "lat": 24.0,   "traffic_pct": 48, "category": "semiconductors", "portwatch_name": "Taiwan Strait"},
    {"id": "cape_of_good_hope", "name": "Cape of Good Hope",    "lng": 18.49,  "lat": -34.36, "traffic_pct": 6,  "category": "trade",          "portwatch_name": "Cape of Good Hope"},
    {"id": "gibraltar",         "name": "Strait of Gibraltar",  "lng": -5.6,   "lat": 35.9,   "traffic_pct": 8,  "category": "trade",          "portwatch_name": "Gibraltar Strait"},
    {"id": "bosphorus",         "name": "Bosporus Strait",      "lng": 29.0,   "lat": 41.1,   "traffic_pct": 3,  "category": "oil",            "portwatch_name": "Bosporus Strait"},
    {"id": "korea_strait",      "name": "Korea Strait",         "lng": 129.0,  "lat": 34.0,   "traffic_pct": 4,  "category": "trade",          "portwatch_name": "Korea Strait"},
    {"id": "dover_strait",      "name": "Dover Strait",         "lng": 1.5,    "lat": 51.0,   "traffic_pct": 8,  "category": "trade",          "portwatch_name": "Dover Strait"},
    {"id": "kerch_strait",      "name": "Kerch Strait",         "lng": 36.6,   "lat": 45.3,   "traffic_pct": 2,  "category": "trade",          "portwatch_name": "Kerch Strait"},
    {"id": "lombok_strait",     "name": "Lombok Strait",        "lng": 115.7,  "lat": -8.5,   "traffic_pct": 4,  "category": "oil",            "portwatch_name": "Lombok Strait"},
]

# ── Shipping indices (worldmonitor tracks these) ──────────────────────────────

SHIPPING_INDICES = [
    {"id": "SCFI",  "name": "Shanghai Container Freight Index", "unit": "USD/TEU"},
    {"id": "BDI",   "name": "Baltic Dry Index",                 "unit": "points"},
    {"id": "BDTI",  "name": "Baltic Dirty Tanker Index",        "unit": "points"},
    {"id": "HRSY",  "name": "Harpex Shipping",                  "unit": "USD/box"},
    {"id": "WCI",   "name": "Drewry World Container Index",     "unit": "USD/40ft"},
]

# ── Critical minerals (worldmonitor static reference) ─────────────────────────

CRITICAL_MINERALS = [
    {"id": "cobalt",   "name": "Cobalt",   "primary_producer": "DRC",    "share_pct": 70},
    {"id": "lithium",  "name": "Lithium",  "primary_producer": "Chile",  "share_pct": 26},
    {"id": "rare_earth","name": "Rare Earths","primary_producer": "China","share_pct": 85},
    {"id": "nickel",   "name": "Nickel",   "primary_producer": "Indonesia","share_pct": 37},
    {"id": "copper",   "name": "Copper",   "primary_producer": "Chile",  "share_pct": 28},
    {"id": "graphite", "name": "Graphite", "primary_producer": "China",  "share_pct": 79},
]
_WORLDMONITOR_BUNDLE_KEY = "worldmonitor_bundle_snapshot_v1"

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def _db_upsert(table: str, key: str, data: Any) -> None:
    """Store JSON payload keyed by name in Firestore."""
    fetched_at = datetime.now(timezone.utc).isoformat()
    _client().collection("worldmonitor_cache").document(_safe_doc_id(key)).set({
        "key": key,
        "table_name": table,
        "payload": data,
        "fetched_at": fetched_at,
    }, merge=True)
    payload = {"data": data, "fetched_at": fetched_at}
    _set_l1_cache(key, payload)
    _redis_set_payload(key, payload)


def _set_l1_cache(key: str, payload: dict[str, Any]) -> None:
    with _READ_CACHE_LOCK:
        _READ_CACHE[key] = (time.monotonic() + _READ_CACHE_TTL_SECONDS, payload)


def _get_l1_cache(key: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    now = time.monotonic()
    with _READ_CACHE_LOCK:
        cached = _READ_CACHE.get(key)
        if not cached:
            return None, None
        payload = cached[1]
        stale = payload if isinstance(payload, dict) else None
        if cached[0] > now:
            return stale, stale
        return None, stale


def _redis_client() -> Any | None:
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT
    with _REDIS_CLIENT_LOCK:
        if _REDIS_CLIENT is not None:
            return _REDIS_CLIENT
        try:
            from redis import Redis

            _REDIS_CLIENT = Redis.from_url(
                os.getenv("REDIS_URL", "redis://localhost:6379/0"),
                decode_responses=True,
                socket_connect_timeout=1.0,
                socket_timeout=2.0,
            )
            _REDIS_CLIENT.ping()
            return _REDIS_CLIENT
        except Exception:
            _REDIS_CLIENT = None
            return None


def _redis_cache_key(key: str) -> str:
    return f"{_REDIS_CACHE_PREFIX}{key}"


def _redis_lock_key(key: str) -> str:
    return f"{_REDIS_LOCK_PREFIX}{key}"


def _redis_get_payload(key: str) -> dict[str, Any] | None:
    client = _redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_redis_cache_key(key))
        if not raw:
            return None
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return None
    except Exception:
        return None


def _redis_set_payload(key: str, payload: dict[str, Any]) -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        client.set(_redis_cache_key(key), json.dumps(payload), ex=_READ_CACHE_TTL_SECONDS)
    except Exception:
        pass


def _redis_get_many_payloads(keys: list[str]) -> dict[str, dict[str, Any]]:
    client = _redis_client()
    if client is None or not keys:
        return {}
    try:
        raw_values = client.mget([_redis_cache_key(key) for key in keys])
    except Exception:
        return {}
    rows: dict[str, dict[str, Any]] = {}
    for key, raw in zip(keys, raw_values):
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        if isinstance(parsed, dict):
            rows[key] = parsed
    return rows


def _redis_acquire_lock(key: str) -> tuple[Any | None, str | None]:
    client = _redis_client()
    if client is None:
        return None, None
    token = uuid4().hex
    try:
        acquired = client.set(
            _redis_lock_key(key),
            token,
            nx=True,
            ex=_REDIS_LOCK_TTL_SECONDS,
        )
        if acquired:
            return client, token
        return client, None
    except Exception:
        return None, None


def _redis_release_lock(client: Any, key: str, token: str) -> None:
    try:
        client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then "
            "return redis.call('del', KEYS[1]) else return 0 end",
            1,
            _redis_lock_key(key),
            token,
        )
    except Exception:
        pass


def _read_from_firestore(key: str) -> dict[str, Any] | None:
    doc = _client().collection("worldmonitor_cache").document(_safe_doc_id(key)).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    return {"data": data.get("payload"), "fetched_at": data.get("fetched_at")}


def _lock_for_key(key: str) -> Lock:
    with _READ_FETCH_LOCKS_LOCK:
        lock = _READ_FETCH_LOCKS.get(key)
        if lock is None:
            lock = Lock()
            _READ_FETCH_LOCKS[key] = lock
        return lock


def db_read(key: str) -> Any | None:
    """Read a cached payload. Returns None if not found."""
    fresh, stale_payload = _get_l1_cache(key)
    if fresh is not None:
        return fresh

    redis_payload = _redis_get_payload(key)
    if redis_payload is not None:
        _set_l1_cache(key, redis_payload)
        return redis_payload

    lock = _lock_for_key(key)
    with lock:
        fresh, stale_payload = _get_l1_cache(key)
        if fresh is not None:
            return fresh
        redis_payload = _redis_get_payload(key)
        if redis_payload is not None:
            _set_l1_cache(key, redis_payload)
            return redis_payload

        client, lock_token = _redis_acquire_lock(key)
        if client is not None and lock_token is None:
            deadline = time.monotonic() + _REDIS_LOCK_WAIT_SECONDS
            while time.monotonic() < deadline:
                time.sleep(0.1)
                redis_payload = _redis_get_payload(key)
                if redis_payload is not None:
                    _set_l1_cache(key, redis_payload)
                    return redis_payload

        try:
            payload = _read_from_firestore(key)
            if payload is None:
                return stale_payload
            _set_l1_cache(key, payload)
            _redis_set_payload(key, payload)
            return payload
        except Exception:
            # If Firestore read fails, serve last known payload instead of dropping data to empty.
            return stale_payload
        finally:
            if client is not None and lock_token:
                _redis_release_lock(client, key, lock_token)


def db_read_all_by_table(table: str) -> list[dict]:
    """Read all records for a given table name."""
    try:
        rows = (
            _client()
            .collection("worldmonitor_cache")
            .where(filter=FieldFilter("table_name", "==", table))
            .stream()
        )
        result: list[dict] = []
        for doc in rows:
            payload = doc.to_dict() or {}
            result.append({
                "key": payload.get("key"),
                "data": payload.get("payload"),
                "fetched_at": payload.get("fetched_at"),
            })
        return result
    except Exception:
        return []


def db_read_many(keys: list[str]) -> dict[str, dict[str, Any] | None]:
    """
    Read multiple cached payloads with a single Firestore round-trip when possible.
    Falls back to per-key reads for local SQLite or unsupported clients.
    """
    result: dict[str, dict[str, Any] | None] = {}
    stale_payloads: dict[str, dict[str, Any]] = {}
    misses: list[str] = []

    for key in keys:
        fresh, stale = _get_l1_cache(key)
        if stale is not None:
            stale_payloads[key] = stale
        if fresh is not None:
            result[key] = fresh
            continue
        misses.append(key)

    if not misses:
        return result

    redis_rows = _redis_get_many_payloads(misses)
    for key, payload in redis_rows.items():
        result[key] = payload
        _set_l1_cache(key, payload)
    misses = [key for key in misses if key not in redis_rows]
    if not misses:
        return result

    client = _client()
    try:
        if hasattr(client, "get_all"):
            refs = [client.collection("worldmonitor_cache").document(_safe_doc_id(key)) for key in misses]
            docs = list(client.get_all(refs))
            for key, doc in zip(misses, docs):
                if not doc.exists:
                    result[key] = stale_payloads.get(key)
                    continue
                data = doc.to_dict() or {}
                payload = {"data": data.get("payload"), "fetched_at": data.get("fetched_at")}
                result[key] = payload
                _set_l1_cache(key, payload)
                _redis_set_payload(key, payload)
        else:
            for key in misses:
                result[key] = db_read(key)
    except Exception:
        for key in misses:
            result[key] = stale_payloads.get(key)

    for key in keys:
        result.setdefault(key, stale_payloads.get(key))
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Individual fetchers — each matches a worldmonitor data panel
# ─────────────────────────────────────────────────────────────────────────────

async def _safe_get(client: httpx.AsyncClient, url: str, **kwargs) -> dict | list | None:
    """Fetch JSON; return None on HTTP errors, empty body, or non-JSON payloads."""
    try:
        resp = await client.get(url, timeout=15, follow_redirects=True, **kwargs)
        if resp.status_code != 200:
            logger.warning("[worldmonitor] GET %s HTTP %s", url, resp.status_code)
            return None
        raw = (resp.content or b"").strip()
        if not raw:
            logger.warning("[worldmonitor] GET %s empty body (status 200)", url)
            return None
        try:
            parsed: dict | list = json.loads(raw)
            return parsed
        except json.JSONDecodeError as e:
            preview = raw[:240].decode("utf-8", errors="replace").replace("\n", " ")
            logger.warning(
                "[worldmonitor] GET %s non-JSON (%s); preview: %r",
                url,
                e,
                preview,
            )
            return None
    except Exception as e:
        logger.warning("[worldmonitor] GET %s failed: %s", url, e)
    return None


# ── Natural Hazards (NASA EONET) ──────────────────────────────────────────────

async def fetch_eonet():
    """NASA EONET — wildfires, storms, floods, volcanic activity."""
    async with httpx.AsyncClient() as c:
        data = await _safe_get(c, "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50&days=7")
    if not data:
        return
    events = []
    for ev in data.get("events", []):
        geo = ev.get("geometry", [{}])
        lat = lng = None
        if geo:
            coords = geo[-1].get("coordinates", [])
            if coords:
                lng, lat = coords[0], coords[1]
        events.append({
            "id": ev.get("id"),
            "title": ev.get("title"),
            "category": ev.get("categories", [{}])[0].get("title", "Natural"),
            "source": "NASA EONET",
            "lng": lng, "lat": lat,
            "time": ev.get("geometry", [{}])[-1].get("date") if ev.get("geometry") else None,
            "severity": "HIGH" if any(k in str(ev.get("title","")).upper() for k in ["FIRE","HURRICANE","TYPHOON","CYCLONE","EARTHQUAKE"]) else "MEDIUM",
        })
    _db_upsert("natural_hazards", "eonet_events", events)
    logger.info(f"[worldmonitor] EONET: {len(events)} events cached")


# ── Earthquakes (USGS) ────────────────────────────────────────────────────────

async def fetch_earthquakes():
    """USGS earthquake feed — M4.5+ worldwide, last 7 days."""
    async with httpx.AsyncClient() as c:
        data = await _safe_get(c, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson")
    if not data:
        return
    quakes = []
    for feat in data.get("features", [])[:40]:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [])
        mag = props.get("mag", 0)
        quakes.append({
            "id": feat.get("id"),
            "title": props.get("title", "Earthquake"),
            "lng": coords[0] if coords else None,
            "lat": coords[1] if coords else None,
            "magnitude": mag,
            "depth_km": coords[2] if len(coords) > 2 else None,
            "place": props.get("place"),
            "time": props.get("time"),
            "url": props.get("url"),
            "severity": "CRITICAL" if mag >= 7 else "HIGH" if mag >= 6 else "MEDIUM",
            "source": "USGS",
        })
    _db_upsert("earthquakes", "usgs_earthquakes", quakes)
    logger.info(f"[worldmonitor] USGS: {len(quakes)} earthquakes cached")


# ── Global Disaster Alerts (GDACS) ───────────────────────────────────────────

async def fetch_gdacs():
    """GDACS — multi-hazard global disaster alert system (RSS)."""
    async with httpx.AsyncClient() as c:
        data = await _safe_get(c, "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtype=ALL&fromDate=&toDate=&alertlevel=&country=&limit=50")
    if not data:
        return
    alerts = []
    for ev in (data.get("features") or [])[:40]:
        props = ev.get("properties", {})
        coords = ev.get("geometry", {}).get("coordinates", [])
        alerts.append({
            "id": str(props.get("eventid")),
            "title": props.get("name"),
            "type": props.get("eventtype"),
            "severity": str(props.get("alertlevel", "GREEN")).upper(),
            "country": props.get("country"),
            "lat": coords[1] if len(coords) > 1 else None,
            "lng": coords[0] if coords else None,
            "url": props.get("url", {}).get("report") if isinstance(props.get("url"), dict) else None,
            "source": "GDACS",
        })
    _db_upsert("gdacs", "gdacs_alerts", alerts)
    logger.info(f"[worldmonitor] GDACS: {len(alerts)} alerts cached")


# ── Active Fires (NASA FIRMS) ─────────────────────────────────────────────────

async def fetch_active_fires():
    """NASA FIRMS — satellite fire detections (last 24h)."""
    if not NASA_FIRMS_KEY:
        return
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/json/{NASA_FIRMS_KEY}/MODIS_NRT/world/1"
    async with httpx.AsyncClient() as c:
        data = await _safe_get(c, url)
    if not data or not isinstance(data, list):
        return
    fires = [{"lat": f.get("latitude"), "lng": f.get("longitude"),
               "brightness": f.get("brightness"), "acq_date": f.get("acq_date"),
               "confidence": f.get("confidence"), "source": "NASA FIRMS"} for f in data[:200]]
    _db_upsert("fires", "firms_fires", fires)
    logger.info(f"[worldmonitor] FIRMS: {len(fires)} fire detections cached")


# ── Armed Conflict (ACLED) ────────────────────────────────────────────────────

async def _fetch_acled_access_token(client: httpx.AsyncClient) -> str:
    if ACLED_ACCESS_TOKEN:
        return ACLED_ACCESS_TOKEN
    if not ACLED_EMAIL or not ACLED_PASSWORD:
        return ""
    try:
        resp = await client.post(
            "https://acleddata.com/oauth/token",
            data={"email": ACLED_EMAIL, "password": ACLED_PASSWORD},
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return ""
    return str(
        payload.get("access_token")
        or payload.get("token")
        or payload.get("data", {}).get("access_token")
        or ""
    ).strip()


async def fetch_conflict_events():
    """ACLED — armed conflict & protest events (current month, OAuth or legacy key)."""
    if not ((ACLED_EMAIL and ACLED_PASSWORD) or (ACLED_API_KEY and ACLED_EMAIL) or ACLED_ACCESS_TOKEN):
        return
    now = datetime.now(timezone.utc)
    params = {
        "event_type": "Battles|Violence against civilians|Protests|Riots",
        "event_date": f"{now.strftime('%Y-%m-01')}|{now.strftime('%Y-%m-%d')}",
        "event_date_where": "BETWEEN",
        "limit": "100",
        "_format": "json",
    }
    headers = {"Accept": "application/json"}
    async with httpx.AsyncClient() as c:
        token = await _fetch_acled_access_token(c)
        if token:
            headers["Authorization"] = f"Bearer {token}"
            data = await _safe_get(c, "https://acleddata.com/api/acled/read", params=params, headers=headers)
        elif ACLED_API_KEY and ACLED_EMAIL:
            params["key"] = ACLED_API_KEY
            params["email"] = ACLED_EMAIL
            data = await _safe_get(c, "https://api.acleddata.com/acled/read/", params=params, headers=headers)
        else:
            return
    if not data:
        return
    events = []
    for ev in (data.get("data") or []):
        try:
            lat = float(ev.get("latitude", 0) or 0)
            lng = float(ev.get("longitude", 0) or 0)
        except (TypeError, ValueError):
            lat, lng = 0.0, 0.0
        events.append({
            "id": ev.get("event_id_cnty"),
            "date": ev.get("event_date"),
            "type": ev.get("event_type"),
            "country": ev.get("country"),
            "region": ev.get("admin1"),
            "lat": lat,
            "lng": lng,
            "fatalities": int(ev.get("fatalities", 0) or 0),
            "notes": str(ev.get("notes", ""))[:300],
            "source": "ACLED",
        })
    _db_upsert("conflict", "acled_events", events)
    logger.info(f"[worldmonitor] ACLED: {len(events)} conflict events cached")


# ── Geopolitical Events (GDELT) ───────────────────────────────────────────────

async def fetch_gdelt():
    """GDELT — global event database, supply chain relevant."""
    global _GDELT_RATE_LIMIT_UNTIL
    now_ts = time.monotonic()
    if now_ts < _GDELT_RATE_LIMIT_UNTIL:
        logger.info("[worldmonitor] GDELT skipped: in rate-limit cooldown")
        return

    # ArtList mode often rejects OR-compound queries with a non-JSON error body; keep a single broad phrase.
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc?"
        "query=supply+chain"
        "&mode=ArtList&maxrecords=20&format=json&timespan=24h"
    )
    async with httpx.AsyncClient() as c:
        resp = await c.get(url, timeout=15, follow_redirects=True)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After") or 1800)
            _GDELT_RATE_LIMIT_UNTIL = now_ts + max(300, retry_after)
            logger.warning("[worldmonitor] GDELT rate-limited (429). Cooling down for %ss", max(300, retry_after))
            return
        if resp.status_code != 200:
            logger.warning("[worldmonitor] GDELT HTTP %s", resp.status_code)
            return
        try:
            data = resp.json()
        except Exception:
            logger.warning("[worldmonitor] GDELT returned non-JSON payload")
            return

    articles = []
    for art in (data.get("articles") or [] if data else [])[:30]:
        articles.append({
            "title": art.get("title"), "url": art.get("url"),
            "source": art.get("domain"), "seendate": art.get("seendate"),
            "country": art.get("sourcecountry"),
            "lang": art.get("language"),
            "event_type": "geopolitical",
        })
    _db_upsert("gdelt", "gdelt_events", articles)
    logger.info(f"[worldmonitor] GDELT: {len(articles)} events cached")


# ── Supply Chain News (NewsAPI) ───────────────────────────────────────────────

async def fetch_supply_chain_news():
    """NewsAPI primary, GNews fallback — supply chain disruption headlines."""
    articles: list[dict] = []
    query = "supply chain OR chokepoint OR shipping disruption OR port congestion"
    async with httpx.AsyncClient() as c:
        if NEWSAPI_KEY:
            url = (
                f"https://newsapi.org/v2/everything?"
                f"q=supply+chain+OR+chokepoint+OR+shipping+disruption+OR+port+congestion"
                f"&language=en&sortBy=publishedAt&pageSize=30"
                f"&apiKey={NEWSAPI_KEY}"
            )
            data = await _safe_get(c, url)
            for art in (data.get("articles") or [] if data else [])[:30]:
                if not art.get("url") or "[Removed]" in str(art.get("title", "")):
                    continue
                articles.append({
                    "id": art.get("url"),
                    "title": art.get("title"),
                    "description": art.get("description", "")[:200] if art.get("description") else "",
                    "url": art.get("url"),
                    "source": art.get("source", {}).get("name"),
                    "publishedAt": art.get("publishedAt"),
                    "category": "supply_chain",
                })
        if len(articles) < 5 and GNEWS_KEY:
            gnews_url = (
                "https://gnews.io/api/v4/search?"
                f"q={query.replace(' ', '%20')}&lang=en&max=20&apikey={GNEWS_KEY}"
            )
            data = await _safe_get(c, gnews_url)
            for art in (data.get("articles") or [] if data else [])[:20]:
                if not art.get("url"):
                    continue
                articles.append({
                    "id": art.get("url"),
                    "title": art.get("title"),
                    "description": str(art.get("description", ""))[:200],
                    "url": art.get("url"),
                    "source": art.get("source", {}).get("name") if isinstance(art.get("source"), dict) else art.get("source"),
                    "publishedAt": art.get("publishedAt"),
                    "category": "supply_chain",
                })
    if articles:
        _db_upsert("news", "newsapi_supply_chain", articles[:30])
        logger.info(f"[worldmonitor] Supply-chain news: {len(articles[:30])} articles cached")


# ── Market Data (Finnhub) ─────────────────────────────────────────────────────

async def fetch_market_quotes():
    """Finnhub — equity quotes for supply-chain bellwether tickers."""
    if not FINNHUB_KEY:
        return
    tickers = ["MAERSK-B.CO", "ZIM", "DSV.CO", "FDX", "UPS", "XOM", "CVX", "BHP", "AA", "NVDA", "APPL", "AMZN"]
    quotes = []
    async with httpx.AsyncClient() as c:
        for sym in tickers:
            url = f"https://finnhub.io/api/v1/quote?symbol={sym}&token={FINNHUB_KEY}"
            d = await _safe_get(c, url)
            if d and d.get("c"):
                quotes.append({
                    "symbol": sym, "price": d.get("c"), "change": d.get("d"),
                    "change_pct": d.get("dp"), "high": d.get("h"), "low": d.get("l"),
                    "open": d.get("o"), "prev_close": d.get("pc"),
                    "time": datetime.now(timezone.utc).isoformat(),
                })
    if quotes:
        _db_upsert("market", "finnhub_quotes", quotes)
        logger.info(f"[worldmonitor] Finnhub: {len(quotes)} quotes cached")


# ── Energy Prices (EIA) ───────────────────────────────────────────────────────

async def fetch_energy_prices():
    """EIA — US crude/natgas; GIE AGSI — EU gas storage (free, no key)."""
    result: dict[str, Any] = {}
    async with httpx.AsyncClient() as c:
        if EIA_KEY:
            datasets = {
                "crude_inventory": f"https://api.eia.gov/v2/petroleum/sum/sndw/data/?frequency=weekly&data[0]=value&facets[series][]=WCESTUS1&offset=0&length=4&api_key={EIA_KEY}",
                "natgas_storage": f"https://api.eia.gov/v2/natural-gas/stor/wkly/data/?frequency=weekly&data[0]=value&facets[series][]=NW2_EPG0_SWO_R48_BCF&offset=0&length=4&api_key={EIA_KEY}",
            }
            for key, url in datasets.items():
                d = await _safe_get(c, url)
                if d:
                    result[key] = (d.get("response", {}).get("data") or [])[:4]
        # GIE AGSI — EU aggregate gas storage fill % (public API)
        agsi = await _safe_get(
            c,
            "https://agsi.gie.eu/api",
            params={"from": (datetime.now(timezone.utc).strftime("%Y-%m-%d")), "size": 1, "country": "eu"},
        )
        if agsi and agsi.get("data"):
            latest = agsi["data"][0]
            result["eu_gas_storage"] = {
                "full": latest.get("full"),
                "trend": latest.get("trend"),
                "date": latest.get("gasDayStart"),
            }
    if result:
        _db_upsert("energy", "eia_energy", result)
        logger.info(f"[worldmonitor] Energy: {list(result.keys())} cached")


# ── Macro Indicators (FRED) ───────────────────────────────────────────────────

async def fetch_macro():
    """FRED — macro stress panel series (matches worldmonitor bootstrap macroSignals)."""
    if not FRED_KEY:
        return
    # Keys match NetworkView MacroStress panel expectations
    series = {
        "VIX": "VIXCLS",
        "FEDFUNDS": "FEDFUNDS",
        "T10Y2Y": "T10Y2Y",
        "UNRATE": "UNRATE",
        "CPI": "CPIAUCSL",
        "PPI": "PPIACO",
    }
    result = {}
    async with httpx.AsyncClient() as c:
        for label, sid in series.items():
            url = f"https://api.stlouisfed.org/fred/series/observations?series_id={sid}&limit=2&sort_order=desc&api_key={FRED_KEY}&file_type=json"
            d = await _safe_get(c, url)
            if d:
                obs = d.get("observations", [])
                if obs:
                    result[label] = {"value": obs[0].get("value"), "date": obs[0].get("date")}
    if result:
        _db_upsert("macro", "fred_macro", result)
        logger.info(f"[worldmonitor] FRED: {len(result)} macro series cached")


# ── Air Quality (OpenAQ) ──────────────────────────────────────────────────────

async def fetch_air_quality():
    """OpenAQ — air quality for major port cities."""
    if not OPENAQ_KEY:
        return
    port_cities = ["Shanghai", "Rotterdam", "Singapore", "Shenzhen", "Dubai", "Houston", "Mumbai", "Lagos"]
    results = []
    headers = {"X-API-Key": OPENAQ_KEY}
    async with httpx.AsyncClient(headers=headers) as c:
        for city in port_cities[:5]:
            url = f"https://api.openaq.org/v3/locations?city={city}&limit=1&parameters_id=2"
            d = await _safe_get(c, url)
            if d and d.get("results"):
                loc = d["results"][0]
                results.append({
                    "city": city, "location": loc.get("name"),
                    "lat": loc.get("coordinates", {}).get("latitude"),
                    "lng": loc.get("coordinates", {}).get("longitude"),
                    "country": loc.get("country", {}).get("name"),
                })
    if results:
        _db_upsert("air_quality", "openaq_cities", results)
        logger.info(f"[worldmonitor] OpenAQ: {len(results)} cities cached")


# ── Aviation Intelligence (AviationStack) ────────────────────────────────────

async def fetch_aviation():
    """AviationStack — live flight data for key cargo hubs."""
    if not AVIATION_KEY:
        return
    # Focus on major cargo airports
    airports = ["DXB", "HKG", "ICN", "FRA", "AMS"]
    result = []
    async with httpx.AsyncClient() as c:
        for iata in airports[:3]:  # limit to 3 to preserve free-tier quota
            url = f"http://api.aviationstack.com/v1/flights?access_key={AVIATION_KEY}&dep_iata={iata}&flight_status=active&limit=5"
            d = await _safe_get(c, url)
            if d and d.get("data"):
                for fl in d["data"][:5]:
                    result.append({
                        "flight_iata": fl.get("flight", {}).get("iata"),
                        "airline": fl.get("airline", {}).get("name"),
                        "departure": iata,
                        "arrival": fl.get("arrival", {}).get("iata"),
                        "status": fl.get("flight_status"),
                        "departure_time": fl.get("departure", {}).get("actual"),
                    })
    if result:
        _db_upsert("aviation", "aviationstack_flights", result)
        logger.info(f"[worldmonitor] AviationStack: {len(result)} flights cached")


# ── PortWatch transit data (IMF — free ArcGIS, no key) ───────────────────────

def _arcgis_timestamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


async def fetch_portwatch_transits():
    """IMF PortWatch — per-chokepoint week-over-week transit deltas."""
    since_sql = _arcgis_timestamp(
        datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - (14 * 86_400), tz=timezone.utc)
    )
    metrics: dict[str, dict] = {}
    async with httpx.AsyncClient() as c:
        for cp in CHOKEPOINTS:
            name = cp.get("portwatch_name") or cp["name"]
            escaped = name.replace("'", "''")
            data = await _safe_get(
                c,
                PORTWATCH_TRANSIT_URL,
                params={
                    "where": f"portname='{escaped}' AND date >= timestamp '{since_sql}'",
                    "outFields": "date,n_total",
                    "orderByFields": "date ASC",
                    "resultRecordCount": "2000",
                    "f": "json",
                },
            )
            features = (data or {}).get("features") or []
            if len(features) < 8:
                continue
            totals = [float((f.get("attributes") or {}).get("n_total") or 0) for f in features]
            this_week = sum(totals[-7:])
            prev_week = sum(totals[-14:-7])
            wow = ((this_week - prev_week) / prev_week * 100.0) if prev_week > 0 else 0.0
            metrics[cp["id"]] = {
                "wow_change_pct": round(wow, 1),
                "latest_transit_count": round(totals[-1]),
                "portwatch_name": name,
            }
    if metrics:
        _db_upsert("portwatch", "portwatch_transits", metrics)
        logger.info(f"[worldmonitor] PortWatch: {len(metrics)} chokepoint transit series cached")


# ── Shipping rates (FRED proxies + index metadata) ───────────────────────────

async def fetch_shipping_rates():
    """Shipping index values — FRED Brent proxy + static index registry."""
    indices = []
    fetched_at = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient() as c:
        brent_val = None
        if FRED_KEY:
            d = await _safe_get(
                c,
                f"https://api.stlouisfed.org/fred/series/observations?series_id=DCOILBRENTEU&limit=2&sort_order=desc&api_key={FRED_KEY}&file_type=json",
            )
            if d and d.get("observations"):
                brent_val = d["observations"][0].get("value")
        for idx in SHIPPING_INDICES:
            entry = {**idx, "value": None, "change_pct": None, "fetched_at": fetched_at}
            if idx["id"] == "BDTI" and brent_val:
                entry["value"] = brent_val
                entry["unit"] = "USD/bbl (Brent proxy)"
            indices.append(entry)
    payload = {
        "indices": indices,
        "fetched_at": fetched_at,
        "upstream_unavailable": len(indices) == 0,
    }
    _db_upsert("shipping_rates", "shipping_rates_v2", payload)
    logger.info(f"[worldmonitor] Shipping rates: {len(indices)} indices cached")


# ── Chokepoint Composite Risk Scorer ─────────────────────────────────────────

async def score_chokepoints():
    """
    Compute composite risk score for each chokepoint based on:
    - Proximity to recent EONET events
    - Nearby ACLED conflict density
    - GDACS alert level in region
    - Static traffic volume weight

    This mirrors worldmonitor's 'Chokepoint Status' panel logic.
    """
    # Load cached events + PortWatch transit deltas
    eonet = db_read("eonet_events")
    eonet_events = eonet["data"] if eonet else []
    acled = db_read("acled_events")
    acled_events = acled["data"] if acled else []
    portwatch = db_read("portwatch_transits")
    pw_metrics: dict = portwatch["data"] if portwatch else {}

    scored = []
    for cp in CHOKEPOINTS:
        base = cp["traffic_pct"] * 0.8  # traffic weight as baseline risk

        # Proximity scoring: count events within ~15° lat/lng box
        def nearby(ev, radius=15):
            elat = ev.get("lat")
            elng = ev.get("lng")
            if elat is None or elng is None:
                return False
            return abs(elat - cp["lat"]) < radius and abs(elng - cp["lng"]) < radius

        eonet_near = sum(1 for e in eonet_events if nearby(e)) * 5
        acled_near = sum(1 for e in acled_events if nearby(e)) * 3

        pw = pw_metrics.get(cp["id"], {})
        wow_pct = float(pw.get("wow_change_pct") or 0)
        transit_boost = min(20, int(abs(wow_pct) / 2)) if abs(wow_pct) >= 8 else 0

        # Region-specific surges (worldmonitor tracks these prominently)
        yemeni_boost = 30 if cp["id"] == "bab_el_mandeb" else 0
        taiwan_boost = 15 if cp["id"] == "taiwan_strait" else 0
        hormuz_boost = 20 if cp["id"] == "hormuz_strait" else 0

        risk = min(100, int(base + eonet_near + acled_near + transit_boost + yemeni_boost + taiwan_boost + hormuz_boost))
        trend = "up" if wow_pct <= -8 else "down" if wow_pct >= 8 else ("escalating" if risk >= 80 else "stable" if risk < 50 else "elevated")
        war_risk_tier = (
            "WAR_RISK_TIER_CRITICAL" if risk >= 80
            else "WAR_RISK_TIER_HIGH" if risk >= 65
            else "WAR_RISK_TIER_ELEVATED" if risk >= 45
            else "WAR_RISK_TIER_NORMAL"
        )

        scored.append({
            **{k: v for k, v in cp.items() if k != "portwatch_name"},
            "risk_score": risk,
            "trend": trend,
            "wow_change_pct": wow_pct,
            "war_risk_tier": war_risk_tier,
            "eonet_nearby": eonet_near // 5,
            "acled_nearby": acled_near // 3,
            "latest_transit_count": pw.get("latest_transit_count"),
            "last_scored": datetime.now(timezone.utc).isoformat(),
        })

    _db_upsert("chokepoints", "scored_chokepoints", scored)
    logger.info(f"[worldmonitor] Chokepoints scored: {[(c['id'], c['risk_score']) for c in scored]}")


# ── Country Instability Index ─────────────────────────────────────────────────

async def compute_country_instability():
    """
    Mirrors worldmonitor 'Country Instability' panel.
    Aggregates ACLED + EONET + GDACS events by country to rank instability.
    """
    country_counts: dict[str, dict] = {}

    acled = db_read("acled_events")
    for ev in (acled["data"] if acled else []):
        c = ev.get("country", "Unknown")
        if c not in country_counts:
            country_counts[c] = {"conflict": 0, "natural": 0, "fatalities": 0}
        country_counts[c]["conflict"] += 1
        try:
            country_counts[c]["fatalities"] += int(ev.get("fatalities", 0) or 0)
        except (ValueError, TypeError):
            pass

    eonet = db_read("eonet_events")
    for ev in (eonet["data"] if eonet else []):
        c = ev.get("country", "Unknown")
        if c not in country_counts:
            country_counts[c] = {"conflict": 0, "natural": 0, "fatalities": 0}
        country_counts[c]["natural"] += 1

    ranked = []
    for country, counts in country_counts.items():
        score = min(100, counts["conflict"] * 4 + counts["natural"] * 2 + (counts["fatalities"] // 10))
        ranked.append({"country": country, "instability_score": score, **counts})
    ranked.sort(key=lambda x: x["instability_score"], reverse=True)

    ranked = [r for r in ranked if r["country"] and r["country"] not in ["Unknown", "N/A"]]
    _db_upsert("country_instability", "country_instability", ranked[:50])
    logger.info(f"[worldmonitor] Country instability: top={ranked[0]['country'] if ranked else 'N/A'}")


# ── Shipping Stress Estimator ─────────────────────────────────────────────────

async def estimate_shipping_stress():
    """
    Estimates shipping stress levels — mirrors worldmonitor SupplyChainPanel.
    Uses number of active chokepoint disruptions + nearby hazard events.
    """
    scored = db_read("scored_chokepoints")
    chops = scored["data"] if scored else CHOKEPOINTS

    # Granular stress score: base level from all chokepoints + extra for high risk
    avg_risk = sum(c.get("risk_score", 0) for c in chops) / len(chops) if chops else 0
    high_risk_count = len([c for c in chops if (c.get("risk_score") or 0) >= 70])
    
    stress_score = min(100, int(avg_risk * 1.2 + high_risk_count * 12))
    stress_level = "critical" if stress_score >= 75 else "high" if stress_score >= 55 else "elevated" if stress_score >= 35 else "normal"

    carriers = [
        {"name": "Maersk",    "risk": "high" if stress_score > 70 else "medium"},
        {"name": "MSC",       "risk": "high" if stress_score > 70 else "medium"},
        {"name": "CMA CGM",   "risk": "high" if stress_score > 75 else "medium"},
        {"name": "COSCO",     "risk": "medium"},
        {"name": "Evergreen", "risk": "medium" if stress_score < 80 else "high"},
    ]

    result = {
        "stress_score": stress_score,
        "stress_level": stress_level,
        "carriers": carriers,
        "high_risk_chokepoints": [c["id"] if isinstance(c, dict) else c for c in chops if (c.get("risk_score") or 0) >= 70],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    _db_upsert("shipping_stress", "shipping_stress", result)
    logger.info(f"[worldmonitor] Shipping stress: {stress_level} ({stress_score})")


# ── Market Implications AI Summary ───────────────────────────────────────────

async def generate_market_implications():
    """
    Uses Groq (via llm_provider) to generate a brief market implications summary.
    Mirrors worldmonitor 'Market Implications' panel.
    """
    scored = db_read("scored_chokepoints")
    chops = scored["data"] if scored else []
    instability = db_read("country_instability")
    # Filter out entries where country is unknown or empty
    top_unstable = [u for u in (instability["data"] if instability else []) if u.get("country") and u.get("country") not in ["Unknown", "N/A"]]
    top_unstable = top_unstable[:3]

    high_risk_cp = [c for c in chops if c.get("risk_score", 0) >= 75]

    import json
    prompt = f"""
    Analyze the following supply chain data and provide exactly 3 bullet points of market implications.
    High Risk Chokepoints: {json.dumps(high_risk_cp)}
    Top Unstable Countries: {json.dumps(top_unstable)}
    Return ONLY a JSON array of 3 strings. 
    IMPORTANT: Do not mention countries as "unknown". Use specific names provided. If no country name is provided, focus on the chokepoints or general macro risk.
    Example: ["Point 1", "Point 2", "Point 3"]
    """

    try:
        from services.llm_provider import chat_complete
        text, provider = await chat_complete(
            prompt=prompt, 
            system="You are an expert supply chain analyst. Provide concise, actionable insights.", 
            max_tokens=250
        )
        
        start = text.find('[')
        end = text.rfind(']')
        if start != -1 and end != -1:
            implications = json.loads(text[start:end+1])
        else:
            raise ValueError("No JSON array found in LLM response")
            
        model = f"LLM ({provider})"
    except Exception as e:
        logger.error(f"[worldmonitor] LLM failed for market implications: {e}")
        # Fallback heuristic
        implications = []
        for cp in high_risk_cp[:3]:
            if cp.get("category") == "oil":
                implications.append(f"Oil price pressure: {cp['name']} risk at {cp.get('risk_score',0)}% — expect Brent +${cp.get('risk_score',70)//10}/bbl if closure exceeds 48h.")
            elif cp.get("category") == "trade":
                implications.append(f"Container rate spike risk: {cp['name']} elevated — SCFI may rise 8-15% over 3-week horizon.")
            elif cp.get("category") == "semiconductors":
                implications.append(f"Semiconductor supply chain alert: {cp['name']} — electronics OEM lead times +30-45d at closure risk.")

        for u in top_unstable[:2]:
            implications.append(f"{u['country']} instability ({u['instability_score']}/100) — monitor commodity & energy exports for disruption signal.")

        if not implications:
            implications = ["Global supply chain operating within normal stress parameters."]
            
        model = "heuristic"

    result = {
        "summary": implications,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
    }
    _db_upsert("market_implications", "market_implications", result)
    logger.info(f"[worldmonitor] Market implications: {len(implications)} items generated via {model}")


# ── Strategic Risk Overview ───────────────────────────────────────────────────

async def compute_strategic_risk():
    """
    Computes the composite 'Global Strategic Risk Score' shown in worldmonitor's
    'Strategic Risk Overview' panel. Range 0-100.
    """
    scored = db_read("scored_chokepoints")
    chops = scored["data"] if scored else []
    instability = db_read("country_instability")
    countries = (instability["data"] if instability else [])[:20]
    eonet = db_read("eonet_events")
    events = eonet["data"] if eonet else []

    cp_risk = sum(c.get("risk_score", 50) for c in chops) / max(len(chops), 1)
    country_risk = sum(c.get("instability_score", 0) for c in countries[:10]) / max(len(countries[:10]), 1)
    event_risk = min(30, len(events) * 0.8)

    composite = int(min(100, cp_risk * 0.5 + country_risk * 0.3 + event_risk))
    level = "CRITICAL" if composite >= 80 else "HIGH" if composite >= 60 else "ELEVATED" if composite >= 40 else "NORMAL"
    trend = "Escalating" if composite >= 70 else "Stable"

    result = {
        "score": composite,
        "level": level,
        "trend": trend,
        "components": {
            "chokepoint_risk": round(cp_risk),
            "country_instability": round(country_risk),
            "active_events": len(events),
        },
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    _db_upsert("strategic_risk", "strategic_risk", result)
    logger.info(f"[worldmonitor] Strategic risk: {level} ({composite})")


# ─────────────────────────────────────────────────────────────────────────────
# Master cron orchestrator
# ─────────────────────────────────────────────────────────────────────────────

FETCH_SCHEDULE = [
    # (coroutine_fn, interval_minutes, description)
    (fetch_eonet,                  30,  "NASA EONET natural hazards"),
    (fetch_earthquakes,            15,  "USGS earthquakes"),
    (fetch_gdacs,                  30,  "GDACS global disasters"),
    (fetch_active_fires,           30,  "NASA FIRMS fires"),
    (fetch_conflict_events,        30,  "ACLED conflict events"),
    (fetch_gdelt,                  30,  "GDELT geopolitical"),
    (fetch_supply_chain_news,      30,  "NewsAPI/GNews supply chain"),
    (fetch_market_quotes,          15,  "Finnhub market quotes"),
    (fetch_energy_prices,          30,  "EIA/GIE energy prices"),
    (fetch_macro,                  30,  "FRED macro indicators"),
    (fetch_air_quality,            30,  "OpenAQ air quality"),
    (fetch_aviation,               30,  "AviationStack flights"),
    (fetch_portwatch_transits,     30,  "IMF PortWatch chokepoint transits"),
    (fetch_shipping_rates,         30,  "Shipping rate indices"),
    (score_chokepoints,            15,  "Chokepoint risk scoring"),
    (compute_country_instability,  30,  "Country instability index"),
    (estimate_shipping_stress,     15,  "Shipping stress estimate"),
    (generate_market_implications, 30,  "Market implications"),
    (compute_strategic_risk,       15,  "Strategic risk composite"),
]

# Track last run times
_last_run: dict[str, float] = {}


async def run_all_fetchers_once():
    """Force run all fetchers immediately (useful for startup warm-up)."""
    tasks = [fn() for fn, _, _ in FETCH_SCHEDULE]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for (fn, _, desc), result in zip(FETCH_SCHEDULE, results):
        if isinstance(result, Exception):
            logger.error(f"[worldmonitor] {desc} startup failed: {result}")


async def worldmonitor_cron_loop():
    """
    Async cron loop: runs each fetcher on its own interval cadence.
    Designed to run as a background asyncio task in FastAPI lifespan.
    """
    if os.getenv("WORLDMONITOR_FETCHER_ENABLED", "true").lower() not in ("1", "true", "yes"):
        logger.info("[worldmonitor] Fetcher disabled (WORLDMONITOR_FETCHER_ENABLED=false)")
        return
    logger.info("[worldmonitor] Cron loop started — fetching all data sources")

    # Initial warm-up: run all on startup
    await run_all_fetchers_once()
    now_startup = time.monotonic()
    for fn, _, _ in FETCH_SCHEDULE:
        _last_run[fn.__name__] = now_startup

    while True:
        await asyncio.sleep(60)  # check every minute
        now = time.monotonic()
        run_fetchers = []
        for fn, interval_minutes, desc in FETCH_SCHEDULE:
            fn_key = fn.__name__
            last = _last_run.get(fn_key, 0)
            if now - last >= interval_minutes * 60:
                _last_run[fn_key] = now
                try:
                    await fn()
                    run_fetchers.append(fn_key)
                except Exception as e:
                    logger.error(f"[worldmonitor] {desc} cron failed: {e}")

        if run_fetchers:
            try:
                from services.event_bus import broadcast_all
                # New batch event
                await broadcast_all("worldmonitor_updated_batch", {"fetchers": run_fetchers})
                # Legacy event for compatibility (e.g., ArView.tsx)
                await broadcast_all("worldmonitor_updated", {"fetcher": "batch"})
            except Exception as e:
                logger.error(f"[worldmonitor] failed to broadcast batch update: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Public API — called from main.py routes
# ─────────────────────────────────────────────────────────────────────────────

def get_natural_hazards() -> list:
    r = db_read("eonet_events"); return r["data"] if r else []

def get_earthquakes() -> list:
    r = db_read("usgs_earthquakes"); return r["data"] if r else []

def get_conflict_events() -> list:
    r = db_read("acled_events"); return r["data"] if r else []

def get_gdalt_events() -> list:
    r = db_read("gdelt_events"); return r["data"] if r else []

def get_gdacs_alerts() -> list:
    r = db_read("gdacs_alerts"); return r["data"] if r else []

def get_supply_chain_news() -> list:
    r = db_read("newsapi_supply_chain"); return r["data"] if r else []

def get_market_quotes() -> list:
    r = db_read("finnhub_quotes"); return r["data"] if r else []

def get_energy_prices() -> dict:
    r = db_read("eia_energy"); return r["data"] if r else {}

def get_macro_indicators() -> dict:
    r = db_read("fred_macro"); return r["data"] if r else {}

def get_chokepoint_status() -> list:
    r = db_read("scored_chokepoints")
    if r:
        return r["data"]
    # Fallback: return static with default risk scores
    return [{**cp, "risk_score": cp["traffic_pct"], "trend": "stable"} for cp in CHOKEPOINTS]

def get_shipping_stress() -> dict:
    r = db_read("shipping_stress"); return r["data"] if r else {"stress_score": 50, "stress_level": "elevated", "carriers": []}

def get_country_instability() -> list:
    r = db_read("country_instability"); return r["data"] if r else []

def get_strategic_risk() -> dict:
    r = db_read("strategic_risk"); return r["data"] if r else {"score": 50, "level": "ELEVATED", "trend": "Stable"}

def get_market_implications() -> dict:
    r = db_read("market_implications"); return r["data"] if r else {"summary": [], "generated_at": ""}

def get_active_fires() -> list:
    r = db_read("firms_fires"); return r["data"] if r else []

def get_aviation_intel() -> list:
    r = db_read("aviationstack_flights"); return r["data"] if r else []

def get_air_quality() -> list:
    r = db_read("openaq_cities"); return r["data"] if r else []

def get_critical_minerals() -> list:
    return CRITICAL_MINERALS

def get_shipping_indices() -> list:
    return SHIPPING_INDICES

def get_shipping_rates() -> dict:
    r = db_read("shipping_rates_v2")
    if r and r.get("data"):
        return r["data"]
    return {"indices": SHIPPING_INDICES, "fetched_at": "", "upstream_unavailable": True}


def get_worldmonitor_bundle_snapshot() -> dict[str, Any]:
    """
    Optimized multi-key read for dashboard/summary endpoints.
    Reduces repeated Firestore document reads during one API request.
    """
    cached_bundle = db_read(_WORLDMONITOR_BUNDLE_KEY)
    if isinstance(cached_bundle, dict):
        bundle_payload = cached_bundle.get("data")
        if isinstance(bundle_payload, dict):
            return bundle_payload

    keys = [
        "eonet_events",
        "usgs_earthquakes",
        "acled_events",
        "gdelt_events",
        "gdacs_alerts",
        "newsapi_supply_chain",
        "finnhub_quotes",
        "eia_energy",
        "fred_macro",
        "scored_chokepoints",
        "shipping_stress",
        "country_instability",
        "strategic_risk",
        "market_implications",
        "firms_fires",
        "aviationstack_flights",
        "openaq_cities",
        "shipping_rates_v2",
    ]
    rows = db_read_many(keys)

    def _data(key: str, default: Any) -> Any:
        row = rows.get(key)
        if row and row.get("data") is not None:
            return row["data"]
        return default

    chokepoints = _data(
        "scored_chokepoints",
        [{**cp, "risk_score": cp["traffic_pct"], "trend": "stable"} for cp in CHOKEPOINTS],
    )
    bundle = {
        "hazards": _data("eonet_events", []),
        "earthquakes": _data("usgs_earthquakes", []),
        "conflict": _data("acled_events", []),
        "gdelt": _data("gdelt_events", []),
        "disasters": _data("gdacs_alerts", []),
        "news": _data("newsapi_supply_chain", []),
        "market_quotes": _data("finnhub_quotes", []),
        "energy": _data("eia_energy", {}),
        "macro": _data("fred_macro", {}),
        "chokepoints": chokepoints,
        "shipping_stress": _data("shipping_stress", {"stress_score": 50, "stress_level": "elevated", "carriers": []}),
        "country_instability": _data("country_instability", []),
        "strategic_risk": _data("strategic_risk", {"score": 50, "level": "ELEVATED", "trend": "Stable"}),
        "market_implications": _data("market_implications", {"summary": [], "generated_at": ""}),
        "fires": _data("firms_fires", []),
        "aviation": _data("aviationstack_flights", []),
        "air_quality": _data("openaq_cities", []),
        "minerals": CRITICAL_MINERALS,
        "shipping_indices": SHIPPING_INDICES,
        "shipping_rates": _data("shipping_rates_v2", {"indices": SHIPPING_INDICES, "fetched_at": "", "upstream_unavailable": True}),
    }
    _db_upsert("worldmonitor_bundle", _WORLDMONITOR_BUNDLE_KEY, bundle)
    return bundle
