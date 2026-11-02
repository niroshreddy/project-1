# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate && pnpm install --frozen-lockfile
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json vite.config.ts panel.html devtools.html devtools.js background.js manifest.json ./
RUN pnpm run build
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=frontend /build/dist ./dist
RUN useradd --create-home workspace && mkdir /data && chown workspace:workspace /data
USER workspace
ENV TEAM_DB=/data/team.sqlite3
EXPOSE 8080
CMD ["python","-m","uvicorn","backend.team_app:app","--host","0.0.0.0","--port","8080","--no-proxy-headers"]
