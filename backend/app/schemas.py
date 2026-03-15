from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ─── Auth ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None
    is_admin: bool = False


# ─── Users ───────────────────────────────────────────────────────────────────

class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    email: str
    is_admin: bool = False
    is_active: bool = True
    max_vms: int = 10
    max_storage_gb: int = 100

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserUpdate(BaseModel):
    email: Optional[str] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None
    max_vms: Optional[int] = None
    max_storage_gb: Optional[int] = None
    password: Optional[str] = None

class UserResponse(UserBase):
    id: int
    is_ldap: bool
    created_at: datetime
    last_login: Optional[datetime] = None
    vm_count: int = 0
    disk_usage_bytes: int = 0
    is_bootstrap: bool = False

    class Config:
        from_attributes = True


# ─── VM Groups ────────────────────────────────────────────────────────────────

class VMGroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: Optional[str] = None
    color: str = "#6366f1"
    network_enabled: bool = False

class VMGroupCreate(VMGroupBase):
    pass

class VMGroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    network_enabled: Optional[bool] = None

class VMGroupResponse(VMGroupBase):
    id: int
    user_id: int
    created_at: datetime
    vm_count: int = 0
    has_running_vms: bool = False

    class Config:
        from_attributes = True


# ─── VM Config (86Box settings) ───────────────────────────────────────────────

