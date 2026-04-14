from pydantic import BaseModel, Field
from .settings import settings


class OcrDocumentRequest(BaseModel):
  model: str = Field(default="")
  document: str = Field(default="")
  includeLayout: bool = Field(default=True)
  prompt: str = Field(default="")
  maxTokens: int = Field(default=settings.max_new_tokens)
