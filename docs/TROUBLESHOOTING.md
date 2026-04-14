# Troubleshooting

## Docker Status Commands

```bash
docker ps -a --filter "label=com.docker.compose.project=billforge" --format 'table {{.Names}}\t{{.Status}}'

docker volume ls --format '{{.Name}}' | grep billforge

docker network ls --format '{{.Name}}' | grep billforge
```

## Health Checks

```bash
curl http://localhost:4100/health
curl http://localhost:4100/health/ready

curl http://localhost:8200/v1/health
curl http://localhost:8300/v1/health

curl http://localhost:9100/minio/health/live

curl http://localhost:8280/health/ready
```

## Common Issues

### Login returns 403

**Symptom**: Login redirects back with a 403 error.

**Cause**: `AUTH_AUTO_PROVISION_USERS` is not set to `true`. The Keycloak user exists but no matching MongoDB user record was auto-created.

**Fix**: Ensure `AUTH_AUTO_PROVISION_USERS=true` in docker-compose.yml environment (this is the default). If you've overridden it in `backend/.env`, remove that override.

### Keycloak not starting

**Symptom**: Backend can't connect to Keycloak, health check fails, login redirects fail.

**Cause**: Keycloak has a 30-second start period and can take up to 2 minutes on first boot (realm import).

**Fix**:
```bash
docker logs billforge-keycloak --tail 50

curl http://localhost:8280/health/ready
```

If Keycloak is stuck, restart it:
```bash
docker restart billforge-keycloak
```

### Keycloak realm not imported

**Symptom**: Login fails with "realm not found" or OIDC discovery returns 404.

**Cause**: The realm config file was not mounted or Keycloak skipped import.

**Fix**: Verify the realm config mount:
```bash
docker exec billforge-keycloak ls /opt/keycloak/data/import/
```

The file `realm-config.json` should be present. If not, check the volume mount in `docker-compose.yml` points to `infra/keycloak/realm-config.json`.

### Keycloak token introspection fails

**Symptom**: Backend returns 401 on authenticated requests even though the user is logged in.

**Cause**: `OIDC_CLIENT_SECRET` does not match the Keycloak client secret, or the introspect endpoint is unreachable from inside Docker.

**Fix**:
1. Verify the client secret matches: check `OIDC_CLIENT_SECRET` in your environment against the Keycloak admin console (Clients > billforge-app > Credentials).
2. Verify the backend can reach Keycloak internally:
```bash
docker exec billforge-backend curl -s http://keycloak:8080/realms/billforge/.well-known/openid-configuration | head -5
```

### OCR / SLM services not ready

**Symptom**: Backend hangs on startup or returns 503.

**Cause**: Backend blocks readiness until OCR and SLM services are healthy and reachable. The native ML services must be running on the host.

**Fix**:
```bash
curl http://localhost:8200/v1/health
curl http://localhost:8300/v1/health

cat .local-run/ocr.log
cat .local-run/slm.log

yarn docker:reload
```

### LlamaExtract returns empty extraction

**Symptom**: Invoices go to FAILED_PARSE with LlamaExtract enabled. OCR text is present but no fields are extracted.

**Cause**: `LLAMA_PARSE_EXTRACT_ENABLED` is `true` but `LLAMA_CLOUD_API_KEY` is missing or invalid, or the extract tier is not set.

**Fix**:
1. Verify the API key is set and valid:
```bash
echo $LLAMA_CLOUD_API_KEY
```
2. Check the backend logs for LlamaExtract errors:
```bash
docker logs billforge-backend --tail 100 | grep -i llama
```
3. Verify environment variables:
```bash
LLAMA_CLOUD_API_KEY=llx-your-key
LLAMA_PARSE_EXTRACT_ENABLED=true
LLAMA_PARSE_EXTRACT_TIER=cost_effective
FIELD_VERIFIER_PROVIDER=none
```

### LlamaParse OCR timeout

**Symptom**: Large PDFs fail with timeout errors when using LlamaParse.

**Cause**: Default `OCR_TIMEOUT_MS` may be too low for large documents processed via LlamaCloud.

**Fix**: Increase the timeout:
```bash
OCR_TIMEOUT_MS=7200000
```

### MinIO bucket missing

**Symptom**: S3 uploads fail with `NoSuchBucket` error.

**Cause**: The `minio-init` service didn't run or failed silently.

**Fix**:
```bash
docker compose up -d minio-init
docker logs billforge-minio-init
```

### Orphaned volumes from old project name

**Symptom**: Old `invoiceprocessor_*` volumes taking up disk space.

**Cause**: The compose project was renamed from `invoiceprocessor` to `billforge`. Old volumes were not automatically cleaned up.

**Fix**:
```bash
docker volume ls --format '{{.Name}}' | grep invoiceprocessor

docker volume rm invoiceprocessor_mongo_data invoiceprocessor_minio_data
```

### Port conflicts

**Symptom**: Container fails to start with "address already in use".

**Fix**: Check what's using the port and stop it:
```bash
lsof -i :4100   # Backend
lsof -i :5177   # Frontend
lsof -i :27018  # MongoDB
lsof -i :8200   # OCR (native host service)
lsof -i :8300   # SLM (native host service)
lsof -i :8280   # Keycloak
lsof -i :6379   # Redis
```

### Yarn lockfile stale after workspace rename

**Symptom**: `yarn docker:up` fails with "Package for billforge@workspace:. not found".

**Cause**: `yarn.lock` has stale workspace names after a rename.

**Fix**: Run `yarn install` to regenerate the lockfile.

### Redis connection refused

**Symptom**: Backend logs show `ECONNREFUSED` errors for Redis.

**Cause**: Redis container is not running or the `REDIS_URL` is misconfigured.

**Fix**:
```bash
docker logs billforge-redis --tail 20
curl -s telnet://localhost:6379
```

Verify `REDIS_URL=redis://redis:6379` in docker-compose.yml.

## Log Access

```bash
docker logs billforge-backend --tail 50

docker logs billforge-keycloak --tail 50

docker logs billforge-minio-init

docker logs billforge-mailhog-oauth --tail 20

docker logs billforge-redis --tail 20

docker logs -f billforge-backend
```
