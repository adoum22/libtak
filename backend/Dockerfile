FROM python:3.11-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN python -m venv "$VIRTUAL_ENV" \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && pip install --upgrade pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .
RUN pip install -r requirements.txt


FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    SQLITE_PATH=/app/data/db.sqlite3 \
    STATIC_ROOT=/app/staticfiles \
    MEDIA_ROOT=/app/media \
    LIBTAK_BACKUP_DIR=/home/libtak/.libtak/backups

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libjpeg62-turbo \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libpq5 \
        netcat-traditional \
        zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 libtak \
    && useradd --uid 10001 --gid libtak --no-log-init \
        --home-dir /home/libtak --create-home \
        --shell /usr/sbin/nologin libtak

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY . .
COPY --chown=root:root entrypoint.sh /entrypoint.sh

RUN mkdir -p \
        /app/data \
        /app/media \
        /app/staticfiles \
        /home/libtak/.libtak/backups \
        /home/libtak/.libtak/offsite \
    && chown -R libtak:libtak \
        /app/data \
        /app/media \
        /app/staticfiles \
        /home/libtak \
    && chmod 0555 /entrypoint.sh

USER 10001:10001

ENTRYPOINT ["/entrypoint.sh"]
