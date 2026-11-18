FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./backend/app
COPY --from=frontend /app/dist ./frontend/dist
RUN useradd --create-home cerberus && mkdir -p backend/models && chown cerberus backend/models
USER cerberus
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port \"$PORT\""]
