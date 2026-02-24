from .base import OCREngine
from ..settings import settings


def create_ocr_engine() -> OCREngine:
  if settings.engine == "local_hybrid":
    from .local_hybrid import LocalHybridOCREngine

    return LocalHybridOCREngine()

  if settings.engine == "local_mlx":
    from .local_mlx import LocalMlxOCREngine

    return LocalMlxOCREngine()

  if settings.engine == "local_apple_vision":
    from .local_apple_vision import LocalAppleVisionOCREngine

    return LocalAppleVisionOCREngine()

  if settings.engine == "prod_http":
    if not settings.remote_base_url:
      raise RuntimeError("OCR_ENGINE=prod_http requires OCR_REMOTE_BASE_URL.")
    from .prod_http import ProdHttpOCREngine

    return ProdHttpOCREngine()

  raise RuntimeError(f"Unsupported OCR_ENGINE='{settings.engine}'.")
