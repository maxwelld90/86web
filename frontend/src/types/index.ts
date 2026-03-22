export interface User {
  id: number
  username: string
  email: string
  is_admin: boolean
  is_active: boolean
  is_ldap: boolean
  max_vms: number
  max_storage_gb: number
  created_at: string
  last_login?: string
  vm_count: number
  disk_usage_bytes: number
  is_bootstrap?: boolean
  can_manage_vms?: boolean;
  can_manage_groups?: boolean;
  can_access_library?: boolean;
  can_upload_images?: boolean;
}

export interface VMGroup {
  id: number
  name: string
  description?: string
  color: string
  network_enabled: boolean
  user_id: number
  created_at: string
  vm_count: number
  has_running_vms: boolean
  shared_with_user_ids?: number[];
}

export interface VMConfig {
  // Machine
  machine: string
  cpu_family: string
  cpu_speed: number    // 0-based index into cpu_family's CPU speed list
  cpu_use_dynarec: boolean
  cpu_waitstates: number
  fpu_type: string
  fpu_softfloat: boolean
  mem_size: number     // KB
  pit_mode: number
  time_sync: string

  // Display
  gfxcard: string
  voodoo_enabled: boolean
  voodoo_type: string
  show_second_monitors: boolean

  // Sound
  sndcard: string
  midi_device: string
  mpu401_standalone_enable: boolean
  fm_driver: string
  sound_is_float: boolean

  // Network
  net_card: string
  net_type: string
  net_host_dev: string
  net_use_group: boolean

  // Storage controllers
  hdd_controller: string
  ide_ter_enabled: boolean
  ide_qua_enabled: boolean
  scsi_card: string
  fdc_card: string

  // Hard disks (up to 8)
  hdd_01_enabled: boolean
  hdd_01_bus: string
  hdd_01_size_mb: number
  hdd_01_cylinders: number | null
  hdd_01_heads: number | null
  hdd_01_spt: number | null
  hdd_01_speed: string
  hdd_01_ide_channel: string
  hdd_02_enabled: boolean
  hdd_02_bus: string
  hdd_02_size_mb: number
  hdd_02_cylinders: number | null
  hdd_02_heads: number | null
  hdd_02_spt: number | null
  hdd_02_speed: string
  hdd_02_ide_channel: string
  hdd_03_enabled: boolean
  hdd_03_bus: string
  hdd_03_size_mb: number
  hdd_03_cylinders: number | null
  hdd_03_heads: number | null
  hdd_03_spt: number | null
  hdd_03_speed: string
  hdd_03_ide_channel: string
  hdd_04_enabled: boolean
  hdd_04_bus: string
  hdd_04_size_mb: number
  hdd_04_cylinders: number | null
  hdd_04_heads: number | null
  hdd_04_spt: number | null
  hdd_04_speed: string
  hdd_04_ide_channel: string
  hdd_05_enabled: boolean
  hdd_05_bus: string
  hdd_05_size_mb: number
  hdd_05_cylinders: number | null
  hdd_05_heads: number | null
  hdd_05_spt: number | null
  hdd_05_speed: string
  hdd_05_ide_channel: string
  hdd_06_enabled: boolean
  hdd_06_bus: string
  hdd_06_size_mb: number
  hdd_06_cylinders: number | null
  hdd_06_heads: number | null
  hdd_06_spt: number | null
  hdd_06_speed: string
  hdd_06_ide_channel: string
  hdd_07_enabled: boolean
  hdd_07_bus: string
  hdd_07_size_mb: number
  hdd_07_cylinders: number | null
  hdd_07_heads: number | null
  hdd_07_spt: number | null
  hdd_07_speed: string
  hdd_07_ide_channel: string
  hdd_08_enabled: boolean
  hdd_08_bus: string
  hdd_08_size_mb: number
  hdd_08_cylinders: number | null
  hdd_08_heads: number | null
  hdd_08_spt: number | null
  hdd_08_speed: string
  hdd_08_ide_channel: string

  // Floppy drives (up to 4)
  fdd_01_type: string
  fdd_01_turbo: boolean
  fdd_01_check_bpb: boolean
  fdd_01_fn: string
  fdd_02_type: string
  fdd_02_turbo: boolean
  fdd_02_check_bpb: boolean
  fdd_02_fn: string
  fdd_03_type: string
  fdd_03_turbo: boolean
  fdd_03_check_bpb: boolean
  fdd_03_fn: string
  fdd_04_type: string
  fdd_04_turbo: boolean
  fdd_04_check_bpb: boolean
  fdd_04_fn: string

