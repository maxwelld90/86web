import os
import configparser
from pydantic import BaseModel

class VMImportRequest(BaseModel):
    folder_name: str
    vm_name: str
    description: str = ""
    group_id: int | None = None

def scan_for_unregistered_folders(vms_path: str, db_uuids: set) -> list:
    """Scans the vms_path for directories containing an 86box.cfg that are not registered in the DB."""
    unregistered = []
    if os.path.exists(vms_path):
        for folder_name in os.listdir(vms_path):
            folder_path = os.path.join(vms_path, folder_name)
            
            # Check if it's a directory and not already registered by its folder name (which should be the UUID)
            if os.path.isdir(folder_path) and folder_name not in db_uuids:
                cfg_path = os.path.join(folder_path, "86box.cfg")
                if os.path.exists(cfg_path):
                    machine_name = "Unknown Machine"
                    try:
                        cfg = configparser.RawConfigParser()
                        cfg.read(cfg_path, encoding="utf-8-sig")
                        if cfg.has_option("Machine", "machine"):
                            machine_name = cfg.get("Machine", "machine")
                    except Exception:
                        pass
                        
                    unregistered.append({
                        "folder_name": folder_name,
                        "machine": machine_name
                    })
    return unregistered

# --- Helper functions for safe type parsing ---

def _get_int(cfg: configparser.RawConfigParser, section: str, key: str, default: int = 0) -> int:
    try:
        return int(cfg.get(section, key))
    except Exception:
        return default

def _get_bool(cfg: configparser.RawConfigParser, section: str, key: str, default: bool = False) -> bool:
    try:
        val = cfg.get(section, key).strip().lower()
        return val in ("1", "true", "yes", "on")
    except Exception:
        return default

def _get_str(cfg: configparser.RawConfigParser, section: str, key: str, default: str = "") -> str:
    try:
        return cfg.get(section, key)
    except Exception:
        return default

