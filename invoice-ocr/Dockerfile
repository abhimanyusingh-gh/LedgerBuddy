FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY invoice-ocr/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r /app/requirements.txt

COPY invoice-ocr/server.py /app/server.py
COPY invoice-ocr/app /app/app
COPY invoice-ocr/deepseek_ocr_mlx /app/deepseek_ocr_mlx

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
