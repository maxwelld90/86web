#!/usr/bin/env python3
"""
86Box Hardware Compatibility Filter — Web App Integration Library
=================================================================
This module provides the core filtering and configuration logic for a web UI
that lets users select 86Box VM hardware components with full compatibility
validation, matching the exact logic in the 86Box source code.

USAGE (as a library):

    from filter_86box import HardwareFilter, FilterRequest

    f = HardwareFilter.from_file("86box_hardware_db.json")

    # Get compatible video cards for a given machine
    result = f.filter(FilterRequest(
        machine_id="ibmpc",
        categories=["video_cards"]
    ))
    # result.video_cards → list of compatible devices

    # Get device settings (for populating a settings panel)
    settings = f.get_device_settings("sb16")
    # settings → structured dict of config fields with types, defaults, options

USAGE (as a CLI tool):

    python3 filter_86box.py --machine ibmpc --categories video_cards sound_cards
    python3 filter_86box.py --machine ibmpc --device-settings sb16
    python3 filter_86box.py --list-machines
    python3 filter_86box.py --machine ibmpc --all-categories

CFG FILE FORMAT:
    Each selected device maps to a section in the 86Box CFG file:
        [device_internal_name]
        setting_name=value

    The key for each setting is the config entry's .name field.
    Values:
        CONFIG_BINARY/SELECTION/INT/SPINNER/MEMORY/MIDI  → integer
        CONFIG_STRING/FNAME/SERPORT/BIOS                 → string
        CONFIG_HEX16/HEX20                               → hex (written as 0x...)
        CONFIG_MAC                                        → MAC string

COMPATIBILITY RULES (from device_is_valid() in device.c):
    1. A device with NO bus flags is always valid (built-in/None).
    2. A device requiring a bus is valid iff machine.bus_flags & device_bus_flags != 0.
    3. Exception: DEVICE_PCI cards are EXCLUDED from machines with MACHINE_PCI_INTERNAL.
"""

import json
import sys
import argparse
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Any

# ---------------------------------------------------------------------------
# Compatibility constants
# ---------------------------------------------------------------------------

DEVICE_BUS_MASK      = 0x001FFFFF
DEVICE_PCI           = 0x00010000
MACHINE_PCI_INTERNAL = 0x00200000


def device_is_valid(device: dict, machine: dict) -> bool:
    """
    Exact Python mirror of 86Box's device_is_valid(device, machine_index).
    """
    dev_bus = device.get('flags_value', 0) & DEVICE_BUS_MASK
    if dev_bus == 0:
        return True
    if (device.get('flags_value', 0) & DEVICE_PCI) and \
       (machine.get('flags_value', 0) & MACHINE_PCI_INTERNAL):
        return False
    return bool(machine.get('bus_flags_value', 0) & dev_bus)


# ---------------------------------------------------------------------------
# Filter request / response dataclasses
# ---------------------------------------------------------------------------

# All available component categories
ALL_CATEGORIES = [
    'video_cards',
    'sound_cards',
    'network_cards',
    'hdc',
    'scsi',
    'fdc',
    'cdrom_interface',
    'cdrom_drive_types',
    'isartc',
    'isamem',
]

CATEGORY_LABELS = {
    'video_cards':       'Video Card',
    'sound_cards':       'Sound Card',
    'network_cards':     'Network Card',
    'hdc':               'Hard Disk Controller',
    'scsi':              'SCSI Controller',
    'fdc':               'Floppy Controller',
    'cdrom_interface':   'CD-ROM Interface',
    'cdrom_drive_types': 'CD-ROM Drive',
    'isartc':            'ISA RTC Card',
    'isamem':            'ISA Memory Expansion',
}

# Machine feature flags that indicate built-in hardware
MACHINE_FLAG_VIDEO   = 0x00000002
MACHINE_FLAG_VIDEO_ONLY = 0x00000008
MACHINE_FLAG_SOUND   = 0x00020000
MACHINE_FLAG_HDC     = 0x0001F100  # includes MFM/XTA/ESDI/IDE bits
MACHINE_FLAG_FDC     = 0x00080000
MACHINE_FLAG_NIC     = 0x00100000
MACHINE_FLAG_GAMEPORT = 0x00040000


@dataclass
class FilterRequest:
    """
    Specifies what to filter and any additional constraints.

    machine_id    : internal_name of the machine (e.g. 'ibmpc')
    categories    : list of category keys to filter; None = all
    exclude_none  : if True, exclude the 'None' and 'Internal' entries
    include_flags : optional dict of extra machine feature overrides
                    (e.g. {'video_flags_value': new_value})
    """
    machine_id: str
    categories: Optional[list] = None
    exclude_none: bool = False
    include_flags: dict = field(default_factory=dict)


