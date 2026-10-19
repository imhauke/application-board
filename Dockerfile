# Applications 2027 — production image (http://localhost:8888).
# The data lives in Postgres (the db service) and the CVs (cv/) are not baked into the image:
# docker-compose.yml mounts them from the project, so a new PDF is read right away.

FROM node:22.21.1-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22.21.1-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.21.1-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8888
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 8888
CMD ["node_modules/.bin/next", "start", "-p", "8888", "-H", "0.0.0.0"]
