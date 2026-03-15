import configparser
import logging
import os
import re
from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import get_settings
from .vm_process import VMProcessManager
from .updater import check_86box_update, check_roms_update, download_86box, download_roms

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("86web.runner")

manager = VMProcessManager()


async def _auto_shutdown_loop():
    """Periodically stop VMs that have exceeded vm_auto_shutdown_minutes."""
    limit = settings.vm_auto_shutdown_minutes * 60  # convert to seconds
    while True:
        await asyncio.sleep(60)
        for vm_info in manager.list_running():
            if vm_info.get("uptime", 0) >= limit:
                log.info(
                    "Auto-shutdown: VM %d has been running for %.0f minutes (limit %d) — stopping",
                    vm_info["vm_id"], vm_info["uptime"] / 60, settings.vm_auto_shutdown_minutes,
                )
                await manager.stop_vm(vm_info["vm_id"])


def _ensure_global_config():
    """Write fixed settings into 86box_global.cfg (Qt AppConfigLocation).

    86Box reads global preferences from a separate file, not the per-VM
    86box.cfg passed via --config.  We use /tmp/86box-global as
    XDG_CONFIG_HOME so the file lands at /tmp/86box-global/86Box/86box_global.cfg.

    Settings enforced here:
      confirm_reset = 0   — suppress "Are you sure?" before hard reset
      [Shortcuts]         — lock keybindings to their defaults so our xdotool
                            calls always match what 86Box expects, even if a
                            user somehow accesses the settings dialog.
    """
    config_dir = "/tmp/86box-global/86Box"
    os.makedirs(config_dir, exist_ok=True)
    path = os.path.join(config_dir, "86box_global.cfg")

    cfg = configparser.RawConfigParser()
    cfg.optionxform = str  # preserve case
    try:
        cfg.read(path)
    except configparser.MissingSectionHeaderError:
        # 86Box wrote the file without section headers — discard and start fresh
        log.warning("86box_global.cfg has no section headers (written by 86Box directly); overwriting.")
        os.remove(path)

    # Top-level keys live under the implicit DEFAULT / no-section area.
    # configparser writes them under [DEFAULT] which Qt reads as top-level.
    cfg.defaults()["confirm_reset"] = "0"

    # Lock keybindings to the 86Box defaults.  Key names extracted from the
    # binary; values are Qt key-sequence strings.
    shortcuts = {
        "send_ctrl_alt_del":     "Ctrl+F12",
        "send_ctrl_alt_esc":     "Ctrl+F10",
        "fullscreen":            "Ctrl+Alt+PgUp",
        "toggle_ui_fullscreen":  "Ctrl+Alt+PgDown",
        "screenshot":            "Ctrl+F11",
        "release_mouse":         "Ctrl+End",
        "hard_reset":            "Ctrl+Alt+F12",
        "pause":                 "Ctrl+Alt+F1",
        "mute":                  "Ctrl+Alt+M",
        "force_interpretation":  "Ctrl+Alt+I",
    }
    if not cfg.has_section("Shortcuts"):
        cfg.add_section("Shortcuts")
    for key, value in shortcuts.items():
        cfg.set("Shortcuts", key, value)

    with open(path, "w") as f:
        cfg.write(f)

    log.info("86Box global config written to %s", path)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_global_config()
    log.info("86Web Runner started. 86Box binary: %s", settings.box86_bin)
    shutdown_task = None
    if settings.vm_auto_shutdown_minutes > 0:
        log.info("Auto-shutdown enabled: VMs will be stopped after %d minutes", settings.vm_auto_shutdown_minutes)
        shutdown_task = asyncio.create_task(_auto_shutdown_loop())
    yield
    if shutdown_task:
        shutdown_task.cancel()
    log.info("86Web Runner shutting down — stopping all VMs…")
    for vm_info in manager.list_running():
        await manager.stop_vm(vm_info["vm_id"])


app = FastAPI(title="86Web Runner", lifespan=lifespan)


# ─── VM lifecycle ─────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    vm_dir: str
    network_group_id: int | None = None


@app.post("/vms/{vm_id}/start")
async def start_vm(vm_id: int, req: StartRequest):
    result = await manager.start_vm(vm_id, req.vm_dir, network_group_id=req.network_group_id)
    if result.get("error"):
        raise HTTPException(500, result["error"])
    return result


@app.post("/vms/{vm_id}/stop")
async def stop_vm(vm_id: int):
    return await manager.stop_vm(vm_id)


@app.post("/vms/{vm_id}/reset")
async def reset_vm(vm_id: int):
    result = await manager.reset_vm(vm_id)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@app.post("/vms/{vm_id}/pause")
async def pause_vm(vm_id: int):
    result = await manager.pause_vm(vm_id)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@app.post("/vms/{vm_id}/send-key")
async def send_key(vm_id: int, body: dict):
    key = body.get("key", "")
    if not key:
        raise HTTPException(400, "key is required")
    result = manager.send_key(vm_id, key)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@app.get("/vms/{vm_id}/status")
async def get_vm_status(vm_id: int):
    return manager.get_status(vm_id)


@app.get("/vms")
async def list_vms():
    return manager.list_running()


# ─── VNC WebSocket proxy ──────────────────────────────────────────────────────