@dataclass
class DeviceEntry:
    """Represents one device option in a category."""
    name: str
    internal_name: str
    symbol: str
    bus_flags: list          # human-readable bus requirement names
    bus_flags_value: int
    has_config: bool
    config: list             # list of ConfigField
    is_builtin: bool         # True for device_none / device_internal
    display_name: str        # ready-to-show string (may include bus label)


@dataclass
class ConfigField:
    """One configurable setting for a device."""
    name: str                # key used in CFG file
    description: str         # human-readable label
    type: str                # CONFIG_* type name
    cfg_key: str             # exact key to write in CFG file (= name)
    default_int: Optional[int] = None
    default_string: Optional[str] = None
    options: list = field(default_factory=list)   # for CONFIG_SELECTION
    spinner: Optional[dict] = None                # {min, max, step}
    bios_variants: list = field(default_factory=list)  # for CONFIG_BIOS
    file_filter: Optional[str] = None            # for CONFIG_FNAME


@dataclass
class FilterResult:
    """Full result from a filter() call."""
    machine: dict
    categories: dict          # category → list of DeviceEntry
    machine_cpu_families: list
    machine_has_builtin_video: bool
    machine_has_builtin_sound: bool
    machine_has_builtin_hdc: bool
    machine_has_builtin_fdc: bool
    machine_has_builtin_nic: bool


# ---------------------------------------------------------------------------
# Settings panel analysis (from QT source)
# ---------------------------------------------------------------------------

