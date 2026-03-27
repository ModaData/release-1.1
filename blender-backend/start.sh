#!/bin/bash
# Start both FastAPI server (port 8000) and WebSocket bridge (port 8765)
set -e

echo "[start] Starting Blender Garment Backend..."
echo "[start] FastAPI on :8000, WebSocket Bridge on :8765"

# Start WebSocket bridge in background
python3 /app/ws_bridge.py &
WS_PID=$!

# Start FastAPI server (foreground)
python3 -m uvicorn server:app --host 0.0.0.0 --port 8000 &
API_PID=$!

# Wait for either to exit
wait -n $WS_PID $API_PID

# If one exits, kill the other
kill $WS_PID $API_PID 2>/dev/null
wait
