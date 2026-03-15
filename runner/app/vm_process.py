"""
Manages individual 86Box VM processes.

Each running VM gets:
  - A PulseAudio daemon with a virtual null sink (for audio capture)
  - An Xvfb virtual framebuffer display (:100 + slot)
  - An x11vnc server exposing the display over standard TCP RFB
  - A 86Box process on that display, with SDL audio routed to PulseAudio
  - Audio streamed to the browser via ffmpeg → WebM/Opus HTTP endpoint

Port allocation:
  VNC:  BASE_VNC_PORT + slot   (e.g. 5900, 5901, ...) — x11vnc TCP RFB
  DISP: 100 + slot             (e.g. :100, :101, ...)
"""

import asyncio
import configparser
import logging
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

from .config import get_settings

log = logging.getLogger("86web.vm_process")
settings = get_settings()


@dataclass
class VMProcesses:
    vm_id: int
    slot: int
    display: str       # ":100"
    vnc_tcp_port: int  # Xtigervnc RFB TCP port (base_vnc_port + slot)
    vm_dir: str = ""
    box86_cmd: list = field(default_factory=list)
    pulse_proc: Optional[subprocess.Popen] = None
    pulse_runtime: str = ""   # /tmp/pulse-vm{slot}
    vnc_proc: Optional[subprocess.Popen] = None   # Xtigervnc
    box86_proc: Optional[subprocess.Popen] = None
    started_at: float = field(default_factory=time.time)
    network_group_id: Optional[int] = None        # group bridge id, if networking enabled
    network_tap_dev: Optional[str] = None         # actual kernel TAP device name (e.g. tap0)
    paused: bool = False

    @property
    def status(self) -> str:
        if self.box86_proc and self.box86_proc.poll() is None:
            return "paused" if self.paused else "running"
        return "stopped"


def _run_ip(*args: str) -> tuple[bool, str]:
    """Run `sudo /sbin/ip <args>`. Returns (success, stderr)."""
    try:
        result = subprocess.run(["sudo", "/sbin/ip"] + list(args), capture_output=True, timeout=10)
        stderr = result.stderr.decode(errors="replace").strip()
        if result.returncode != 0:
            log.warning("ip %s failed (rc=%d): %s", " ".join(args), result.returncode, stderr)
        return result.returncode == 0, stderr
    except Exception as e:
        log.warning("ip command exception: %s", e)
        return False, str(e)


def _bridge_name(group_id: int) -> str:
    return f"br-group-{group_id}"


def _tap_name(vm_id: int) -> str:
    return f"tap-vm{vm_id}"


def _setup_network(vm_id: int, group_id: int):
    """Ensure the group bridge exists. The TAP is created by 86Box itself via
    /dev/net/tun — we cannot pre-create it because Linux returns EOPNOTSUPP
    when a process tries to TUNSETIFF an existing persistent TAP with different
    flags.  After 86Box creates the TAP we attach it to the bridge asynchronously
    via _attach_tap_to_bridge()."""
    bridge = _bridge_name(group_id)
    tap = _tap_name(vm_id)

    # Create bridge if it doesn't exist
    check = subprocess.run(["sudo", "/sbin/ip", "link", "show", bridge], capture_output=True)
    if check.returncode != 0:
        ok, err = _run_ip("link", "add", bridge, "type", "bridge")
        if not ok:
            raise RuntimeError(
                f"Failed to create bridge {bridge}: {err}. "
                "Ensure the runner container has NET_ADMIN capability and the 'bridge' kernel module is loaded on the host."
            )
        ok, err = _run_ip("link", "set", bridge, "up")
        if not ok:
            raise RuntimeError(f"Failed to bring up bridge {bridge}: {err}")
        log.info("Network: created bridge %s for group %d", bridge, group_id)

    # Delete any stale 86Box bridge from a previous ungraceful shutdown so
    # 86Box can create a fresh one without a name collision.
    _run_ip("link", "delete", tap)


