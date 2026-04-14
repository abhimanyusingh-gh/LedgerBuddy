# Local DeepSeek MLX Setup

Run MLX services on Apple Silicon host, not in Docker.

## 1. Install local ML dependencies

```bash
python3 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r ocr/requirements.local.txt -r slm/requirements.local.txt
```

## 2. Start full local stack

```bash
yarn docker:up
```

Defaults:
- OCR provider: `local_hybrid` (DeepSeek MLX + Apple Vision arbitration)
- OCR model: `mlx-community/DeepSeek-OCR-4bit`
- SLM model: `mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit`

`yarn docker:up` starts:
- native OCR service on host (`8200`) — Docker proxy at `8202`
- native MLX SLM service on host (`8300`) — Docker proxy at `8302`
- `backend` (`4100`)
- `frontend` (`5177`)
- `mongo` (`27018`)
- `mongo-express` (`8181`)
- `minio` (`9100`) + `minio-init` (auto-creates `billforge-local` bucket)
- `keycloak` (`8280`) — OIDC identity provider
- `mailhog` (`8125`) — SMTP catch-all UI
- `mailhog-oauth` (`8126`) — OAuth2/SendGrid wrapper

## 3. Health endpoints

- OCR (native): `http://localhost:8200/v1/health`
- OCR (Docker proxy): `http://localhost:8202/v1/health`
- OCR models: `http://localhost:8200/v1/models`
- OCR extract: `http://localhost:8200/v1/ocr/document`
- SLM (native): `http://localhost:8300/v1/health`
- SLM (Docker proxy): `http://localhost:8302/v1/health`
- SLM verify: `http://localhost:8300/v1/verify/invoice`
- Backend: `http://localhost:4100/health`
- Backend readiness: `http://localhost:4100/health/ready`

Backend readiness is blocked until OCR + SLM are reachable and ready.

## 4. Provider boundaries

- Local OCR providers: `OCR_ENGINE=local_hybrid|local_mlx|local_apple_vision`
- Local SLM provider: `SLM_ENGINE=local_mlx`
- Production-safe provider: `*_ENGINE=prod_http`
- No `/v1/chat/completions` usage.

MLX exists only in local provider modules:
- `ocr/app/providers/local/mlx.py`
- `ocr/app/providers/local/hybrid.py` (imports local MLX + Apple Vision only in local mode)
- `slm/app/providers/local/mlx.py`

Production Docker images install `requirements.prod.txt` only (no MLX packages).

## 5. Stack management

Always use yarn scripts, never `docker compose` directly:

```bash
yarn docker:up           # Start everything (native ML + Docker)
yarn docker:down         # Stop Docker containers (keep ML models loaded)
yarn docker:down:all     # Stop everything including native ML processes
yarn docker:reload       # Rebuild Docker containers, restart native ML
```