class VMConfig(BaseModel):
    model_config = {"extra": "ignore"}

    # ── Machine ────────────────────────────────────────────────────────────────
    machine: str = "ibmxt"
    cpu_family: str = "8088"
    # 0-based index into cpu_family's CPU list; rspeed/multi resolved at write time
    cpu_speed: int = 0
    cpu_use_dynarec: bool = False
    cpu_waitstates: int = 0
    fpu_type: str = "none"
    fpu_softfloat: bool = False
    mem_size: int = 640  # KB
    pit_mode: int = 0   # 0 = auto
    time_sync: str = "local"  # local | utc | disabled

    # ── Display ────────────────────────────────────────────────────────────────
    gfxcard: str = "cga"
    voodoo_enabled: bool = False
    voodoo_type: str = "voodoo1"
    show_second_monitors: bool = False

    # ── Sound ──────────────────────────────────────────────────────────────────
    sndcard: str = "adlib"
    midi_device: str = "none"          # midi_output_device in 86Box cfg
    mpu401_standalone_enable: bool = False
    fm_driver: str = "nuked"           # nuked | ymfm
    sound_is_float: bool = False

    # ── Network ────────────────────────────────────────────────────────────────
    net_card: str = "none"
    net_type: str = "slirp"           # slirp | pcap | tap | vde
    net_host_dev: str = ""            # PCAP interface name
    net_use_group: bool = True        # when True and VM is in a networked group, override transport to TAP

    # ── Storage controllers ────────────────────────────────────────────────────
    hdd_controller: str = "ide_isa"   # → hdc_1 in cfg
    ide_ter_enabled: bool = False     # → hdc_2 = ide_ter
    ide_qua_enabled: bool = False     # → hdc_3 = ide_qua
    scsi_card: str = "none"           # → scsicard_1 in cfg
    fdc_card: str = "none"            # add-in FDC card (most machines have built-in)

    # ── Hard disks (up to 8) ──────────────────────────────────────────────────
    hdd_01_enabled: bool = False
    hdd_01_bus: str = "ide"
    hdd_01_size_mb: int = 512
    hdd_01_cylinders: Optional[int] = None
    hdd_01_heads: Optional[int] = None
    hdd_01_spt: Optional[int] = None
    hdd_01_speed: str = "1997_5400rpm"
    hdd_01_ide_channel: str = "0:0"

    hdd_02_enabled: bool = False
    hdd_02_bus: str = "ide"
    hdd_02_size_mb: int = 512
    hdd_02_cylinders: Optional[int] = None
    hdd_02_heads: Optional[int] = None
    hdd_02_spt: Optional[int] = None
    hdd_02_speed: str = "1997_5400rpm"
    hdd_02_ide_channel: str = "0:1"

    hdd_03_enabled: bool = False
    hdd_03_bus: str = "scsi"
    hdd_03_size_mb: int = 512
    hdd_03_cylinders: Optional[int] = None
    hdd_03_heads: Optional[int] = None
    hdd_03_spt: Optional[int] = None
    hdd_03_speed: str = "1997_5400rpm"
    hdd_03_ide_channel: str = "1:0"

    hdd_04_enabled: bool = False
    hdd_04_bus: str = "scsi"
    hdd_04_size_mb: int = 512
    hdd_04_cylinders: Optional[int] = None
    hdd_04_heads: Optional[int] = None
    hdd_04_spt: Optional[int] = None
    hdd_04_speed: str = "1997_5400rpm"
    hdd_04_ide_channel: str = "1:1"

    hdd_05_enabled: bool = False
    hdd_05_bus: str = "ide"
    hdd_05_size_mb: int = 512
    hdd_05_cylinders: Optional[int] = None
    hdd_05_heads: Optional[int] = None
    hdd_05_spt: Optional[int] = None
    hdd_05_speed: str = "1997_5400rpm"
    hdd_05_ide_channel: str = "2:0"

    hdd_06_enabled: bool = False
    hdd_06_bus: str = "ide"
    hdd_06_size_mb: int = 512
    hdd_06_cylinders: Optional[int] = None
    hdd_06_heads: Optional[int] = None
    hdd_06_spt: Optional[int] = None
    hdd_06_speed: str = "1997_5400rpm"
    hdd_06_ide_channel: str = "2:1"

    hdd_07_enabled: bool = False
    hdd_07_bus: str = "ide"
    hdd_07_size_mb: int = 512
    hdd_07_cylinders: Optional[int] = None
    hdd_07_heads: Optional[int] = None
    hdd_07_spt: Optional[int] = None
    hdd_07_speed: str = "1997_5400rpm"
    hdd_07_ide_channel: str = "3:0"

    hdd_08_enabled: bool = False
    hdd_08_bus: str = "ide"
    hdd_08_size_mb: int = 512
    hdd_08_cylinders: Optional[int] = None
    hdd_08_heads: Optional[int] = None
    hdd_08_spt: Optional[int] = None
    hdd_08_speed: str = "1997_5400rpm"
    hdd_08_ide_channel: str = "3:1"

    # ── Floppy drives (up to 4) ───────────────────────────────────────────────
    fdd_01_type: str = "525_2dd"
    fdd_01_turbo: bool = False
    fdd_01_check_bpb: bool = True
    fdd_01_fn: str = ""

    fdd_02_type: str = "none"
    fdd_02_turbo: bool = False
    fdd_02_check_bpb: bool = True
    fdd_02_fn: str = ""

    fdd_03_type: str = "none"
    fdd_03_turbo: bool = False
    fdd_03_check_bpb: bool = True
    fdd_03_fn: str = ""

    fdd_04_type: str = "none"
    fdd_04_turbo: bool = False
    fdd_04_check_bpb: bool = True
    fdd_04_fn: str = ""

    # ── CD-ROM drives (up to 4) ───────────────────────────────────────────────
    cdrom_01_enabled: bool = False
    cdrom_01_bus: str = "ide"
    cdrom_01_ide_channel: str = "1:0"
    cdrom_01_speed: int = 24
    cdrom_01_drive_type: str = ""   # internal_name from cdrom_drive_types; "" = 86Box default
    cdrom_01_fn: str = ""

    cdrom_02_enabled: bool = False
    cdrom_02_bus: str = "ide"
    cdrom_02_ide_channel: str = "1:1"
    cdrom_02_speed: int = 24
    cdrom_02_drive_type: str = ""
    cdrom_02_fn: str = ""

    cdrom_03_enabled: bool = False
    cdrom_03_bus: str = "ide"
    cdrom_03_ide_channel: str = "2:0"
    cdrom_03_speed: int = 24
    cdrom_03_drive_type: str = ""
    cdrom_03_fn: str = ""

    cdrom_04_enabled: bool = False
    cdrom_04_bus: str = "ide"
    cdrom_04_ide_channel: str = "2:1"
    cdrom_04_speed: int = 24
    cdrom_04_drive_type: str = ""
    cdrom_04_fn: str = ""

    # ── COM ports (86Box keys: com_1_enabled … com_4_enabled) ────────────────
    com_1_enabled: bool = True
    com_2_enabled: bool = True
    com_3_enabled: bool = False
    com_4_enabled: bool = False

    # ── LPT ports (86Box keys: lpt_1_enabled … lpt_3_enabled) ────────────────
    lpt_1_enabled: bool = True
    lpt_2_enabled: bool = False
    lpt_3_enabled: bool = False

    # ── Input ──────────────────────────────────────────────────────────────────
    mouse_type: str = "ps2"
    joystick_type: str = "none"
    keyboard_type: str = "keyboard_at"

    # ── Other peripherals ─────────────────────────────────────────────────────
    isartc_type: str = "none"
    isamem_1_base: int = 0
    isamem_1_size: int = 0
    isamem_2_base: int = 0
    isamem_2_size: int = 0

    # ── VNC/display (internal, not written to 86Box cfg) ──────────────────────
    vnc_password: str = ""

    # ── Per-device configuration (IRQ, DMA, I/O base, etc.) ──────────────────
    device_settings: dict = {}


