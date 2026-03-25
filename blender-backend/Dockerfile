FROM nytimes/blender:4.0-gpu-ubuntu22.04

# Install Python dependencies
RUN apt-get update && apt-get install -y \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    fastapi==0.109.0 \
    uvicorn[standard]==0.27.0 \
    python-multipart==0.0.6 \
    trimesh==4.0.8 \
    numpy==1.26.3 \
    aiofiles==23.2.1

# Create working directories
RUN mkdir -p /app/scripts /tmp/blender-work/input /tmp/blender-work/output

WORKDIR /app

COPY server.py /app/server.py
COPY scripts/ /app/scripts/

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
