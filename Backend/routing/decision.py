from __future__ import annotations

from typing import Any


VALID_ROUTE_MODES = {"sea", "air", "land", "hybrid"}


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _land_best(row: dict[str, Any]) -> dict[str, Any]:
    sssp = row.get("sssp") if isinstance(row.get("sssp"), dict) else {}
    maps = row.get("maps") if isinstance(row.get("maps"), dict) else {}
    candidates = [r for r in (sssp, maps) if _float(r.get("cost_usd")) > 0 or _float(r.get("duration_hours")) > 0]
    if not candidates:
        return {}
    return min(candidates, key=lambda r: (_float(r.get("duration_hours"), 999999), _float(r.get("cost_usd"), 999999)))


def route_days(row: dict[str, Any]) -> float:
    mode = str(row.get("mode") or "").lower()
    if mode in {"sea", "hybrid"}:
        return _float(row.get("transit_days"))
    if mode == "air":
        return round(_float(row.get("flight_hours")) / 24.0, 2)
    if mode == "land":
        return round(_float(_land_best(row).get("duration_hours")) / 24.0, 2)
    return _float(row.get("transit_days"))


def route_cost_usd(row: dict[str, Any]) -> float:
    mode = str(row.get("mode") or "").lower()
    if mode == "land":
        best = _land_best(row)
        return _float(best.get("cost_usd"))
    return _float(row.get("cost_usd"))


def route_distance_km(row: dict[str, Any]) -> float:
    mode = str(row.get("mode") or "").lower()
    if mode == "land":
        best = _land_best(row)
        return _float(best.get("distance_km"))
    return _float(row.get("distance_km"))


def normalize_route_option(row: dict[str, Any]) -> dict[str, Any]:
    mode = str(row.get("mode") or "").lower()
    days = route_days(row)
    cost = route_cost_usd(row)
    viable = mode in VALID_ROUTE_MODES and days > 0 and cost > 0
    enriched = dict(row)
    enriched.update(
        {
            "mode": mode,
            "transit_days": round(days, 1) if days else 0,
            "cost_usd": round(cost, 2) if cost else 0,
            "distance_km": round(route_distance_km(row), 2),
            "viable": viable,
        }
    )
    if not enriched.get("status_label"):
        enriched["status_label"] = "Available" if viable else "Unavailable"
    return enriched


def build_hybrid_route(sea: dict[str, Any], land: dict[str, Any]) -> dict[str, Any] | None:
    sea_n = normalize_route_option(sea)
    land_n = normalize_route_option(land)
    if not sea_n["viable"] or not land_n["viable"]:
        return None
    if sea_n["distance_km"] < 900:
        return None

    sea_days = _float(sea_n.get("transit_days"))
    land_days = _float(land_n.get("transit_days"))
    sea_cost = _float(sea_n.get("cost_usd"))
    land_cost = _float(land_n.get("cost_usd"))
    hybrid_days = max(0.8, (sea_days * 0.58) + (land_days * 0.32) + 1.0)
    hybrid_cost = max(1.0, (sea_cost * 0.72) + (land_cost * 0.42))
    hybrid_distance = (_float(sea_n.get("distance_km")) * 0.62) + (_float(land_n.get("distance_km")) * 0.45)

    return {
        "mode": "hybrid",
        "description": "Land + sea hybrid corridor",
        "transit_days": round(hybrid_days, 1),
        "cost_usd": round(hybrid_cost, 2),
        "distance_km": round(hybrid_distance, 2),
        "risk_score": 0.24,
        "viable": True,
        "status_label": "Balanced",
        "legs": ["land", "sea"],
    }


