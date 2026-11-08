# syntax=docker/dockerfile:1.7
# Static musl build on Alpine, shipped on distroless static as a non root user.
# Build context is the backend directory. Queries are checked against the committed .sqlx
# cache, so no database is needed at build time.

# Base images are pinned by digest for reproducible builds. Refresh with
#   docker buildx imagetools inspect <image:tag>
FROM rust:1.97-alpine@sha256:3c38f3f82c2f3d73da3b38e18d279393a04cb43ddded0e35088a8c3324d40900 AS build
RUN apk add --no-cache musl-dev gcc
WORKDIR /src
ENV SQLX_OFFLINE=true CARGO_NET_RETRY=5

# Dependency layer, rebuilt only when the manifests change.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY .sqlx ./.sqlx
COPY migrations ./migrations
COPY src ./src
# Copied files keep their host timestamps, which can be older than the placeholder build
# above. Touching them forces cargo to rebuild the crate itself.
RUN touch src/main.rs src/lib.rs && cargo build --release --locked && strip target/release/r16a-vault-backend

FROM gcr.io/distroless/static-debian13:nonroot@sha256:25ac8f0c3b2334a9eb05452266bd4697864a8c8ef0ef71e5e6480d7f92868329
COPY --from=build /src/target/release/r16a-vault-backend /r16a-vault-backend
USER 65532:65532
EXPOSE 8081
ENTRYPOINT ["/r16a-vault-backend"]
CMD ["serve"]
