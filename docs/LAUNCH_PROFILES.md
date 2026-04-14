# Launch Profile System

BillForge uses a composable profile system to configure launch environments. Instead of dozens of `package.json` script permutations, you select dimensions via flags.

## Quick Start

```bash
# Start docker with Claude engine + multi-step extraction
yarn docker --engine=claude --extraction=multi

# Restart SLM with MLX engine
yarn slm --engine=mlx --extraction=single

# Use a preset (llamaextract with agentic tier)
yarn docker --preset=llamaextract

# See all available options
yarn profile:list
```

## How It Works

The system has four composable dimensions:

| Dimension      | Flag              | Description                          |
|----------------|-------------------|--------------------------------------|
| **Engine**     | `--engine=X`      | SLM inference backend                |
| **OCR**        | `--ocr=X`         | OCR provider configuration           |
| **Extraction** | `--extraction=X`  | Extraction pipeline mode             |
| **Preset**     | `--preset=X`      | Pre-built combo of the above         |

### Merge Order

Profiles are merged with a **first-writer-wins** rule:

1. **Preset** (loaded first, sets base defaults)
2. **Engine** (overrides preset's engine settings)
3. **OCR** (overrides preset's OCR settings)
4. **Extraction** (overrides preset's extraction settings)
5. **CLI env overrides** (env vars set before the command always win)

This means explicit flags always take precedence over preset defaults.

## Available Options

### Engines (`dev/profiles/engines/`)

| Name    | SLM_ENGINE         | Description                      |
|---------|--------------------|---------------------------------|
| claude  | local_claude_cli   | Claude CLI running locally      |
| mlx     | local_mlx          | MLX local inference             |
| codex   | local_codex_cli    | Codex CLI running locally       |
| api     | anthropic_api      | Anthropic API (remote)          |

### OCR (`dev/profiles/ocr/`)

| Name          | Key Setting                                          | Description         |
|---------------|------------------------------------------------------|---------------------|
| default       | (none)                                               | DeepSeek OCR        |
| apple_vision  | OCR_ENGINE=local_apple_vision                        | Apple Vision OCR    |
| llamaparse    | APP_MANIFEST_PATH=backend/runtime-manifest.llamaparse.json | LlamaParse OCR |

### Extraction (`dev/profiles/extraction/`)

| Name    | Key Settings                                             | Description             |
|---------|----------------------------------------------------------|-------------------------|
| default | (none)                                                   | Default pipeline        |
| single  | SLM_EXTRACTION_PIPELINE=single_verify, MULTI_STEP=false  | Single-pass verify      |
| multi   | SLM_MULTI_STEP_EXTRACTION=true                            | Multi-step extraction   |

### Presets (`dev/profiles/presets/`)

| Name                   | Description                                       |
|------------------------|---------------------------------------------------|
| llamaextract           | LlamaParse OCR + agentic extraction, no verifier  |
| llamaextract-lowcost   | LlamaParse OCR + cost-effective extraction         |
| claude-single-apple    | Claude engine + Apple Vision + single extraction   |
| mlx-multi              | MLX engine + multi-step extraction                 |

## Adding a New Provider

1. Create a `.env` file in the appropriate `dev/profiles/<dimension>/` directory
2. Set only the env vars that differ from defaults
3. The profile is automatically discovered by `yarn profile:list`

Example — adding a new engine called `ollama`:
```
# dev/profiles/engines/ollama.env
SLM_ENGINE=local_ollama
RESTART_LOCAL_ML=true
```

## Targets

| Command          | What it runs                      |
|------------------|-----------------------------------|
| `yarn docker`    | Full Docker stack via docker-up.sh |
| `yarn slm`       | SLM restart via slm-restart.sh     |
| `yarn benchmark` | ML benchmarks via benchmark-ml.sh  |

## Validation

The system rejects invalid combinations:

- `--preset=llamaextract --ocr=apple_vision` — llamaextract manages its own OCR
- `--engine=codex --ocr=apple_vision` — unsupported combination

## Migration from Old Commands

| Old Command                          | New Command                                         |
|--------------------------------------|-----------------------------------------------------|
| `yarn docker:up`                     | `yarn docker`                                       |
| `yarn docker:up:claude`              | `yarn docker --engine=claude --extraction=multi`    |
| `yarn docker:up:claude:single`       | `yarn docker --engine=claude --extraction=single`   |
| `yarn docker:up:mlx`                 | `yarn docker --engine=mlx --extraction=single`      |
| `yarn docker:up:mlx:multi`           | `yarn docker --engine=mlx --extraction=multi`       |
| `yarn docker:up:codex`               | `yarn docker --engine=codex`                        |
| `yarn docker:up:api`                 | `yarn docker --engine=api`                          |
| `yarn docker:up:apple_vision:claude` | `yarn docker --engine=claude --ocr=apple_vision --extraction=multi` |
| `yarn docker:up:apple_vision:claude:single` | `yarn docker --engine=claude --ocr=apple_vision --extraction=single` |
| `yarn docker:up:apple_vision:api`    | `yarn docker --engine=api --ocr=apple_vision`       |
| `yarn docker:up:llamaparse`          | `yarn docker --engine=claude --ocr=llamaparse`      |
| `yarn docker:up:llamaparse:claude`   | `yarn docker --engine=claude --ocr=llamaparse`      |
| `yarn docker:up:llamaparse:claude:single` | `yarn docker --engine=claude --ocr=llamaparse --extraction=single` |
| `yarn docker:up:llamaparse:api`      | `yarn docker --engine=api --ocr=llamaparse`         |
| `yarn docker:up:llamaextract`        | `yarn docker --preset=llamaextract`                 |
| `yarn docker:up:llamaextract:lowcost`| `yarn docker --preset=llamaextract-lowcost`         |
| `yarn docker:up:llamaextract:slm`    | `yarn docker --preset=llamaextract --engine=claude` |
| `yarn slm:claude`                    | `yarn slm --engine=claude --extraction=multi`       |
| `yarn slm:claude:single`             | `yarn slm --engine=claude --extraction=single`      |
| `yarn slm:mlx`                       | `yarn slm --engine=mlx --extraction=single`         |
| `yarn slm:mlx:multi`                 | `yarn slm --engine=mlx --extraction=multi`          |
| `yarn slm:codex`                     | `yarn slm --engine=codex`                           |
| `yarn benchmark:ml`                  | `yarn benchmark`                                    |
