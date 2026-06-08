"""Shared helpers for event/incident recency checks."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

_GDACS_FROM_RE = re.compile(r"from:\s*(\d{1,2}\s+\w{3}\s+\d{4})", re.IGNORECASE)


def parse_event_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _parse_gdacs_title_date(title: str) -> datetime | None:
    match = _GDACS_FROM_RE.search(title)
    if not match:
        return None
    try:
        return datetime.strptime(match.group(1).strip(), "%d %b %Y").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def extract_event_timestamp(event: dict[str, Any]) -> datetime | None:
    for key in ("detected_at", "timestamp", "time", "event_time", "event_date"):
        parsed = parse_event_dt(event.get(key))
        if parsed:
            return parsed
    title = str(event.get("title") or event.get("event_title") or event.get("htmldescription") or "")
    parsed = _parse_gdacs_title_date(title)
    if parsed:
        return parsed
    return parse_event_dt(event.get("created_at"))


def is_event_fresh(event: dict[str, Any], max_event_days: int = 30) -> bool:
    ts = extract_event_timestamp(event)
    if ts is None:
        return True
    return (datetime.now(timezone.utc) - ts).days <= max_event_days


def is_incident_fresh(inc: dict[str, Any], max_incident_days: int = 7, max_event_days: int = 30) -> bool:
    event_dt = inc.get("event_time") or inc.get("event_date")
    if event_dt:
        parsed = parse_event_dt(event_dt)
        if parsed and (datetime.now(timezone.utc) - parsed).days > max_event_days:
            return False
    else:
        title = str(inc.get("event_title") or inc.get("title") or "")
        parsed = _parse_gdacs_title_date(title)
        if parsed and (datetime.now(timezone.utc) - parsed).days > max_event_days:
            return False
    created = inc.get("detected_at") or inc.get("created_at") or inc.get("timestamp")
    if created:
        parsed = parse_event_dt(created)
        if parsed and (datetime.now(timezone.utc) - parsed).days > max_incident_days:
            return False
    return True