# ─── VMs ─────────────────────────────────────────────────────────────────────

class VMBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: Optional[str] = None
    group_id: Optional[int] = None

class VMCreate(VMBase):
    config: VMConfig = Field(default_factory=VMConfig)

class VMUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    group_id: Optional[int] = None
    config: Optional[VMConfig] = None

class VMResponse(VMBase):
    id: int
    uuid: str
    user_id: int
    status: str
    vnc_port: Optional[int] = None
    ws_port: Optional[int] = None
    config: Dict[str, Any]
    disk_usage_bytes: int = 0
    created_at: datetime
    last_started: Optional[datetime] = None
    last_stopped: Optional[datetime] = None
    owner_username: Optional[str] = None
    group_name: Optional[str] = None
    group_color: Optional[str] = None

    class Config:
        from_attributes = True


# ─── System ──────────────────────────────────────────────────────────────────

class SystemStats(BaseModel):
    cpu_percent: float
    memory_total: int
    memory_used: int
    memory_percent: float
    disk_total: int
    disk_used: int
    disk_percent: float
    running_vms: int
    total_vms: int
    uptime_seconds: float
    hostname: str = ""

class VersionInfo(BaseModel):
    box86_version: Optional[str] = None
    box86_latest: Optional[str] = None
    roms_version: Optional[str] = None
    roms_latest: Optional[str] = None
    app_version: str = "1.0.0"
    update_available: bool = False
    roms_update_available: bool = False
    vm_auto_shutdown_minutes: int = 0

class UserStats(BaseModel):
    vm_count: int
    running_vm_count: int
    disk_usage_bytes: int
    max_vms: int
    max_storage_gb: int


# ─── App Settings ─────────────────────────────────────────────────────────────

class AppSettings(BaseModel):
    enforce_quotas: bool = True
    active_vm_limit: Optional[int] = None  # None = use runner default


# ─── Drive Management ────────────────────────────────────────────────────────

class DriveMount(BaseModel):
    path: str  # full server path to the image file

class BlankFloppyCreate(BaseModel):
    name: str
    size_kb: int = 1440  # 360 | 720 | 1200 | 1440 | 2880


# ─── 86Box Hardware Lists (returned by /api/system/hardware) ─────────────────

class DeviceConfigOption(BaseModel):
    description: str
    value: int

class DeviceConfig(BaseModel):
    name: str
    description: str
    type: str
    default: Optional[int] = None
    default_string: Optional[str] = None
    options: Optional[List[DeviceConfigOption]] = None
    spinner_min: Optional[int] = None
    spinner_max: Optional[int] = None
    spinner_step: Optional[int] = None

class HardwareOption(BaseModel):
    id: str
    name: str
    category: Optional[str] = None
    bus_flags: int = 0
    config: Optional[List[DeviceConfig]] = None
    # Machine-specific memory limits (KB)
    ram_min: Optional[int] = None
    ram_max: Optional[int] = None
    ram_step: Optional[int] = None
    # HDD speed preset technical specs
    rpm: Optional[int] = None
    full_stroke_ms: Optional[int] = None
    track_seek_ms: Optional[int] = None
    heads: Optional[int] = None
    avg_spt: Optional[int] = None
    # Optical drive specs
    speed_x: Optional[int] = None
    is_dvd: Optional[bool] = None

class HardwareLists(BaseModel):
    machines: List[HardwareOption]
    cpu_families: Dict[str, List[HardwareOption]]
    # cpu_speeds[family_id] = list of display-name strings; index = VMConfig.cpu_speed value
    cpu_speeds: Dict[str, List[str]]
    video_cards: List[HardwareOption]
    sound_cards: List[HardwareOption]
    midi_devices: List[HardwareOption]
    network_cards: List[HardwareOption]
    hdd_controllers: List[HardwareOption]
    scsi_cards: List[HardwareOption]
    fdc_cards: List[HardwareOption]
    isartc_types: List[HardwareOption]
    isamem_types: List[HardwareOption]
    mouse_types: List[HardwareOption]
    joystick_types: List[HardwareOption]
    floppy_types: List[HardwareOption]
    cdrom_drive_types: List[HardwareOption]
    hdd_speed_presets: List[HardwareOption]
