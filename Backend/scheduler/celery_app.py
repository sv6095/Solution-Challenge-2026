import os
from celery import Celery

# Uses local Redis by default for dev, but Cloud Memorystore / Upstash in prod
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "praecantator_scheduler",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["scheduler.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_track_started=True,
    result_expires=86400,
    # Celery Beat config for distributed autonomous execution
    beat_schedule={
        "poll-signals-every-20-minutes": {
            "task": "scheduler.tasks.poll_signals",
            "schedule": float(os.getenv("SIGNAL_POLL_INTERVAL_SECONDS", "1200")),
        },
        "refresh-worldmonitor-every-15-minutes": {
            "task": "scheduler.tasks.refresh_worldmonitor",
            "schedule": float(os.getenv("WORLDMONITOR_REFRESH_INTERVAL_SECONDS", "900")),
        },
    }
)
