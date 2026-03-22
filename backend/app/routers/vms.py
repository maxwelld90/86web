import logging
import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File

log = logging.getLogger("86web")
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..models import User, VM, VMGroup, SystemSetting
from ..schemas import (
    VMCreate, VMUpdate, VMResponse,
    VMGroupCreate, VMGroupUpdate, VMGroupResponse,
    DriveMount, BlankFloppyCreate,
)
from ..services.vm_service import VMService
from ..config import get_settings

router = APIRouter(prefix="/api/vms", tags=["vms"])
settings = get_settings()


def _enforce_quotas(db: Session) -> bool:
    row = db.query(SystemSetting).filter(SystemSetting.key == "enforce_quotas").first()
    return (row.value if row else "true").lower() != "false"


def _vm_to_response(vm: VM) -> VMResponse:
    resp = VMResponse.model_validate(vm)
    if vm.owner:
        resp.owner_username = vm.owner.username
    if vm.group:
        resp.group_name = vm.group.name
        resp.group_color = vm.group.color
    if vm.locked_by:
        resp.locked_by_username = vm.locked_by.username
    resp.shared_with_user_ids = [u.id for u in vm.shared_with]
    return resp


def _group_to_response(g: VMGroup) -> VMGroupResponse:
    resp = VMGroupResponse.model_validate(g)
    resp.vm_count = len(g.vms)
    resp.has_running_vms = any(vm.status == "running" for vm in g.vms)
    resp.shared_with_user_ids = [u.id for u in g.shared_with]
    return resp

def _get_accessible_vm(db: Session, vm_id: int, user: User) -> VM:
    vm = db.query(VM).filter(VM.id == vm_id).first()
    if not vm:
        raise HTTPException(404, "VM not found")   
    if vm.user_id == user.id:
        return vm 
    if user in vm.shared_with:
        return vm
    if vm.group and user in vm.group.shared_with:
        return vm
    raise HTTPException(403, "Access denied")

# ─── VM Groups ────────────────────────────────────────────────────────────────

@router.get("/groups", response_model=List[VMGroupResponse])
async def list_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(VMGroup).filter(
        or_(
            VMGroup.user_id == current_user.id,
            VMGroup.shared_with.any(User.id == current_user.id)
        )
    )
    groups = query.all()
    return [_group_to_response(g) for g in groups]