# What the QT settings pages look for and what they write to the CFG file.
# This documents the relationship between QT settings UI and the CFG file.
SETTINGS_PANEL_INFO = {
    'video_cards': {
        'qt_file':    'qt_settingsdisplay.cpp',
        'cfg_section': '[Video]',
        'cfg_keys': {
            'gfxcard': 'gfxcard_%d (primary=0)',
        },
        'extra_options': {
            'voodoo_enabled':              {'type': 'binary', 'cfg_key': 'voodoo_enabled',              'description': 'Enable 3DFX Voodoo add-on'},
            'ibm8514_standalone_enabled':  {'type': 'binary', 'cfg_key': 'ibm8514_standalone',          'description': 'Enable IBM 8514/A add-on'},
            'xga_standalone_enabled':      {'type': 'binary', 'cfg_key': 'xga_standalone',              'description': 'Enable XGA add-on (MCA only)'},
            'da2_standalone_enabled':      {'type': 'binary', 'cfg_key': 'da2_standalone',              'description': 'Enable PS/55 DA2 add-on'},
            'monitor_edid':                {'type': 'binary', 'cfg_key': 'monitor_edid',                'description': 'Use custom EDID'},
            'monitor_edid_path':           {'type': 'fname',  'cfg_key': 'monitor_edid_path',           'description': 'Custom EDID file path'},
        },
        'notes': [
            'Primary card slot stored as gfxcard_0, secondary as gfxcard_1 (or gfxcard_2, etc.)',
            'Up to GFXCARD_MAX cards supported simultaneously.',
            'Voodoo 3DFX passthrough requires a PCI machine.',
            'XGA add-on only configurable on MCA machines.',
            'If machine has VIDEO_ONLY flag, video card is fixed and cannot be changed.',
        ],
    },
    'sound_cards': {
        'qt_file':    'qt_settingssound.cpp',
        'cfg_section': '[Sound]',
        'cfg_keys': {
            'sndcard': 'sndcard_%d (0-indexed slot)',
        },
        'extra_options': {
            'fm_driver':                  {'type': 'selection', 'cfg_key': 'fm_driver',
                                           'description': 'FM synthesizer driver',
                                           'options': [('Nuked OPL (accurate)', 0), ('YMFM (faster)', 1)]},
            'midi_output_device':         {'type': 'selection', 'cfg_key': 'midi_output_device',
                                           'description': 'MIDI output device (system MIDI)'},
            'midi_input_device':          {'type': 'selection', 'cfg_key': 'midi_input_device',
                                           'description': 'MIDI input device'},
            'mpu401_standalone_enable':   {'type': 'binary',    'cfg_key': 'mpu401_standalone_enable',
                                           'description': 'Enable standalone MPU-401'},
            'sound_is_float':             {'type': 'binary',    'cfg_key': 'sound_is_float',
                                           'description': 'Use 32-bit float audio rendering'},
        },
        'notes': [
            'Up to SOUND_CARD_MAX (4) sound cards can be selected simultaneously.',
            'Internal sound (slot 0) shown only if machine has MACHINE_SOUND flag.',
            'MIDI output/input are separate from card selection.',
            'MPU-401 standalone only available when a sound card is selected.',
        ],
    },
    'network_cards': {
        'qt_file':    'qt_settingsnetwork.cpp',
        'cfg_section': '[Network]',
        'cfg_keys': {
            'net_card': 'net_card_%d',
            'net_type': 'net_type_%d  (PCAP=1, SLiRP=2, TAP=3, VDE=4, Switch=5, RemoteSwitch=6)',
            'net_host_dev': 'net_host_dev_%d  (PCAP interface name)',
            'net_bridge': 'net_bridge_%d  (TAP bridge name)',
            'net_vde_socket': 'net_vde_socket_%d',
        },
        'notes': [
            'Up to NET_CARD_MAX network cards can be selected.',
            'Each card has an independent network backend (SLiRP, PCAP, TAP, VDE).',
            'PCAP requires a physical interface name.',
            'TAP requires bridge configuration.',
            'Remote switch uses hostname + shared secret.',
        ],
    },
    'hdc': {
        'qt_file':    'qt_settingsstoragecontrollers.cpp',
        'cfg_section': '[Storage controllers]',
        'cfg_keys': {
            'hdc': 'hdc_%d  (0-indexed, internal=1)',
        },
        'notes': [
            'Up to HDC_MAX hard disk controllers.',
            '"Internal" (index 1) only available if machine has MACHINE_HDC flag.',
            'Most disk images connect to IDE or SCSI controllers.',
        ],
    },
    'scsi': {
        'qt_file':    'qt_settingsstoragecontrollers.cpp',
        'cfg_section': '[Storage controllers]',
        'cfg_keys': {
            'scsi': 'scsicard_%d  (0-indexed)',
        },
        'notes': [
            'Up to SCSI_CARD_MAX SCSI controllers simultaneously.',
            'SCSI devices (drives, scanners, etc.) attach to SCSI buses.',
        ],
    },
    'fdc': {
        'qt_file':    'qt_settingsstoragecontrollers.cpp',
        'cfg_section': '[Storage controllers]',
        'cfg_keys': {
            'fdc': 'fdc_card  (single value)',
        },
        'notes': [
            'Single floppy controller per machine.',
            '"Internal" available when machine has MACHINE_FDC flag.',
        ],
    },
    'cdrom_interface': {
        'qt_file':    'qt_settingsstoragecontrollers.cpp',
        'cfg_section': '[Storage controllers]',
        'cfg_keys': {
            'cdrom_interface': 'cdrom_interface  (single value)',
        },
        'notes': [
            'Proprietary CD-ROM interfaces (Mitsumi, MKE/Panasonic).',
            'Most CD-ROMs use ATAPI (IDE) — no separate interface card needed.',
        ],
    },
    'cdrom_drive_types': {
        'qt_file':    'qt_settingsfloppycdrom.cpp',
        'cfg_section': '[CD-ROM drives]',
        'cfg_keys': {
            'cdrom_type': 'cdrom_%d_type  (drive slot index)',
            'cdrom_drive_type': 'cdrom_%d_parameters  (vendor/model/revision/speed)',
        },
        'notes': [
            'CD-ROM drives are virtual emulated drives, not controller cards.',
            'Each drive slot has a bus (IDE channel/SCSI bus) and a drive model.',
            'Drive model affects reported speed, inquiry strings, and quirks.',
            'DVD drives can read DVD ISOs when is_dvd=True.',
        ],
    },
    'isartc': {
        'qt_file':    'qt_settingsotherperipherals.cpp',
        'cfg_section': '[Other peripherals]',
        'cfg_keys': {'isartc_type': 'isartc_type'},
        'notes': ['ISA real-time clock cards; only 1 at a time.'],
    },
    'isamem': {
        'qt_file':    'qt_settingsotherperipherals.cpp',
        'cfg_section': '[ISA memory]',
        'cfg_keys': {'isamem': 'isamem_%d_type'},
        'notes': ['ISA memory expansion cards; multiple supported.'],
    },
}

# ---------------------------------------------------------------------------
# Config field builder
# ---------------------------------------------------------------------------

