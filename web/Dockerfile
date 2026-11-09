# syntax=docker/dockerfile:1.7
# Build context is the repository root, because the web build needs shared/.

# Base images are pinned by digest for reproducible builds. Refresh with
#   docker buildx imagetools inspect <image:tag>
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /repo/shared
COPY web ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
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
# Notices for every bundled npm package, linked from Settings.
COPY --from=build /repo/web/dist/r16a-vault-web/3rdpartylicenses.txt /usr/share/nginx/html/licenses/third-party.txt
ENV R16A_BACKEND_UPSTREAM=backend:8081 R16A_WEB_LISTEN=8080 \
    R16A_ANDROID_PACKAGE=dev.r16a.r16a_vault R16A_ANDROID_CERT_FINGERPRINTS= R16A_APPLE_APP_IDS=
USER 101
EXPOSE 8080
