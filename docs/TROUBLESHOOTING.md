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
```

## Common Issues

### Login returns 403

**Symptom**: Login redirects back with a 403 error.

**Cause**: `AUTH_AUTO_PROVISION_USERS` is not set to `true`. The Keycloak user exists but no matching MongoDB user record was auto-created.

**Fix**: Ensure `AUTH_AUTO_PROVISION_USERS=true` in docker-compose.yml environment (this is the default). If you've overridden it in `backend/.env`, remove that override.

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

### MinIO bucket missing

**Symptom**: S3 uploads fail with `NoSuchBucket` error.

**Cause**: The `minio-init` service didn't run or failed silently.

**Fix**:
```bash
docker compose up -d minio-init
docker logs billforge-minio-init
```

### Keycloak not starting

**Symptom**: Backend can't connect to Keycloak, health check fails.

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
```

### Yarn lockfile stale after workspace rename

**Symptom**: `yarn docker:up` fails with "Package for billforge@workspace:. not found".

**Cause**: `yarn.lock` has stale workspace names after a rename.

**Fix**: Run `yarn install` to regenerate the lockfile.

## Log Access

```bash
docker logs billforge-backend --tail 50

docker logs billforge-keycloak --tail 50

docker logs billforge-minio-init

docker logs billforge-mailhog-oauth --tail 20

docker logs -f billforge-backend
```
