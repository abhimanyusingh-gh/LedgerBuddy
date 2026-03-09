# Local DeepSeek MLX Setup

Run MLX services on Apple Silicon host, not in Docker.

## 1. Install local ML dependencies

```bash
python3 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r invoice-ocr/requirements.local.txt -r invoice-slm/requirements.local.txt
```

## 2. Start full local stack

```bash
yarn docker:up
```

Defaults:
- OCR provider: `local_hybrid` (DeepSeek MLX + Apple Vision arbitration)
- OCR model: `mlx-community/DeepSeek-OCR-4bit`
- SLM model: `mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`

`yarn docker:up` starts:
- local OCR service (`8200`) using host macOS providers
- local MLX SLM service (`8300`)
- `backend` (`4100`)
- `frontend` (`5174`)
- `mongo` (`27018`)
- `mongo-express` (`8181`)

## 3. Health endpoints

- OCR: `http://localhost:8200/v1/health`
- OCR models: `http://localhost:8200/v1/models`
- OCR extract: `http://localhost:8200/v1/ocr/document`
- SLM: `http://localhost:8300/v1/health`
- SLM verify: `http://localhost:8300/v1/verify/invoice`
- Backend: `http://localhost:4100/health`

Backend readiness is blocked until OCR + SLM are reachable and ready.

## 4. Provider boundaries

- Local OCR providers: `OCR_ENGINE=local_hybrid|local_mlx|local_apple_vision`
- Local SLM provider: `SLM_ENGINE=local_mlx`
- Production-safe provider: `*_ENGINE=prod_http`
- No `/v1/chat/completions` usage.

MLX exists only in local provider modules:
- `invoice-ocr/app/providers/local_mlx.py`
- `invoice-ocr/app/providers/local_hybrid.py` (imports local MLX + Apple Vision only in local mode)
- `invoice-slm/app/providers/local_mlx.py`

Production Docker images install `requirements.prod.txt` only (no MLX packages).