def parse_86box_cfg(cfg_path: str) -> dict:
    """Reads an existing 86box.cfg and translates it into the JSON state format used by the React frontend."""
    cfg = configparser.RawConfigParser()
    cfg.read(cfg_path, encoding="utf-8-sig")
    
    parsed = {}
    
    # --- Machine settings ---
    if cfg.has_section("Machine"):
        parsed["machine"] = _get_str(cfg, "Machine", "machine", "ibm_pc")
        parsed["mem_size"] = _get_int(cfg, "Machine", "mem_size", 64)
        parsed["cpu_family"] = _get_str(cfg, "Machine", "cpu_family", "")
        # NEW: Keep the raw Hz value temporarily to translate it into an index later
        parsed["_raw_cpu_speed"] = _get_int(cfg, "Machine", "cpu_speed", 0)
        parsed["cpu_use_dynarec"] = _get_bool(cfg, "Machine", "cpu_use_dynarec", True)
        parsed["time_sync"] = _get_str(cfg, "Machine", "time_sync", "local")
        parsed["fpu_type"] = _get_str(cfg, "Machine", "fpu_type", "none")
        parsed["fpu_softfloat"] = _get_bool(cfg, "Machine", "fpu_softfloat", False)
        
    # --- Video settings ---
    if cfg.has_section("Video"):
        parsed["gfxcard"] = _get_str(cfg, "Video", "gfxcard", "none")
        
    if cfg.has_section("3Dfx Voodoo Graphics"):
        voodoo_type = _get_str(cfg, "3Dfx Voodoo Graphics", "type", "none")
        parsed["voodoo_enabled"] = voodoo_type != "none"
        if parsed["voodoo_enabled"]:
            parsed["voodoo_type"] = voodoo_type
            
    # --- Sound settings ---
    if cfg.has_section("Sound"):
        parsed["sndcard"] = _get_str(cfg, "Sound", "sndcard", "none")
        parsed["midi_device"] = _get_str(cfg, "Sound", "midi_device", "none")
        parsed["fm_driver"] = _get_str(cfg, "Sound", "fm_driver", "nuked")

    # --- Network settings ---
    if cfg.has_section("Network"):
        parsed["net_card"] = _get_str(cfg, "Network", "net_01_card", "none")
        parsed["net_type"] = _get_str(cfg, "Network", "net_01_net_type", "slirp")
        parsed["net_host_dev"] = _get_str(cfg, "Network", "net_01_host_device", "")
        
    # --- Storage Controllers ---
    if cfg.has_section("Storage controllers"):
        # NEW: Check for modern hdc_1 first, then fallback to old hdc
        hdc_val = _get_str(cfg, "Storage controllers", "hdc_1", "none")
        if hdc_val == "none":
            hdc_val = _get_str(cfg, "Storage controllers", "hdc", "none")
        parsed["hdd_controller"] = hdc_val
        
        parsed["scsi_card"] = _get_str(cfg, "Storage controllers", "scsi_card", "none")
        parsed["fdc_card"] = _get_str(cfg, "Storage controllers", "fdc", "none")
        
    # --- Hard Disks ---
    if cfg.has_section("Hard disks"):
        for i in range(1, 9):
            n = f"{i:02d}"
            params = _get_str(cfg, "Hard disks", f"hdd_{n}_parameters", "")
            if params:
                parsed[f"hdd_{n}_enabled"] = True
                parts = [p.strip() for p in params.split(",")]
                
                if len(parts) >= 4:
                    parsed[f"hdd_{n}_spt"] = int(parts[0]) if parts[0].isdigit() else 63
                    parsed[f"hdd_{n}_heads"] = int(parts[1]) if parts[1].isdigit() else 16
                    parsed[f"hdd_{n}_cylinders"] = int(parts[2]) if parts[2].isdigit() else 0
                    parsed[f"hdd_{n}_size_mb"] = int(parts[3]) if parts[3].isdigit() else 0
                if len(parts) >= 5:
                    parsed[f"hdd_{n}_bus"] = parts[4]
                    
                # NEW: Save the original filename temporarily so we can move the file later
                parsed[f"_hdd_{n}_fn_orig"] = _get_str(cfg, "Hard disks", f"hdd_{n}_fn", "")
                parsed[f"hdd_{n}_speed"] = _get_str(cfg, "Hard disks", f"hdd_{n}_speed", "")
                parsed[f"hdd_{n}_ide_channel"] = _get_str(cfg, "Hard disks", f"hdd_{n}_ide_channel", "")
                
    # --- Floppy and CD-ROM drives ---
    if cfg.has_section("Floppy and CD-ROM drives"):
        for i in range(1, 5):
            n = f"{i:02d}"
            f_type = _get_str(cfg, "Floppy and CD-ROM drives", f"fdd_{n}_type", "none")
            parsed[f"fdd_{n}_type"] = f_type
            if f_type != "none":
                parsed[f"fdd_{n}_fn"] = _get_str(cfg, "Floppy and CD-ROM drives", f"fdd_{n}_fn", "")
                parsed[f"fdd_{n}_turbo"] = _get_bool(cfg, "Floppy and CD-ROM drives", f"fdd_{n}_turbo", False)

            cd_type = _get_str(cfg, "Floppy and CD-ROM drives", f"cdrom_{n}_type", "")
            if cd_type and cd_type != "none":
                parsed[f"cdrom_{n}_enabled"] = True
                parsed[f"cdrom_{n}_drive_type"] = cd_type
                parsed[f"cdrom_{n}_speed"] = _get_int(cfg, "Floppy and CD-ROM drives", f"cdrom_{n}_speed", 72)
                parsed[f"cdrom_{n}_ide_channel"] = _get_str(cfg, "Floppy and CD-ROM drives", f"cdrom_{n}_ide_channel", "")
                parsed[f"cdrom_{n}_fn"] = _get_str(cfg, "Floppy and CD-ROM drives", f"cdrom_{n}_image_path", "")

    # --- Input / Ports ---
    # 1. Try modern v4/v5 format first
    if cfg.has_section("Input devices"):
        parsed["mouse_type"] = _get_str(cfg, "Input devices", "mouse_type", "none")
        parsed["joystick_type"] = _get_str(cfg, "Input devices", "joystick_type", "none")
        parsed["keyboard_type"] = _get_str(cfg, "Input devices", "keyboard_type", "none")
    else:
        # 2. Fallback to older v3 formats
        if cfg.has_section("Mouse"):
            parsed["mouse_type"] = _get_str(cfg, "Mouse", "type", "none")
        if cfg.has_section("Joystick"):
            parsed["joystick_type"] = _get_str(cfg, "Joystick", "type", "none")
        if cfg.has_section("Keyboard"):
            parsed["keyboard_type"] = _get_str(cfg, "Keyboard", "type", "none")
        
    return parsed