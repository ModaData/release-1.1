"""
ws_bridge.py — WebSocket server that bridges browser clients to Blender sessions.

Architecture:
  Browser (Three.js) ←→ WebSocket (this server) ←→ Blender subprocess (stdin/stdout)

Each WebSocket connection gets its own Blender subprocess. When the client sends
an edit command (select_face, translate_verts, sculpt_stroke, etc.), this bridge
forwards it to the Blender process and streams the response back.

The Blender process runs realtime_session.py which maintains a bmesh in memory
and processes commands via JSON-lines on stdin/stdout.

Run alongside the main FastAPI server:
  python3 ws_bridge.py --port 8765
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Optional

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip install websockets")
    sys.exit(1)

BLENDER_BIN = os.environ.get("BLENDER_BIN", "/usr/local/bin/blender")
SCRIPTS_DIR = Path("/app/scripts")
MAX_SESSIONS = int(os.environ.get("MAX_REALTIME_SESSIONS", "5"))


class BlenderSession:
    """Manages a single Blender subprocess for real-time editing."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.process: Optional[subprocess.Popen] = None
        self.lock = asyncio.Lock()
        self._ready = False

    async def start(self):
        """Spawn the Blender subprocess."""
        script_path = SCRIPTS_DIR / "realtime_session.py"

        self.process = await asyncio.create_subprocess_exec(
            BLENDER_BIN, "--background", "--python", str(script_path),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Wait for "ready" signal
        try:
            line = await asyncio.wait_for(self.process.stdout.readline(), timeout=30)
            data = json.loads(line.decode().strip())
            if data.get("ready"):
                self._ready = True
                print(f"[ws_bridge] Session {self.session_id}: Blender ready (PID {self.process.pid})")
            else:
                print(f"[ws_bridge] Session {self.session_id}: Unexpected ready response: {data}")
        except asyncio.TimeoutError:
            print(f"[ws_bridge] Session {self.session_id}: Blender startup timed out")
            await self.stop()
            raise RuntimeError("Blender session startup timed out")

    async def send_command(self, cmd_data: dict) -> dict:
        """Send a command to Blender and return the response."""
        if not self.process or self.process.returncode is not None:
            return {"error": "Blender session not running"}

        async with self.lock:
            try:
                line = json.dumps(cmd_data) + "\n"
                self.process.stdin.write(line.encode())
                await self.process.stdin.drain()

                # Read response with timeout
                resp_line = await asyncio.wait_for(
                    self.process.stdout.readline(), timeout=30
                )
                return json.loads(resp_line.decode().strip())
            except asyncio.TimeoutError:
                return {"error": "Blender command timed out (30s)"}
            except Exception as e:
                return {"error": f"Blender communication error: {str(e)}"}

    async def stop(self):
        """Terminate the Blender subprocess."""
        if self.process and self.process.returncode is None:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
            print(f"[ws_bridge] Session {self.session_id}: Blender stopped")

    @property
    def is_alive(self):
        return self.process is not None and self.process.returncode is None


class SessionManager:
    """Manages multiple Blender sessions with limits."""

    def __init__(self, max_sessions: int = MAX_SESSIONS):
        self.sessions: dict[str, BlenderSession] = {}
        self.max_sessions = max_sessions

    async def create_session(self, session_id: str) -> BlenderSession:
        """Create a new Blender session."""
        # Check limits
        active = {k: v for k, v in self.sessions.items() if v.is_alive}
        if len(active) >= self.max_sessions:
            # Kill oldest session
            oldest_id = next(iter(active))
            await self.destroy_session(oldest_id)

        session = BlenderSession(session_id)
        await session.start()
        self.sessions[session_id] = session
        return session

    async def get_session(self, session_id: str) -> Optional[BlenderSession]:
        session = self.sessions.get(session_id)
        if session and session.is_alive:
            return session
        return None

    async def destroy_session(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if session:
            await session.stop()

    async def cleanup_all(self):
        for sid in list(self.sessions.keys()):
            await self.destroy_session(sid)


# ── Global state ──
manager = SessionManager()


async def handle_websocket(websocket):
    """Handle a single WebSocket connection."""
    session_id = None
    session = None

    try:
        # First message should be a session init
        raw = await asyncio.wait_for(websocket.recv(), timeout=30)
        init_data = json.loads(raw)

        if init_data.get("cmd") != "init":
            await websocket.send(json.dumps({
                "error": "First message must be {cmd: 'init', session_id: '...'}"
            }))
            return

        session_id = init_data.get("session_id", f"ws-{id(websocket)}")
        glb_path = init_data.get("glb_path")

        print(f"[ws_bridge] New connection: {session_id}")

        # Create or reuse session
        session = await manager.get_session(session_id)
        if not session:
            session = await manager.create_session(session_id)

        await websocket.send(json.dumps({
            "ok": True,
            "session_id": session_id,
            "message": "Blender session ready",
        }))

        # If a GLB path was provided, load it
        if glb_path:
            result = await session.send_command({"cmd": "load_glb", "path": glb_path})
            await websocket.send(json.dumps(result))

        # Main command loop
        async for raw_msg in websocket:
            try:
                cmd_data = json.loads(raw_msg)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"error": "Invalid JSON"}))
                continue

            cmd = cmd_data.get("cmd")

            # Handle client-side commands
            if cmd == "close":
                break

            # Forward everything else to Blender
            result = await session.send_command(cmd_data)
            await websocket.send(json.dumps(result))

    except websockets.exceptions.ConnectionClosed:
        print(f"[ws_bridge] Connection closed: {session_id}")
    except Exception as e:
        print(f"[ws_bridge] Error in session {session_id}: {e}")
        try:
            await websocket.send(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        # Don't destroy session on disconnect — allow reconnection
        # Session is cleaned up by the manager's LRU eviction
        print(f"[ws_bridge] Client disconnected: {session_id}")


async def main():
    port = int(os.environ.get("WS_BRIDGE_PORT", "8765"))
    print(f"[ws_bridge] Starting WebSocket bridge on port {port} (max {MAX_SESSIONS} sessions)")

    async with websockets.serve(handle_websocket, "0.0.0.0", port):
        # Run forever
        stop = asyncio.Future()

        def handle_signal():
            stop.set_result(None)

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, handle_signal)

        await stop

    # Cleanup
    await manager.cleanup_all()
    print("[ws_bridge] Shut down.")


if __name__ == "__main__":
    asyncio.run(main())