def build_config_fields(config: list) -> list:
    """Convert raw config dicts from DB into structured ConfigField objects."""
    fields = []
    for entry in config:
        if entry.get('type') == 'CONFIG_END':
            continue
        name = entry.get('name', '')
        if not name:
            continue

        cf = ConfigField(
            name=name,
            description=entry.get('description', name),
            type=entry.get('type', 'CONFIG_INT'),
            cfg_key=name,
        )

        if 'default_int' in entry:
            cf.default_int = entry['default_int']
        if 'default_string' in entry:
            cf.default_string = entry['default_string']
        if entry.get('selection'):
            cf.options = [
                {'value': s['value'], 'label': s['description']}
                for s in entry['selection']
            ]
        if entry.get('spinner'):
            cf.spinner = entry['spinner']
        if entry.get('bios'):
            cf.bios_variants = [
                {'name': b['name'], 'internal_name': b['internal_name']}
                for b in entry['bios']
            ]
        if entry.get('file_filter'):
            cf.file_filter = entry['file_filter']

        fields.append(cf)
    return fields


# ---------------------------------------------------------------------------
# Bus flag display helpers
# ---------------------------------------------------------------------------

BUS_DISPLAY = {
    'DEVICE_ISA':     'ISA',
    'DEVICE_ISA16':   'ISA 16-bit',
    'DEVICE_MCA':     'MCA',
    'DEVICE_MCA32':   'MCA 32-bit',
    'DEVICE_EISA':    'EISA',
    'DEVICE_VLB':     'VLB',
    'DEVICE_PCI':     'PCI',
    'DEVICE_AGP':     'AGP',
    'DEVICE_PCMCIA':  'PCMCIA',
    'DEVICE_AC97':    'AC97',
    'DEVICE_COM':     'Serial',
    'DEVICE_LPT':     'Parallel',
    'DEVICE_CBUS':    'C-BUS',
}

BUS_ORDER = [
    'DEVICE_ISA', 'DEVICE_ISA16', 'DEVICE_MCA', 'DEVICE_MCA32',
    'DEVICE_EISA', 'DEVICE_VLB', 'DEVICE_PCI', 'DEVICE_AGP',
    'DEVICE_PCMCIA', 'DEVICE_AC97', 'DEVICE_COM', 'DEVICE_LPT', 'DEVICE_CBUS',
]


def get_primary_bus(flags: list) -> str:
    for bus in BUS_ORDER:
        if bus in flags:
            return BUS_DISPLAY.get(bus, bus)
    return 'Built-in'


def build_device_entry(d: dict) -> DeviceEntry:
    iname = d.get('internal_name', '')

    # Handle cdrom_drive_types records (vendor/model/revision, no 'name' field)
    if 'vendor' in d and 'name' not in d:
        display = d.get('display_name', f"{d.get('vendor','')} {d.get('model','')}".strip())
        return DeviceEntry(
            name=display,
            internal_name=iname,
            symbol='',
            bus_flags=[],
            bus_flags_value=0,
            has_config=False,
            config=[],
            is_builtin=False,
            display_name=display,
        )

    name = d.get('name', '?')
    flags = d.get('flags', [])
    is_builtin = iname in ('none', 'internal') or name in ('None', 'Internal')

    config_list = d.get('config', [])
    config_fields = build_config_fields(config_list)

    bus_label = get_primary_bus(flags)
    if not is_builtin and bus_label != 'Built-in':
        display_name = f"{name} [{bus_label}]"
    else:
        display_name = name

    return DeviceEntry(
        name=name,
        internal_name=iname,
        symbol=d.get('symbol', ''),
        bus_flags=[f for f in flags if f in BUS_DISPLAY],
        bus_flags_value=d.get('flags_value', 0),
        has_config=bool(config_fields),
        config=config_fields,
        is_builtin=is_builtin,
        display_name=display_name,
    )


# ---------------------------------------------------------------------------
# Main filter class
# ---------------------------------------------------------------------------