@router.post("/groups", response_model=VMGroupResponse, status_code=201)
async def create_group(
    body: VMGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin and not current_user.can_manage_groups:
        raise HTTPException(403, "No Permission to create VM groups")

    group = VMGroup(
        name=body.name,
        description=body.description,
        color=body.color,
        network_enabled=body.network_enabled,
        user_id=current_user.id,
    )

    if hasattr(body, 'shared_with_user_ids') and body.shared_with_user_ids is not None:
        shared_users = db.query(User).filter(User.id.in_(body.shared_with_user_ids)).all()
        group.shared_with = shared_users

    db.add(group)
    db.commit()
    db.refresh(group)
    return _group_to_response(group)


@router.patch("/groups/{group_id}", response_model=VMGroupResponse)
async def update_group(
    group_id: int,
    body: VMGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    group = db.query(VMGroup).filter(VMGroup.id == group_id, VMGroup.user_id == current_user.id).first()
    if not group:
        raise HTTPException(404, "Group not found")
    
    if not current_user.is_admin and not current_user.can_manage_groups:
        raise HTTPException(403, "No Permission to edit / delete VM groups")

    if body.name is not None:
        group.name = body.name
    if body.description is not None:
        group.description = body.description
    if body.color is not None:
        group.color = body.color
    if body.network_enabled is not None:
        if body.network_enabled != group.network_enabled:
            if any(vm.status == "running" for vm in group.vms):
                raise HTTPException(400, "Cannot change networking while a VM in the group is running. Stop all VMs first.")
        group.network_enabled = body.network_enabled

    if hasattr(body, 'shared_with_user_ids') and body.shared_with_user_ids is not None:
        if not current_user.is_admin and group.user_id != current_user.id:
            raise HTTPException(403, "Only the owner can share this group")
            
        shared_users = db.query(User).filter(User.id.in_(body.shared_with_user_ids)).all()
        group.shared_with = shared_users

    db.commit()
    db.refresh(group)
    return _group_to_response(group)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin and not current_user.can_manage_groups:
        raise HTTPException(403, "No Permission to edit / delete VM groups")
    
    group = db.query(VMGroup).filter(VMGroup.id == group_id, VMGroup.user_id == current_user.id).first()
    if not group:
        raise HTTPException(404, "Group not found")
    # Unlink VMs from group
    for vm in group.vms:
        vm.group_id = None
    db.delete(group)
    db.commit()


# ─── VMs ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[VMResponse])
async def list_vms(
    group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(VM).filter(
        or_(
            VM.user_id == current_user.id,
            VM.shared_with.any(User.id == current_user.id),
            VM.group.has(VMGroup.shared_with.any(User.id == current_user.id))
        )
    )

    if group_id is not None:
        query = query.filter(VM.group_id == group_id)
        
    vms = query.all()
    return [_vm_to_response(vm) for vm in vms]


@router.post("", response_model=VMResponse, status_code=201)
async def create_vm(
    body: VMCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin and not current_user.can_manage_vms:
        raise HTTPException(403, "No Permission to create VMs")
    
    # Quota checks (skipped when enforce_quotas is disabled)
    if _enforce_quotas(db):
        vm_count = db.query(VM).filter(VM.user_id == current_user.id).count()
        if vm_count >= current_user.max_vms:
            raise HTTPException(429, f"VM limit reached ({current_user.max_vms})")
        disk_usage = sum(v.disk_usage_bytes for v in db.query(VM).filter(VM.user_id == current_user.id).all())
        if disk_usage >= current_user.max_storage_gb * 1024 ** 3:
            raise HTTPException(429, f"Storage limit reached ({current_user.max_storage_gb} GB)")

    # Validate group ownership
    if body.group_id:
        group = db.query(VMGroup).filter(
            VMGroup.id == body.group_id, VMGroup.user_id == current_user.id
        ).first()
        if not group:
            raise HTTPException(404, "Group not found")

    vm = VM(
        name=body.name,
        description=body.description,
        user_id=current_user.id,
        group_id=body.group_id,
        config=body.config.model_dump(),
        status="stopped",
    )

    if hasattr(body, 'shared_with_user_ids') and body.shared_with_user_ids is not None:
        shared_users = db.query(User).filter(User.id.in_(body.shared_with_user_ids)).all()
        vm.shared_with = shared_users

    db.add(vm)
    db.commit()
    db.refresh(vm)

    # Create VM directory (named by UUID for portability)
    vm_dir = os.path.join(settings.vms_path, vm.uuid)
    os.makedirs(vm_dir, exist_ok=True)
    os.makedirs(os.path.join(vm_dir, "hdd"), exist_ok=True)
    media_dir = os.path.join(vm_dir, "media")
    os.makedirs(media_dir, exist_ok=True)

    # Create a 'library' symlink so 86Box can browse library images via its own file dialogs
    if os.path.isdir(settings.library_path):
        lib_link = os.path.join(media_dir, "library")
        if not os.path.exists(lib_link) and not os.path.islink(lib_link):
            os.symlink(settings.library_path, lib_link)

    # Create an 'images' symlink pointing at the user's (or shared) custom images directory
    user_imgs = settings.user_images_path(current_user.id)
    os.makedirs(user_imgs, exist_ok=True)
    imgs_link = os.path.join(media_dir, "images")
    if not os.path.exists(imgs_link) and not os.path.islink(imgs_link):
        os.symlink(user_imgs, imgs_link)

    # Write initial 86Box config file
    _write_86box_config(vm, vm_dir)

    return _vm_to_response(vm)


@router.get("/{vm_id}", response_model=VMResponse)
async def get_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = _get_accessible_vm(db, vm_id, current_user)
    return _vm_to_response(vm)


@router.patch("/{vm_id}", response_model=VMResponse)
async def update_vm(
    vm_id: int,
    body: VMUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin and not current_user.can_manage_vms:
        raise HTTPException(403, "No Permission to edit / delete VMs")
    
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    if vm.status == "running":
        raise HTTPException(400, "Cannot modify a running VM. Stop it first.")

    if body.name is not None:
        vm.name = body.name
    if body.description is not None:
        vm.description = body.description
    if 'group_id' in body.model_fields_set:
        if body.group_id is None:
            vm.group_id = None
        else:
            group = db.query(VMGroup).filter(
                VMGroup.id == body.group_id, VMGroup.user_id == current_user.id
            ).first()
            if not group:
                raise HTTPException(404, "Group not found")
            vm.group_id = body.group_id
    if body.config is not None:
        vm.config = body.config.model_dump()
        # Rewrite 86Box config
        vm_dir = os.path.join(settings.vms_path, vm.uuid)
        try:
            _write_86box_config(vm, vm_dir)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to write config: {e}")
    
    if hasattr(body, 'shared_with_user_ids') and body.shared_with_user_ids is not None:
        if not current_user.is_admin and vm.user_id != current_user.id:
            raise HTTPException(403, "Only the owner can share this VM")
        
        shared_users = db.query(User).filter(User.id.in_(body.shared_with_user_ids)).all()
        vm.shared_with = shared_users

    db.commit()
    db.refresh(vm)
    return _vm_to_response(vm)


@router.delete("/{vm_id}", status_code=204)
async def delete_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin and not current_user.can_manage_vms:
        raise HTTPException(403, "No Permission to edit / delete VMs")
    
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    if vm.status == "running":
        raise HTTPException(400, "Stop the VM before deleting it")

    # Remove VM directory
    vm_dir = os.path.join(settings.vms_path, vm.uuid)
    if os.path.exists(vm_dir):
        shutil.rmtree(vm_dir)

    db.delete(vm)
    db.commit()


# ─── VM Actions ───────────────────────────────────────────────────────────────

@router.post("/{vm_id}/start")
async def start_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = _get_accessible_vm(db, vm_id, current_user)
    if vm.status in ("running", "paused", "starting"):
        raise HTTPException(400, "VM is already active")

    if vm.locked_by_user_id is not None and vm.locked_by_user_id != current_user.id:
        raise HTTPException(403, f"VM is currently in use by {vm.locked_by.username}")

    # Enforce active VM limit (DB setting takes priority over runner default)
    raw_limit = db.query(SystemSetting).filter(SystemSetting.key == "active_vm_limit").first()
    if raw_limit and raw_limit.value.isdigit():
        limit = int(raw_limit.value)
        active = db.query(VM).filter(VM.status.in_(["running", "paused", "starting"])).count()
        if active >= limit:
            raise HTTPException(429, f"Active VM limit reached ({limit} active). Stop a running VM first.")

    vm_dir = os.path.join(settings.vms_path, vm.uuid)

    # Determine network group (for TAP/bridge networking)
    network_group_id = None
    config_override = None
    if vm.group and vm.group.network_enabled:
        network_group_id = vm.group.id
        # Override transport to TAP pointing at the pre-created TAP device.
        # Only effective when the VM has a network card configured and net_use_group is True.
        cfg = vm.config or {}
        if cfg.get("net_card", "none") != "none" and cfg.get("net_use_group", True):
            config_override = {"net_type": "tap", "net_host_dev": f"tap-vm{vm_id}"}

    _write_86box_config(vm, vm_dir, config_override=config_override)

    # Claim the slot immediately so concurrent requests can't bypass the limit
    vm.status = "starting"
    vm.locked_by_user_id = current_user.id
    db.commit()

    service = VMService()
    result = await service.start_vm(vm_id, vm_dir, network_group_id=network_group_id)
    if result.get("error"):
        vm.status = "stopped"
        vm.locked_by_user_id = None
        db.commit()
        raise HTTPException(500, result["error"])

    vm.status = "running"
    vm.vnc_port = result.get("vnc_port")
    vm.ws_port = result.get("ws_port")
    vm.last_started = datetime.utcnow()
    db.commit()
    db.refresh(vm)
    return _vm_to_response(vm)


@router.post("/{vm_id}/stop")
async def stop_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = _get_accessible_vm(db, vm_id, current_user)
    if vm.locked_by_user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "You cannot stop a VM started by another user")

    if vm.status not in ("running", "paused"):
        raise HTTPException(400, "VM is not running")

    service = VMService()
    await service.stop_vm(vm_id)

    vm.status = "stopped"
    vm.locked_by_user_id = None
    vm.vnc_port = None
    vm.ws_port = None
    vm.last_stopped = datetime.utcnow()
    db.commit()
    db.refresh(vm)
    return _vm_to_response(vm)


@router.post("/{vm_id}/reset")
async def reset_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    if vm.status != "running":
        raise HTTPException(400, "VM is not running")

    service = VMService()
    await service.reset_vm(vm_id)
    return {"status": "reset sent"}


@router.post("/{vm_id}/pause")
async def pause_vm(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle pause — SIGSTOP/SIGCONT the 86Box process."""
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    if vm.status not in ("running", "paused"):
        raise HTTPException(400, "VM is not running")

    service = VMService()
    result = await service.pause_vm(vm_id)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return {"status": "pause sent"}


@router.post("/{vm_id}/send-key")
async def send_key(
    vm_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    key = body.get("key", "")
    if not key:
        raise HTTPException(400, "key is required")
    service = VMService()
    result = await service.send_key(vm_id, key)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.get("/{vm_id}/status")
async def get_vm_status(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = _get_accessible_vm(db, vm_id, current_user)

    if vm.status == "stopped" and vm.locked_by_user_id is not None:
        vm.locked_by_user_id = None
        db.commit()

    service = VMService()
    runner_status = await service.get_vm_status(vm_id)
    actual_status = runner_status.get("status", "stopped")

    if actual_status != vm.status:
        if not (vm.status == "starting" and actual_status == "stopped"):
            vm.status = actual_status
            if actual_status == "stopped":
                vm.locked_by_user_id = None
                vm.vnc_port = None
                vm.ws_port = None
                vm.last_stopped = datetime.utcnow()
            db.commit()

    return {
        "id": vm.id,
        "status": vm.status,
        "vnc_port": vm.vnc_port,
        "ws_port": vm.ws_port,
        "uptime": runner_status.get("uptime"),
        "locked_by_user_id": vm.locked_by_user_id
    }


# ─── 86Box Config File Generator ─────────────────────────────────────────────

def _write_device_settings(cfg: dict, device_settings: dict) -> str:
    """Generate [Device Name] INI sections for device-specific config."""
    if not device_settings:
        return ""

    from .. import hardware_lists

    # Build a lookup: device_id → {name, config}
    all_devices = {}
    for getter in [
        hardware_lists.get_sound_cards,
        hardware_lists.get_video_cards,
        hardware_lists.get_network_cards,
        hardware_lists.get_hdc,
        hardware_lists.get_scsi,
        hardware_lists.get_fdc,
        hardware_lists.get_isartc,
        hardware_lists.get_isamem,
    ]:
        for d in getter():
            all_devices[d.get("id") or d.get("internal_name", "")] = d

    out = ""
    for device_id, settings in device_settings.items():
        if not settings:
            continue
        device = all_devices.get(device_id)
        if not device:
            continue
        # Build type map for this device's config entries
        type_map = {}
        for entry in device.get("config") or []:
            type_map[entry["name"]] = entry.get("type", "int")

        out += f"\n[{device['name']}]\n"
        for key, value in settings.items():
            t = type_map.get(key, "int")
            if t in ("hex16",):
                out += f"{key} = {int(value):04x}\n"
            elif t == "hex20":
                out += f"{key} = {int(value):05x}\n"
            else:
                out += f"{key} = {value}\n"
    return out

def _create_disk_image(path: str, size_mb: int):
    """Create a sparse disk image file if it doesn't already exist."""
    if not os.path.exists(path):
        size_bytes = size_mb * 1024 * 1024
        with open(path, "wb") as f:
            f.seek(size_bytes - 1)
            f.write(b"\x00")


def _write_86box_config(vm: VM, vm_dir: str, config_override: dict | None = None):
    """Write a 86Box-compatible .cfg file from the VM's JSON config.

    config_override: optional key/value pairs merged into cfg at write time
    (not persisted to DB). Used e.g. to inject PCap transport for group networking.
    """
    from ..hardware_lists import get_cpu_by_index, machine_has_builtin_video, get_cdrom_drive_types
    _cdrom_drive_list = get_cdrom_drive_types()
    def _cdrom_type_index(internal_name: str) -> int | None:
        """Map a cdrom_drive_type internal_name to its numeric 86Box index."""
        if not internal_name:
            return None
        for idx, d in enumerate(_cdrom_drive_list):
            if d.get("internal_name") == internal_name:
                return idx
        return None

    cfg = dict(vm.config or {})
    if config_override:
        cfg.update(config_override)
    lines = []

    def section(name: str):
        lines.append(f"\n[{name}]")

    def opt(key: str, val):
        lines.append(f"{key} = {_fmt(val)}")

    def _fmt(v) -> str:
        if isinstance(v, bool):
            return "1" if v else "0"
        if isinstance(v, float) and v == int(v):
            return str(int(v))
        return str(v)

    # ── [Machine] ──────────────────────────────────────────────────────────────
    section("Machine")
    machine_id = cfg.get("machine", "ibmxt")
    opt("machine", machine_id)
    cpu_family = cfg.get("cpu_family", "8088")
    opt("cpu_family", cpu_family)
    # cpu_speed stored as 0-based index; resolve to rspeed (Hz) + multi for cfg
    speed_index = int(cfg.get("cpu_speed", 0))
    rspeed, cpu_multi = get_cpu_by_index(cpu_family, speed_index)
    opt("cpu_speed", rspeed)
    opt("cpu_multi", cpu_multi)
    opt("cpu_use_dynarec", cfg.get("cpu_use_dynarec", False))
    opt("cpu_waitstates", cfg.get("cpu_waitstates", 0))
    opt("fpu_type", cfg.get("fpu_type", "none"))
    if cfg.get("fpu_softfloat", False):
        opt("fpu_softfloat", 1)
    opt("mem_size", cfg.get("mem_size", 640))
    opt("pit_mode", cfg.get("pit_mode", 0))
    if cfg.get("time_sync", "local") != "local":
        opt("time_sync", cfg["time_sync"])

    # ── [Video] ────────────────────────────────────────────────────────────────
    section("Video")
    if machine_has_builtin_video(machine_id):
        gfxcard = "internal"
    else:
        gfxcard = cfg.get("gfxcard") or "vga"
        if gfxcard in ("none", "internal"):
            gfxcard = "vga"
    opt("gfxcard", gfxcard)
    if cfg.get("voodoo_enabled", False):
        opt("voodoo", 1)
        opt("voodoo_type", cfg.get("voodoo_type", "voodoo1"))
    if cfg.get("show_second_monitors", False):
        opt("show_second_monitors", 1)

    # ── [Input devices] ────────────────────────────────────────────────────────
    section("Input devices")
    opt("keyboard_type", cfg.get("keyboard_type", "keyboard_at"))
    opt("mouse_type", cfg.get("mouse_type", "ps2"))
    joystick = cfg.get("joystick_type", "none")
    if joystick != "none":
        opt("joystick_type", joystick)

    # ── [Sound] ────────────────────────────────────────────────────────────────
    section("Sound")
    sndcard = cfg.get("sndcard", "none")
    if sndcard and sndcard != "none":
        opt("sndcard", sndcard)
    midi = cfg.get("midi_device", "none")
    if midi and midi != "none":
        opt("midi_output_device", midi)
    if cfg.get("mpu401_standalone_enable", False):
        opt("mpu401_standalone_enable", 1)
    if cfg.get("fm_driver", "nuked") != "nuked":
        opt("fm_driver", cfg["fm_driver"])
    if cfg.get("sound_is_float", False):
        opt("sound_is_float", 1)

    # ── [Network] ─────────────────────────────────────────────────────────────
    section("Network")
    net_card = cfg.get("net_card", "none")
    net_type = cfg.get("net_type", "slirp")
    if net_card and net_card != "none":
        opt("net_01_card", net_card)
    opt("net_01_net_type", net_type)
    if cfg.get("net_host_dev"):
        opt("net_01_host_device", cfg["net_host_dev"])
    opt("net_01_link", 0)

    # ── [Storage controllers] ─────────────────────────────────────────────────
    section("Storage controllers")
    hdd_ctrl = cfg.get("hdd_controller", "ide_isa")
    if hdd_ctrl and hdd_ctrl not in ("none", "internal"):
        opt("hdc_1", hdd_ctrl)
    hdc_slot = 2
    if cfg.get("ide_ter_enabled", False):
        opt(f"hdc_{hdc_slot}", "ide_ter")
        hdc_slot += 1
    if cfg.get("ide_qua_enabled", False):
        opt(f"hdc_{hdc_slot}", "ide_qua")
    if cfg.get("scsi_card", "none") != "none":
        opt("scsicard_1", cfg["scsi_card"])
    fdc = cfg.get("fdc_card", "none")
    if fdc and fdc != "none":
        opt("fdc_card", fdc)

    # ── [Hard disks] ──────────────────────────────────────────────────────────
    hdd_dir = os.path.join(vm_dir, "hdd")
    os.makedirs(hdd_dir, exist_ok=True)
    section("Hard disks")
    _default_channels = ["0:0", "0:1", "1:0", "1:1", "2:0", "2:1", "3:0", "3:1"]
    for i in range(1, 9):
        n = f"{i:02d}"
        if cfg.get(f"hdd_{n}_enabled"):
            bus = cfg.get(f"hdd_{n}_bus", "ide")
            size = cfg.get(f"hdd_{n}_size_mb", 512)
            img_path = os.path.join(hdd_dir, f"hdd{i}.img")
            _create_disk_image(img_path, size)
            cyl_stored = cfg.get(f"hdd_{n}_cylinders")
            heads_stored = cfg.get(f"hdd_{n}_heads")
            spt_stored = cfg.get(f"hdd_{n}_spt")
            if cyl_stored and heads_stored and spt_stored:
                heads = heads_stored
                spt = spt_stored
                cyls = cyl_stored
            else:
                # hdd_image_calc_chs algorithm
                ts = size * 2048
                MAX_TS = 65535 * 16 * 255
                if ts > MAX_TS:
                    ts = MAX_TS
                if ts >= 65535 * 16 * 63:
                    spt = 255
                    heads = 16
                    cth = ts // spt
                else:
                    spt = 17
                    cth = ts // spt
                    heads = (cth + 1023) // 1024
                    if heads < 4:
                        heads = 4
                    if cth >= heads * 1024 or heads > 16:
                        spt = 31
                        heads = 16
                        cth = ts // spt
                    if cth >= heads * 1024:
                        spt = 63
                        heads = 16
                        cth = ts // spt
                cyls = max(1, cth // heads)
            opt(f"hdd_{n}_parameters", f"{spt}, {heads}, {cyls}, 0, {bus}")
            opt(f"hdd_{n}_fn", img_path)
            opt(f"hdd_{n}_speed", cfg.get(f"hdd_{n}_speed", "1997_5400rpm"))
            if bus == "ide":
                channel = cfg.get(f"hdd_{n}_ide_channel") or _default_channels[i - 1]
                opt(f"hdd_{n}_ide_channel", channel)

    # ── [Floppy and CD-ROM drives] ────────────────────────────────────────────
    section("Floppy and CD-ROM drives")

    # Floppy drives 01-04; 86Box defaults fdd_01/02 = 525_2dd, fdd_03/04 = none
    _fdd_defaults = {1: "525_2dd", 2: "525_2dd", 3: "none", 4: "none"}
    for i in range(1, 5):
        n = f"{i:02d}"
        ftype = cfg.get(f"fdd_{n}_type", _fdd_defaults[i])
        if ftype != _fdd_defaults[i]:
            opt(f"fdd_{n}_type", ftype)
        if cfg.get(f"fdd_{n}_turbo", False):
            opt(f"fdd_{n}_turbo", 1)
        if not cfg.get(f"fdd_{n}_check_bpb", True):
            opt(f"fdd_{n}_check_bpb", 0)
        fn = cfg.get(f"fdd_{n}_fn", "")
        if fn and ftype != "none":
            opt(f"fdd_{n}_fn", fn)

    # CD-ROM drives 01-04
    _default_cdrom_channels = {1: "1:0", 2: "1:1", 3: "2:0", 4: "2:1"}
    for i in range(1, 5):
        n = f"{i:02d}"
        if cfg.get(f"cdrom_{n}_enabled"):
            bus = cfg.get(f"cdrom_{n}_bus", "ide")
            bus_str = "atapi" if bus in ("ide", "atapi") else bus
            opt(f"cdrom_{n}_parameters", f"1, {bus_str}")
            speed = cfg.get(f"cdrom_{n}_speed", 24)
            if speed != 24:
                opt(f"cdrom_{n}_speed", speed)
            drive_type_idx = _cdrom_type_index(cfg.get(f"cdrom_{n}_drive_type", ""))
            if drive_type_idx is not None:
                opt(f"cdrom_{n}_type", drive_type_idx)
            if bus_str == "atapi":
                channel = cfg.get(f"cdrom_{n}_ide_channel") or _default_cdrom_channels[i]
                opt(f"cdrom_{n}_ide_channel", channel)
            fn = cfg.get(f"cdrom_{n}_fn", "")
            if fn:
                opt(f"cdrom_{n}_image_path", fn)

    # ── [Ports (COM & LPT)] ───────────────────────────────────────────────────
    section("Ports (COM & LPT)")
    _com_defaults = {1: True, 2: True, 3: False, 4: False}
    for port in range(1, 5):
        default_on = _com_defaults[port]
        enabled = bool(cfg.get(f"com_{port}_enabled", default_on))
        if enabled != default_on:
            opt(f"com_{port}_enabled", 1 if enabled else 0)
    _lpt_defaults = {1: True, 2: False, 3: False}
    for port in range(1, 4):
        default_on = _lpt_defaults[port]
        enabled = bool(cfg.get(f"lpt_{port}_enabled", default_on))
        if enabled != default_on:
            opt(f"lpt_{port}_enabled", 1 if enabled else 0)

    # ── [Other peripherals] ───────────────────────────────────────────────────
    section("Other peripherals")
    isartc = cfg.get("isartc_type", "none")
    if isartc and isartc != "none":
        opt("isartc_type", isartc)
    for slot in range(1, 5):
        base = cfg.get(f"isamem_{slot}_base", 0)
        size = cfg.get(f"isamem_{slot}_size", 0)
        if base and size:
            prefix = "isamem" if slot == 1 else f"isamem{slot}"
            opt(f"{prefix}_base", base)
            opt(f"{prefix}_size", size)

    config_text = "\n".join(lines) + "\n"
    config_text += _write_device_settings(cfg, cfg.get("device_settings", {}))

    config_path = os.path.join(vm_dir, "86box.cfg")
    with open(config_path, "w") as f:
        f.write(config_text)


# ─── Media File Management ────────────────────────────────────────────────────

def _media_dir(current_user: User, vm: VM) -> str:
    return os.path.join(settings.vms_path, vm.uuid, "media")


@router.get("/{vm_id}/media")
async def list_media(
    vm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    files = []
    # VM-specific media
    mdir = _media_dir(current_user, vm)
    if os.path.exists(mdir):
        for name in sorted(os.listdir(mdir)):
            fp = os.path.join(mdir, name)
            if os.path.isfile(fp):
                files.append({"name": name, "size": os.path.getsize(fp), "path": fp})
    # Shared/pooled media (user-level)
    shared_mdir = settings.shared_media_path(current_user.id)
    seen = {f["name"] for f in files}
    if os.path.exists(shared_mdir):
        for name in sorted(os.listdir(shared_mdir)):
            fp = os.path.join(shared_mdir, name)
            if os.path.isfile(fp) and name not in seen:
                files.append({"name": name, "size": os.path.getsize(fp), "path": fp})
    return sorted(files, key=lambda f: f["name"])


@router.post("/{vm_id}/media")
async def upload_media(
    vm_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    if _enforce_quotas(db):
        disk_usage = sum(v.disk_usage_bytes for v in db.query(VM).filter(VM.user_id == current_user.id).all())
        if disk_usage >= current_user.max_storage_gb * 1024 ** 3:
            raise HTTPException(429, f"Storage limit reached ({current_user.max_storage_gb} GB)")
    mdir = _media_dir(current_user, vm)
    os.makedirs(mdir, exist_ok=True)
    # Sanitise filename – keep only the basename
    safe_name = os.path.basename(file.filename or "upload")
    if not safe_name:
        raise HTTPException(400, "Invalid filename")
    dest = os.path.join(mdir, safe_name)
    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
    return {"name": safe_name, "size": os.path.getsize(dest)}


@router.delete("/{vm_id}/media/{filename}", status_code=204)
async def delete_media(
    vm_id: int,
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")
    safe_name = os.path.basename(filename)
    fp = os.path.join(_media_dir(current_user, vm), safe_name)
    if not os.path.exists(fp):
        raise HTTPException(404, "File not found")
    os.remove(fp)


# ─── Drive Management (mount / eject / blank floppy) ─────────────────────────

_VALID_DRIVE_KEYS = {"fdd_01", "fdd_02", "cdrom_01", "cdrom_02"}


@router.post("/{vm_id}/drives/{drive_key}/mount")
async def mount_drive(
    vm_id: int,
    drive_key: str,
    body: DriveMount,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if drive_key not in _VALID_DRIVE_KEYS:
        raise HTTPException(400, f"Invalid drive key. Valid: {sorted(_VALID_DRIVE_KEYS)}")
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")

    # Security: path must be inside the VM's media dir or the user's shared media pool
    mdir = os.path.abspath(_media_dir(current_user, vm))
    shared_mdir = os.path.abspath(settings.shared_media_path(current_user.id))
    abs_path = os.path.abspath(body.path)
    if not (abs_path.startswith(mdir + os.sep) or abs_path.startswith(shared_mdir + os.sep)):
        raise HTTPException(400, "Image path must be within the VM's media directory or shared media pool")
    if not os.path.exists(abs_path):
        raise HTTPException(404, "Image file not found")

    config = dict(vm.config or {})
    config[f"{drive_key}_fn"] = abs_path
    vm.config = config
    db.commit()

    vm_dir = os.path.join(settings.vms_path, vm.uuid)
    _write_86box_config(vm, vm_dir)

    if vm.status == "running":
        service = VMService()
        await service.reset_vm(vm_id)

    return {"status": "mounted", "drive_key": drive_key, "path": abs_path}


@router.post("/{vm_id}/drives/{drive_key}/eject")
async def eject_drive(
    vm_id: int,
    drive_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if drive_key not in _VALID_DRIVE_KEYS:
        raise HTTPException(400, f"Invalid drive key. Valid: {sorted(_VALID_DRIVE_KEYS)}")
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")

    config = dict(vm.config or {})
    config[f"{drive_key}_fn"] = ""
    vm.config = config
    db.commit()

    vm_dir = os.path.join(settings.vms_path, vm.uuid)
    _write_86box_config(vm, vm_dir)

    if vm.status == "running":
        service = VMService()
        await service.reset_vm(vm_id)

    return {"status": "ejected", "drive_key": drive_key}


@router.post("/{vm_id}/media/blank-floppy")
async def create_blank_floppy(
    vm_id: int,
    body: BlankFloppyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vm = db.query(VM).filter(VM.id == vm_id, VM.user_id == current_user.id).first()
    if not vm:
        raise HTTPException(404, "VM not found")

    valid_sizes = {360, 720, 1200, 1440, 2880}
    if body.size_kb not in valid_sizes:
        raise HTTPException(400, f"size_kb must be one of {sorted(valid_sizes)}")

    mdir = _media_dir(current_user, vm)
    os.makedirs(mdir, exist_ok=True)

    safe_name = os.path.basename(body.name)
    if not safe_name:
        raise HTTPException(400, "Invalid filename")
    if not any(safe_name.endswith(ext) for ext in ('.img', '.ima', '.vfd', '.flp')):
        safe_name += '.img'

    dest = os.path.join(mdir, safe_name)
    if os.path.exists(dest):
        raise HTTPException(409, "A file with that name already exists")

    # Sparse zeroed image — 86Box accepts raw blank disk images
    size_bytes = body.size_kb * 1024
    with open(dest, "wb") as f:
        f.seek(size_bytes - 1)
        f.write(b"\x00")

    return {"name": safe_name, "size": size_bytes, "path": dest}
