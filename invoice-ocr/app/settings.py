from dataclasses import dataclass
import os

ENV_MODES = {"local", "dev", "stg", "prod"}
OCR_ENGINES = {"local_hybrid", "local_mlx", "local_apple_vision", "prod_http"}


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


def read_float(name: str, default: float, minimum: float, maximum: float) -> float:
  raw = os.getenv(name)
  if raw is None:
    return default
  try:
    value = float(raw.strip())
  except ValueError:
    return default
  if value < minimum or value > maximum:
    return default
  return value


def read_choice(name: str, default: str, allowed: set[str]) -> str:
  raw = os.getenv(name)
  if raw is None:
    return default
  value = raw.strip().lower()
  return value if value in allowed else default


def read_env_mode() -> str:
  return read_choice("ENV", "local", ENV_MODES)


def default_ocr_engine(env_mode: str) -> str:
  return "local_hybrid" if env_mode in {"local", "dev"} else "prod_http"


@dataclass(frozen=True)
class Settings:
  provider: str
  model_id: str
  model_path: str
  remote_base_url: str
  remote_api_key: str
  remote_timeout_ms: int
  validate_remote_on_startup: bool
  text_prompt: str
  layout_prompt: str
  max_new_tokens: int
  pdf_max_pages: int
  load_on_startup: bool
  hybrid_apple_accept_score: float


env_mode = read_env_mode()

settings = Settings(
  provider=read_choice("OCR_ENGINE", default_ocr_engine(env_mode), OCR_ENGINES),
  model_id=os.getenv("OCR_MODEL_ID", "mlx-community/DeepSeek-OCR-4bit").strip(),
  model_path=os.getenv("OCR_MODEL_PATH", "").strip(),
  remote_base_url=os.getenv("OCR_REMOTE_BASE_URL", "").strip(),
  remote_api_key=os.getenv("OCR_REMOTE_API_KEY", "").strip(),
  remote_timeout_ms=read_int("OCR_REMOTE_TIMEOUT_MS", 300000, 1000),
  validate_remote_on_startup=read_bool("OCR_VALIDATE_REMOTE_ON_STARTUP", True),
  text_prompt=os.getenv("OCR_TEXT_PROMPT", "Extract all visible text from this document."),
  layout_prompt=os.getenv("OCR_LAYOUT_PROMPT", "<|grounding|>Convert page to markdown."),
  max_new_tokens=read_int("OCR_MAX_NEW_TOKENS", 512, 64),
  pdf_max_pages=read_int("OCR_PDF_MAX_PAGES", 6, 1),
  load_on_startup=read_bool("OCR_LOAD_ON_STARTUP", True),
  hybrid_apple_accept_score=read_float("OCR_HYBRID_APPLE_ACCEPT_SCORE", 0.9, 0.0, 1.0)
)
