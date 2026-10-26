# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin API by default (nginx proxies /api to the API container). Override only for a split-domain deployment.
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_STATIC_FALLBACK=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_STATIC_FALLBACK=$VITE_STATIC_FALLBACK
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
