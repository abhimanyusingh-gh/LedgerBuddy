FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV OCR_ENGINE=prod_http

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  libgl1 \
  libglib2.0-0 \
  libsm6 \
  libxext6 \
  libxrender1 \
  libxcb1 \
  && rm -rf /var/lib/apt/lists/*

COPY invoice-ocr/requirements.base.txt /app/requirements.base.txt
COPY invoice-ocr/requirements.prod.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r /app/requirements.txt

COPY invoice-ocr/server.py /app/server.py
COPY invoice-ocr/app /app/app

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