def enrich_route_decision(
    route_rows: list[dict[str, Any]],
    *,
    current_mode: str = "sea",
    delivery_deadline_days: float | None = None,
    customer_exposure_usd: float = 0.0,
) -> dict[str, Any]:
    options = [normalize_route_option(r) for r in route_rows if isinstance(r, dict)]
    viable = [o for o in options if o.get("viable")]
    if not viable:
        return {
            "route_options": options,
            "recommended_mode": "",
            "next_best_mode": "",
            "delivery_answer": "No viable route is currently available.",
            "cost_answer": "Cost cannot be estimated until a viable route is found.",
            "customer_impact_answer": "Customer impact is likely unless supply is sourced elsewhere.",
            "decision_summary": {
                "can_still_deliver": False,
                "needs_customer_comms": True,
                "reason": "No viable logistics mode passed feasibility checks.",
            },
        }

    baseline = next((o for o in viable if o.get("mode") == current_mode), None) or min(viable, key=lambda o: _float(o.get("cost_usd")))
    base_days = max(0.1, _float(baseline.get("transit_days")))
    base_cost = max(0.1, _float(baseline.get("cost_usd")))
    max_days = max(_float(o.get("transit_days")) for o in viable) or 1.0
    max_cost = max(_float(o.get("cost_usd")) for o in viable) or 1.0

    for option in options:
        if not option.get("viable"):
            option["delay_days"] = None
            option["cost_delta_pct"] = None
            option["delivery_status"] = "unavailable"
            continue
        days = _float(option.get("transit_days"))
        cost = _float(option.get("cost_usd"))
        risk = _float(option.get("risk_score"), 0.25)
        option["delay_days"] = round(days - base_days, 1)
        option["cost_delta_pct"] = round(((cost - base_cost) / base_cost) * 100.0, 1)
        if delivery_deadline_days and days > delivery_deadline_days:
            option["delivery_status"] = "late"
        else:
            option["delivery_status"] = "on_time" if delivery_deadline_days else "deliverable"
        deadline_penalty = 1.2 if delivery_deadline_days and days > delivery_deadline_days else 0.0
        option["decision_score"] = round((days / max_days) * 0.48 + (cost / max_cost) * 0.34 + risk * 0.18 + deadline_penalty, 4)

    ranked = sorted([o for o in options if o.get("viable")], key=lambda o: _float(o.get("decision_score"), 999))
    recommended = ranked[0]
    next_best = ranked[1] if len(ranked) > 1 else ranked[0]
    can_deliver = recommended.get("delivery_status") in {"on_time", "deliverable"}
    needs_customer_comms = bool(delivery_deadline_days and _float(recommended.get("transit_days")) > delivery_deadline_days)
    if customer_exposure_usd > 0 and _float(recommended.get("delay_days")) > 0:
        needs_customer_comms = True

    recommended["recommended"] = True
    recommended["status_label"] = "Best"
    for option in options:
        if option is not recommended:
            option["recommended"] = False

    delay = _float(recommended.get("delay_days"))
    cost_delta = _float(recommended.get("cost_delta_pct"))
    return {
        "route_options": options,
        "recommended_mode": recommended["mode"],
        "next_best_mode": next_best["mode"],
        "delivery_answer": (
            f"Yes. {recommended['mode'].title()} can deliver in {recommended['transit_days']} days."
            if can_deliver
            else f"Not on the current promise. Best route is {recommended['mode']} at {recommended['transit_days']} days."
        ),
        "next_best_route_answer": (
            f"Use {recommended['mode'].title()} route; next fallback is {next_best['mode'].title()} "
            f"at {next_best['transit_days']} days."
        ),
        "cost_answer": f"Estimated cost is ${_float(recommended.get('cost_usd')):,.0f}, {cost_delta:+.1f}% versus {baseline['mode']}.",
        "customer_impact_answer": (
            "Customer communication is recommended because the selected route may affect commitments."
            if needs_customer_comms
            else "Customer impact is not expected from the selected route."
        ),
        "decision_summary": {
            "can_still_deliver": can_deliver,
            "needs_customer_comms": needs_customer_comms,
            "delay_days_vs_current": round(delay, 1),
            "cost_delta_pct_vs_current": round(cost_delta, 1),
            "baseline_mode": baseline["mode"],
        },
    }
