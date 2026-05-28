FROM python:3.9-slim

# Copia o executável do uv da imagem oficial do Astral
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
RUN apt-get update && apt-get install -y tzdata && rm -rf /var/lib/apt/lists/*
ENV TZ=America/Sao_Paulo

COPY requirements.txt .
# Instala as dependências usando o uv (muito mais rápido que o pip)
RUN uv pip install --system --no-cache -r requirements.txt

COPY . .

# Expose port
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
