from __future__ import annotations

import hashlib
import json
import os
from threading import Lock
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from google.cloud import firestore as g_firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pathlib import Path
import logging
logger = logging.getLogger(__name__)

from services.event_freshness import is_incident_fresh

DB_PATH = Path(os.getenv("LOCAL_DB_PATH") or (Path(__file__).resolve().parent.parent / "local_fallback.db"))


def _connect_db():
    import sqlite3
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA cache_size=-2000;")
        con.execute("PRAGMA temp_store=MEMORY;")
    except Exception as exc:
        logger.warning("Failed to configure SQLite PRAGMAs: %s", exc)
    return con


class DocumentSnapshot:
    def __init__(self, doc_id: str, collection_path: list[str], data: dict | None):
        self.id = doc_id
        self.exists = data is not None
        self._data = data or {}
        self.reference = DocumentBuilder(collection_path + [doc_id])

    def to_dict(self) -> dict:
        return self._data


class DocumentBuilder:
    def __init__(self, path: list[str]):
        self.path = path
        self.id = path[-1]

    def collection(self, name: str):
        return CollectionBuilder(self.path + [name])

    def get(self):
        collection_name = "/".join(self.path[:-1])
        document_id = self.id
        data = _emulator_db_read(collection_name, document_id)
        return DocumentSnapshot(document_id, self.path[:-1], data)

    def set(self, data: dict, merge: bool = False):
        collection_name = "/".join(self.path[:-1])
        document_id = self.id
        _emulator_db_write(collection_name, document_id, data, merge)

    def delete(self):
        collection_name = "/".join(self.path[:-1])
        document_id = self.id
        _emulator_db_delete(collection_name, document_id)

    @property
    def reference(self):
        return self


class QueryBuilder:
    def __init__(self, collection_name: str, is_group: bool = False):
        self.collection_name = collection_name
        self.is_group = is_group
        self.filters = []
        self.orders = []
        self.limit_val = None

    def where(self, filter=None, field=None, op=None, value=None):
        if filter is not None:
            field = getattr(filter, "field_path", None)
            op = getattr(filter, "op", None)
            value = getattr(filter, "value", None)
            if field is None:
                try:
                    field = filter.field_path
                    op = filter.op
                    value = filter.value
                except Exception:
                    pass
        if field is not None:
            self.filters.append((field, op, value))
        return self

    def order_by(self, field: str, direction=None):
        self.orders.append((field, direction))
        return self

    def limit(self, val: int):
        self.limit_val = val
        return self

    def stream(self):
        return _emulator_query(self)


class CollectionBuilder(QueryBuilder):
    def __init__(self, path: list[str] | str):
        if isinstance(path, str):
            path = [path]
        super().__init__("/".join(path))
        self.path = path

    def document(self, name: str = None):
        if name is None:
            name = uuid4().hex
        return DocumentBuilder(self.path + [name])


class CollectionGroupBuilder(QueryBuilder):
    def __init__(self, name: str):
        super().__init__(name, is_group=True)


class BatchBuilder:
    def __init__(self):
        self.operations = []

    def set(self, ref: DocumentBuilder, data: dict, merge: bool = False):
        self.operations.append(("set", ref, data, merge))

    def delete(self, ref: DocumentBuilder):
        self.operations.append(("delete", ref, None, False))

    def commit(self):
        import json
        con = _connect_db()
        try:
            with con:
                for op, ref, data, merge in self.operations:
                    collection_name = "/".join(ref.path[:-1])
                    document_id = ref.id
                    if op == "set":
                        if merge:
                            cur = con.cursor()
                            cur.execute(
                                "SELECT data_json FROM firestore_emulator WHERE collection_name = ? AND document_id = ?",
                                (collection_name, document_id)
                            )
                            row = cur.fetchone()
                            existing = {}
                            if row:
                                try:
                                    existing = json.loads(row[0])
                                except Exception:
                                    pass
                            existing.update(data)
                            data = existing
                        con.execute(
                            """
                            INSERT OR REPLACE INTO firestore_emulator (collection_name, document_id, data_json)
                            VALUES (?, ?, ?)
                            """,
                            (collection_name, document_id, json.dumps(data))
                        )
                    elif op == "delete":
                        con.execute(
                            "DELETE FROM firestore_emulator WHERE collection_name = ? AND document_id = ?",
                            (collection_name, document_id)
                        )
        finally:
            con.close()


class SQLiteFirestoreProxy:
    def collection(self, name: str):
        return CollectionBuilder(name)

    def collection_group(self, name: str):
        return CollectionGroupBuilder(name)

    def batch(self):
        return BatchBuilder()


