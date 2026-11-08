# Kubernetes deployment

## Prerequisites

| Requirement | Why |
|---|---|
| A CNI that **enforces NetworkPolicy** (Calico or Cilium) | `networkpolicy.yaml` is what keeps every other pod away from the backend and PostgreSQL. Flannel accepts the objects but ignores them, which would let any pod reach the database and spoof `X-Forwarded-For` to bypass rate limits. Check with `kubectl get pods -n kube-system` that your CNI supports policies before deploying. |
| Traefik in a namespace named `traefik` | The policies admit ingress traffic from that namespace only. |
| cert-manager with a `letsencrypt-prod` ClusterIssuer | TLS for the public host. |
| PostgreSQL with TLS and the roles from `provision.sql` | Connections use `sslmode=verify-full`. Put the CA that signed the server certificate in the `r16a-db-ca` ConfigMap. |

## Trusted proxies

`R16A_TRUSTED_PROXY_CIDRS` decides whose `X-Forwarded-For` is believed. The safest value is Traefik's own pod range, for example a dedicated Calico IP pool for the `traefik` namespace. The default, the whole pod network, is acceptable only together with enforced NetworkPolicy.

## Secrets

`secret.template.yaml` defines two Secrets. `r16a-backend-secrets` is mounted into the backend and holds only the runtime role. `r16a-migrate-secrets` holds the schema owner and is referenced only by the migration Job. Never merge them, the split is what stops a compromised backend from altering the schema.

## Order of operations

1. Run `provision.sql` on PostgreSQL.
2. Fill in, encrypt and apply both Secrets and the `r16a-db-ca` ConfigMap.
3. `kubectl apply -f migrate-job.yaml` and wait for it to complete. Rename the Job for each release.
4. `kubectl apply -k .`
