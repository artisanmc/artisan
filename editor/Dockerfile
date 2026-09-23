# Production image for the Artisan editor (static SPA built with Vite, served by nginx).
# BUILD CONTEXT MUST BE THE REPO ROOT: editor/src/schema/validateMenuV1.ts imports
# ../../../docs/schema/menu/v1/schema.json at build time, so docs/ must be present.
#
# Coolify: Build Pack = Dockerfile, Base Directory = `/`, Dockerfile = editor/Dockerfile
# Set the backend URL as build args (baked into the bundle — VITE_* are build-time):
#   VITE_API_URL=https://api.artisanmc.net
#   VITE_PLUGIN_WS_URL=wss://api.artisanmc.net/ws/plugin
#   VITE_EDITOR_URL=https://editor.artisanmc.net
#
#   docker build -f editor/Dockerfile --build-arg VITE_API_URL=https://api.artisanmc.net -t artisan-editor .
FROM node:22-alpine AS build
WORKDIR /app/editor

COPY editor/package.json editor/package-lock.json ./
COPY editor/packages ./packages
RUN npm ci
COPY docs-site/package.json docs-site/package-lock.json ../docs-site/
RUN npm ci --prefix ../docs-site
COPY editor ./
COPY docs-site ../docs-site
COPY docs ../docs

ARG VITE_API_URL=https://api.artisanmc.net
ARG VITE_PLUGIN_WS_URL=wss://api.artisanmc.net/ws/plugin
ARG VITE_EDITOR_URL=https://editor.artisanmc.net
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PLUGIN_WS_URL=$VITE_PLUGIN_WS_URL
ENV VITE_EDITOR_URL=$VITE_EDITOR_URL
RUN npm run build

FROM nginx:alpine AS serve
COPY --from=build /app/editor/dist /usr/share/nginx/html
COPY editor/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
