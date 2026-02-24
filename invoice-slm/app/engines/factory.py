from .base import LLMEngine
from ..settings import settings


def create_llm_engine() -> LLMEngine:
  if settings.engine == "local_mlx":
    from .local_mlx import LocalMlxLLMEngine

    return LocalMlxLLMEngine()

  if settings.engine == "prod_http":
    if not settings.remote_base_url:
      raise RuntimeError("SLM_ENGINE=prod_http requires SLM_REMOTE_BASE_URL.")
    from .prod_http import ProdHttpLLMEngine

    return ProdHttpLLMEngine()

  raise RuntimeError(f"Unsupported SLM_ENGINE='{settings.engine}'.")
