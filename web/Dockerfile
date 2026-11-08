# syntax=docker/dockerfile:1.7
# Build context is the repository root, because the web build needs shared/.

FROM node:24-alpine AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /repo/shared
COPY web ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine
# Pull in Alpine security fixes newer than the base image, and drop curl, which nothing
# here uses. Health checks rely on busybox wget.
USER root
RUN apk upgrade --no-cache && apk del --no-cache curl
# The stock site config is replaced by a template rendered at start, see nginx/default.conf.template.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY web/nginx/nginx.conf /etc/nginx/nginx.conf
COPY web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist/r16a-vault-web/browser /usr/share/nginx/html
ENV R16A_BACKEND_UPSTREAM=backend:8081 R16A_WEB_LISTEN=8080
USER 101
EXPOSE 8080
