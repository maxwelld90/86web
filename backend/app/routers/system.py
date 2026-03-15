import psutil
import re
import time
import os
import socket
from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user, require_admin
from ..models import User, VM, SystemSetting
from ..schemas import SystemStats, VersionInfo, UserStats, HardwareLists, HardwareOption, AppSettings
from ..services.runner_client import RunnerClient
from ..config import get_settings
from ..utils import dir_size
from .. import hardware_lists

router = APIRouter(prefix="/api/system", tags=["system"])
settings = get_settings()
_start_time = time.time()

def _read_app_version() -> str:
    for candidate in [Path("/app/VERSION"), Path(__file__).parents[3] / "VERSION"]:
        try:
            return candidate.read_text().strip()
        except OSError:
            pass
    return "dev"

APP_VERSION = _read_app_version()


@router.get("/stats", response_model=SystemStats)
async def get_system_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage(settings.data_path)

    total_vms = db.query(VM).count()
    running_vms = db.query(VM).filter(VM.status == "running").count()

    return SystemStats(
        cpu_percent=cpu,
        memory_total=mem.total,
        memory_used=mem.used,
        memory_percent=mem.percent,
        disk_total=disk.total,
        disk_used=disk.used,
        disk_percent=disk.percent,
        running_vms=running_vms,
        total_vms=total_vms,
        uptime_seconds=time.time() - _start_time,
        hostname=socket.gethostname(),
    )


@router.get("/user-stats", response_model=UserStats)
async def get_user_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vms = db.query(VM).filter(VM.user_id == current_user.id).all()
    vm_count = len(vms)
    running_count = sum(1 for v in vms if v.status == "running")
    user_images_dir = settings.user_images_path(current_user.id)
    shared_media_dir = settings.shared_media_path(current_user.id)
    vm_usage = sum(dir_size(os.path.join(settings.vms_path, vm.uuid)) for vm in vms)
    disk_usage = vm_usage + dir_size(user_images_dir) + dir_size(shared_media_dir)
    return UserStats(
        vm_count=vm_count,
        running_vm_count=running_count,
        disk_usage_bytes=disk_usage,
        max_vms=current_user.max_vms,
        max_storage_gb=current_user.max_storage_gb,
    )


@router.get("/version", response_model=VersionInfo)
async def get_version_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = RunnerClient()
    try:
        runner_info = await client.get_version_info()
    except Exception:
        runner_info = {}

    return VersionInfo(
        box86_version=runner_info.get("version"),
        box86_latest=runner_info.get("latest"),
        roms_version=runner_info.get("roms_version"),
        roms_latest=runner_info.get("roms_latest"),
        app_version=APP_VERSION,
        update_available=runner_info.get("update_available", False),
        roms_update_available=runner_info.get("roms_update_available", False),
        vm_auto_shutdown_minutes=runner_info.get("vm_auto_shutdown_minutes", 0),
    )


@router.post("/update-86box")
async def trigger_update(
    current_user: User = Depends(require_admin),
):
    client = RunnerClient()
    result = await client.trigger_update()
    return result


