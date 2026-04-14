from ..boundary import LLMProvider
from ..settings import settings


def create_llm_provider() -> LLMProvider:
  if settings.provider == "local_mlx":
    from .local.mlx import LocalMlxLLMProvider

    return LocalMlxLLMProvider()

  if settings.provider == "local_codex_cli":
    from .local.codex_cli import LocalCodexCliLLMProvider

    return LocalCodexCliLLMProvider()

  if settings.provider == "local_claude_cli":
    from .local.claude_cli import LocalClaudeCliLLMProvider

    return LocalClaudeCliLLMProvider()

  if settings.provider == "prod_http":
    if not settings.remote_base_url:
      raise RuntimeError("SLM_ENGINE=prod_http requires SLM_REMOTE_BASE_URL.")
    from .http.provider import ProdHttpLLMProvider

    return ProdHttpLLMProvider()

  if settings.provider == "anthropic_api":
    from .api.anthropic import AnthropicApiLLMProvider

    return AnthropicApiLLMProvider()

  raise RuntimeError(f"Unsupported SLM_ENGINE='{settings.provider}'.")
