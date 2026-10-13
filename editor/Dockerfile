# artisanmc.net: the landing page and the wiki (docs-site), served by nginx. No editor —
# the editor ships inside the plugin.
# BUILD CONTEXT MUST BE THE REPO ROOT (docs-site/ and docs/ are needed at build time).
#
#   docker build -f editor/Dockerfile -t artisan-site .
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

RUN npm run build:site

FROM nginx:alpine AS serve
COPY --from=build /app/editor/dist /usr/share/nginx/html
COPY editor/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