def init_emulator_db() -> None:
    con = _connect_db()
    try:
        with con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS firestore_emulator (
                    collection_name TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    PRIMARY KEY (collection_name, document_id)
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_emulator_collection ON firestore_emulator(collection_name)")
    finally:
        con.close()


def _emulator_db_read(collection_name: str, document_id: str) -> dict | None:
    import json
    con = _connect_db()
    cur = con.cursor()
    cur.execute(
        "SELECT data_json FROM firestore_emulator WHERE collection_name = ? AND document_id = ?",
        (collection_name, document_id)
    )
    row = cur.fetchone()
    con.close()
    if row:
        try:
            return json.loads(row[0])
        except Exception:
            return {}
    return None


def _emulator_db_write(collection_name: str, document_id: str, data: dict, merge: bool = False):
    import json
    con = _connect_db()
    try:
        with con:
            if merge:
                cur = con.cursor()
                cur.execute(
                    "SELECT data_json FROM firestore_emulator WHERE collection_name = ? AND document_id = ?",
                    (collection_name, document_id)
                )
                row = cur.fetchone()
                existing = {}
                if row:
                    try:
                        existing = json.loads(row[0])
                    except Exception:
                        pass
                existing.update(data)
                data = existing
            con.execute(
                """
                INSERT OR REPLACE INTO firestore_emulator (collection_name, document_id, data_json)
                VALUES (?, ?, ?)
                """,
                (collection_name, document_id, json.dumps(data))
            )
    finally:
        con.close()


def _emulator_db_delete(collection_name: str, document_id: str):
    con = _connect_db()
    try:
        with con:
            con.execute(
                "DELETE FROM firestore_emulator WHERE collection_name = ? AND document_id = ?",
                (collection_name, document_id)
            )
    finally:
        con.close()


def _emulator_query(builder: QueryBuilder) -> list[DocumentSnapshot]:
    import json
    con = _connect_db()
    cur = con.cursor()
    if builder.is_group:
        cur.execute(
            "SELECT collection_name, document_id, data_json FROM firestore_emulator WHERE collection_name = ? OR collection_name LIKE ?",
            (builder.collection_name, builder.collection_name + "/%")
        )
    else:
        cur.execute(
            "SELECT collection_name, document_id, data_json FROM firestore_emulator WHERE collection_name = ?",
            (builder.collection_name,)
        )
    rows = cur.fetchall()
    con.close()
    
    results = []
    for col_path, doc_id, data_json in rows:
        try:
            data = json.loads(data_json)
        except Exception:
            data = {}
        
        match = True
        for field, op, val in builder.filters:
            field_val = data
            for part in field.split("."):
                if isinstance(field_val, dict):
                    field_val = field_val.get(part)
                else:
                    field_val = None
                    break
            
            if op in ("==", "equal"):
                if field_val != val:
                    match = False
            elif op == "<":
                if not (field_val is not None and field_val < val):
                    match = False
            elif op == "<=":
                if not (field_val is not None and field_val <= val):
                    match = False
            elif op == ">":
                if not (field_val is not None and field_val > val):
                    match = False
            elif op == ">=":
                if not (field_val is not None and field_val >= val):
                    match = False
            elif op == "!=":
                if field_val == val:
                    match = False
            elif op == "array-contains":
                if not (isinstance(field_val, list) and val in field_val):
                    match = False
            elif op == "in":
                if not (isinstance(val, list) and field_val in val):
                    match = False
            else:
                if field_val != val:
                    match = False
                    
            if not match:
                break
                
        if match:
            results.append(DocumentSnapshot(doc_id, col_path.split("/"), data))
            
    for field, direction in reversed(builder.orders):
        is_desc = False
        if direction is not None:
            dir_str = str(direction).upper()
            if "DESC" in dir_str or "DESCENDING" in dir_str:
                is_desc = True
        
        def sort_key(snap):
            val = snap._data
            for part in field.split("."):
                if isinstance(val, dict):
                    val = val.get(part)
                else:
                    val = None
                    break
            if val is None:
                return "" if is_desc else "\xff\xff\xff"
            return val
            
        results.sort(key=sort_key, reverse=is_desc)
        
    if builder.limit_val is not None:
        results = results[:builder.limit_val]
        
    return results


def gcp_project_id() -> str | None:
    """
    Resolve GCP/Firebase project id for Firestore and related clients.

    Strips whitespace and newlines. A stray newline in an env value (common when
    pasting into hosting dashboards) makes gRPC metadata invalid and breaks Firestore commits.
    """
    for key in ("FIREBASE_PROJECT_ID", "GCP_PROJECT_ID", "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"):
        raw = os.getenv(key)
        if not raw:
            continue
        cleaned = raw.strip()
        if cleaned:
            return cleaned
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_use_local_fallback = None

def _should_use_local() -> bool:
    global _use_local_fallback
    if _use_local_fallback is not None:
        return _use_local_fallback
    db_provider = os.getenv("DB_PROVIDER", "firestore").strip().lower()
    if db_provider in ("local", "sqlite") or not gcp_project_id():
        _use_local_fallback = True
    else:
        _use_local_fallback = False
    return _use_local_fallback


_FIRESTORE_CLIENT: g_firestore.Client | None = None
_FIRESTORE_CLIENT_LOCK = Lock()
_SYNC_REDIS_CLIENT = None


def _get_sync_redis():
    global _SYNC_REDIS_CLIENT
    if _SYNC_REDIS_CLIENT is not None:
        return _SYNC_REDIS_CLIENT
    try:
        import redis
        url = (os.getenv("REDIS_URL") or "redis://localhost:6379/0").strip()
        _SYNC_REDIS_CLIENT = redis.from_url(url, decode_responses=True)
        _SYNC_REDIS_CLIENT.ping()
        return _SYNC_REDIS_CLIENT
    except Exception as exc:
        logger.warning("Failed to initialize sync Redis client: %s", exc)
        _SYNC_REDIS_CLIENT = None  # Leave as None to allow retrying on the next poll
        return None


def _client() -> g_firestore.Client:
    """
    Return a process-wide Firestore client singleton or fallback to SQLite proxy.
    """
    global _FIRESTORE_CLIENT, _use_local_fallback
    if _FIRESTORE_CLIENT is not None:
        return _FIRESTORE_CLIENT
    with _FIRESTORE_CLIENT_LOCK:
        if _FIRESTORE_CLIENT is not None:
            return _FIRESTORE_CLIENT
        
        if _should_use_local():
            init_emulator_db()
            _FIRESTORE_CLIENT = SQLiteFirestoreProxy()
            return _FIRESTORE_CLIENT

        project = gcp_project_id()
        try:
            _FIRESTORE_CLIENT = g_firestore.Client(project=project)
        except Exception as exc:
            logger.warning("Failed to initialize Firestore client, falling back to local SQLite emulator: %s", exc)
            _use_local_fallback = True
            init_emulator_db()
            _FIRESTORE_CLIENT = SQLiteFirestoreProxy()
            return _FIRESTORE_CLIENT
        return _FIRESTORE_CLIENT


def _safe_doc_id(value: Any) -> str:
    raw = str(value or "").strip()
    if raw and "/" not in raw:
        return raw
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"key_{digest}"


def _loads_json(value: Any, fallback: Any = None) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if value is None:
        return fallback
    try:
        return json.loads(str(value))
    except Exception:
        return fallback


def _doc_to_dict(doc: Any) -> dict[str, Any] | None:
    if not doc or not doc.exists:
        return None
    data = doc.to_dict() or {}
    if isinstance(data, dict):
        return data
    return None


def _query_stream(query: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for doc in query.stream():
        data = doc.to_dict() or {}
        if isinstance(data, dict):
            data.setdefault("_doc_id", doc.id)
            rows.append(data)
    return rows


def init_store() -> None:
    _client()


def upsert_workflow_event(workflow_id: str, stage: str, confidence: float) -> dict:
    updated_at = _now()
    payload = {"workflow_id": workflow_id, "stage": stage, "confidence": confidence, "updated_at": updated_at}
    _client().collection("workflow_events").document(workflow_id).set(payload, merge=True)
    return payload


def get_workflow_event(workflow_id: str) -> dict | None:
    return _doc_to_dict(_client().collection("workflow_events").document(workflow_id).get())


def add_audit(action: str, payload: str = "") -> None:
    created_at = _now()
    doc = _client().collection("audit_entries").document()
    doc.set({"id": doc.id, "action": action, "payload": payload, "created_at": created_at, "timestamp": created_at})


def list_audit(limit: int = 50) -> list[dict]:
    rows = _query_stream(_client().collection("audit_entries").order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit))
    return [
        {"id": row.get("id") or row.get("_doc_id"), "action": row.get("action", ""), "payload": row.get("payload", ""), "timestamp": row.get("timestamp") or row.get("created_at", "")}
        for row in rows
    ]


def get_audit(audit_id: int | str) -> dict | None:
    doc_id = str(audit_id)
    data = _doc_to_dict(_client().collection("audit_entries").document(doc_id).get())
    if not data:
        return None
    return {"id": data.get("id") or doc_id, "action": data.get("action", ""), "payload": data.get("payload", ""), "timestamp": data.get("timestamp") or data.get("created_at", "")}


def _upsert_payload_doc(collection: str, doc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    updated_at = _now()
    data = dict(payload)
    data.setdefault("workflow_id", doc_id)
    data["updated_at"] = updated_at
    _client().collection(collection).document(doc_id).set(data, merge=True)
    return {"workflow_id": doc_id, "updated_at": updated_at}


def _get_payload_doc(collection: str, doc_id: str) -> dict[str, Any] | None:
    data = _doc_to_dict(_client().collection(collection).document(doc_id).get())
    if not data:
        return None
    data.setdefault("workflow_id", doc_id)
    return data


def upsert_workflow_report(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return _upsert_payload_doc("workflow_reports", workflow_id, payload)


def get_workflow_report(workflow_id: str) -> dict[str, Any] | None:
    return _get_payload_doc("workflow_reports", workflow_id)


def upsert_workflow_checkpoint(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return _upsert_payload_doc("workflow_checkpoints", workflow_id, payload)


def get_workflow_checkpoint(workflow_id: str) -> dict[str, Any] | None:
    return _get_payload_doc("workflow_checkpoints", workflow_id)


def upsert_workflow_outcome(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return _upsert_payload_doc("workflow_outcomes", workflow_id, payload)


def list_workflow_outcomes(limit: int = 200) -> list[dict[str, Any]]:
    rows = _query_stream(_client().collection("workflow_outcomes").order_by("updated_at", direction=g_firestore.Query.DESCENDING).limit(limit))
    return rows


def create_user(user_id: str, email: str, password_hash: str, company_name: str = "", full_name: str = "") -> dict:
    created_at = _now()
    email_l = email.lower()
    payload = {
        "user_id": user_id,
        "email": email_l,
        "password_hash": password_hash,
        "company_name": company_name,
        "full_name": full_name,
        "created_at": created_at,
    }
    db = _client()
    db.collection("users").document(user_id).set(payload)
    db.collection("user_email_index").document(_safe_doc_id(email_l)).set({"user_id": user_id, "email": email_l})
    return payload


def get_user_by_email(email: str) -> dict | None:
    email_l = email.lower()
    db = _client()
    idx = _doc_to_dict(db.collection("user_email_index").document(_safe_doc_id(email_l)).get())
    if idx and idx.get("user_id"):
        return get_user_by_id(str(idx["user_id"]))
    rows = _query_stream(
        db.collection("users")
        .where(filter=FieldFilter("email", "==", email_l))
        .limit(1)
    )
    return rows[0] if rows else None


def get_user_by_id(user_id: str) -> dict | None:
    return _doc_to_dict(_client().collection("users").document(user_id).get())


def upsert_context(user_id: str, payload_json: str) -> dict:
    updated_at = _now()
    payload = _loads_json(payload_json, {})
    if not isinstance(payload, dict):
        payload = {}
    payload["user_id"] = user_id
    payload["updated_at"] = updated_at
    db = _client()
    db.collection("contexts").document(user_id).set(payload, merge=True)
    sync_graph_to_firestore(user_id, payload)
    return {"user_id": user_id, "updated_at": updated_at}


def get_context(user_id: str) -> dict | None:
    data = _doc_to_dict(_client().collection("contexts").document(user_id).get())
    if not data:
        return None
    return {"user_id": user_id, "payload_json": json.dumps(data), "updated_at": data.get("updated_at", "")}


def list_contexts(limit: int = 500) -> list[dict[str, Any]]:
    rows = _query_stream(
        _client().collection("contexts").order_by("updated_at", direction=g_firestore.Query.DESCENDING).limit(limit)
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        user_id = str(row.get("user_id") or row.get("_doc_id") or "").strip()
        if not user_id:
            continue
        out.append(
            {
                "user_id": user_id,
                "payload_json": json.dumps(row),
                "updated_at": row.get("updated_at", ""),
            }
        )
    return out


def sync_graph_to_firestore(user_id: str, payload: dict[str, Any]) -> None:
    db = _client()
    tenant_id = user_id
    nodes_ref = db.collection("tenants").document(tenant_id).collection("graph_nodes")
    batch = db.batch()
    for doc in nodes_ref.limit(500).stream():
        batch.delete(doc.reference)
    for idx, supplier in enumerate(payload.get("suppliers") or []):
        if not isinstance(supplier, dict):
            continue
        node_id = str(supplier.get("id") or hashlib.sha256(str(supplier.get("name", idx)).encode("utf-8")).hexdigest()[:16])
        data = dict(supplier)
        data.update({"tenant_id": tenant_id, "node_id": node_id, "node_type": "supplier", "updated_at": payload.get("updated_at") or _now()})
        batch.set(nodes_ref.document(_safe_doc_id(node_id)), data, merge=True)
    for idx, node in enumerate(payload.get("logistics_nodes") or []):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or hashlib.sha256(str(node.get("name", idx)).encode("utf-8")).hexdigest()[:16])
        data = dict(node)
        data.update({"tenant_id": tenant_id, "node_id": node_id, "node_type": "logistics", "updated_at": payload.get("updated_at") or _now()})
        batch.set(nodes_ref.document(_safe_doc_id(node_id)), data, merge=True)
    batch.commit()


def insert_signal(signal_id: str, payload_json: str) -> None:
    payload = _loads_json(payload_json, {})
    _client().collection("signals").document(_safe_doc_id(signal_id)).set({"signal_id": signal_id, "payload": payload, "created_at": _now()}, merge=True)


def list_signals(limit: int = 50) -> list[dict[str, Any]]:
    rows = _query_stream(_client().collection("signals").order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit))
    return [{"signal_id": r.get("signal_id") or r.get("_doc_id"), "payload_json": json.dumps(r.get("payload") or {}), "created_at": r.get("created_at", "")} for r in rows]


def _strip_volatile_keys(data: Any, volatile_keys: set[str]) -> Any:
    if isinstance(data, dict):
        return {
            k: _strip_volatile_keys(v, volatile_keys)
            for k, v in data.items()
            if k not in volatile_keys
        }
    if isinstance(data, list):
        return [_strip_volatile_keys(x, volatile_keys) for x in data]
    return data


def replace_active_signals(items: list[dict[str, Any]]) -> None:
    db = _client()
    now = _now()
    incoming: dict[str, dict[str, Any]] = {}
    incoming_hashes: dict[str, str] = {}
    
    volatile_keys = {
        "created_at", "updated_at", "last_seen", "ingested_at",
        "retrieved_at", "pipeline_run_id", "last_refresh"
    }
    stats = {"incoming": len(items), "archived": 0, "skipped": 0, "updated": 0, "new": 0}
    
    for item in items:
        signal_id = str(item.get("id") or item.get("signal_id") or "").strip()
        if not signal_id:
            basis = f"{item.get('source','')}|{item.get('title','')}|{item.get('location','')}|{item.get('created_at','')}"
            signal_id = f"sig_{hashlib.sha256(basis.encode('utf-8')).hexdigest()[:16]}"
        incoming[signal_id] = item
        
        # Deterministic hashing excluding volatile fields
        payload_for_hash = _strip_volatile_keys(item, volatile_keys)
        payload_str = json.dumps(payload_for_hash, sort_keys=True, separators=(",", ":"))
        incoming_hashes[_safe_doc_id(signal_id)] = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()

    batch = db.batch()
    incoming_doc_ids_list = [_safe_doc_id(k) for k in incoming]
    incoming_doc_ids_set = set(incoming_doc_ids_list)
    
    redis_client = _get_sync_redis()
    cached_ids = set()
    stored_hashes = {}
    
    if redis_client:
        try:
            members = redis_client.smembers("active_signal_ids")
            if members:
                cached_ids = set(members)
                
            if incoming_doc_ids_list:
                keys = [f"signal_hash:{doc_id}" for doc_id in incoming_doc_ids_list]
                hash_vals = redis_client.mget(keys)
                for doc_id, hval in zip(incoming_doc_ids_list, hash_vals):
                    if hval:
                        stored_hashes[doc_id] = hval
        except Exception as exc:
            logger.warning("Redis operation failed in replace_active_signals: %s", exc)
            redis_client = None

    if redis_client:
        stale_ids = cached_ids - incoming_doc_ids_set
        for doc_id in stale_ids:
            doc = db.collection("signals").document(doc_id).get()
            if doc.exists:
                stats["archived"] += 1
                data = doc.to_dict() or {}
                archived_id = f"{doc_id}_{hashlib.sha256(now.encode('utf-8')).hexdigest()[:8]}"
                batch.set(db.collection("signals_archive").document(archived_id), {**data, "archived_at": now}, merge=True)
                batch.delete(db.collection("signals").document(doc_id))
    else:
        logger.warning("Skipping archive reconciliation because Redis is unavailable")

    for signal_id, payload in incoming.items():
        doc_id = _safe_doc_id(signal_id)
        new_hash = incoming_hashes[doc_id]
        
        # Skip writes for unchanged payloads
        if redis_client and stored_hashes.get(doc_id) == new_hash:
            stats["skipped"] += 1
            continue
            
        # Update existing vs insert new
        is_existing = doc_id in cached_ids or doc_id in stored_hashes
        
        if not redis_client:
            is_existing = db.collection("signals").document(doc_id).get().exists

        write_payload = dict(payload)
        
        if is_existing:
            stats["updated"] += 1
            # Pop created_at to avoid rewriting it
            write_payload.pop("created_at", None)
            batch.set(db.collection("signals").document(doc_id), {"signal_id": signal_id, "payload": write_payload}, merge=True)
        else:
            stats["new"] += 1
            write_payload["created_at"] = write_payload.get("created_at") or now
            batch.set(db.collection("signals").document(doc_id), {"signal_id": signal_id, "payload": write_payload, "created_at": write_payload["created_at"]}, merge=True)
            
    batch.commit()
    logger.info("replace_active_signals complete: %d incoming, %d archived, %d skipped, %d updated, %d new", 
                stats["incoming"], stats["archived"], stats["skipped"], stats["updated"], stats["new"])

    if redis_client:
        try:
            pipe = redis_client.pipeline()
            temp_key = f"active_signal_ids_tmp_{uuid4().hex[:8]}"
            if incoming_doc_ids_list:
                pipe.sadd(temp_key, *incoming_doc_ids_list)
                pipe.rename(temp_key, "active_signal_ids")
            else:
                pipe.delete("active_signal_ids")
            
            for doc_id, new_hash in incoming_hashes.items():
                pipe.set(f"signal_hash:{doc_id}", new_hash, ex=2592000) # 30 days TTL for hashes
            pipe.execute()
        except Exception as exc:
            logger.warning("Failed to update Redis cache for active signals: %s", exc)


def purge_archived_signals(days: int = 7) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    docs = list(
        _client()
        .collection("signals_archive")
        .where(filter=FieldFilter("archived_at", "<", cutoff))
        .stream()
    )
    batch = _client().batch()
    for doc in docs:
        batch.delete(doc.reference)
    if docs:
        batch.commit()
    return len(docs)


def create_rfq_event(rfq_id: str, user_id: str, recipient: str, subject: str, body: str, status: str) -> dict:
    return create_rfq_event_linked(rfq_id, user_id, None, recipient, subject, body, status)


def create_rfq_event_linked(rfq_id: str, user_id: str, workflow_id: str | None, recipient: str, subject: str, body: str, status: str) -> dict:
    created_at = _now()
    payload = {"rfq_id": rfq_id, "user_id": user_id, "workflow_id": workflow_id, "recipient": recipient, "subject": subject, "body": body, "status": status, "created_at": created_at}
    _client().collection("rfq_events").document(rfq_id).set(payload)
    return {"rfq_id": rfq_id, "status": status, "created_at": created_at}


def list_rfq_events(limit: int = 50) -> list[dict]:
    return _query_stream(_client().collection("rfq_events").order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit))


def update_rfq_status(rfq_id: str, status: str) -> dict[str, Any] | None:
    ref = _client().collection("rfq_events").document(rfq_id)
    if not ref.get().exists:
        return None
    ref.set({"status": status}, merge=True)
    return {"rfq_id": rfq_id, "status": status}


def add_rfq_message(rfq_id: str, direction: str, sender: str | None, body: str) -> dict[str, Any]:
    created_at = _now()
    doc = _client().collection("rfq_events").document(rfq_id).collection("messages").document()
    payload = {"id": doc.id, "rfq_id": rfq_id, "direction": direction, "sender": sender, "body": body, "created_at": created_at}
    doc.set(payload)
    return payload


def list_rfq_messages(rfq_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = _query_stream(_client().collection("rfq_events").document(rfq_id).collection("messages").order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit))
    return list(reversed(rows))


def insert_reasoning_step(workflow_id: str, agent: str, stage: str, detail: str, status: str = "success", output: dict[str, Any] | None = None, timestamp: str | None = None, timestamp_ms: int | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    ts = timestamp or now.isoformat()
    ms = int(now.timestamp() * 1000) if timestamp_ms is None or timestamp_ms <= 0 else timestamp_ms
    payload = {"agent": agent, "stage": stage, "detail": detail, "status": status, "output": output or {}, "timestamp": ts, "timestamp_ms": ms}
    _client().collection("workflow_events").document(workflow_id).collection("reasoning").document().set(payload)
    return payload


def list_reasoning_steps(workflow_id: str, limit: int = 100) -> list[dict[str, Any]]:
    return _query_stream(_client().collection("workflow_events").document(workflow_id).collection("reasoning").order_by("timestamp_ms").limit(limit))


def list_workflow_reports(limit: int = 100) -> list[dict[str, Any]]:
    rows = _query_stream(_client().collection("workflow_reports").order_by("updated_at", direction=g_firestore.Query.DESCENDING).limit(limit))
    return [{"workflow_id": r.get("workflow_id") or r.get("_doc_id"), "updated_at": r.get("updated_at", ""), "summary": r.get("summary") if isinstance(r.get("summary"), dict) else {}} for r in rows]


def cache_set_entry(cache_key: str, payload: Any, ttl_seconds: int = 1800) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(seconds=max(0, ttl_seconds))).isoformat() if ttl_seconds > 0 else None
    _client().collection("cache_entries").document(_safe_doc_id(cache_key)).set({"cache_key": cache_key, "payload": payload, "expires_at": expires_at, "updated_at": now.isoformat()}, merge=True)
    return {"cache_key": cache_key, "expires_at": expires_at}


def cache_get_entry(cache_key: str) -> Any | None:
    ref = _client().collection("cache_entries").document(_safe_doc_id(cache_key))
    data = _doc_to_dict(ref.get())
    if not data:
        return None
    expires_at = data.get("expires_at")
    if expires_at and str(expires_at) <= _now():
        ref.delete()
        return None
    return data.get("payload")


def cache_delete_entry(cache_key: str) -> None:
    _client().collection("cache_entries").document(_safe_doc_id(cache_key)).delete()


def cache_prune_expired() -> int:
    docs = list(
        _client()
        .collection("cache_entries")
        .where(filter=FieldFilter("expires_at", "<=", _now()))
        .stream()
    )
    batch = _client().batch()
    for doc in docs:
        batch.delete(doc.reference)
    if docs:
        batch.commit()
    return len(docs)


def upsert_incident(incident_id: str, payload: dict[str, Any], status: str, severity: str, tenant_id: str = "default") -> dict[str, Any]:
    now = _now()
    ref = _client().collection("tenants").document(tenant_id).collection("incidents").document(incident_id)
    existing = _doc_to_dict(ref.get()) or {}
    created_at = existing.get("created_at") or now
    data = dict(payload)
    data.update({"id": incident_id, "tenant_id": tenant_id, "status": status, "severity": severity, "created_at": created_at, "updated_at": now})
    ref.set(data, merge=True)
    return {"id": incident_id, "status": status, "updated_at": now}


def _incident_doc_to_api(data: dict[str, Any], doc_id: str = "") -> dict[str, Any]:
    out = dict(data)
    out.setdefault("id", doc_id or data.get("_doc_id", ""))
    out.setdefault("status", data.get("status", ""))
    out.setdefault("severity", data.get("severity", ""))
    return out


def get_incident(incident_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
    db = _client()
    if tenant_id:
        data = _doc_to_dict(db.collection("tenants").document(tenant_id).collection("incidents").document(incident_id).get())
        return _incident_doc_to_api(data, incident_id) if data else None
    for doc in (
        db.collection_group("incidents")
        .where(filter=FieldFilter("id", "==", incident_id))
        .limit(1)
        .stream()
    ):
        data = doc.to_dict() or {}
        return _incident_doc_to_api(data, doc.id)
    return None


def _is_visible_incident_record(data: dict[str, Any]) -> bool:
    if bool(data.get("simulation_only")):
        return False
    if str(data.get("simulation_outcome") or "").strip().lower() == "no_impact":
        return False
    try:
        affected_node_count = int(data.get("affected_node_count") or 0)
    except (TypeError, ValueError):
        affected_node_count = 0
    return affected_node_count > 0


def _is_simulation_incident_record(data: dict[str, Any]) -> bool:
    return bool(data.get("simulation_only"))


def delete_incident(incident_id: str, tenant_id: str | None = None) -> int:
    db = _client()
    refs: list[Any] = []
    if tenant_id:
        refs = [db.collection("tenants").document(tenant_id).collection("incidents").document(incident_id)]
    else:
        refs = [
            doc.reference
            for doc in db.collection_group("incidents")
            .where(filter=FieldFilter("id", "==", incident_id))
            .stream()
        ]
    deleted = 0
    for ref in refs:
        if ref.get().exists:
            ref.delete()
            deleted += 1
    return deleted


def list_incidents(status: str | None = None, limit: int = 50, tenant_id: str | None = None, visibility: str = "visible") -> list[dict[str, Any]]:
    db = _client()
    query = db.collection("tenants").document(tenant_id).collection("incidents") if tenant_id else db.collection_group("incidents")
    if visibility == "simulation":
        query = query.where(filter=FieldFilter("simulation_only", "==", True))
    if status:
        # Apply only the equality filter; order_by on a different field would require a composite
        # index. Fetch a larger batch and sort in Python instead.
        query = query.where(filter=FieldFilter("status", "==", status))
        rows = _query_stream(query.limit(limit * 2))
        rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    else:
        rows = _query_stream(query.order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit * 2))
    results: list[dict[str, Any]] = []
    for row in rows:
        data = _incident_doc_to_api(row, str(row.get("_doc_id") or ""))
        if visibility == "simulation":
            if not _is_simulation_incident_record(data):
                continue
        elif visibility != "all" and not _is_visible_incident_record(data):
            continue
        results.append(data)
        if len(results) >= limit:
            break
    return results


def list_simulation_incidents(status: str | None = None, limit: int = 50, tenant_id: str | None = None) -> list[dict[str, Any]]:
    return list_incidents(status=status, limit=limit, tenant_id=tenant_id, visibility="simulation")


def update_incident_status(incident_id: str, status: str, extra_fields: dict[str, Any] | None = None, tenant_id: str | None = None) -> dict[str, Any] | None:
    existing = get_incident(incident_id, tenant_id)
    if not existing:
        return None
    if extra_fields:
        existing.update(extra_fields)
    return upsert_incident(incident_id, existing, status, str(existing.get("severity") or "LOW"), tenant_id or str(existing.get("tenant_id") or "default"))


def count_incidents_by_status(tenant_id: str | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in list_incidents(limit=1000, tenant_id=tenant_id):
        key = str(item.get("status") or "").strip()
        if key:
            counts[key] = counts.get(key, 0) + 1
    return counts


def purge_stale_incidents(tenant_id: str | None = None, max_age_days: int = 7) -> dict[str, Any]:
    """Auto-resolve incidents that have been in active status for longer than max_age_days.

    Active statuses: DETECTED, ANALYZED, AWAITING_APPROVAL.
    These are moved to AUTO_RESOLVED with a note about staleness.
    Also resolves active incidents whose underlying event is no longer fresh.
    """
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=max_age_days)).isoformat()
    active_statuses = {"DETECTED", "ANALYZED", "AWAITING_APPROVAL"}
    all_active = list_incidents(limit=500, tenant_id=tenant_id, visibility="all")
    stale: list[dict[str, Any]] = []
    for inc in all_active:
        status = str(inc.get("status") or "").strip().upper()
        if status not in active_statuses:
            continue
        if not is_incident_fresh(inc, max_incident_days=max_age_days, max_event_days=30):
            stale.append(inc)
            continue
        created_at = str(inc.get("created_at") or "")
        if not created_at:
            continue
        if created_at < cutoff:
            stale.append(inc)
    resolved_ids: list[str] = []
    for inc in stale:
        inc_id = str(inc.get("id") or "")
        if not inc_id:
            continue
        update_incident_status(
            inc_id,
            "AUTO_RESOLVED",
            {
                "auto_resolved_at": now.isoformat(),
                "auto_resolved_reason": f"Stale incident (>{max_age_days} days in active status)",
            },
            tenant_id=tenant_id,
        )
        resolved_ids.append(inc_id)
    return {"purged_count": len(resolved_ids), "purged_ids": resolved_ids}


def append_master_data_change(user_id: str, change_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    created_at = _now()
    doc = _client().collection("users").document(user_id).collection("master_data_changes").document()
    data = {"id": doc.id, "user_id": user_id, "change_type": change_type, "payload": payload, "created_at": created_at}
    doc.set(data)
    return {"user_id": user_id, "change_type": change_type, "created_at": created_at}


def list_master_data_changes(user_id: str, limit: int = 200) -> list[dict[str, Any]]:
    return _query_stream(_client().collection("users").document(user_id).collection("master_data_changes").order_by("created_at", direction=g_firestore.Query.DESCENDING).limit(limit))


def upsert_orchestration_run(run_id: str, orchestration_path: str, entity_id: str, status: str, payload: dict[str, Any], tenant_id: str = "default") -> dict[str, Any]:
    now = _now()
    ref = _client().collection("tenants").document(tenant_id).collection("orchestration_runs").document(run_id)
    existing = _doc_to_dict(ref.get()) or {}
    data = {"run_id": run_id, "orchestration_path": orchestration_path, "entity_id": entity_id, "tenant_id": tenant_id, "status": status, "payload": payload, "created_at": existing.get("created_at") or now, "updated_at": now}
    ref.set(data, merge=True)
    return {"run_id": run_id, "status": status, "updated_at": now}


def get_orchestration_run(run_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
    db = _client()
    if tenant_id:
        return _doc_to_dict(db.collection("tenants").document(tenant_id).collection("orchestration_runs").document(run_id).get())
    for doc in (
        db.collection_group("orchestration_runs")
        .where(filter=FieldFilter("run_id", "==", run_id))
        .limit(1)
        .stream()
    ):
        return doc.to_dict() or {}
    return None


def list_orchestration_runs(entity_id: str | None = None, tenant_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    db = _client()
    query = db.collection("tenants").document(tenant_id).collection("orchestration_runs") if tenant_id else db.collection_group("orchestration_runs")
    if entity_id:
        # Avoid composite index: filter only, sort in Python.
        rows = _query_stream(query.where(filter=FieldFilter("entity_id", "==", entity_id)).limit(limit * 3))
        rows.sort(key=lambda r: r.get("updated_at", ""), reverse=True)
        return rows[:limit]
    return _query_stream(query.order_by("updated_at", direction=g_firestore.Query.DESCENDING).limit(limit))


def get_global_impacted_tenants(duns_number: str) -> list[str]:
    if not duns_number:
        return []
    tenants: set[str] = set()
    for doc in (
        _client()
        .collection_group("graph_nodes")
        .where(filter=FieldFilter("dunsNumber", "==", duns_number))
        .stream()
    ):
        data = doc.to_dict() or {}
        tenant = str(data.get("tenant_id") or "").strip()
        if tenant:
            tenants.add(tenant)
    for doc in (
        _client()
        .collection_group("graph_nodes")
        .where(filter=FieldFilter("duns_number", "==", duns_number))
        .stream()
    ):
        data = doc.to_dict() or {}
        tenant = str(data.get("tenant_id") or "").strip()
        if tenant:
            tenants.add(tenant)
    return sorted(tenants)


if _should_use_local():
    import services.local_store as local_store
    local_store.init_local_store()
    for name in list(globals().keys()):
        if name.startswith("_") or name in ("init_store", "init_emulator_db", "gcp_project_id", "DB_PATH"):
            continue
        if hasattr(local_store, name):
            globals()[name] = getattr(local_store, name)
    globals()["init_store"] = local_store.init_local_store
