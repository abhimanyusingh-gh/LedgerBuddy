from ..boundary import LLMProvider
from ..settings import settings


def create_llm_provider() -> LLMProvider:
  if settings.provider == "local_mlx":
    from .local_mlx import LocalMlxLLMProvider

    return LocalMlxLLMProvider()

  if settings.provider == "local_codex_cli":
    from .local_codex_cli import LocalCodexCliLLMProvider

    return LocalCodexCliLLMProvider()

  if settings.provider == "prod_http":
    if not settings.remote_base_url:
      raise RuntimeError("SLM_ENGINE=prod_http requires SLM_REMOTE_BASE_URL.")
    from .prod_http import ProdHttpLLMProvider

    return ProdHttpLLMProvider()

  raise RuntimeError(f"Unsupported SLM_ENGINE='{settings.provider}'.")
