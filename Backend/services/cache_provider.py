from __future__ import annotations

import json
import os
import time
from typing import Any

from .firestore_store import cache_get_entry, cache_prune_expired, cache_set_entry

CACHE_PROVIDER = (os.getenv("CACHE_PROVIDER") or "memory").strip().lower()
REDIS_URL = (os.getenv("REDIS_URL") or "redis://localhost:6379/0").strip()

# In-memory: value -> (payload, expires_at_monotonic or None)
_memory: dict[str, tuple[Any, float | None]] = {}
_redis_client: Any | None = None


def _cache_provider() -> str:
    return (os.getenv("CACHE_PROVIDER") or CACHE_PROVIDER or "memory").strip().lower()


def _redis_url() -> str:
    return (os.getenv("REDIS_URL") or REDIS_URL or "redis://localhost:6379/0").strip()


async def _get_redis_client() -> Any | None:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        from redis.asyncio import Redis

        _redis_client = Redis.from_url(_redis_url(), decode_responses=True, socket_connect_timeout=1.0, socket_timeout=2.0)
        await _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_client = None
        return None


def _memory_get(key: str) -> Any | None:
    row = _memory.get(key)
    if row is None:
        return None
    val, exp = row
    if exp is not None and time.monotonic() > exp:
        _memory.pop(key, None)
        return None
    return val


def _memory_set(key: str, value: Any, ttl_seconds: int) -> None:
    exp = time.monotonic() + float(ttl_seconds) if ttl_seconds > 0 else None
    _memory[key] = (value, exp)


async def cache_get(key: str) -> Any | None:
    if _cache_provider() == "redis":
        client = await _get_redis_client()
        if client is not None:
            try:
                raw = await client.get(key)
                if raw is None:
                    return None
                try:
                    return json.loads(raw)
                except Exception:
                    return raw
            except Exception:
                pass
        try:
            from upstash_redis import Redis

            url = (os.getenv("UPSTASH_REDIS_REST_URL") or "").strip()
            token = (os.getenv("UPSTASH_REDIS_REST_TOKEN") or "").strip()
            if not (url and token):
                raise RuntimeError("Upstash REST credentials are not configured")
            r = Redis(url=url, token=token)
            raw = r.get(key)
            if raw is None:
                return None
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8", errors="replace")
            try:
                return json.loads(raw)
            except Exception:
                return raw
        except Exception:
            cached_value = cache_get_entry(key)
            if cached_value is not None:
                return cached_value
            return _memory_get(key)
    cached_value = cache_get_entry(key)
    if cached_value is not None:
        return cached_value
    return _memory_get(key)


async def cache_set(key: str, value: Any, ttl_seconds: int = 1800) -> None:
    import asyncio as _asyncio

    def _write_to_firestore() -> None:
        """Blocking Firestore write, executed off the event-loop thread."""
        cache_set_entry(key, value, ttl_seconds)

    async def _background_firestore_write() -> None:
        try:
            loop = _asyncio.get_event_loop()
            await loop.run_in_executor(None, _write_to_firestore)
        except Exception as exc:
            pass  # Non-critical: in-memory cache already populated

    if _cache_provider() == "redis":
        client = await _get_redis_client()
        if client is not None:
            try:
                payload = json.dumps(value) if not isinstance(value, (str, bytes)) else value
                await client.set(key, payload, ex=ttl_seconds if ttl_seconds > 0 else None)
                # Fire Firestore write in the background — don't block the response.
                _asyncio.ensure_future(_background_firestore_write())
                return
            except Exception:
                pass
        try:
            from upstash_redis import Redis

            url = (os.getenv("UPSTASH_REDIS_REST_URL") or "").strip()
            token = (os.getenv("UPSTASH_REDIS_REST_TOKEN") or "").strip()
            if not (url and token):
                raise RuntimeError("Upstash REST credentials are not configured")
            r = Redis(url=url, token=token)
            payload = json.dumps(value) if not isinstance(value, (str, bytes)) else value
            r.set(key, payload, ex=ttl_seconds)
            # Fire Firestore write in the background — don't block the response.
            _asyncio.ensure_future(_background_firestore_write())
            return
        except Exception:
            # Both Redis paths failed — fall through to in-memory + Firestore.
            _memory_set(key, value, ttl_seconds)
            _asyncio.ensure_future(_background_firestore_write())
            return
    # Memory-only provider: write memory synchronously, Firestore asynchronously.
    cache_prune_expired()
    _memory_set(key, value, ttl_seconds)
    _asyncio.ensure_future(_background_firestore_write())