async def _attach_tap_to_bridge(vm_id: int, group_id: int, timeout: float = 10.0) -> Optional[str]:
    """Wait for 86Box to create its bridge+TAP, then move the raw TAP into the
    group bridge.

    86Box's Linux TAP mode creates a bridge named after net_host_dev (e.g.
    tap-vm1) and enslaves a sequentially-numbered TAP (tap0, tap1, …) to it.
    We can't slave a bridge to another bridge, so we pull the real TAP out of
    86Box's bridge, attach it directly to br-group-{id}, and delete the now-
    empty 86Box bridge.

    Returns the kernel TAP device name (e.g. "tap0") so the caller can store
    it for teardown, or None on timeout.
    """
    box_bridge = _tap_name(vm_id)   # e.g. tap-vm1  — bridge 86Box creates
    group_bridge = _bridge_name(group_id)
    deadline = asyncio.get_event_loop().time() + timeout

    while asyncio.get_event_loop().time() < deadline:
        # Wait for 86Box's bridge to appear and have at least one slave port.
        result = subprocess.run(
            ["sudo", "/sbin/ip", "link", "show", "master", box_bridge],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            # Parse the first slave device name from output like "4: tap0: ..."
            tap_dev = None
            for line in result.stdout.splitlines():
                # Lines starting with a digit are interface entries
                parts = line.strip().split(": ")
                if len(parts) >= 2 and parts[0].isdigit():
                    tap_dev = parts[1].split("@")[0]  # strip @ifN suffix if present
                    break

            if tap_dev:
                # Move the raw TAP from 86Box's bridge into the group bridge.
                _run_ip("link", "set", tap_dev, "nomaster")
                _run_ip("link", "set", tap_dev, "master", group_bridge)
                # Remove the now-empty 86Box bridge.
                _run_ip("link", "delete", box_bridge)
                log.info(
                    "Network: TAP %s moved from %s → %s (VM %d, group %d)",
                    tap_dev, box_bridge, group_bridge, vm_id, group_id,
                )
                return tap_dev

        await asyncio.sleep(0.3)

    log.warning(
        "Network: 86Box bridge %s did not appear within %.0fs — VM networking may not work",
        box_bridge, timeout,
    )
    return None


def _teardown_network(vm_id: int, group_id: int, remaining_group_vms: list, tap_dev: Optional[str] = None):
    """Clean up TAP (if still present) and bridge (if no VMs remain in group).
    86Box normally destroys the TAP when it exits; this handles ungraceful exits."""
    bridge = _bridge_name(group_id)

    # Delete the actual kernel TAP device if we know its name; also try the
    # 86Box bridge name in case _attach_tap_to_bridge never ran (e.g. crash).
    for dev in filter(None, [tap_dev, _tap_name(vm_id)]):
        ok, _ = _run_ip("link", "delete", dev)
        if ok:
            log.info("Network: destroyed device %s (VM %d)", dev, vm_id)
            break

    if not remaining_group_vms:
        ok, _ = _run_ip("link", "delete", bridge)
        if ok:
            log.info("Network: destroyed bridge %s (group %d, no remaining VMs)", bridge, group_id)


def _inject_cfg_options(cfg_path: str, overrides: dict):
    """Write key=value pairs into specific sections of an 86box.cfg INI file.

    Only modifies the specified keys; all other content is preserved.
    Creates the file / section if they don't exist yet.
    """
    cfg = configparser.RawConfigParser()
    cfg.optionxform = str          # preserve key case (86Box is case-sensitive)
    cfg.read(cfg_path)
    for section, pairs in overrides.items():
        if not cfg.has_section(section):
            cfg.add_section(section)
        for key, value in pairs.items():
            cfg.set(section, key, value)
    with open(cfg_path, "w") as fh:
        cfg.write(fh)


class VMProcessManager:
    _instance: Optional["VMProcessManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._vms: Dict[int, VMProcesses] = {}
            cls._instance._slots: set = set()
        return cls._instance

    def _alloc_slot(self) -> int:
        for s in range(settings.max_concurrent_vms):
            if s not in self._slots:
                self._slots.add(s)
                return s
        raise RuntimeError("No free VM slots available")

    def _free_slot(self, slot: int):
        self._slots.discard(slot)

    async def start_vm(self, vm_id: int, vm_dir: str, network_group_id: Optional[int] = None) -> dict:
        if not os.path.isfile(settings.box86_bin):
            return {
                "error": "86Box is not installed. Please go to Settings and click 'Update Now' to download it."
            }

        if vm_id in self._vms:
            existing = self._vms[vm_id]
            if existing.status == "running":
                return {
                    "status": "already_running",
                    "vnc_tcp_port": existing.vnc_tcp_port,
                }
            await self.stop_vm(vm_id)

        # Enforce the active VM limit (separate from the VNC slot cap)
        active = sum(1 for p in self._vms.values() if p.status == "running")
        if active >= settings.active_vm_limit:
            return {
                "error": f"Active VM limit reached ({settings.active_vm_limit} running). "
                         "Stop a running VM before starting another."
            }

        slot = self._alloc_slot()
        display_num = 100 + slot
        display = f":{display_num}"
        vnc_tcp_port = settings.base_vnc_port + slot

        log.info("Starting VM %d on display %s, x11vnc TCP port %d", vm_id, display, vnc_tcp_port)

        procs = VMProcesses(
            vm_id=vm_id,
            slot=slot,
            display=display,
            vnc_tcp_port=vnc_tcp_port,
            network_group_id=network_group_id,
        )

        try:
            # ── 0. Network bridge + TAP (if group networking is enabled) ──────
            if network_group_id is not None:
                _setup_network(vm_id, network_group_id)

            # ── 1. PulseAudio (isolated per VM slot) ─────────────────────────
            pulse_runtime = f"/tmp/pulse-vm{slot}"
            pulse_socket = os.path.join(pulse_runtime, "native")

            # Clean up any stale runtime dir from a previous crash (stale PID
            # files cause PulseAudio to think an instance is already running)
            shutil.rmtree(pulse_runtime, ignore_errors=True)
            os.makedirs(pulse_runtime, exist_ok=True)
            procs.pulse_runtime = pulse_runtime

            # Pre-create the pulse config subdir so PulseAudio finds a writable
            # location without falling back to $HOME/.config (which doesn't exist
            # in this container — user was created with -M / no home dir).
            os.makedirs(os.path.join(pulse_runtime, "pulse"), exist_ok=True)

            pulse_env = os.environ.copy()
            pulse_env["PULSE_RUNTIME_PATH"] = pulse_runtime
            # Both XDG_CONFIG_HOME and HOME point to our runtime dir, so every
            # path PulseAudio might try for config files stays within /tmp/pulse-vmN.
            pulse_env["XDG_CONFIG_HOME"] = pulse_runtime
            pulse_env["HOME"] = pulse_runtime
            # Suppress D-Bus lookup — PulseAudio in Docker has no system bus.
            pulse_env["DBUS_SESSION_BUS_ADDRESS"] = "disabled:"

            pa_log_path = os.path.join(pulse_runtime, "pulse.log")
            with open(pa_log_path, 'w') as pa_log_file:
                procs.pulse_proc = subprocess.Popen(
                    [
                        "pulseaudio",
                        "--daemonize=no",           # stay in foreground; no fork+exit
                        "--exit-idle-time=-1",
                        "-n",                       # no default config
                        "--load=module-null-sink sink_name=box86_sink "
                            "sink_properties=device.description=86Box",
                        f"--load=module-native-protocol-unix auth-anonymous=1 "
                            f"socket={pulse_socket}",
                        "--log-level=info",
                    ],
                    env=pulse_env,
                    stdout=pa_log_file,
                    stderr=pa_log_file,
                )

            # Wait for the socket file to appear (up to 5 s).
            # Do NOT check poll() here — PulseAudio may daemonize (fork+exit the
            # initial process) before the socket appears; that looks like a crash
            # but the daemon child is still starting up.
            for _ in range(50):
                if os.path.exists(pulse_socket):
                    break
                await asyncio.sleep(0.1)
            else:
                pa_log_content = "(log not available)"
                try:
                    with open(pa_log_path) as _f:
                        pa_log_content = _f.read(3000)
                except Exception:
                    pass
                raise RuntimeError(
                    f"PulseAudio socket not created at {pulse_socket} "
                    f"(exit={procs.pulse_proc.poll()}). Log:\n{pa_log_content}"
                )
            log.info("PulseAudio ready for VM %d (socket %s)", vm_id, pulse_socket)

            # ── 2. Build shared environment for X processes ───────────────────
            env = os.environ.copy()
            env["DISPLAY"] = display
            env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
            env["PULSE_RUNTIME_PATH"] = pulse_runtime
            env["PULSE_SERVER"] = f"unix:{pulse_socket}"

            # ── 3. Start Xtigervnc (TigerVNC) ────────────────────────────────
            # Xtigervnc is both the X server and the VNC server in one process.
            # Unlike Xvfb+x11vnc, it handles keyboard events natively — no
            # XTest injection required, so all keys (Enter, F-keys, letters,
            # numbers) work correctly out of the box.
            x_lock = f"/tmp/.X{display_num}-lock"
            x_sock = f"/tmp/.X11-unix/X{display_num}"
            for path in (x_lock, x_sock):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

            procs.vnc_proc = subprocess.Popen(
                [
                    "Xtigervnc",
                    display,
                    "-rfbport", str(vnc_tcp_port),
                    "-SecurityTypes", "None",
                    "-AlwaysShared",
                    "-geometry", "1024x768",
                    "-depth", "24",
                    "-ac",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            await asyncio.sleep(1.5)  # Give Xtigervnc time to start

            if procs.vnc_proc.poll() is not None:
                raise RuntimeError("Xtigervnc exited immediately")

            # ── 5. Window manager (maximises the 86Box window) ───────────────
            try:
                subprocess.Popen(
                    ["matchbox-window-manager", "-use_titlebar", "no"],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                await asyncio.sleep(0.5)
            except FileNotFoundError:
                log.warning("matchbox-window-manager not found — 86Box window will not be maximised")

            # ── 6. Start 86Box ────────────────────────────────────────────────
            # SDL_AUDIODRIVER=pulse routes audio through PulseAudio null sink,
            # which ffmpeg reads and streams to the browser as WebM/Opus.

            # Redirect _86box_cache (shader/ROM cache) to the shared cache dir
            # so it doesn't accumulate inside each VM's config directory.
            box86_cache_dir = os.path.join(settings.data_path, "cache", "_86box_cache")
            os.makedirs(box86_cache_dir, exist_ok=True)
            cache_link = os.path.join(vm_dir, "_86box_cache")
            if not os.path.exists(cache_link) and not os.path.islink(cache_link):
                os.symlink(box86_cache_dir, cache_link)

            cfg_path = os.path.join(vm_dir, "86box.cfg")
            _inject_cfg_options(cfg_path, {"General": {"hide_tool_bar": "1", "start_in_fullscreen": "1"}})
            box86_args = [
                settings.box86_exec,  # extracted binary if available, else AppImage
                "--config", cfg_path,
                "--rompath", settings.roms_path,
                "--vmpath", vm_dir,
            ]
            # Always run 86Box via cap_wrap so CAP_NET_RAW is in the ambient set.
            # 86Box enumerates pcap devices at startup regardless of whether the
            # current VM config uses pcap networking — without NET_RAW the device
            # list is empty and it shows a "No PCap devices found" dialog.
            # cap_wrap has file capabilities (cap_net_raw,cap_setpcap+ep) that let
            # it raise CAP_NET_RAW as an ambient cap before exec'ing 86Box, so
            # the capability survives the AppImage extract+exec chain.
            box86_cmd = ["/usr/local/bin/cap_wrap"] + box86_args
            procs.vm_dir = vm_dir
            procs.box86_cmd = box86_cmd

            box86_env = env.copy()
            box86_env["SDL_AUDIODRIVER"] = "pulse"
            # Use the monitor of our null sink so ffmpeg can read and stream it
            box86_env["PULSE_SINK"] = "box86_sink"
            # Point Qt's AppConfigLocation to a writable /tmp path so 86Box reads
            # 86box_global.cfg from /tmp/86box-global/86Box/ (written at runner startup).
            box86_env["XDG_CONFIG_HOME"] = "/tmp/86box-global"
            # Extract-and-run avoids the AppImage FUSE mount, which would otherwise
            # fork a second "86Box" process as mount keeper. Single process = clean
            # SIGSTOP/SIGCONT for pause and simpler process group management.
            box86_env["APPIMAGE_EXTRACT_AND_RUN"] = "1"

            log.info("86Box cmd: %s", " ".join(box86_cmd))
            procs.box86_proc = subprocess.Popen(
                box86_cmd,
                env=box86_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=vm_dir,
                preexec_fn=os.setpgrp,  # own process group so killpg/SIGSTOP covers AppImage children
            )
            await asyncio.sleep(2.0)

            if procs.box86_proc.poll() is not None:
                stderr = procs.box86_proc.stderr.read().decode(errors="replace")
                raise RuntimeError(f"86Box exited immediately: {stderr[:500]}")

            self._vms[vm_id] = procs
            log.info("VM %d started successfully (x11vnc TCP port %d)", vm_id, vnc_tcp_port)

            # Attach the TAP (created by 86Box) to the bridge in the background.
            # Store the resolved kernel TAP name on completion for teardown.
            if network_group_id is not None:
                async def _do_attach(vid=vm_id, gid=network_group_id):
                    tap_dev = await _attach_tap_to_bridge(vid, gid)
                    if tap_dev and vid in self._vms:
                        self._vms[vid].network_tap_dev = tap_dev
                asyncio.create_task(_do_attach())

            return {
                "status": "running",
                "vnc_tcp_port": vnc_tcp_port,
                "display": display,
            }

        except Exception as e:
            log.error("Failed to start VM %d: %s", vm_id, e)
            await self._kill_procs(procs)
            self._free_slot(slot)
            return {"error": str(e)}

    async def stop_vm(self, vm_id: int) -> dict:
        procs = self._vms.pop(vm_id, None)
        if not procs:
            return {"status": "not_running"}

        log.info("Stopping VM %d", vm_id)
        await self._kill_procs(procs)
        self._free_slot(procs.slot)

        # Tear down TAP; destroy bridge only if no other VMs in this group remain
        if procs.network_group_id is not None:
            remaining = [
                p for p in self._vms.values()
                if p.network_group_id == procs.network_group_id
            ]
            _teardown_network(vm_id, procs.network_group_id, remaining, procs.network_tap_dev)

        return {"status": "stopped"}

    async def reset_vm(self, vm_id: int) -> dict:
        """Restart only the 86Box process, keeping Xvfb/x11vnc/PulseAudio alive.

        The VNC session stays connected through the reset.
        """
        procs = self._vms.get(vm_id)
        if not procs or not procs.box86_proc:
            return {"error": "VM not running"}

        log.info("Resetting VM %d (restarting 86Box)", vm_id)

        if procs.box86_proc.poll() is None:
            try:
                procs.box86_proc.terminate()
            except Exception:
                pass
            await asyncio.sleep(1.0)
            if procs.box86_proc.poll() is None:
                try:
                    procs.box86_proc.kill()
                except Exception:
                    pass

        await asyncio.sleep(0.5)

        env = os.environ.copy()
        env["DISPLAY"] = procs.display
        env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
        env["PULSE_RUNTIME_PATH"] = procs.pulse_runtime
        env["PULSE_SERVER"] = f"unix:{procs.pulse_runtime}/native"
        env["SDL_AUDIODRIVER"] = "pulse"
        env["PULSE_SINK"] = "box86_sink"

        try:
            procs.box86_proc = subprocess.Popen(
                procs.box86_cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=procs.vm_dir,
                preexec_fn=os.setpgrp,
            )
            procs.paused = False
            procs.started_at = time.time()
            log.info("VM %d reset complete", vm_id)
            return {"status": "reset"}
        except Exception as e:
            log.error("Failed to restart 86Box for VM %d: %s", vm_id, e)
            return {"error": str(e)}

    async def pause_vm(self, vm_id: int) -> dict:
        """Toggle pause on 86Box using SIGSTOP/SIGCONT."""
        procs = self._vms.get(vm_id)
        if not procs or not procs.box86_proc or procs.box86_proc.poll() is not None:
            return {"error": "VM not running"}

        pid = procs.box86_proc.pid
        try:
            if procs.paused:
                os.killpg(pid, signal.SIGCONT)
                procs.paused = False
                log.info("VM %d resumed (SIGCONT → pgrp %d)", vm_id, pid)
                return {"status": "resumed"}
            else:
                os.killpg(pid, signal.SIGSTOP)
                procs.paused = True
                log.info("VM %d paused (SIGSTOP → pgrp %d)", vm_id, pid)
                return {"status": "paused"}
        except ProcessLookupError:
            return {"error": "VM process not found"}
        except Exception as e:
            return {"error": str(e)}

    async def _kill_procs(self, procs: VMProcesses):
        # Kill in reverse startup order.
        # 86Box runs in its own process group (preexec_fn=os.setpgrp) so we use
        # killpg to also terminate AppImage child processes.
        if procs.box86_proc and procs.box86_proc.poll() is None:
            try:
                # Resume first if paused — a SIGSTOP'd process group won't respond to SIGTERM
                if procs.paused:
                    os.killpg(procs.box86_proc.pid, signal.SIGCONT)
                os.killpg(procs.box86_proc.pid, signal.SIGTERM)
            except Exception:
                pass
        for proc in [procs.vnc_proc, procs.pulse_proc]:
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
        await asyncio.sleep(1.0)
        if procs.box86_proc and procs.box86_proc.poll() is None:
            try:
                os.killpg(procs.box86_proc.pid, signal.SIGKILL)
            except Exception:
                pass
        for proc in [procs.vnc_proc, procs.pulse_proc]:
            if proc and proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass

    def get_status(self, vm_id: int) -> dict:
        procs = self._vms.get(vm_id)
        if not procs:
            return {"status": "stopped"}
        return {
            "status": procs.status,
            "vnc_tcp_port": procs.vnc_tcp_port,
            "display": procs.display,
            "uptime": time.time() - procs.started_at,
        }

    def send_key(self, vm_id: int, key: str) -> dict:
        """Send a key combo to the VM's virtual display via xdotool."""
        procs = self._vms.get(vm_id)
        if not procs or procs.status == "stopped":
            return {"error": "VM not running"}
        try:
            env = os.environ.copy()
            env["DISPLAY"] = procs.display
            result = subprocess.run(
                ["xdotool", "key", "--clearmodifiers", key],
                timeout=5, env=env,
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                log.warning("xdotool send_key failed (rc=%d): %s", result.returncode, result.stderr.strip())
                return {"error": result.stderr.strip() or f"xdotool rc={result.returncode}"}
            return {"status": "ok"}
        except FileNotFoundError:
            return {"error": "xdotool not installed"}

    def get_pulse_info(self, vm_id: int) -> dict | None:
        procs = self._vms.get(vm_id)
        if not procs or procs.status != "running":
            return None
        return {
            "pulse_runtime": procs.pulse_runtime,
            "pulse_server": f"unix:{procs.pulse_runtime}/native",
        }

    def list_running(self) -> list:
        return [
            {
                "vm_id": p.vm_id,
                "status": p.status,
                "vnc_tcp_port": p.vnc_tcp_port,
                "uptime": time.time() - p.started_at,
            }
            for p in self._vms.values()
        ]