class HardwareFilter:
    """
    The main API class for web app integration.

    Call HardwareFilter.from_file(path) to load the database, then use:
        filter()              → get compatible devices for a machine
        get_device_settings() → get config schema for a device
        get_machine_info()    → get full machine details
        list_machines()       → list all machines
        get_cpu_options()     → get CPUs for a machine
    """

    def __init__(self, db: dict):
        self.db = db
        self._machines_by_id: dict[str, dict] = {
            m['internal_name']: m for m in db.get('machines', [])
        }
        self._devices_by_id: dict[str, dict] = {}
        # Build cross-category device lookup
        for cat in ALL_CATEGORIES:
            for d in db.get(cat, []):
                iname = d.get('internal_name', '')
                if iname:
                    self._devices_by_id[iname] = d

    @classmethod
    def from_file(cls, path: str) -> 'HardwareFilter':
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(
                f"Database '{path}' not found. Run parse_86box.py first."
            )
        with open(p, encoding='utf-8') as f:
            return cls(json.load(f))

    # ------------------------------------------------------------------
    # Core filter
    # ------------------------------------------------------------------

    def filter(self, req: FilterRequest) -> FilterResult:
        """
        Return compatible devices for each requested category, given a machine.

        This is the primary API for the web app. Call it whenever the user
        changes the machine selection.
        """
        machine = self._machines_by_id.get(req.machine_id)
        if not machine:
            raise ValueError(f"Unknown machine: {req.machine_id!r}")

        categories = req.categories if req.categories else ALL_CATEGORIES

        result_cats: dict[str, list[DeviceEntry]] = {}
        for cat in categories:
            devices = self.db.get(cat, [])
            compat = [
                build_device_entry(d)
                for d in devices
                if device_is_valid(d, machine)
            ]
            if req.exclude_none:
                compat = [d for d in compat if not d.is_builtin]
            result_cats[cat] = compat

        # CPU families
        cpu_families = self.get_cpu_options(machine)

        # Machine capability flags
        flags_val = machine.get('flags_value', 0)

        return FilterResult(
            machine=machine,
            categories=result_cats,
            machine_cpu_families=cpu_families,
            machine_has_builtin_video=bool(flags_val & MACHINE_FLAG_VIDEO),
            machine_has_builtin_sound=bool(flags_val & MACHINE_FLAG_SOUND),
            machine_has_builtin_hdc=bool(flags_val & MACHINE_FLAG_HDC),
            machine_has_builtin_fdc=bool(flags_val & MACHINE_FLAG_FDC),
            machine_has_builtin_nic=bool(flags_val & MACHINE_FLAG_NIC),
        )

    # ------------------------------------------------------------------
    # Device settings
    # ------------------------------------------------------------------

    def get_device_settings(self, device_id: str, category: Optional[str] = None) -> Optional[dict]:
        """
        Return the full settings schema for a device.

        Returns a dict like:
            {
                'name': 'Sound Blaster 16',
                'internal_name': 'sb16',
                'cfg_section': 'sb16',
                'settings_panel_info': { ... },  # from SETTINGS_PANEL_INFO
                'fields': [                       # list of config fields
                    {
                        'name':        'base',
                        'description': 'Address',
                        'type':        'CONFIG_HEX16',
                        'cfg_key':     'base',
                        'default':     544,
                        'options':     [{'value': 544, 'label': '0x220'}, ...],
                        'cfg_hint':    '# Written as hex: 0x220',
                    },
                    ...
                ]
            }
        """
        device = self._devices_by_id.get(device_id)
        if not device:
            # Try searching all categories
            for cat in ALL_CATEGORIES:
                for d in self.db.get(cat, []):
                    if d.get('internal_name') == device_id:
                        device = d
                        if not category:
                            category = cat
                        break
                if device:
                    break

        if not device:
            return None

        config_fields = build_config_fields(device.get('config', []))
        panel_info = SETTINGS_PANEL_INFO.get(category or '', {})

        fields_out = []
        for cf in config_fields:
            field_dict: dict[str, Any] = {
                'name':        cf.name,
                'description': cf.description,
                'type':        cf.type,
                'cfg_key':     cf.cfg_key,
            }

            # Default value
            if cf.default_int is not None:
                field_dict['default'] = cf.default_int
                if cf.type in ('CONFIG_HEX16', 'CONFIG_HEX20'):
                    field_dict['default_hex'] = hex(cf.default_int)
                    field_dict['cfg_hint'] = f'# Written as hex: {hex(cf.default_int)}'
            if cf.default_string is not None:
                field_dict['default'] = cf.default_string

            # Options for selection
            if cf.options:
                field_dict['options'] = cf.options

            # Spinner range
            if cf.spinner:
                field_dict['min'] = cf.spinner['min']
                field_dict['max'] = cf.spinner['max']
                field_dict['step'] = cf.spinner['step']

            # BIOS variants
            if cf.bios_variants:
                field_dict['bios_variants'] = cf.bios_variants

            # File filter
            if cf.file_filter:
                field_dict['file_filter'] = cf.file_filter

            # Type hints for UI rendering
            field_dict['ui_hint'] = _get_ui_hint(cf.type)

            fields_out.append(field_dict)

        return {
            'name':          device.get('name', device_id),
            'internal_name': device_id,
            'cfg_section':   device_id,   # section name in CFG file
            'bus_flags':     device.get('flags', []),
            'settings_panel_info': panel_info,
            'fields': fields_out,
        }

    def get_device_settings_for_category(self, device_id: str, category: str) -> Optional[dict]:
        """Like get_device_settings but explicitly specifying the category."""
        return self.get_device_settings(device_id, category)

    # ------------------------------------------------------------------
    # Machine info
    # ------------------------------------------------------------------

    def get_machine_info(self, machine_id: str) -> Optional[dict]:
        """Return full information about a machine."""
        m = self._machines_by_id.get(machine_id)
        if not m:
            return None
        result = dict(m)
        result['cpu_families'] = self.get_cpu_options(m)
        result['settings_notes'] = self._get_machine_notes(m)
        return result

    def _get_machine_notes(self, m: dict) -> dict:
        flags = m.get('flags', [])
        notes: dict[str, Any] = {}
        if 'MACHINE_VIDEO' in flags:
            notes['video'] = 'Machine has built-in video; "Internal" option available'
        if 'MACHINE_VIDEO_ONLY' in flags:
            notes['video'] = 'Machine has FIXED video card; cannot be changed'
        if 'MACHINE_SOUND' in flags:
            notes['sound'] = 'Machine has built-in sound; "Internal" option available'
        if 'MACHINE_FDC' in flags:
            notes['fdc'] = 'Machine has built-in FDC; "Internal" option available'
        if 'MACHINE_PCI_INTERNAL' in flags:
            notes['pci'] = 'Machine has only internal PCI; external PCI cards excluded'
        bus_flags = m.get('bus_flags', [])
        if 'MACHINE_BUS_ISA' not in bus_flags and 'MACHINE_BUS_ISA16' not in bus_flags:
            notes['no_isa'] = 'Machine has no ISA bus; ISA cards not available'
        return notes

    # ------------------------------------------------------------------
    # Machine list
    # ------------------------------------------------------------------

    def list_machines(self, machine_type: Optional[str] = None) -> list:
        """
        Return list of all machines, optionally filtered by type.

        Each entry: { internal_name, name, type, cpu_packages, bus_flags }
        """
        machines = self.db.get('machines', [])
        if machine_type:
            machines = [m for m in machines if m.get('type') == machine_type]
        return [
            {
                'internal_name': m['internal_name'],
                'name':          m['name'],
                'type':          m.get('type', ''),
                'chipset':       m.get('chipset', ''),
                'cpu_packages':  m.get('cpu_packages', []),
                'bus_flags':     m.get('bus_flags', []),
                'has_video':     'MACHINE_VIDEO' in m.get('flags', []),
                'has_sound':     'MACHINE_SOUND' in m.get('flags', []),
            }
            for m in machines
        ]

    def get_machine_types(self) -> list:
        """Return all unique machine types with counts."""
        from collections import Counter
        counts = Counter(m.get('type', 'Unknown') for m in self.db.get('machines', []))
        return [{'type': t, 'count': c} for t, c in sorted(counts.items())]

    # ------------------------------------------------------------------
    # CPU options
    # ------------------------------------------------------------------

    def get_cpu_options(self, machine: dict) -> list:
        """Return CPU families compatible with a machine's CPU package."""
        pkg_set = set(machine.get('cpu_packages', []))
        if not pkg_set:
            return []
        families = []
        for fam in self.db.get('cpu_families', []):
            # package may be compound: "CPU_PKG_SOCKET1 | CPU_PKG_SOCKET3_PC330"
            fam_pkgs = {p.strip() for p in fam.get('package', '').split('|')}
            if fam_pkgs & pkg_set:
                cpus = [
                    {
                        'name':       cpu['name'],
                        'speed_mhz':  round(cpu['rspeed'] / 1_000_000, 2),
                        'rspeed_hz':  cpu['rspeed'],
                        'voltage_mv': cpu['voltage_mv'],
                    }
                    for cpu in fam.get('cpus', [])
                ]
                families.append({
                    'manufacturer':  fam['manufacturer'],
                    'name':          fam['name'],
                    'internal_name': fam['internal_name'],
                    'package':       fam['package'],
                    'cpus':          cpus,
                })
        return families

    # ------------------------------------------------------------------
    # Convenience: settings panel info
    # ------------------------------------------------------------------

    def get_settings_panel_info(self, category: str) -> dict:
        """
        Return documentation about what the QT settings panel does for this
        category, what CFG keys it reads/writes, and any extra options.
        """
        return SETTINGS_PANEL_INFO.get(category, {})

    # ------------------------------------------------------------------
    # Serialization (for REST API responses)
    # ------------------------------------------------------------------

    def filter_to_json(self, req: FilterRequest, indent: int = 2) -> str:
        """Run filter() and return JSON-serializable result."""
        result = self.filter(req)
        out: dict[str, Any] = {
            'machine': {
                'internal_name': result.machine['internal_name'],
                'name':          result.machine['name'],
                'type':          result.machine.get('type'),
                'bus_flags':     result.machine['bus_flags'],
                'flags':         result.machine['flags'],
                'ram':           result.machine.get('ram'),
                'cpu_packages':  result.machine.get('cpu_packages', []),
                'has_builtin_video': result.machine_has_builtin_video,
                'has_builtin_sound': result.machine_has_builtin_sound,
                'has_builtin_hdc':   result.machine_has_builtin_hdc,
                'has_builtin_fdc':   result.machine_has_builtin_fdc,
                'has_builtin_nic':   result.machine_has_builtin_nic,
            },
            'cpu_families': result.machine_cpu_families,
            'categories':   {}
        }
        for cat, devices in result.categories.items():
            out['categories'][cat] = [
                {
                    'name':          d.name,
                    'internal_name': d.internal_name,
                    'display_name':  d.display_name,
                    'bus_flags':     d.bus_flags,
                    'has_config':    d.has_config,
                    'is_builtin':    d.is_builtin,
                    'config':        [
                        {
                            'name':        cf.name,
                            'description': cf.description,
                            'type':        cf.type,
                            'cfg_key':     cf.cfg_key,
                            'default':     cf.default_int if cf.default_string is None else cf.default_string,
                            'options':     cf.options,
                            'spinner':     cf.spinner,
                        }
                        for cf in d.config
                    ],
                }
                for d in devices
            ]
        return json.dumps(out, indent=indent)


