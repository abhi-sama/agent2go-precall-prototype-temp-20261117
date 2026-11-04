# Build context is backend/ (docker-compose.yml in backend/infra): the agent shares the logging and Executive analysis libraries.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY libs/a2g_logging /app/libs/a2g_logging
COPY libs/a2g_exec_analysis /app/libs/a2g_exec_analysis
COPY agent/pyproject.toml /app/agent/pyproject.toml
COPY agent/src /app/agent/src
# The agent's library dependencies are relative paths (../libs/...); the layout above keeps them valid.
RUN pip install --no-cache-dir /app/libs/a2g_logging /app/libs/a2g_exec_analysis /app/agent

EXPOSE 8080
CMD ["uvicorn", "msl_agent.app:app", "--host", "0.0.0.0", "--port", "8080"]
