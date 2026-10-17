# ATHERYN web: the engine, its HTTP API and the static site in one image.
# Linux is required — experiments are confined with POSIX rlimits.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    ATHERYN_RUNS_DIR=/data/runs \
    ATHERYN_TRUST_PROXY=1

WORKDIR /app

# Missions run as an unprivileged user; /data is the only writable path.
RUN useradd --create-home --uid 10001 atheryn \
 && mkdir -p /data/runs \
 && chown -R atheryn:atheryn /data

COPY --chown=atheryn:atheryn atheryn ./atheryn
COPY --chown=atheryn:atheryn atheryn_server ./atheryn_server
COPY --chown=atheryn:atheryn web ./web
COPY --chown=atheryn:atheryn examples ./examples

USER atheryn
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)"

CMD ["python", "-m", "atheryn_server"]
