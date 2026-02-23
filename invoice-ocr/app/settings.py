from dataclasses import dataclass
import os


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


@dataclass(frozen=True)
class Settings:
  engine: str
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
  allow_download: bool
  load_on_startup: bool
  dynamic_crops: bool
  crop_size: int
  min_dynamic_crops: int
  max_dynamic_crops: int


settings = Settings(
  engine=read_choice("OCR_ENGINE", "local_mlx", {"local_mlx", "remote_http"}),
  model_id=os.getenv("OCR_MODEL_ID", "deepseek-ai/DeepSeek-OCR"),
  model_path=os.getenv("OCR_MODEL_PATH", "").strip(),
  remote_base_url=os.getenv("OCR_REMOTE_BASE_URL", "").strip(),
  remote_api_key=os.getenv("OCR_REMOTE_API_KEY", "").strip(),
  remote_timeout_ms=read_int("OCR_REMOTE_TIMEOUT_MS", 300000, 1000),
  validate_remote_on_startup=read_bool("OCR_VALIDATE_REMOTE_ON_STARTUP", True),
  text_prompt=os.getenv("OCR_TEXT_PROMPT", "<image>\nExtract all visible text from this document."),
  layout_prompt=os.getenv(
    "OCR_LAYOUT_PROMPT",
    "<image>\n<|grounding|>Convert page to markdown."
  ),
  max_new_tokens=read_int("OCR_MAX_NEW_TOKENS", 256, 64),
  pdf_max_pages=read_int("OCR_PDF_MAX_PAGES", 6, 1),
  allow_download=read_bool("OCR_ALLOW_DOWNLOAD", True),
  load_on_startup=read_bool("OCR_LOAD_ON_STARTUP", False),
  dynamic_crops=read_bool("OCR_DYNAMIC_CROPS", True),
  crop_size=read_int("OCR_CROP_SIZE", 640, 256),
  min_dynamic_crops=read_int("OCR_MIN_DYNAMIC_CROPS", 2, 1),
  max_dynamic_crops=read_int("OCR_MAX_DYNAMIC_CROPS", 9, 1)
)
