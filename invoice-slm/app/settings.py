from dataclasses import dataclass
import os

ENV_MODES = {"local", "dev", "stg", "prod"}
SLM_ENGINES = {"local_mlx", "local_codex_cli", "local_claude_cli", "prod_http"}
EXTRACTION_PIPELINES = {"multi_step", "single_verify", "direct"}


def read_bool(name: str, default: bool) -> bool:
  raw = os.getenv(name)
  if raw is None:
    return default
  return raw.strip().lower() == "true"


def read_int(name: str, default: int, minimum: int) -> int:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    value = int(raw.strip())
  except ValueError:
    return default
  return value if value >= minimum else default


def read_choice(name: str, default: str, allowed: set[str]) -> str:
  raw = os.getenv(name)
  if raw is None:
    return default
  value = raw.strip().lower()
  return value if value in allowed else default


def read_env_mode() -> str:
  return read_choice("ENV", "local", ENV_MODES)


def default_slm_engine(env_mode: str) -> str:
  return "local_codex_cli" if env_mode in {"local", "dev"} else "prod_http"


@dataclass(frozen=True)
class Settings:
  provider: str
  model_id: str
  model_path: str
  codex_command: str
  codex_model: str
  codex_workdir: str
  codex_timeout_ms: int
  claude_command: str
  claude_model: str
  claude_workdir: str
  claude_timeout_ms: int
  claude_max_budget_usd: float
  claude_max_retries: int
  claude_retry_base_delay_ms: int
  remote_base_url: str
  remote_select_path: str
  remote_api_key: str
  remote_timeout_ms: int
  probe_timeout_ms: int
  validate_remote_on_startup: bool
  load_on_startup: bool
  max_new_tokens: int
  max_blocks: int
  multi_step_extraction: bool
  extraction_pipeline: str


env_mode = read_env_mode()

settings = Settings(
  provider=read_choice("SLM_ENGINE", default_slm_engine(env_mode), SLM_ENGINES),
  model_id=os.getenv("SLM_MODEL_ID", "mlx-community/Qwen2.5-14B-Instruct-4bit").strip(),
  model_path=os.getenv("SLM_MODEL_PATH", "").strip(),
  codex_command=os.getenv("SLM_CODEX_COMMAND", "codex").strip() or "codex",
  codex_model=os.getenv("SLM_CODEX_MODEL", "").strip(),
  codex_workdir=os.getenv("SLM_CODEX_WORKDIR", "").strip(),
  codex_timeout_ms=read_int("SLM_CODEX_TIMEOUT_MS", 300000, 1000),
  claude_command=os.getenv("SLM_CLAUDE_COMMAND", "claude").strip() or "claude",
  claude_model=os.getenv("SLM_CLAUDE_MODEL", "sonnet").strip(),
  claude_workdir=os.getenv("SLM_CLAUDE_WORKDIR", "").strip(),
  claude_timeout_ms=read_int("SLM_CLAUDE_TIMEOUT_MS", 40000, 1000),
  claude_max_budget_usd=float(os.getenv("SLM_CLAUDE_MAX_BUDGET_USD", "0.50").strip() or "0.50"),
  claude_max_retries=read_int("SLM_CLAUDE_MAX_RETRIES", 3, 0),
  claude_retry_base_delay_ms=read_int("SLM_CLAUDE_RETRY_BASE_DELAY_MS", 2000, 100),
  remote_base_url=os.getenv("SLM_REMOTE_BASE_URL", "").strip(),
  remote_select_path=os.getenv("SLM_REMOTE_SELECT_PATH", "/v1/verify/invoice").strip() or "/v1/verify/invoice",
  remote_api_key=os.getenv("SLM_REMOTE_API_KEY", "").strip(),
  remote_timeout_ms=read_int("SLM_REMOTE_TIMEOUT_MS", 60000, 1000),
  probe_timeout_ms=read_int("SLM_PROBE_TIMEOUT_MS", 3000, 500),
  validate_remote_on_startup=read_bool("SLM_VALIDATE_REMOTE_ON_STARTUP", True),
  load_on_startup=read_bool("SLM_LOAD_ON_STARTUP", True),
  max_new_tokens=read_int("SLM_MAX_NEW_TOKENS", 2048, 64),
  max_blocks=read_int("SLM_MAX_BLOCKS", 220, 1),
  multi_step_extraction=read_bool("SLM_MULTI_STEP_EXTRACTION", False),
  extraction_pipeline=read_choice("SLM_EXTRACTION_PIPELINE", "single_verify", EXTRACTION_PIPELINES)
)
