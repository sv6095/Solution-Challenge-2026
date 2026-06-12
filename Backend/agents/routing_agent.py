from __future__ import annotations

from currency.frankfurter import convert_cost
from currency.risk_index import compute_currency_risk_index
from routing.air import air_route
from routing.decision import build_hybrid_route, enrich_route_decision
from routing.land import google_maps_live_route, land_route
from routing.sea import sea_route


async def run_routing(
    origin_lat: float,
    origin_lng: float,
    origin_country_code: str,
    origin_label: str,
    dest_lat: float,
    dest_lng: float,
    dest_country_code: str,
    dest_label: str,
    target_currency: str,
) -> dict:
    if abs(origin_lat - dest_lat) < 1e-6 and abs(origin_lng - dest_lng) < 1e-6:
        raise ValueError("Origin and destination cannot be identical")
    if not all(
        isinstance(v, (int, float))
        for v in (origin_lat, origin_lng, dest_lat, dest_lng)
    ):
        raise ValueError("Invalid routing coordinates")

    sea = sea_route(origin_lat, origin_lng, dest_lat, dest_lng)
    air = air_route(origin_lat, origin_lng, dest_lat, dest_lng)
    land = land_route(origin_lat, origin_lng, dest_lat, dest_lng)
    live = await google_maps_live_route(origin_label, dest_label)
    if live:
        land["maps"] = live
    hybrid = build_hybrid_route(sea, land)

    comparison = []
    for mode in (sea, air):
        comparison.append({**mode, "cost": await convert_cost(mode["cost_usd"], target_currency)})
    if hybrid:
        comparison.append({**hybrid, "cost": await convert_cost(hybrid["cost_usd"], target_currency)})
    comparison.append(
        {
            "mode": "land",
            "sssp": {**land["sssp"], "cost": await convert_cost(float(land["sssp"]["cost_usd"]), target_currency)},
            "maps": {**land["maps"], "cost": await convert_cost(float(land["maps"]["cost_usd"]), target_currency)},
        }
    )
    decision = enrich_route_decision(comparison, current_mode="sea")
    recommended_mode = str(decision.get("recommended_mode") or "")
    if not recommended_mode:
        raise ValueError("No valid route modes computed")
    return {
        "route_comparison": decision["route_options"],
        "currency_risk_index": await compute_currency_risk_index(origin_country_code, dest_country_code),
        "recommended_mode": recommended_mode,
        "next_best_mode": decision.get("next_best_mode", ""),
        "delivery_answer": decision.get("delivery_answer", ""),
        "next_best_route_answer": decision.get("next_best_route_answer", ""),
        "cost_answer": decision.get("cost_answer", ""),
        "customer_impact_answer": decision.get("customer_impact_answer", ""),
        "decision_summary": decision.get("decision_summary", {}),
    }