@router.get("/hardware", response_model=HardwareLists)
async def get_hardware_lists(
    current_user: User = Depends(get_current_user),
):
    """Return hardware options for VM configuration UI, sourced from 86box_hardware_db.json."""

    # ── Machines ──────────────────────────────────────────────────────────────
    machine_options = []
    for m in hardware_lists.get_machines():
        ram = m.get("ram", {})
        machine_options.append(HardwareOption(
            id=m["internal_name"],
            name=m["name"],
            category=m.get("type", "").replace("MACHINE_TYPE_", "").replace("_", " ").title(),
            bus_flags=m.get("bus_flags_value", 0),
            ram_min=ram.get("min_kb"),
            ram_max=ram.get("max_kb"),
            ram_step=ram.get("step_kb"),
        ))

    # ── CPU families map: machine_id → [compatible HardwareOption] ────────────
    cpu_families_map: dict[str, list] = {}
    for m in hardware_lists.get_machines():
        mid = m["internal_name"]
        pkg_set = set(m.get("cpu_packages", []))
        families = [
            HardwareOption(id=f["internal_name"], name=f["name"])
            for f in hardware_lists.get_cpu_families()
            if f.get("package") in pkg_set
        ]
        if families:
            cpu_families_map[mid] = families

    # ── CPU speeds map: family_id → [display_name strings] ───────────────────
    # Index in the list = value stored in VMConfig.cpu_speed
    cpu_speeds_map: dict[str, list[str]] = {}
    for fam in hardware_lists.get_cpu_families():
        names = [cpu["name"] for cpu in fam.get("cpus", [])]
        if names:
            cpu_speeds_map[fam["internal_name"]] = names

    # ── MIDI devices ─────────────────────────────────────────────────────────
    midi_keywords = ("midi", "mpu", "mt-32", "mt32", "fluidsynth", "opl4")
    midi_devices = [
        HardwareOption(id=s["id"], name=s["name"])
        for s in hardware_lists.get_sound_cards()
        if any(k in s["name"].lower() for k in midi_keywords)
        or s["id"] in ("none", "internal")
    ]
    if not any(d.id == "none" for d in midi_devices):
        midi_devices.insert(0, HardwareOption(id="none", name="None"))

    def _opt(item: dict, **extra) -> HardwareOption:
        return HardwareOption(
            id=item.get("id") or item.get("internal_name", ""),
            name=item["name"],
            bus_flags=item.get("flags_value", item.get("bus_flags", 0)),
            config=item.get("config"),
            **extra,
        )

    return HardwareLists(
        machines=machine_options,
        cpu_families=cpu_families_map,
        cpu_speeds=cpu_speeds_map,
        video_cards=[_opt(v) for v in hardware_lists.get_video_cards()],
        sound_cards=[_opt(s) for s in hardware_lists.get_sound_cards()],
        midi_devices=midi_devices,
        network_cards=[_opt(n) for n in hardware_lists.get_network_cards()],
        hdd_controllers=[_opt(h) for h in hardware_lists.get_hdc()],
        scsi_cards=[_opt(s) for s in hardware_lists.get_scsi()],
        fdc_cards=[_opt(f) for f in hardware_lists.get_fdc()],
        isartc_types=[_opt(r) for r in hardware_lists.get_isartc()],
        isamem_types=[_opt(r) for r in hardware_lists.get_isamem()],
        mouse_types=[HardwareOption(id=m["id"], name=m["name"]) for m in hardware_lists.get_mouse_types()],
        joystick_types=[HardwareOption(id=j["id"], name=j["name"]) for j in hardware_lists.get_joystick_types()],
        floppy_types=[HardwareOption(id=f["id"], name=f["name"]) for f in hardware_lists.get_floppy_types()],
        cdrom_drive_types=[
            HardwareOption(
                id=d.get("internal_name", ""),
                name=re.sub(r'\s*\(\d+x\)\s*$', '', d["display_name"]).strip(),
                speed_x=d.get("speed_x") if d.get("speed_x", -1) >= 0 else None,
                is_dvd=d.get("is_dvd"),
            )
            for d in hardware_lists.get_cdrom_drive_types()
            if d.get("internal_name")  # skip entries with no internal_name (catch-all row)
        ],
        hdd_speed_presets=[
            HardwareOption(
                id=p["internal_name"],
                name=p["name"],
                category=p.get("category"),
                rpm=p.get("rpm"),
                full_stroke_ms=p.get("full_stroke_ms"),
                track_seek_ms=p.get("track_seek_ms"),
                heads=p.get("heads"),
                avg_spt=p.get("avg_spt"),
            )
            for p in hardware_lists.get_hdd_speed_presets()
            if p.get("internal_name")
        ],
    )


@router.get("/hardware/machine-cpu-map")
async def get_machine_cpu_map(current_user: User = Depends(get_current_user)):
    """Return machine_id → first compatible cpu_family_id map (for legacy UI compatibility)."""
    # Build package → first family_id map
    pkg_to_family: dict[str, str] = {}
    for fam in hardware_lists.get_cpu_families():
        pkg = fam.get("package", "")
        if pkg and pkg not in pkg_to_family:
            pkg_to_family[pkg] = fam["internal_name"]

    result = {}
    for machine in hardware_lists.get_machines():
        mid = machine.get("internal_name", "")
        pkgs = machine.get("cpu_packages", [])
        for pkg in pkgs:
            if pkg in pkg_to_family:
                result[mid] = pkg_to_family[pkg]
                break
    return result


@router.post("/hardware/refresh")
async def refresh_hardware_lists(current_user: User = Depends(require_admin)):
    """Admin: re-download 86Box source from GitHub and regenerate hardware database."""
    from fastapi import HTTPException
    from ..services.machine_db import refresh_hardware_json

    config_dir = Path(settings.data_path) / "config"
    result = await refresh_hardware_json(config_dir, force=True)
    if not result:
        raise HTTPException(500, "Hardware database refresh failed — check server logs.")
    # Reload the hardware lists module so the new data is used immediately
    from .. import hardware_lists as hl
    hl.reload()
    machines_count = len(hl.get_machines())
    return {"status": "ok", "path": str(result), "machines": machines_count}


