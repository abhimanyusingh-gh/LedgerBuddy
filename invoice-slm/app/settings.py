from dataclasses import dataclass
import os


def read_bool(name: str, default: bool) -> bool:
  raw = os.getenv(name)
  if raw is None:
    return default
  return raw.strip().lower() == "true"


def read_float(name: str, default: float, minimum: float, maximum: float) -> float:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    value = float(raw.strip())
  except ValueError:
    return default
  if value < minimum:
    return minimum
  if value > maximum:
    return maximum
  return value


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


@dataclass(frozen=True)
class Settings:
  engine: str
  model_id: str
  model_path: str
  remote_base_url: str
  remote_select_path: str
  remote_api_key: str
  remote_timeout_ms: int
  validate_remote_on_startup: bool
  allow_download: bool
  load_on_startup: bool
  max_new_tokens: int
  temperature: float
  max_blocks: int


settings = Settings(
  engine=read_choice("SLM_ENGINE", "local_mlx", {"local_mlx", "remote_http"}),
  model_id=os.getenv("SLM_MODEL_ID", "mlx-community/Qwen2.5-3B-Instruct-4bit"),
  model_path=os.getenv("SLM_MODEL_PATH", "").strip(),
  remote_base_url=os.getenv("SLM_REMOTE_BASE_URL", "").strip(),
  remote_select_path=os.getenv("SLM_REMOTE_SELECT_PATH", "/v1/verify/invoice").strip() or "/v1/verify/invoice",
  remote_api_key=os.getenv("SLM_REMOTE_API_KEY", "").strip(),
  remote_timeout_ms=read_int("SLM_REMOTE_TIMEOUT_MS", 60000, 1000),
  validate_remote_on_startup=read_bool("SLM_VALIDATE_REMOTE_ON_STARTUP", True),
  allow_download=read_bool("SLM_ALLOW_DOWNLOAD", True),
  load_on_startup=read_bool("SLM_LOAD_ON_STARTUP", False),
  max_new_tokens=read_int("SLM_MAX_NEW_TOKENS", 384, 64),
  temperature=read_float("SLM_TEMPERATURE", 0.0, 0.0, 1.0),
  max_blocks=read_int("SLM_MAX_BLOCKS", 220, 1)
)
