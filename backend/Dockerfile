FROM python:3.12-slim

LABEL maintainer="86Web"
LABEL description="86Web Backend API"

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/app/ ./app/
COPY VERSION /app/VERSION

# Copy query tool and create a convenient wrapper command
COPY scripts/query_86box.py ./scripts/query_86box.py
RUN printf '#!/bin/sh\nexec python3 /app/scripts/query_86box.py "$@"\n' > /usr/local/bin/86box-query \
    && chmod +x /usr/local/bin/86box-query

# Entrypoint script (handles UID/GID, directory creation)
COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info"]
