# ── Stage 1: builder ─────────────────────────────────────────────────────────
# Installs all Python deps into an isolated venv inside a throw-away layer.
# Using a venv means the runtime stage copies exactly ONE directory (/venv)
# instead of patching system site-packages and /usr/local/bin (which would
# leak compiler binaries into the final image).
FROM python:3.11.13-slim AS builder

WORKDIR /build

# Build-time system deps (gcc required for some wheels: argon2-cffi, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        build-essential \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create the venv. All pip installs below write to /venv — never to the
# system Python — so the runtime stage only needs to copy /venv.
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY requirements.txt .

# Install PyTorch CPU-only FIRST.
# Without an explicit index-url, pip resolves the CUDA wheel (~2.5 GB).
# CPU wheel is ~200 MB and sufficient for inference on EC2 CPU instances.
RUN pip install --no-cache-dir \
        torch==2.3.1 \
        --index-url https://download.pytorch.org/whl/cpu

# torch_geometric version-detects torch at install time — torch must exist first.
RUN pip install --no-cache-dir torch_geometric==2.5.3

# Install everything else. pip sees torch + torch_geometric are already at the
# required versions and skips them, so no duplicate downloads.
RUN pip install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11.13-slim AS runtime

WORKDIR /app

# curl is the only runtime system dep (used by HEALTHCHECK).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the venv from builder — a single directory, no compiler binaries leaked.
COPY --from=builder /venv /venv

# Activate the venv for all subsequent RUN, CMD, and ENTRYPOINT instructions.
ENV VIRTUAL_ENV=/venv \
    PATH="/venv/bin:$PATH"

# Copy application source (.dockerignore strips secrets, DBs, scratch/, etc.)
COPY . .

# Run as a non-root user (principle of least privilege).
RUN mkdir -p /app/data \
    && addgroup --system appgroup \
    && adduser --system --ingroup appgroup appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

# Startup can be slow (torch import + model load) so give 90 s before first check.
# Use /api/ping (lightweight, no DB calls) not /health (runs disruption_snapshot + registry queries).
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -f http://localhost:8000/api/ping || exit 1

# IMPORTANT: Keep workers=1. main.py starts APScheduler, worldmonitor_cron_loop,
# ChatbotManager, and WorkflowGraphManager at module/startup level.
# Multiple workers would fork all background tasks, causing duplicate schedulers
# and duplicate cron jobs. Use a single worker for this architecture.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]
