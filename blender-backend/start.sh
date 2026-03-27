#!/bin/bash
# Start FastAPI server only (port 8000)
# WebSocket bridge (ws_bridge.py) is optional — start manually if needed
set -e

echo "[start] Starting Blender Garment Backend on :8000"
echo "[start] Blender: $(blender --version 2>&1 | head -1)"

exec python3 -m uvicorn server:app --host 0.0.0.0 --port 8000