@router.get("/hardware/voodoo-types")
async def get_voodoo_types(current_user: User = Depends(get_current_user)):
    """Return Voodoo 3dfx card types (subset of video cards)."""
    voodoo_keywords = ("voodoo", "banshee", "3dfx")
    return [
        {"id": v["id"], "name": v["name"]}
        for v in hardware_lists.get_video_cards()
        if any(k in v["name"].lower() or k in v["id"].lower() for k in voodoo_keywords)
    ]


@router.get("/config")
async def get_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin: return current application configuration (sensitive values masked)."""
    s = settings
    return {
        "Application": {
            "APP_NAME": s.app_name,
            "APP_HOST": s.app_host,
            "APP_PORT": str(s.app_port),
            "APP_SECRET_KEY": "*** (set)" if s.app_secret_key else "(not set)",
            "LOG_LEVEL": s.log_level,
        },
        "Authentication": {
            "USER_MANAGEMENT": str(s.user_management),
            "ADMIN_USERNAME": s.admin_username,
            "ADMIN_PASSWORD": "***",
            "JWT_ALGORITHM": s.jwt_algorithm,
            "ACCESS_TOKEN_EXPIRE_MINUTES": str(s.access_token_expire_minutes),
        },
        "LDAP": {
            "LDAP_ENABLED": str(s.ldap_enabled),
            "LDAP_SERVER": s.ldap_server or "(not set)",
            "LDAP_PORT": str(s.ldap_port),
            "LDAP_BASE_DN": s.ldap_base_dn or "(not set)",
            "LDAP_BIND_DN": s.ldap_bind_dn or "(not set)",
            "LDAP_BIND_PASSWORD": "***" if s.ldap_bind_password else "(not set)",
            "LDAP_USER_FILTER": s.ldap_user_filter,
            "LDAP_GROUP_DN": s.ldap_group_dn or "(not set)",
            "LDAP_USERNAME_ATTR": s.ldap_username_attr,
            "LDAP_EMAIL_ATTR": s.ldap_email_attr,
            "LDAP_TLS": str(s.ldap_tls),
        },
        "Quotas": {
            "DEFAULT_MAX_VMS": str(s.default_max_vms),
            "DEFAULT_MAX_STORAGE_GB": str(s.default_max_storage_gb),
            "ACTIVE_VM_LIMIT (DB)": _get_setting(db, "active_vm_limit", "(runner default)"),
        },
        "Paths": {
            "DATA_PATH": s.data_path,
            "LIBRARY_PATH": s.library_path,
            "RUNNER_URL": s.runner_url,
        },
    }


def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row else default


def _set_setting(db: Session, key: str, value: str):
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
    db.commit()


@router.get("/app-settings", response_model=AppSettings)
async def get_app_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    raw_limit = _get_setting(db, "active_vm_limit", "")
    active_vm_limit = int(raw_limit) if raw_limit.isdigit() else None
    return AppSettings(
        enforce_quotas=_get_setting(db, "enforce_quotas", "true").lower() != "false",
        active_vm_limit=active_vm_limit,
    )


@router.put("/app-settings", response_model=AppSettings)
async def update_app_settings(
    body: AppSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    _set_setting(db, "enforce_quotas", "true" if body.enforce_quotas else "false")
    if body.active_vm_limit is not None:
        _set_setting(db, "active_vm_limit", str(body.active_vm_limit))
    else:
        # Clear stored limit — runner default will be used
        row = db.query(SystemSetting).filter(SystemSetting.key == "active_vm_limit").first()
        if row:
            db.delete(row)
            db.commit()
    return body


@router.get("/recommended-vm-limit")
async def recommended_vm_limit(
    current_user: User = Depends(require_admin),
):
    """Admin: proxy the runner's recommended active VM limit based on host hardware."""
    client = RunnerClient()
    return await client._request("GET", "/recommended-vm-limit")


@router.get("/all-users-stats")
async def get_all_users_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin: per-user summary for dashboard."""
    users = db.query(User).filter(User.is_active == True).all()
    result = []
    is_bootstrap_user = current_user.username == settings.admin_username
    for u in users:
        if u.username == settings.admin_username and not is_bootstrap_user:
            continue
        vms = u.vms
        vm_usage = sum(dir_size(os.path.join(settings.vms_path, v.uuid)) for v in vms)
        disk_usage = (
            vm_usage
            + dir_size(settings.user_images_path(u.id))
            + dir_size(settings.shared_media_path(u.id))
        )
        result.append({
            "id": u.id,
            "username": u.username,
            "vm_count": len(vms),
            "running_vms": sum(1 for v in vms if v.status == "running"),
            "disk_usage_bytes": disk_usage,
            "max_vms": u.max_vms,
            "max_storage_gb": u.max_storage_gb,
        })
    return result
