from __future__ import annotations

import json
import os
from typing import Any

from services import firestore as firestore_service
from services import local_store as local_store_service


def effective_db_backend() -> str:
    """Return the configured backend."""
    prov = os.getenv("DB_PROVIDER", "firestore").strip().lower()
    if prov in ("local", "sqlite"):
        return "local"
    # Fallback to local if credentials/project are missing
    from services.firestore_store import gcp_project_id
    if not gcp_project_id():
        return "local"
    return "firestore"


class DatabaseProvider:
    """
    Single facade for persistence routing (Section 2).
    Delegates to firestore or local_store helpers.
    """

    @property
    def backend(self) -> str:
        return effective_db_backend()

    @property
    def auth_mode(self) -> str:
        return (os.getenv("AUTH_PROVIDER") or "local").strip().lower()

    def read_context(self, user_id: str) -> dict | None:
        if self.backend == "local":
            row = local_store_service.get_context(user_id)
            if not row:
                return None
            data = json.loads(row.get("payload_json") or "{}")
            if not isinstance(data, dict):
                data = {}
            data.setdefault("user_id", user_id)
            return data
        return firestore_service.read_context(user_id)

    def write_context(self, user_id: str, payload: dict) -> dict:
        if self.backend == "local":
            return local_store_service.upsert_context(user_id, json.dumps(payload))
        return firestore_service.write_context(user_id, payload)

    def write_workflow_event(self, workflow_id: str, stage: str, confidence: float) -> dict:
        if self.backend == "local":
            return local_store_service.upsert_workflow_event(workflow_id, stage, confidence)
        return firestore_service.write_workflow_event(workflow_id, stage, confidence)

    def read_workflow_event(self, workflow_id: str) -> dict | None:
        if self.backend == "local":
            return local_store_service.get_workflow_event(workflow_id)
        return firestore_service.read_workflow_event(workflow_id)

    def persist_reasoning_step(self, workflow_id: str, step: dict[str, Any]) -> None:
        if self.backend == "local":
            local_store_service.insert_reasoning_step(
                workflow_id,
                str(step.get("agent") or ""),
                str(step.get("stage") or ""),
                str(step.get("detail") or ""),
                str(step.get("status") or "success"),
                step.get("output") if isinstance(step.get("output"), dict) else {},
                str(step.get("timestamp") or ""),
                int(step.get("timestamp_ms") or 0),
            )
            return
        firestore_service.persist_reasoning_step(workflow_id, step)

    def read_reasoning_steps(self, workflow_id: str, limit: int = 500) -> list[dict]:
        if self.backend == "local":
            return local_store_service.list_reasoning_steps(workflow_id, limit=limit)
        return firestore_service.read_reasoning_steps(workflow_id, limit=limit)


db_provider = DatabaseProvider()
