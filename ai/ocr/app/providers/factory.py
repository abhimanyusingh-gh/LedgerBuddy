from ..boundary import OCRProvider
from ..settings import settings


def create_ocr_provider() -> OCRProvider:
  if settings.provider == "local_hybrid":
    from .local.hybrid import LocalHybridOCRProvider

    return LocalHybridOCRProvider()

  if settings.provider == "local_mlx":
    from .local.mlx import LocalMlxOCRProvider

    return LocalMlxOCRProvider()

  if settings.provider == "local_apple_vision":
    from .local.apple_vision import LocalAppleVisionOCRProvider

    return LocalAppleVisionOCRProvider()

  if settings.provider == "prod_http":
    if not settings.remote_base_url:
      raise RuntimeError("OCR_ENGINE=prod_http requires OCR_REMOTE_BASE_URL.")
    from .http.provider import ProdHttpOCRProvider

    return ProdHttpOCRProvider()

  raise RuntimeError(f"Unsupported OCR_ENGINE='{settings.provider}'.")
