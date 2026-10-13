# ============================================================================
# RPA CoE Control Room — web image (Vite build -> nginx)
# Build context MUST be the repository root so deploy/nginx.conf is reachable:
#   docker build -f rpa-dashboard/Dockerfile -t control-room-web .
# ============================================================================
FROM node:22-alpine AS build

WORKDIR /src
COPY rpa-dashboard/package.json rpa-dashboard/package-lock.json ./
RUN npm ci
COPY rpa-dashboard/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