@app.websocket("/vnc/{vm_id}/websockify")
async def vnc_proxy(websocket: WebSocket, vm_id: int):
    """WebSocket-to-TCP proxy — bridges noVNC browser WebSocket to x11vnc's raw RFB TCP port."""
    status = manager.get_status(vm_id)
    if status["status"] not in ("running", "paused"):
        await websocket.close(code=4004, reason="VM not running")
        return

    vnc_tcp_port = status["vnc_tcp_port"]

    req_protocols = websocket.headers.get("sec-websocket-protocol", "")
    subprotocols = [p.strip() for p in req_protocols.split(",") if p.strip()]
    accepted = subprotocols[0] if subprotocols else None
    await websocket.accept(subprotocol=accepted)

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", vnc_tcp_port)
    except Exception as e:
        log.warning("Cannot connect to x11vnc TCP port %d for VM %d: %s", vnc_tcp_port, vm_id, e)
        await websocket.close(code=1011, reason="VNC unavailable")
        return

    async def browser_to_vnc():
        try:
            while True:
                data = await websocket.receive_bytes()
                writer.write(data)
                await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    async def vnc_to_browser():
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                await websocket.send_bytes(data)
        except Exception:
            pass

    try:
        done, pending = await asyncio.wait(
            [asyncio.create_task(browser_to_vnc()),
             asyncio.create_task(vnc_to_browser())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("VNC proxy error for VM %d: %s", vm_id, e)


# ─── Audio streaming ──────────────────────────────────────────────────────────

@app.get("/vms/{vm_id}/audio")
async def audio_stream(vm_id: int):
    """Stream VM audio as MP3 via ffmpeg reading from the PulseAudio null-sink monitor."""
    pulse_info = manager.get_pulse_info(vm_id)
    if not pulse_info:
        raise HTTPException(404, "VM not running")

    pulse_socket = os.path.join(pulse_info["pulse_runtime"], "native")
    if not os.path.exists(pulse_socket):
        log.error("PulseAudio socket missing for VM %d: %s", vm_id, pulse_socket)
        raise HTTPException(503, "PulseAudio not ready")

    pulse_env = os.environ.copy()
    pulse_env["PULSE_RUNTIME_PATH"] = pulse_info["pulse_runtime"]
    pulse_env["PULSE_SERVER"] = pulse_info["pulse_server"]

    async def generate():
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            # Minimise input probe/analysis buffering
            "-fflags", "+nobuffer",
            "-probesize", "32",
            "-analyzeduration", "0",
            "-f", "pulse",
            "-i", "box86_sink.monitor",
            "-c:a", "libmp3lame",
            "-b:a", "128k",
            "-vn",
            "-f", "mp3",
            "-flush_packets", "1",
            "-loglevel", "warning",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=pulse_env,
        )

        # Give ffmpeg a moment, then confirm it's still alive
        await asyncio.sleep(0.5)
        if proc.returncode is not None:
            try:
                err = await asyncio.wait_for(proc.stderr.read(), timeout=2.0)
                log.error("ffmpeg for VM %d exited (code %d): %s",
                          vm_id, proc.returncode, err.decode(errors="replace").strip())
            except Exception:
                pass
            return  # empty body — caller sees truncated stream

        # ffmpeg is running — drain stderr in background
        async def _drain_stderr():
            try:
                data = await proc.stderr.read()
                if data:
                    log.warning("ffmpeg VM %d: %s", vm_id, data.decode(errors="replace").strip())
            except Exception:
                pass
        asyncio.create_task(_drain_stderr())

        try:
            while True:
                chunk = await proc.stdout.read(1024)
                if not chunk:
                    break
                yield chunk
        except Exception:
            pass
        finally:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Version / update ─────────────────────────────────────────────────────────

@app.get("/version")
async def get_version():
    box_info = await check_86box_update()
    roms_info = await check_roms_update()
    return {
        "version": box_info.get("version"),
        "latest": box_info.get("latest"),
        "update_available": box_info.get("update_available", False),
        "roms_version": roms_info.get("roms_version"),
        "roms_latest": roms_info.get("roms_latest"),
        "roms_update_available": roms_info.get("roms_update_available", False),
        "vm_auto_shutdown_minutes": settings.vm_auto_shutdown_minutes,
    }


@app.post("/update")
async def trigger_update():
    box_info = await check_86box_update()
    roms_info = await check_roms_update()
    results = {}

    if box_info.get("update_available") or not os.path.exists(settings.box86_bin):
        ok = await download_86box(box_info.get("release"))
        results["86box"] = "updated" if ok else "failed"
    else:
        results["86box"] = "up_to_date"

    if roms_info.get("roms_update_available"):
        ok = await download_roms(roms_info.get("release"))
        results["roms"] = "updated" if ok else "failed"
    else:
        results["roms"] = "up_to_date"

    return results


@app.get("/health")
async def health():
    return {"status": "ok", "running_vms": len(manager.list_running())}


@app.get("/recommended-vm-limit")
async def recommended_vm_limit():
    """Compute a rough recommended active VM limit based on host CPU cores and RAM.

    86Box (x86 emulation) is single-threaded and typically consumes 1-2 CPU cores
    at full load, plus ~64-256 MB RAM per VM depending on the emulated hardware.
    We use: min(cpu_cores // 2, ram_gb // 1) as a conservative estimate.
    """
    import multiprocessing
    try:
        cpu_cores = multiprocessing.cpu_count()
    except Exception:
        cpu_cores = 2

    ram_gb = 4  # fallback
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    ram_gb = max(1, kb // 1024 // 1024)
                    break
    except Exception:
        pass

    by_cpu = max(1, cpu_cores // 2)
    by_ram = max(1, ram_gb // 1)
    recommended = min(by_cpu, by_ram)

    return {
        "recommended": recommended,
        "current_limit": settings.active_vm_limit,
        "cpu_cores": cpu_cores,
        "ram_gb": ram_gb,
        "notes": (
            f"Estimated: min(cpu_cores/2={by_cpu}, ram_gb={by_ram}) = {recommended}. "
            "Set ACTIVE_VM_LIMIT in .env to override."
        ),
    }


