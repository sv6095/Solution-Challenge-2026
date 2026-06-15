from __future__ import annotations

import asyncio
import json
import os
import hashlib
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

# Ensure package imports (agents/, services/) resolve in Celery worker contexts.
# Some worker launch paths do not include the backend root on sys.path.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _is_likely_non_english(text: str) -> bool:
    """Return True when text contains a high proportion of non-ASCII characters,
    which reliably signals non-Latin scripts (Gujarati, Hindi, Arabic, CJK, etc.).
    Falls back to langdetect when the ASCII ratio is ambiguous.
    """
    if not text or len(text.strip()) < 4:
        return False
    # Primary check: if >25 % of characters are non-ASCII, it's almost certainly non-English
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    if non_ascii / max(1, len(text)) > 0.25:
        return True
    # Secondary check: try langdetect for borderline cases (Latin-script non-English)
    try:
        from langdetect import detect
        return detect(text) != "en"
    except Exception:
        return False

from apscheduler.schedulers.background import BackgroundScheduler

from agents.citation_tracker import enrich_signal_item, mark_corroborations
from agents.signal_agent import fetch_gdelt, fetch_gnews, fetch_nasa_eonet, fetch_newsapi
from agents.extended_signal_agent import (
    fetch_gdacs,
    fetch_usgs_earthquakes,
    fetch_nasa_firms,
    fetch_reliefweb,
    fetch_acled,
    fetch_gps_interference,
    fetch_ofac_sanctions,
    fetch_portwatch_disruptions,
    fetch_portwatch_transit_alerts,
    fetch_social_sentiment,
    fetch_wto_trade_signals,
)
from services.firestore_store import (
    add_audit,
    list_contexts,
    purge_archived_signals,
    purge_stale_incidents,
    replace_active_signals,
)
from services.local_store import DB_PATH
from services.secret_manager import get_secret
from services.incident_title_resolver import generate_contextual_incident_title

_scheduler: BackgroundScheduler | None = None


