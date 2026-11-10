# deploy

How Zaltys runs outside a developer machine. `compose/` is for local and single-host use, and `k8s/` holds the production manifests for the r16a cluster at `zaltys.app`. Deployment notes are in `docs/SPEC.md` section 13 and operator duties in `docs/OPERATING.md`.

## Rules specific to this folder

- Never write a secret value into any tracked file. `compose/.env` and `k8s/secret.yaml` are git-ignored and hold the real values. Only `.env.example` and `secret.example.yaml` are tracked.
- App containers (backend, migrate, web) run as non-root with a read-only root filesystem and all capabilities dropped, plus seccomp `RuntimeDefault` in Kubernetes. A workload that needs to write gets an `emptyDir` or tmpfs for that path, never a relaxed context. The compose `db` uses the stock postgres image.
- Every container sets CPU and memory requests and limits, plus liveness and readiness probes.
- Keep `deploy/k8s` in the same minimal style as the other r16a apps, one Deployment and Service per image plus one Ingress. Do not reintroduce kustomize, SOPS or per-resource sprawl without a DECISIONS entry.
- Validate manifest changes with kubeconform (command in the root `CLAUDE.md`) and the `k8s-manifest-hardening` checklist.

## Compose

- `docker-compose.yml` is prod-like. Services are `db` (`postgres:18`, roles created by `init-roles.sh` on first start), `migrate` (one-shot, owner role), `backend` and `web` on `127.0.0.1:${R16A_HTTP_PORT:-8080}`. The web container has the pinned IP `10.89.0.10`, the only peer the backend trusts for `X-Forwarded-For`. Logs rotate at 10 MB, 3 files.
- `.env` keys are `POSTGRES_PASSWORD`, `R16A_OWNER_PASSWORD`, `R16A_APP_PASSWORD`, `R16A_PRELOGIN_SECRET`, `R16A_AUTH_PEPPER`, `R16A_PUBLIC_URL`, `R16A_HTTP_PORT`, `R16A_DEV_INSECURE_COOKIE` and `R16A_REGISTRATION_ENABLED`.
- `docker-compose.dev.yml` always starts `db` on `127.0.0.1:5432` with throwaway credentials. Profile `backend` adds the backend on 8081, and profile `web` adds nginx on host networking at `127.0.0.1:8080`, proxying to `127.0.0.1:8081`.

## Kubernetes

- Namespace `r16a-vault`. `backend.yaml` (Deployment with a `migrate` init container, Service on 8081), `web.yaml` (Deployment, Service on 8080), `ingress.yaml` (Traefik `websecure`, cert-manager `letsencrypt-prod`, host `zaltys.app`, `/api` to the backend and `/` to web).
- The database is the shared PostgreSQL 15 in `r16a-databases` (Service `postgres`, StatefulSet `postgres`). `provision.sql` creates database `r16a_vault` with roles `r16a_vault_owner` and `r16a_vault_app`, once, by hand.
- Secret `r16a-vault-secret` has keys `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `PRELOGIN_SECRET` and `AUTH_PEPPER`. Only the init container receives `MIGRATE_DATABASE_URL`. The image pull secret is `registry-r16a-vault`.
- The web Deployment carries `R16A_ANDROID_CERT_FINGERPRINTS` and `R16A_APPLE_APP_IDS`, which feed `/.well-known/assetlinks.json` and `apple-app-site-association` for mobile SSO. Empty values mean mobile SSO fails safely.
- The backend trusts private ranges and Cloudflare's published ranges in `R16A_TRUSTED_PROXY_CIDRS`. There is no NetworkPolicy, matching the rest of the cluster (SPEC R5).

## How images get built and deployed

The web image builds from the repo root workspace. `web/Dockerfile` copies every workspace manifest (`npm ci` checks them all against the lockfile) and installs with `--workspace web`, so the extension's build tools stay out of the image. A new workspace needs its `package.json` copied there too.


`.github/workflows/deploy.yaml` runs on push to `main`, except changes limited to `mobile/`, `docs/` or Markdown, on a self-hosted runner. Jobs `test-backend` (clippy and tests on a throwaway `postgres:15`), `test-web` (shared packages and web), `test-extension` (does not gate the deploy) and `security` (cargo deny, npm audit, OWASP Dependency-Check, Trivy filesystem scan) run in parallel. `build-and-deploy` then builds both images tagged with the commit SHA and `latest`, scans them with Trivy (HIGH and CRITICAL with a fix fail the run), pushes to `registry.r16a.cloud`, sets the SHA in the manifests, applies the three manifests by name and waits for both rollouts. Re-runs restart the deployments, since the image tag is unchanged. Third-party actions are pinned by commit SHA.

## Gotchas

- In `secret.yaml` under `data:`, each value is base64 of the plain string. Encode with `printf '%s' "$value" | base64 -w0`. A trailing newline from `echo`, or a value encoded once instead of twice, gives an `empty host` database error or `string field contains invalid UTF-8` from the container runtime.
- CI applies manifests by name, because `secret.example.yaml` sits in the same folder and applying it would overwrite the real secret.
- Changing the Secret does not restart pods. Run `kubectl -n r16a-vault rollout restart deployment/r16a-vault-backend`.
- `kubectl logs deploy/...` picks an arbitrary pod. During a bad rollout, list pods by creation time and read the newest one.
- `AUTH_PEPPER` must never change after the first account exists, or every login fails. Keep a copy outside the cluster.
- Root `.gitignore` still lists `*.dec.yaml` from the removed SOPS setup. It is harmless.