  // CD-ROM drives (up to 4)
  cdrom_01_enabled: boolean
  cdrom_01_bus: string
  cdrom_01_ide_channel: string
  cdrom_01_speed: number
  cdrom_01_drive_type: string
  cdrom_01_fn: string
  cdrom_02_enabled: boolean
  cdrom_02_bus: string
  cdrom_02_ide_channel: string
  cdrom_02_speed: number
  cdrom_02_drive_type: string
  cdrom_02_fn: string
  cdrom_03_enabled: boolean
  cdrom_03_bus: string
  cdrom_03_ide_channel: string
  cdrom_03_speed: number
  cdrom_03_drive_type: string
  cdrom_03_fn: string
  cdrom_04_enabled: boolean
  cdrom_04_bus: string
  cdrom_04_ide_channel: string
  cdrom_04_speed: number
  cdrom_04_drive_type: string
  cdrom_04_fn: string

  // COM ports (86Box: com_1_enabled … com_4_enabled)
  com_1_enabled: boolean
  com_2_enabled: boolean
  com_3_enabled: boolean
  com_4_enabled: boolean

  // LPT ports (86Box: lpt_1_enabled … lpt_3_enabled)
  lpt_1_enabled: boolean
  lpt_2_enabled: boolean
  lpt_3_enabled: boolean

  // Input
  mouse_type: string
  joystick_type: string
  keyboard_type: string

  // Other peripherals
  isartc_type: string
  isamem_1_base: number
  isamem_1_size: number
  isamem_2_base: number
  isamem_2_size: number

  // VNC (internal, not written to 86Box cfg)
  vnc_password: string

  // Per-device configuration (IRQ, DMA, I/O base, etc.)
  device_settings?: Record<string, Record<string, number | string>>
}

export interface VM {
  id: number
  uuid: string
  name: string
  description?: string
  user_id: number
  group_id?: number
  status: 'stopped' | 'starting' | 'running' | 'paused' | 'error'
  vnc_port?: number
  ws_port?: number
  config: VMConfig
  disk_usage_bytes: number
  created_at: string
  last_started?: string
  last_stopped?: string
  owner_username?: string
  group_name?: string
  group_color?: string
  locked_by_user_id?: number | null;
  locked_by_username?: string | null;
  shared_with_user_ids?: number[];
}

export interface SystemStats {
  cpu_percent: number
  memory_total: number
  memory_used: number
  memory_percent: number
  disk_total: number
  disk_used: number
  disk_percent: number
  running_vms: number
  total_vms: number
  uptime_seconds: number
  hostname: string
}

export interface UserStats {
  vm_count: number
  running_vm_count: number
  disk_usage_bytes: number
  max_vms: number
  max_storage_gb: number
}

export interface VersionInfo {
  box86_version?: string
  box86_latest?: string
  roms_version?: string
  roms_latest?: string
  app_version: string
  update_available: boolean
  roms_update_available: boolean
  vm_auto_shutdown_minutes?: number
}

export interface DeviceConfigOption {
  description: string
  value: number
}

export interface DeviceConfig {
  name: string
  description: string
  type: 'selection' | 'hex16' | 'hex20' | 'binary' | 'spinner' | 'string' | 'int' | 'memory' | 'serport' | string
  default?: number
  default_string?: string
  options?: DeviceConfigOption[]
  spinner_min?: number
  spinner_max?: number
  spinner_step?: number
}

export interface HardwareOption {
  id: string
  name: string
  category?: string
  bus_flags?: number
  config?: DeviceConfig[]
  ram_min?: number   // KB, machines only
  ram_max?: number   // KB, machines only
  ram_step?: number  // KB, machines only
  // HDD speed preset specs
  rpm?: number | null
  full_stroke_ms?: number | null
  track_seek_ms?: number | null
  heads?: number | null
  avg_spt?: number | null
  // Optical drive specs
  speed_x?: number | null
  is_dvd?: boolean | null
}

export interface HardwareLists {
  machines: HardwareOption[]
  cpu_families: Record<string, HardwareOption[]>
  // cpu_speeds[family_id] = array of display names; index = VMConfig.cpu_speed value
  cpu_speeds: Record<string, string[]>
  video_cards: HardwareOption[]
  sound_cards: HardwareOption[]
  midi_devices: HardwareOption[]
  network_cards: HardwareOption[]
  hdd_controllers: HardwareOption[]
  scsi_cards: HardwareOption[]
  fdc_cards: HardwareOption[]
  isartc_types: HardwareOption[]
  isamem_types: HardwareOption[]
  mouse_types: HardwareOption[]
  joystick_types: HardwareOption[]
  floppy_types: HardwareOption[]
  cdrom_drive_types: HardwareOption[]
  hdd_speed_presets: HardwareOption[]
}

export interface AuthConfig {
  user_management: boolean
  ldap_enabled: boolean
}

// Open VM tab (for the tabbed console interface)
export interface VMTab {
  vmId: number
  vmUuid: string
  vmName: string
  status: string
  group_color?: string
}
