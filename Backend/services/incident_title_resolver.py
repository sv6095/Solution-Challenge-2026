from __future__ import annotations

import hashlib
import re
from typing import Any

from pydantic import BaseModel

from services.llm_provider import structured_complete

_GENERIC_PATTERNS = (
    "maritime disruption affecting",
    "disruption affecting",
    "incident affecting",
    "event affecting",
    "risk alert",
)


def _compact(value: Any) -> str:
    return str(value or "").strip()


def _looks_code_like(title: str) -> bool:
    t = _compact(title)
    if not t:
        return True
    if " " in t:
        return False
    if len(t) <= 16:
        return True
    if re.match(r"^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$", t):
        return True
    return False


def needs_contextual_title(title: str, description: str = "") -> bool:
    t = _compact(title).lower()
    d = _compact(description).lower()
    if not t:
        return True
    if _looks_code_like(title):
        return True
    if any(p in t for p in _GENERIC_PATTERNS):
        return True
    if d and t in {"incident", "disruption", "risk", "event"}:
        return True
    return False


def _fallback_title(title: str, event_type: str, location: str) -> str:
    t = _compact(title)
    if t and not _looks_code_like(t):
        return t
    kind = _compact(event_type).replace("_", " ").replace("-", " ").title() or "Disruption"
    loc = _compact(location)
    if loc and loc.lower() != "global":
        return f"{kind} at {loc}"
    if t:
        head = re.split(r"[-_]", t)[0]
        if head:
            return f"{kind} at {head.title()}"
    return "Supply chain disruption"


class _IncidentTitleModel(BaseModel):
    title: str


async def generate_contextual_incident_title(
    *,
    event_id: str,
    title: str,
    description: str,
    event_type: str,
    location: str = "",
    source: str = "",
) -> str:
    """
    Generate a concise, context-rich incident title using Groq as preferred provider.
    Falls back safely to deterministic formatting if LLM is unavailable.
    """
    if not needs_contextual_title(title, description):
        return _compact(title)

    # Deterministic short key used inside prompt (not for storage), helps repeatability.
    prompt_key = hashlib.sha1(
        f"{event_id}|{title}|{description}|{event_type}|{location}|{source}".encode("utf-8")
    ).hexdigest()[:10]

    try:
        out = await structured_complete(
            prompt=(
                "Rewrite the incident title to be context-rich and specific for supply chain operators.\n"
                "Rules:\n"
                "- 4 to 10 words.\n"
                "- Include concrete location/chokepoint/region if present.\n"
                "- Do not use opaque IDs/codes alone.\n"
                "- No trailing punctuation.\n"
                "- English only.\n\n"
                f"Signal key: {prompt_key}\n"
                f"Original title: {title}\n"
                f"Description: {description}\n"
                f"Event type: {event_type}\n"
                f"Location: {location}\n"
                f"Source: {source}\n"
            ),
            output_model=_IncidentTitleModel,
            system="You create concise, operationally useful incident headlines for control towers.",
            max_tokens=120,
            preferred_provider="groq",
        )
        candidate = _compact(out.title)
        if candidate:
            return candidate
    except Exception:
        pass

    return _fallback_title(title, event_type, location)