# ---------------------------------------------------------------------------
# UI hint for config field types
# ---------------------------------------------------------------------------

def _get_ui_hint(config_type: str) -> str:
    return {
        'CONFIG_INT':        'number input',
        'CONFIG_BINARY':     'checkbox',
        'CONFIG_SELECTION':  'dropdown / radio buttons',
        'CONFIG_MIDI_OUT':   'MIDI device dropdown',
        'CONFIG_MIDI_IN':    'MIDI device dropdown',
        'CONFIG_SPINNER':    'number spinner with min/max/step',
        'CONFIG_MEMORY':     'memory size spinner',
        'CONFIG_STRING':     'text input',
        'CONFIG_FNAME':      'file picker',
        'CONFIG_SERPORT':    'serial port dropdown',
        'CONFIG_BIOS':       'BIOS variant dropdown',
        'CONFIG_HEX16':      'hex number input (16-bit)',
        'CONFIG_HEX20':      'hex number input (20-bit)',
        'CONFIG_MAC':        'MAC address input (xx:xx:xx:xx:xx:xx)',
    }.get(config_type, 'text input')


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description='86Box Hardware Compatibility Filter',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    ap.add_argument('--db', default='86box_hardware_db.json',
                    help='Path to hardware database JSON (default: 86box_hardware_db.json)')
    ap.add_argument('--machine', help='Machine internal_name (e.g. ibmpc)')
    ap.add_argument('--categories', nargs='+', choices=ALL_CATEGORIES,
                    help='Categories to filter (default: all)')
    ap.add_argument('--all-categories', action='store_true',
                    help='Filter all categories')
    ap.add_argument('--device-settings', metavar='DEVICE_ID',
                    help='Show settings schema for a device internal_name')
    ap.add_argument('--list-machines', action='store_true',
                    help='List all machines (optionally filter by --type)')
    ap.add_argument('--type', dest='machine_type',
                    help='Filter machines by type (e.g. MACHINE_TYPE_SOCKET7)')
    ap.add_argument('--machine-types', action='store_true',
                    help='List all machine types with counts')
    ap.add_argument('--json', action='store_true',
                    help='Output as JSON (for REST API integration)')
    ap.add_argument('--exclude-none', action='store_true',
                    help='Exclude None/Internal entries from results')
    ap.add_argument('--settings-panel', choices=list(SETTINGS_PANEL_INFO.keys()),
                    help='Show QT settings panel analysis for a category')
    args = ap.parse_args()

    try:
        f = HardwareFilter.from_file(args.db)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # List machines
    if args.list_machines:
        machines = f.list_machines(machine_type=args.machine_type)
        if args.json:
            print(json.dumps(machines, indent=2))
        else:
            print(f"{'Internal Name':<30} {'Name':<60} {'Type'}")
            print('-' * 100)
            for m in machines:
                print(f"{m['internal_name']:<30} {m['name']:<60} {m['type']}")
        return

    if args.machine_types:
        types = f.get_machine_types()
        for t in types:
            print(f"{t['type']:<40} {t['count']:3d} machines")
        return

    # Show settings panel info
    if args.settings_panel:
        info = SETTINGS_PANEL_INFO.get(args.settings_panel, {})
        print(json.dumps(info, indent=2))
        return

    # Device settings schema
    if args.device_settings:
        settings = f.get_device_settings(args.device_settings)
        if not settings:
            print(f"Device '{args.device_settings}' not found.", file=sys.stderr)
            sys.exit(1)
        if args.json:
            print(json.dumps(settings, indent=2))
        else:
            print(f"\nSettings schema for: {settings['name']}")
            print(f"CFG section: [{settings['cfg_section']}]")
            print('=' * 60)
            for fld in settings['fields']:
                print(f"\n  Key:         {fld['cfg_key']}")
                print(f"  Description: {fld['description']}")
                print(f"  Type:        {fld['type']} → {fld.get('ui_hint', '?')}")
                if 'default' in fld:
                    dflt = fld['default']
                    if 'default_hex' in fld:
                        print(f"  Default:     {dflt} ({fld['default_hex']})")
                    else:
                        print(f"  Default:     {dflt}")
                if fld.get('options'):
                    print(f"  Options:")
                    for opt in fld['options']:
                        mark = ' ◀ default' if opt['value'] == fld.get('default') else ''
                        print(f"    {opt['value']:8}  {opt['label']}{mark}")
                if fld.get('min') is not None:
                    print(f"  Range:       {fld['min']} – {fld['max']} (step {fld['step']})")
                if fld.get('bios_variants'):
                    print(f"  BIOS options:")
                    for b in fld['bios_variants']:
                        print(f"    • {b['name']} (id: {b['internal_name']})")
        return

    # Machine compatibility filter
    if not args.machine:
        ap.print_help()
        return

    categories = args.categories if args.categories else (ALL_CATEGORIES if args.all_categories else ALL_CATEGORIES)

    req = FilterRequest(
        machine_id=args.machine,
        categories=categories,
        exclude_none=args.exclude_none,
    )

    try:
        result = f.filter(req)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(f.filter_to_json(req))
        return

    # Human-readable output
    m = result.machine
    print(f"\n{'='*60}")
    print(f"Machine: {m['name']}")
    print(f"ID:      {m['internal_name']}")
    print(f"Type:    {m.get('type', '?')}")
    print(f"Buses:   {', '.join(m['bus_flags']) or 'none'}")
    print(f"Flags:   {', '.join(m['flags']) or 'none'}")
    print(f"CPU:     {', '.join(m.get('cpu_packages', [])) or '?'}")
    ram = m.get('ram', {})
    print(f"RAM:     {ram.get('min_kb',0)}KB – {ram.get('max_kb',0)}KB (step {ram.get('step_kb',0)}KB)")
    print(f"{'='*60}")

    for cat, devices in result.categories.items():
        label = CATEGORY_LABELS.get(cat, cat)
        print(f"\n{label}s ({len(devices)}):")
        print('-' * 40)
        for d in devices:
            cfg_mark = ' [cfg]' if d.has_config else ''
            if d.is_builtin:
                bus = 'built-in'
            elif d.bus_flags:
                bus = get_primary_bus(d.bus_flags)
            else:
                bus = 'Standard'  # bus-agnostic (e.g. CD-ROM drive models)
            print(f"  {d.name:<55} ({bus}){cfg_mark}")

    # CPU options
    if result.machine_cpu_families:
        print(f"\nCPU Options:")
        print('-' * 40)
        for fam in result.machine_cpu_families:
            print(f"  {fam['manufacturer']} {fam['name']}:")
            for cpu in fam['cpus']:
                print(f"    • {cpu['name']:<12} {cpu['speed_mhz']:.2f} MHz")


if __name__ == '__main__':
    main()
