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
- OCR engine: `local_hybrid` (DeepSeek MLX + Apple Vision arbitration)
- OCR model: `mlx-community/DeepSeek-OCR-4bit`
- SLM model: `mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`

`yarn docker:up` starts:
- local OCR service (`8000`) using host macOS engines
- local MLX SLM service (`8100`)
- `backend` (`4000`)
- `frontend` (`5173`)
- `mongo` (`27017`)
- `mongo-express` (`8081`)

## 3. Health endpoints

- OCR: `http://localhost:8000/v1/health`
- OCR models: `http://localhost:8000/v1/models`
- OCR extract: `http://localhost:8000/v1/ocr/document`
- SLM: `http://localhost:8100/v1/health`
- SLM verify: `http://localhost:8100/v1/verify/invoice`
- Backend: `http://localhost:4000/health`

Backend readiness is blocked until OCR + SLM are reachable and ready.

## 4. Engine boundaries

- Local OCR engines: `OCR_ENGINE=local_hybrid|local_mlx|local_apple_vision`
- Local SLM engine: `SLM_ENGINE=local_mlx`
- Production-safe engine: `*_ENGINE=prod_http`
- No `/v1/chat/completions` usage.

MLX exists only in local engine modules:
- `invoice-ocr/app/engines/local_mlx.py`
- `invoice-ocr/app/engines/local_hybrid.py` (imports local MLX + Apple Vision only in local mode)
- `invoice-slm/app/engines/local_mlx.py`

Production Docker images install `requirements.prod.txt` only (no MLX packages).