def _derive_country_instability_signals(items: list[dict]) -> list[dict]:
    grouped: dict[str, dict[str, object]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        source_category = str(item.get("source_category") or "").strip().lower()
        if source_category not in {"geopolitical", "regulatory", "maritime", "trade"}:
            continue
        location = str(item.get("location") or "").strip()
        if not location or location.lower() == "global":
            continue
        country = location.split(",")[-1].strip()
        if not country:
            continue
        bucket = grouped.setdefault(country, {"severity_total": 0.0, "count": 0, "sources": set()})
        bucket["severity_total"] = float(bucket["severity_total"]) + float(item.get("severity") or 0.0)
        bucket["count"] = int(bucket["count"]) + 1
        cast_sources = bucket["sources"]
        if isinstance(cast_sources, set):
            cast_sources.add(str(item.get("source") or "unknown"))

    derived: list[dict] = []
    for country, bucket in grouped.items():
        count = int(bucket["count"])
        if count == 0:
            continue
        sources = bucket["sources"] if isinstance(bucket["sources"], set) else set()
        avg_severity = float(bucket["severity_total"]) / count
        source_bonus = min(25.0, len(sources) * 6.5)
        cii_score = max(20.0, min(100.0, (avg_severity * 8.0) + source_bonus + (count * 2.0)))
        if cii_score < 45.0:
            continue
        derived.append(
            {
                "id": f"cii_{country.lower().replace(' ', '_')}",
                "event_type": "country_instability_index",
                "title": f"Country instability index elevated: {country}",
                "description": (
                    f"Composite instability score {cii_score:.0f}/100 derived from {count} active "
                    f"signals across {len(sources)} source streams."
                ),
                "location": country,
                "severity": min(10.0, max(4.5, cii_score / 10.0)),
                "lat": 0.0,
                "lng": 0.0,
                "source": "cii_model",
                "source_category": "geopolitical",
                "url": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "cii_score": round(cii_score, 1),
                "source_count": len(sources),
            }
        )

    derived.sort(key=lambda item: float(item.get("cii_score") or 0.0), reverse=True)
    return derived[:12]

# ── Stale incident purge ──────────────────────────────────────────────

# Incidents older than these thresholds are auto-purged so the dashboard
# always shows fresh, relevant data.  Active incidents (DETECTED,
# ANALYZED, AWAITING_APPROVAL) are purged after ACTIVE_TTL_HOURS;
# resolved/dismissed incidents are kept longer (RESOLVED_TTL_DAYS) for
# audit trail then removed.

ACTIVE_TTL_HOURS = int(os.getenv("INCIDENT_ACTIVE_TTL_HOURS", "168"))  # 7 days — live events can run longer than 24h
RESOLVED_TTL_DAYS = int(os.getenv("INCIDENT_RESOLVED_TTL_DAYS", "7"))


def _purge_stale_incidents() -> int:
    """Delete incidents that have gone stale based on age + status.

    Returns the number of purged rows.
    """
    import sqlite3

    now = datetime.now(timezone.utc)
    active_cutoff = (now - timedelta(hours=ACTIVE_TTL_HOURS)).isoformat()
    resolved_cutoff = (now - timedelta(days=RESOLVED_TTL_DAYS)).isoformat()

    purged = 0
    try:
        with sqlite3.connect(DB_PATH) as con:
            # 1) Purge active incidents older than ACTIVE_TTL_HOURS
            cur = con.execute(
                """
                DELETE FROM incidents
                WHERE status IN ('DETECTED', 'ANALYZED', 'AWAITING_APPROVAL')
                  AND created_at < ?
                """,
                (active_cutoff,),
            )
            purged += cur.rowcount or 0

            # 2) Purge resolved/dismissed incidents older than RESOLVED_TTL_DAYS
            cur = con.execute(
                """
                DELETE FROM incidents
                WHERE status IN ('RESOLVED', 'APPROVED', 'DISMISSED')
                  AND created_at < ?
                """,
                (resolved_cutoff,),
            )
            purged += cur.rowcount or 0

            # 3) Purge simulation-only artefacts older than 24h
            cur = con.execute(
                """
                DELETE FROM incidents
                WHERE json_extract(payload_json, '$.simulation_only') = 1
                  AND created_at < ?
                """,
                (active_cutoff,),
            )
            purged += cur.rowcount or 0

            # 4) Cleanup orphaned reasoning steps for deleted incidents
            con.execute(
                """
                DELETE FROM reasoning_steps
                WHERE workflow_id NOT IN (SELECT id FROM incidents)
                """
            )

            con.commit()
    except Exception as exc:
        add_audit("incident_purge_error", str(exc)[:200])

    if purged > 0:
        add_audit("incident_purge", f"purged={purged} active_cutoff={ACTIVE_TTL_HOURS}h resolved_cutoff={RESOLVED_TTL_DAYS}d")

    return purged


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


async def _poll_sources() -> None:
    news_api_key = get_secret("NEWSAPI_API_KEY")
    gnews_api_key = get_secret("GNEWS_API_KEY")

    batches: list[dict] = []

    async def run_safe(fn) -> list[dict]:
        try:
            return await fn()
        except Exception as exc:
            add_audit("signal_poll_error", str(exc))
            return []

    tasks = [
        run_safe(fetch_nasa_eonet),
        run_safe(fetch_gdelt),
        run_safe(lambda: fetch_newsapi(news_api_key)),
        run_safe(lambda: fetch_gnews(gnews_api_key)),
        # ── Extended free sources ─────────────────────────────────
        run_safe(fetch_gdacs),
        run_safe(fetch_usgs_earthquakes),
        run_safe(fetch_nasa_firms),
        run_safe(fetch_reliefweb),
        run_safe(fetch_acled),
        run_safe(fetch_portwatch_transit_alerts),
        run_safe(fetch_portwatch_disruptions),
        run_safe(fetch_gps_interference),
        run_safe(fetch_wto_trade_signals),
        run_safe(fetch_ofac_sanctions),
        run_safe(fetch_social_sentiment),
    ]

    results = await asyncio.gather(*tasks)
    for items in results:
        if items:
            batches.extend(items)

    # Deduplicate by signal ID
    dedup: dict[str, dict] = {}
    for item in batches:
        sid = str(item.get("id") or "").strip()
        if not sid:
            basis = f"{item.get('source','')}|{item.get('title','')}|{item.get('location','')}|{item.get('created_at','')}"
            sid = f"sig_{hashlib.sha256(basis.encode('utf-8')).hexdigest()[:16]}"
            item["id"] = sid
        # Prefer most-recent version if we see the same id twice
        existing = dedup.get(sid)
        if existing is None:
            dedup[sid] = item
        # else keep existing (stable dedup)

    for item in _derive_country_instability_signals(list(dedup.values())):
        dedup[str(item["id"])] = item

    from services.signal_geocode import geocode_signal

    enriched = mark_corroborations([enrich_signal_item(dict(x)) for x in dedup.values()])
    enriched = [geocode_signal(dict(x)) for x in enriched]
    replace_active_signals(enriched)
    purged = purge_archived_signals(days=7)
    add_audit("signal_poll_complete", f"active={len(dedup)} purged={purged}")

    # ── Purge stale incidents before generating new ones ──────────────
    stale_purged = _purge_stale_incidents()
    try:
        purge_stale_incidents(max_age_days=7)
    except Exception as exc:
        add_audit("incident_purge_error", str(exc)[:200])

    # ── v4 Autonomous Incident Generation ────────────────────────────
    # After signals land, push the top events through the GNN-based
    # incident engine so incidents appear without any user click.
    try:
        from services.incident_engine import incident_engine
        from services.firestore_store import upsert_incident, list_incidents

        from services.event_freshness import extract_event_timestamp, is_event_fresh

        # Build risk-event dicts from the enriched signals
        events: list[dict] = []
        for sig in enriched:
            sev = float(sig.get("severity", 0) or 0)
            if sev < 2.5:  # Include news, sentiment, humanitarian — not just disasters
                continue
            if not is_event_fresh(sig, max_event_days=30):
                continue
            lat = float(sig.get("lat", 0) or 0)
            lng = float(sig.get("lng", 0) or 0)
            if lat == 0.0 and lng == 0.0:
                continue
            event_ts = extract_event_timestamp(sig)
            events.append({
                "id": str(sig.get("id") or ""),
                "title": str(sig.get("title") or sig.get("event_type") or "Signal"),
                "event_type": str(sig.get("event_type") or "signal"),
                "severity": "CRITICAL" if sev >= 8 else ("HIGH" if sev >= 6 else ("MEDIUM" if sev >= 4 else "LOW")),
                "description": str(sig.get("description") or sig.get("location") or ""),
                "lat": lat,
                "lng": lng,
                "location_precision": str(sig.get("location_precision") or "exact"),
                "region": str(sig.get("location") or "Unknown"),
                "mode": str(sig.get("mode") or "land"),
                "source": str(sig.get("source") or ""),
                "source_category": str(sig.get("source_category") or ""),
                "url": str(sig.get("url") or ""),
                "timestamp": event_ts.isoformat() if event_ts else str(sig.get("created_at") or ""),
            })

        # Query contexts via the active storage abstraction (Firestore or local SQLite).
        contexts_list: list[dict[str, Any]] = []
        try:
            contexts_list = list_contexts(limit=1000)
        except Exception as exc:
            add_audit("context_fetch_error", str(exc))

        for ctx in contexts_list:
            user_id = ctx["user_id"]
            try:
                payload = json.loads(ctx["payload_json"] or "{}")
            except Exception:
                payload = {}
            if not payload or not isinstance(payload, dict):
                continue

            # Resolve tenant_id (consistent with _resolved_request_tenant logic)
            customer_id = str(payload.get("customer_id") or payload.get("company_name") or "").strip()
            tenant_id = customer_id if customer_id else user_id

            # Gather suppliers and logistics nodes
            ctx_suppliers = payload.get("suppliers", [])
            ctx_logistics = payload.get("logistics_nodes", [])

            suppliers_for_gnn = []
            for idx, s in enumerate(ctx_suppliers):
                name = s.get("name") or f"Supplier {idx+1}"
                suppliers_for_gnn.append({
                    "id": s.get("id") or f"sup_{tenant_id}_{idx+1}",
                    "name": name,
                    "country": s.get("country") or "",
                    "location": s.get("location") or f"{s.get('city', '')}, {s.get('country', '')}".strip(", "),
                    "tier": s.get("tier") or "Tier 1",
                    "exposureScore": _safe_float(s.get("exposureScore") or s.get("exposure_score"), 50.0),
                    "lat": _safe_float(s.get("lat"), 0.0),
                    "lng": _safe_float(s.get("lng"), 0.0),
                    "duns_number": s.get("duns_number") or s.get("dunsNumber") or "",
                    "contract_value_usd": _safe_float(s.get("contract_value_usd"), 100000.0),
                    "daily_throughput_usd": _safe_float(s.get("daily_throughput_usd"), 10000.0),
                    "safety_stock_days": _safe_int(s.get("safety_stock_days"), 7),
                    "single_source": bool(s.get("single_source", False)),
                    "criticality": s.get("criticality") or "medium",
                })

            for idx, l in enumerate(ctx_logistics):
                name = l.get("name") or f"Logistics Node {idx+1}"
                suppliers_for_gnn.append({
                    "id": l.get("id") or f"log_{tenant_id}_{idx+1}",
                    "name": name,
                    "country": l.get("country") or "",
                    "location": l.get("location") or f"{l.get('city', '')}, {l.get('country', '')}".strip(", "),
                    "tier": "Tier 0",
                    "exposureScore": _safe_float(l.get("exposureScore") or l.get("exposure_score"), 50.0),
                    "lat": _safe_float(l.get("lat"), 0.0),
                    "lng": _safe_float(l.get("lng"), 0.0),
                    "duns_number": l.get("duns_number") or l.get("dunsNumber") or "",
                    "contract_value_usd": 0.0,
                    "daily_throughput_usd": _safe_float(l.get("daily_throughput_usd"), 0.0),
                    "safety_stock_days": _safe_int(l.get("safety_stock_days"), 7),
                    "single_source": False,
                    "criticality": l.get("criticality") or "medium",
                })

            if not suppliers_for_gnn:
                continue

            existing_ids = {str(inc.get("event_id") or inc.get("id") or "") for inc in list_incidents(limit=500, tenant_id=tenant_id)}

            severity_rank = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "MODERATE": 1}
            events.sort(key=lambda e: severity_rank.get(str(e.get("severity") or ""), 0), reverse=True)

            created = 0
            for evt in events[:25]:
                if evt["id"] in existing_ids:
                    continue
                title = str(evt.get("title") or "")
                desc = str(evt.get("description") or "")
                if _is_likely_non_english(title) or _is_likely_non_english(desc):
                    try:
                        from services.llm_provider import structured_complete
                        from pydantic import BaseModel

                        class EventTranslation(BaseModel):
                            title: str
                            description: str

                        translated = await structured_complete(
                            prompt=(
                                "Translate the following event title and description to English. "
                                "Respond ONLY with the JSON object containing 'title' and 'description'.\n\n"
                                f"Title: {title}\nDescription: {desc}"
                            ),
                            output_model=EventTranslation,
                            system="You are an expert translator. Translate foreign-language incident reports to English.",
                            max_tokens=400,
                        )
                        evt["title"] = translated.title
                        evt["description"] = translated.description
                    except Exception:
                        # Translation failed — keep original text and continue processing.
                        # Better to have a foreign-language incident than to silently drop it.
                        pass
                try:
                    evt["title"] = await generate_contextual_incident_title(
                        event_id=str(evt.get("id") or ""),
                        title=str(evt.get("title") or ""),
                        description=str(evt.get("description") or ""),
                        event_type=str(evt.get("event_type") or evt.get("type") or ""),
                        location=str(evt.get("location") or evt.get("region") or evt.get("country") or ""),
                        source=str(evt.get("source") or ""),
                    )
                except Exception:
                    # Title enhancement is best-effort and should never block ingestion.
                    pass
                
                inc = incident_engine.process_event(evt, suppliers_for_gnn)
                if inc:
                    upsert_incident(inc.id, inc.to_dict(), inc.status, inc.severity, tenant_id=tenant_id)
                    add_audit("incident_auto_created", f"{tenant_id}:{inc.id}:{inc.severity}")
                    created += 1

            if created > 0:
                add_audit("incident_auto_batch", f"tenant={tenant_id} created={created}")
    except Exception as exc:
        add_audit("incident_auto_error", str(exc)[:200])


def _job_wrapper() -> None:
    asyncio.run(_poll_sources())


def start_signal_scheduler() -> None:
    global _scheduler
    if os.getenv("ENABLE_SIGNAL_SCHEDULER", "true").lower() != "true":
        return
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    interval_minutes = int(os.getenv("SIGNAL_POLL_INTERVAL_MINUTES", "10"))
    _scheduler.add_job(
        _job_wrapper,
        "interval",
        minutes=interval_minutes,
        id="signal_poll",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
    )
    _scheduler.start()
    add_audit("signal_scheduler_started", f"{interval_minutes}m")


async def force_poll() -> dict:
    """Trigger an immediate poll outside the scheduler cycle. Called from /api/signals/refresh."""
    await _poll_sources()
    return {"status": "ok", "message": "Signal refresh complete"}
