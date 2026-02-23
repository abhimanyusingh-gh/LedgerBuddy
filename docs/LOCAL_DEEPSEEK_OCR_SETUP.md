# Local DeepSeek OCR Setup (MLX)

This project uses a local MLX OCR service (`invoice-ocr`) on Apple Silicon.
Both OCR and SLM API layers are pluggable by engine:
- OCR: `OCR_ENGINE=local_mlx|remote_http`
- SLM: `SLM_ENGINE=local_mlx|remote_http`
MLX services run on host and Compose backend connects through `host.docker.internal`.

## 1. Install Python dependencies

```bash
python3.12 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r invoice-ocr/requirements.txt -r invoice-slm/requirements.txt
```

`yarn ocr:dev`, `yarn slm:dev`, and `yarn benchmark:ml` auto-use `./.venv-ml/bin/python` when present.

## 2. Start local OCR service

```bash
yarn ocr:dev
```

Service endpoints:
- `http://localhost:8000/health`
- `http://localhost:8000/v1/models`
- `http://localhost:8000/v1/ocr/document`

Default model id:
- `deepseek-ai/DeepSeek-OCR`

## 3. Start local SLM verifier service

```bash
yarn slm:dev
```

Service endpoints:
- `http://localhost:8100/health`
- `http://localhost:8100/v1/verify/invoice`

Default model id:
- `mlx-community/Qwen2.5-3B-Instruct-4bit`

## 4. Start application stack

```bash
docker compose up -d
```

Compose backend is wired to host MLX services by default:
- `DEEPSEEK_BASE_URL=http://host.docker.internal:8000/v1`
- `FIELD_VERIFIER_BASE_URL=http://host.docker.internal:8100/v1`

No API key is required for local OCR or local SLM.

## 5. Optional OCR tuning

Environment variables for `invoice-ocr`:
- `OCR_ENGINE` default `local_mlx`
- `OCR_MODEL_ID` default `deepseek-ai/DeepSeek-OCR`
- `OCR_MODEL_PATH` optional local snapshot path
- `OCR_ALLOW_DOWNLOAD` default `true`
- `OCR_REMOTE_BASE_URL` required when `OCR_ENGINE=remote_http`
- `OCR_REMOTE_API_KEY` optional bearer token
- `OCR_REMOTE_TIMEOUT_MS` default `300000`
- `OCR_MAX_NEW_TOKENS` default `256`
- `OCR_PDF_MAX_PAGES` default `6`
- `OCR_DYNAMIC_CROPS` default `true`
- `OCR_LOAD_ON_STARTUP` default `false`

Example:

```bash
OCR_LOAD_ON_STARTUP=true OCR_MAX_NEW_TOKENS=192 yarn ocr:dev
```

Environment variables for `invoice-slm`:
- `SLM_ENGINE` default `local_mlx`
- `SLM_MODEL_ID` default `mlx-community/Qwen2.5-3B-Instruct-4bit`
- `SLM_REMOTE_BASE_URL` required when `SLM_ENGINE=remote_http`
- `SLM_REMOTE_SELECT_PATH` default `/v1/verify/invoice`
- `SLM_REMOTE_API_KEY` optional bearer token

## 6. Smoke test

```bash
curl -X POST http://localhost:4000/api/jobs/ingest
curl http://localhost:4000/api/jobs/ingest/status
```

## Notes

- First request can be slower due model load.
- Backend validates `/v1/models` on startup before selecting OCR.
- OCR uses direct document inference (`POST /v1/ocr/document`) and returns block bounding boxes.
- `/v1/chat/completions` is intentionally not used.
- Backend + OCR + SLM logs include `correlationId` for cross-service tracing.
