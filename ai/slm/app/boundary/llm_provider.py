from abc import ABC, abstractmethod
from typing import Any


class LLMProvider(ABC):
  @abstractmethod
  def startup(self) -> None:
    raise NotImplementedError

  @abstractmethod
  def health(self) -> dict[str, Any]:
    raise NotImplementedError

  @abstractmethod
  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError

  def call_prompt(self, prompt_text: str) -> dict[str, Any]:
    raise NotImplementedError
