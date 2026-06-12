from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from scheduler.celery_app import celery_app

logger = logging.getLogger(__name__)


def _run_async(coro: Any) -> Any:
    """Run an async backend job from a synchronous Celery worker."""
    return asyncio.run(coro)


@celery_app.task(bind=True, max_retries=3, name="scheduler.tasks.poll_signals")
def poll_signals(self) -> dict[str, Any]:
    """Poll external signal sources and generate incidents outside the API process."""
    logger.info("Executing Celery task: signal ingestion")
    try:
        from scheduler.signal_poll import _poll_sources

        _run_async(_poll_sources())
        return {"status": "ok", "message": "Signals processed"}
    except Exception as exc:
        logger.exception("Signal ingestion failed")
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(bind=True, max_retries=2, name="scheduler.tasks.refresh_worldmonitor")
def refresh_worldmonitor(self) -> dict[str, Any]:
    """Refresh the WorldMonitor datasets without tying up a request worker."""
    logger.info("Executing Celery task: worldmonitor refresh")
    try:
        from services.worldmonitor_fetcher import run_all_fetchers_once

        _run_async(run_all_fetchers_once())
        return {"status": "ok", "message": "WorldMonitor refresh complete"}
    except Exception as exc:
        logger.exception("WorldMonitor refresh failed")
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(bind=True, max_retries=1, name="scheduler.tasks.train_xgboost")
def train_xgboost(self) -> dict[str, Any]:
    """Train the XGBoost model in a worker process."""
    logger.info("Executing Celery task: XGBoost training")
    try:
        from ml.xgboost_model import train_and_save_model

        return train_and_save_model()
    except Exception as exc:
        logger.exception("XGBoost training failed")
        raise self.retry(exc=exc, countdown=120)


def _dataset_suppliers(limit: int = 50) -> list[dict[str, Any]]:
    from services.data_registry import registry

    suppliers: list[dict[str, Any]] = []
    for idx, port in enumerate(registry.ports[: max(1, limit)]):
        exposure = round(25 + ((abs(port.lat) + abs(port.lng)) % 70), 1)
        suppliers.append(
            {
                "id": f"sup_{idx + 1}",
                "name": f"{port.city} Node",
                "country": port.country,
                "location": f"{port.city}, {port.country}",
                "tier": f"Tier {(idx % 3) + 1}",
                "category": "Logistics",
                "exposureScore": exposure,
                "lat": port.lat,
                "lng": port.lng,
                "mode": ["sea", "air", "land"][idx % 3],
            }
        )
    return suppliers


@celery_app.task(bind=True, max_retries=1, name="scheduler.tasks.train_gnn")
def train_gnn(self, user_id: str, epochs: int = 100) -> dict[str, Any]:
    """Train the GNN model in a worker process."""
    logger.info("Executing Celery task: GNN training for user_id=%s", user_id)
    try:
        from ml.gnn_model import train_gnn_model
        from ml.gnn_stub import build_graph_from_context, build_graph_from_dataset
        from services.firestore import read_context
        from services.firestore_store import get_context

        context = read_context(user_id)
        if not isinstance(context, dict) or not context:
            row = get_context(user_id) or {}
            try:
                context = json.loads(row.get("payload_json") or "{}") if isinstance(row, dict) else {}
            except Exception:
                context = {}

        suppliers = context.get("suppliers", []) if isinstance(context, dict) else []
        graph = build_graph_from_context(context) if suppliers else build_graph_from_dataset(_dataset_suppliers())
        return train_gnn_model(graph, epochs=epochs)
    except Exception as exc:
        logger.exception("GNN training failed")
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(bind=True, max_retries=1, name="scheduler.tasks.tune_thresholds")
def tune_thresholds(self, tenant_id: str) -> dict[str, Any]:
    """Tune tenant thresholds in a worker process."""
    logger.info("Executing Celery task: threshold tuning for tenant_id=%s", tenant_id)
    try:
        from services.threshold_tuner import run_threshold_tuning

        return run_threshold_tuning(tenant_id)
    except Exception as exc:
        logger.exception("Threshold tuning failed")
        raise self.retry(exc=exc, countdown=120)
