# OCR and Extraction Provider Setup

BillForge supports three OCR/extraction provider configurations. Choose the one that fits your deployment.

## Provider Overview

| Provider | OCR | Extraction (SLM) | Hardware | Cost |
|----------|-----|-------------------|----------|------|
| DeepSeek MLX (local) | DeepSeek-OCR on Apple Silicon | MLX SLM on Apple Silicon | Mac with M-series chip | Free (local compute) |
| LlamaParse + SLM | LlamaCloud LlamaParse | Separate SLM service (HTTP) | Any | LlamaCloud API credits |
| LlamaExtract (recommended cloud) | LlamaCloud LlamaParse | LlamaCloud LlamaExtract (no SLM needed) | Any | LlamaCloud API credits |

---

## Option 1: DeepSeek MLX (Local, Apple Silicon)

Run MLX services on Apple Silicon host, not in Docker.

### Install local ML dependencies

```bash
python3 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r ai/ocr/requirements.local.txt -r ai/slm/requirements.local.txt
```

### Start full local stack

```bash
yarn docker:up
```

Defaults:
- OCR provider: `local_hybrid` (DeepSeek MLX + Apple Vision arbitration)
- OCR model: `mlx-community/DeepSeek-OCR-4bit`
- SLM model: `mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit`

`yarn docker:up` starts:
- native OCR service on host (`8200`) with Docker proxy at `8202`
- native MLX SLM service on host (`8300`) with Docker proxy at `8302`
- `backend` (`4100`)
- `frontend` (`5177`)
- `mongo` (`27018`)
- `mongo-express` (`8181`)
- `minio` (`9100`) + `minio-init` (auto-creates `billforge-local` bucket)
- `keycloak` (`8280`) -- OIDC identity provider (realm `billforge`, client `billforge-app`)
- `mailhog` (`8125`) -- SMTP catch-all UI
- `mailhog-oauth` (`8126`) -- OAuth2/SendGrid wrapper
- `redis` (`6379`)

### Health endpoints

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

### Provider boundaries

- Local OCR providers: `OCR_ENGINE=local_hybrid|local_mlx|local_apple_vision`
- Local SLM provider: `SLM_ENGINE=local_mlx`
- Production-safe provider: `*_ENGINE=prod_http`
- No `/v1/chat/completions` usage.

MLX exists only in local provider modules:
- `ai/ocr/app/providers/local/mlx.py`
- `ai/ocr/app/providers/local/hybrid.py` (imports local MLX + Apple Vision only in local mode)
- `ai/slm/app/providers/local/mlx.py`

Production Docker images install `requirements.prod.txt` only (no MLX packages).

---

## Option 2: LlamaParse + SLM

Use LlamaCloud LlamaParse for OCR and a separate SLM service for field extraction.

### Environment variables

```bash
OCR_PROVIDER=llamaparse
LLAMA_CLOUD_API_KEY=llx-your-api-key
LLAMA_PARSE_TIER=cost_effective          # fast | cost_effective | agentic
LLAMA_PARSE_EXTRACT_ENABLED=false        # keep false -- extraction handled by SLM

FIELD_VERIFIER_PROVIDER=http
FIELD_VERIFIER_BASE_URL=http://slm:8100/v1
```

The SLM service handles field extraction from the LlamaParse OCR output. Supported SLM backends include the local MLX model, Claude (Anthropic API), or any HTTP-compatible extraction endpoint.

### SLM backend options

The SLM container supports multiple backends via environment variables:

| Backend | Variables | Notes |
|---------|-----------|-------|
| Local MLX | `SLM_ENGINE=local_mlx` | Apple Silicon only |
| Anthropic Claude | `ANTHROPIC_API_KEY=sk-ant-...`, `ANTHROPIC_MODEL=claude-sonnet-4-6` | Cloud API |
| Remote HTTP | `SLM_ENGINE=prod_http`, `SLM_REMOTE_BASE_URL=http://...` | Any compatible endpoint |

---

## Option 3: LlamaExtract (Recommended Cloud)

Use LlamaCloud for both OCR (LlamaParse) and extraction (LlamaExtract). No SLM service needed.

### Start with preset

```bash
yarn docker --preset=llamaextract-lowcost
```

### Environment variables

```bash
OCR_PROVIDER=llamaparse
LLAMA_CLOUD_API_KEY=llx-your-api-key
LLAMA_PARSE_EXTRACT_ENABLED=true
LLAMA_PARSE_EXTRACT_TIER=cost_effective  # cost_effective | agentic

FIELD_VERIFIER_PROVIDER=none             # SLM not needed
```

When `LLAMA_PARSE_EXTRACT_ENABLED=true`, LlamaExtract handles both OCR and structured field extraction in a single API call. The SLM service is not required and `FIELD_VERIFIER_PROVIDER` should be set to `none`.

### Optional: Custom extraction prompt

Set `LLAMA_EXTRACT_SYSTEM_PROMPT` to provide a custom system prompt for LlamaExtract field extraction. This can improve accuracy for domain-specific invoice formats.

---

## Environment Variable Reference

### OCR Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `OCR_PROVIDER` | `auto`, `deepseek`, `llamaparse`, `mock` | `auto` | OCR provider selection |
| `OCR_PROVIDER_BASE_URL` | URL | (local: `http://localhost:8200/v1`) | DeepSeek OCR endpoint |
| `OCR_MODEL` | string | `mlx-community/DeepSeek-OCR-4bit` | DeepSeek model identifier |
| `OCR_TIMEOUT_MS` | number | `3600000` | OCR request timeout in milliseconds |

### LlamaCloud Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `LLAMA_CLOUD_API_KEY` | string | -- | LlamaCloud API key (required for LlamaParse and LlamaExtract) |
| `LLAMA_PARSE_TIER` | `fast`, `cost_effective`, `agentic` | `cost_effective` | LlamaParse processing tier |
| `LLAMA_PARSE_EXTRACT_ENABLED` | `true`, `false` | `false` | Enable LlamaExtract for field extraction |
| `LLAMA_PARSE_EXTRACT_TIER` | `cost_effective`, `agentic` | `cost_effective` | LlamaExtract processing tier |
| `LLAMA_EXTRACT_SYSTEM_PROMPT` | string | -- | Custom system prompt for LlamaExtract |

### SLM Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `FIELD_VERIFIER_PROVIDER` | `http`, `none` | `http` | SLM provider (`none` disables SLM) |
| `FIELD_VERIFIER_BASE_URL` | URL | (local: `http://localhost:8300/v1`) | SLM service endpoint |
| `FIELD_VERIFIER_TIMEOUT_MS` | number | `180000` | SLM request timeout in milliseconds |
| `ANTHROPIC_API_KEY` | string | -- | Anthropic API key (Claude SLM backend) |
| `ANTHROPIC_MODEL` | string | `claude-sonnet-4-6` | Anthropic model for SLM |

---

## Stack Management

Always use yarn scripts, never `docker compose` directly:

```bash
yarn docker:up           # Start everything (native ML + Docker)
yarn docker:down         # Stop Docker containers (keep ML models loaded)
yarn docker:down:all     # Stop everything including native ML processes
yarn docker:reload       # Rebuild Docker containers, restart native ML
```
