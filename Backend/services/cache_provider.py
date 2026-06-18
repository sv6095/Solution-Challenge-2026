from __future__ import annotations

import asyncio
import json
import os
import time
from uuid import uuid4
from typing import Any

from .firestore_store import cache_get_entry, cache_prune_expired, cache_set_entry

CACHE_PROVIDER = (os.getenv("CACHE_PROVIDER") or "memory").strip().lower()
REDIS_URL = (os.getenv("REDIS_URL") or "redis://localhost:6379/0").strip()

# In-memory: value -> (payload, expires_at_monotonic or None)
_memory: dict[str, tuple[Any, float | None]] = {}
_redis_client: Any | None = None
_singleflight_locks: dict[str, asyncio.Lock] = {}
_singleflight_guard = asyncio.Lock()


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

        _redis_client = Redis.from_url(
            _redis_url(),
            decode_responses=True,
            socket_connect_timeout=1.0,
            socket_timeout=2.0,
        )
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
        # Redis unavailable — fall through to Firestore/memory
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
        except Exception:
            pass  # Non-critical: in-memory cache already populated

    if _cache_provider() == "redis":
        client = await _get_redis_client()
        if client is not None:
            try:
                from fastapi.encoders import jsonable_encoder
                payload = json.dumps(jsonable_encoder(value)) if not isinstance(value, (str, bytes)) else value
                await client.set(key, payload, ex=ttl_seconds if ttl_seconds > 0 else None)
                # Fire Firestore write in the background — don't block the response.
                _asyncio.ensure_future(_background_firestore_write())
                return
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Redis cache_set failed for key %s: %s", key, e)
                pass
        # Redis unavailable — fall through to in-memory + Firestore.
        _memory_set(key, value, ttl_seconds)
        _asyncio.ensure_future(_background_firestore_write())
        return

    # Memory-only provider: write memory synchronously, Firestore asynchronously.
    cache_prune_expired()
    _memory_set(key, value, ttl_seconds)
    _asyncio.ensure_future(_background_firestore_write())


async def _acquire_distributed_lock(
    key: str,
    *,
    lock_timeout_seconds: int,
) -> tuple[Any | None, str | None, str | None, bool]:
    if _cache_provider() != "redis":
        return None, None, None, False
    client = await _get_redis_client()
    if client is None:
        return None, None, None, False
    lock_key = f"lock:{key}"
    token = uuid4().hex
    try:
        acquired = await client.set(lock_key, token, nx=True, ex=max(1, lock_timeout_seconds))
        return client, lock_key, token, bool(acquired)
    except Exception:
        return None, None, None, False


async def _release_distributed_lock(client: Any, lock_key: str, token: str) -> None:
    try:
        # Release only when this owner still holds the lock.
        await client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then "
            "return redis.call('del', KEYS[1]) else return 0 end",
            1,
            lock_key,
            token,
        )
    except Exception:
        pass


async def _singleflight_lock_for(key: str) -> asyncio.Lock:
    async with _singleflight_guard:
        lock = _singleflight_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _singleflight_locks[key] = lock
        return lock


async def cache_get_or_set(
    key: str,
    producer: Any,
    *,
    ttl_seconds: int = 1800,
    lock_timeout_seconds: int = 15,
    wait_timeout_seconds: float = 3.0,
) -> Any:
    """
    Read-through cache with local single-flight and optional Redis distributed lock.

    Prevents cache stampedes on TTL expiry when many concurrent requests ask for
    the same key at once.
    """
    cached = await cache_get(key)
    if cached is not None:
        return cached

    lock = await _singleflight_lock_for(key)
    async with lock:
        cached = await cache_get(key)
        if cached is not None:
            return cached

        client, lock_key, token, acquired = await _acquire_distributed_lock(
            key,
            lock_timeout_seconds=lock_timeout_seconds,
        )

        if not acquired and client is not None:
            deadline = time.monotonic() + max(0.1, wait_timeout_seconds)
            while time.monotonic() < deadline:
                await asyncio.sleep(0.1)
                cached = await cache_get(key)
                if cached is not None:
                    return cached

        try:
            cached = await cache_get(key)
            if cached is not None:
                return cached
            data = producer() if callable(producer) else producer
            if asyncio.iscoroutine(data):
                data = await data
            await cache_set(key, data, ttl_seconds=ttl_seconds)
            return data
        finally:
            if acquired and client is not None and lock_key and token:
                await _release_distributed_lock(client, lock_key, token)
