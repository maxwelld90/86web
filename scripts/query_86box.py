#!/usr/bin/env python3
"""
86Box Hardware Compatibility Query Tool
=======================================
Interactive CLI for exploring the 86Box hardware database.

Usage:
    python3 query_86box.py [--db 86box_hardware_db.json]

    Then follow the prompts to select a machine and browse compatible hardware.
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Compatibility engine (mirrors the C source logic exactly)
# ---------------------------------------------------------------------------

DEVICE_BUS_MASK      = 0x001FFFFF  # DEVICE_BUS in device.h
MACHINE_PCI_INTERNAL = 0x00200000  # machines with only internal PCI bus

def device_is_valid(device: dict, machine: dict) -> bool:
    """
    Python implementation of device_is_valid() from device.c:

        int device_is_valid(const device_t *device, int mch) {
            int ret = 1;
            if ((device != NULL) && ((device->flags & DEVICE_BUS) != 0)) {
                if ((device->flags & DEVICE_PCI) &&
                    machine_has_flags(mch, MACHINE_PCI_INTERNAL))
                    ret = 0;
                else
                    ret = machine_has_bus(mch, device->flags & DEVICE_BUS);
            }
            return ret;
        }
    """
    dev_bus = device.get('flags_value', 0) & DEVICE_BUS_MASK

    if dev_bus == 0:
        # No bus requirement — always valid (covers device_none/device_internal)
        return True

    # PCI device on machine with only internal PCI → excluded
    DEVICE_PCI = 0x00010000
    if (device.get('flags_value', 0) & DEVICE_PCI) and \
       (machine.get('flags_value', 0) & MACHINE_PCI_INTERNAL):
        return False

    # machine_has_bus: machines[m].bus_flags & bus_flags
    return bool(machine.get('bus_flags_value', 0) & dev_bus)


# ---------------------------------------------------------------------------
# Database wrapper
# ---------------------------------------------------------------------------

class HardwareDB:
    def __init__(self, db_path: str):
        path = Path(db_path)
        if not path.exists():
            print(f"Error: database file '{db_path}' not found.")
            print("Run parse_86box.py first to generate the database.")
            sys.exit(1)
        with open(path, encoding='utf-8') as f:
            self.db = json.load(f)

        # Build lookup dicts
        self.machines_by_name = {m['name']: m for m in self.db['machines']}
        self.machines_by_id   = {m['internal_name']: m for m in self.db['machines']}

    def get_categories(self) -> list:
        return [c for c in self.db.get('metadata', {}).get('categories', [])
                if c not in ('machines', 'cpu_families', 'metadata')]

    def get_compatible(self, machine: dict, category: str) -> list:
        """Return all devices in category that are compatible with machine."""
        devices = self.db.get(category, [])
        return [d for d in devices if device_is_valid(d, machine)]

    def get_cpu_families_for_machine(self, machine: dict) -> list:
        """Return CPU families whose package matches the machine's cpu_packages.

        A family's package field may be compound e.g. "CPU_PKG_SOCKET1 | CPU_PKG_SOCKET3_PC330",
        meaning the CPU physically fits in any of those sockets. We split on '|' and
        check for any overlap with the machine's supported sockets.
        """
        pkg_set = set(machine.get('cpu_packages', []))
        if not pkg_set:
            return []
        result = []
        for fam in self.db.get('cpu_families', []):
            fam_pkgs = {p.strip() for p in fam.get('package', '').split('|')}
            if fam_pkgs & pkg_set:
                result.append(fam)
        return result

    def search_machines(self, query: str) -> list:
        query_lower = query.lower()
        return [m for m in self.db['machines']
                if query_lower in m['name'].lower() or
                   query_lower in m['internal_name'].lower()]

    def get_all_cpu_packages(self) -> list:
        """Return all unique CPU socket/package types, sorted.

        Splits compound package strings (e.g. "CPU_PKG_SOCKET1 | CPU_PKG_SOCKET3_PC330")
        so each socket type appears as an individual entry.
        """
        packages = set()
        for fam in self.db.get('cpu_families', []):
            for pkg in fam.get('package', '').split('|'):
                pkg = pkg.strip()
                if pkg:
                    packages.add(pkg)
        return sorted(packages)

    def get_machines_for_package(self, package: str) -> list:
        """Return all machines that accept this CPU socket/package."""
        return [m for m in self.db['machines']
                if package in m.get('cpu_packages', [])]

    def get_compatible_machines(self, device: dict) -> list:
        """Return all machines that this device is compatible with."""
        return [m for m in self.db['machines']
                if device_is_valid(device, m)]


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

CATEGORY_LABELS = {
    'video_cards':     'Video Cards',
    'sound_cards':     'Sound Cards',
    'network_cards':   'Network Cards',
    'hdc':             'Hard Disk Controllers',
    'scsi':            'SCSI Controllers',
    'fdc':             'Floppy Disk Controllers',
    'cdrom_interface': 'CD-ROM Interfaces',
    'cdrom_drive_types': 'CD-ROM Drive Models',
    'isartc':          'ISA Real-Time Clock Cards',
    'isamem':          'ISA Memory Expansion Cards',
    'cpu_families':    'CPU Families',
}

BUS_FLAG_LABELS = {
    'DEVICE_ISA':    'ISA (8-bit)',
    'DEVICE_ISA16':  'ISA (16-bit)',
    'DEVICE_MCA':    'MCA',
    'DEVICE_MCA32':  'MCA 32-bit',
    'DEVICE_EISA':   'EISA',
    'DEVICE_VLB':    'VLB (VESA Local Bus)',
    'DEVICE_PCI':    'PCI',
    'DEVICE_AGP':    'AGP',
    'DEVICE_PCMCIA': 'PCMCIA',
    'DEVICE_AC97':   'AC\'97',
    'DEVICE_COM':    'Serial port',
    'DEVICE_LPT':    'Parallel port',
}

CONFIG_TYPE_DESCRIPTIONS = {
    'CONFIG_INT':        'Integer value',
    'CONFIG_BINARY':     'On/Off toggle',
    'CONFIG_SELECTION':  'Selection from list',
    'CONFIG_MIDI_OUT':   'MIDI output device',
    'CONFIG_MIDI_IN':    'MIDI input device',
    'CONFIG_SPINNER':    'Spinner (range)',
    'CONFIG_MEMORY':     'Memory size',
    'CONFIG_STRING':     'Text string',
    'CONFIG_FNAME':      'File path',
    'CONFIG_SERPORT':    'Serial port',
    'CONFIG_BIOS':       'BIOS selection',
    'CONFIG_HEX16':      'Hex value (16-bit)',
    'CONFIG_HEX20':      'Hex value (20-bit)',
    'CONFIG_MAC':        'MAC address',
}


def hr(char='-', width=60):
    print(char * width)


def print_device_info(device: dict, show_config: bool = False):
    name = device.get('name', '?')
    flags = device.get('flags', [])
    flags_value = device.get('flags_value', 0)

    bus_labels = [BUS_FLAG_LABELS.get(f, f) for f in flags
                  if f in BUS_FLAG_LABELS and not f.startswith('DEVICE_KBC')
                  and not f.startswith('DEVICE_PIT') and not f.startswith('DEVICE_ONBOARD')]

    bus_str = ', '.join(bus_labels) if bus_labels else 'Built-in / No bus'
    config_count = len(device.get('config', []))
    has_config = '✓' if config_count > 0 else ''

    print(f"  {name:<55} [{bus_str}] {has_config}")

    if show_config and device.get('config'):
        print_device_config(device)


def print_device_config(device: dict):
    """Print detailed configuration options for a device."""
    config = device.get('config', [])
    if not config:
        print("    No configurable settings.")
        return

    print(f"\n    ── Configuration for: {device['name']} ──")
    print(f"    CFG section: [{device.get('internal_name', '?')}]")
    print()

    for entry in config:
        etype = entry.get('type', 'CONFIG_INT')
        ename = entry.get('name', '')
        edesc = entry.get('description', ename)
        type_label = CONFIG_TYPE_DESCRIPTIONS.get(etype, etype)

        print(f"    • {edesc} (key: {ename!r})")
        print(f"      Type: {type_label}")

        if 'default_int' in entry:
            print(f"      Default: {entry['default_int']}")
        if 'default_string' in entry:
            print(f"      Default: {entry['default_string']!r}")

        if entry.get('selection'):
            print(f"      Options:")
            for sel in entry['selection']:
                mark = " ◀ default" if sel['value'] == entry.get('default_int') else ''
                print(f"        [{sel['value']:6}]  {sel['description']}{mark}")

        if entry.get('bios'):
            print(f"      BIOS variants:")
            for bios in entry['bios']:
                print(f"        • {bios['name']} (id: {bios['internal_name']!r})")

        if entry.get('spinner'):
            sp = entry['spinner']
            print(f"      Range: {sp['min']} – {sp['max']} (step {sp['step']})")

        if etype in ('CONFIG_HEX16', 'CONFIG_HEX20') and 'default_int' in entry:
            print(f"      Default hex: {hex(entry['default_int'])}")

        print()


def print_machine_info(machine: dict):
    hr('=')
    print(f"  Machine: {machine['name']}")
    print(f"  ID:      {machine['internal_name']}")
    print(f"  Type:    {machine['type']}")
    hr('-')
    print(f"  Buses:   {', '.join(machine['bus_flags']) or 'None'}")
    print(f"  Flags:   {', '.join(machine['flags']) or 'None'}")
    print(f"  CPU:     {', '.join(machine['cpu_packages']) or 'Unknown'}")
    ram = machine.get('ram', {})
    print(f"  RAM:     {ram.get('min_kb', 0)}KB – {ram.get('max_kb', 0)}KB (step {ram.get('step_kb', 0)}KB)")

    builtin = machine.get('builtin_devices', {})
    if builtin:
        print(f"  Built-in:")
        for k, v in builtin.items():
            print(f"    {k}: {v}")
    hr('=')


# ---------------------------------------------------------------------------
# Interactive CLI
# ---------------------------------------------------------------------------

def pick_from_list(items: list, label: str, display_fn=None) -> Optional[int]:
    """Present a numbered list and return the chosen index, or None to go back."""
    if not items:
        print(f"  (No {label} available)")
        return None

    print()
    for i, item in enumerate(items):
        if display_fn:
            display_fn(i, item)
        else:
            print(f"  [{i:3d}] {item}")

    print()
    while True:
        raw = input(f"Select {label} number (or 'b' to go back, 'q' to quit): ").strip()
        if raw.lower() in ('b', 'back', ''):
            return None
        if raw.lower() in ('q', 'quit', 'exit'):
            sys.exit(0)
        try:
            idx = int(raw)
            if 0 <= idx < len(items):
                return idx
            print(f"  Please enter a number between 0 and {len(items) - 1}")
        except ValueError:
            print("  Invalid input.")


def browse_by_cpu_package(db: HardwareDB) -> Optional[dict]:
    """Browse machines by CPU socket/package type; optionally select one."""
    packages = db.get_all_cpu_packages()
    if not packages:
        print("  No CPU package data available.")
        return None

    print("\nBrowse by CPU Socket / Package")
    hr()
    for i, pkg in enumerate(packages):
        count = len(db.get_machines_for_package(pkg))
        print(f"  [{i:3d}] {pkg:<30} ({count} machines)")

    idx = pick_from_list(packages, "socket", lambda i, p: None)
    if idx is None:
        return None

    package = packages[idx]
    machines = db.get_machines_for_package(package)

    # Also collect which CPU families match this package for display
    families = [f"{f['manufacturer']} {f['name']}"
                for f in db.db.get('cpu_families', [])
                if f.get('package') == package]
    fam_str = ', '.join(families[:3])
    if len(families) > 3:
        fam_str += f' (+{len(families)-3} more)'

    print(f"\nMachines with {package} socket  (CPUs: {fam_str})")
    hr()

    def show_machine(i, m):
        mtype = m.get('type', '?')
        print(f"  [{i:3d}] {m['name']:<55} {mtype}")

    m_idx = pick_from_list(machines, "machine", show_machine)
    if m_idx is None:
        return None
    return machines[m_idx]


def find_machines_for_device(db: HardwareDB):
    """Reverse lookup: pick a device and show all compatible machines."""
    categories = db.get_categories()
    # cdrom_drive_types have no bus flags so skip them here
    cat_options = [(c, CATEGORY_LABELS.get(c, c)) for c in categories
                   if c != 'cdrom_drive_types']

    print("\nFind Compatible Machines for a Device")
    hr()
    print("Select a hardware category:")
    for i, (cat, label) in enumerate(cat_options):
        total = len(db.db.get(cat, []))
        print(f"  [{i:2d}] {label:<40} ({total} total)")

    idx = pick_from_list(cat_options, "category", lambda i, c: None)
    if idx is None:
        return

    cat, label = cat_options[idx]
    all_devices = db.db.get(cat, [])

    def show_dev(i, d):
        flags = d.get('flags', [])
        bus_flags = [f for f in flags if f in BUS_FLAG_LABELS]
        bus_str = BUS_FLAG_LABELS.get(bus_flags[0], bus_flags[0]) if bus_flags else 'Built-in'
        print(f"  [{i:3d}] {d.get('name', '?'):<50} {bus_str}")

    dev_idx = pick_from_list(all_devices, "device", show_dev)
    if dev_idx is None:
        return

    device = all_devices[dev_idx]
    compat_machines = db.get_compatible_machines(device)

    print(f"\nMachines compatible with: {device['name']}")
    hr()
    print(f"  Found {len(compat_machines)} compatible machines")
    hr('-')

    # Group by type
    type_groups: dict[str, list] = {}
    for m in compat_machines:
        t = m.get('type', 'Unknown')
        type_groups.setdefault(t, []).append(m)

    for t in sorted(type_groups.keys()):
        print(f"\n  {t}:")
        for m in type_groups[t]:
            pkgs = ', '.join(m.get('cpu_packages', [])) or 'Unknown'
            print(f"    {m['name']:<52} CPU socket: {pkgs}")

    input("\nPress Enter to continue...")


def search_and_select_machine(db: HardwareDB) -> Optional[dict]:
    """Search for and select a machine."""
    all_machines = db.db['machines']

    print("\nMachine Selection")
    hr()
    print("Options:")
    print("  1. Browse all machines by type")
    print("  2. Search by name")
    print("  3. Enter internal name directly")
    print("  4. Browse by CPU socket / package")
    print()

    choice = input("Choice (1/2/3/4): ").strip()

    if choice == '1':
        # Group by type
        type_groups: dict[str, list] = {}
        for m in all_machines:
            t = m.get('type', 'Unknown')
            type_groups.setdefault(t, []).append(m)

        type_names = sorted(type_groups.keys())
        print()
        for i, t in enumerate(type_names):
            print(f"  [{i:3d}] {t} ({len(type_groups[t])} machines)")

        idx = pick_from_list(type_names, "machine type")
        if idx is None:
            return None

        machines_in_type = type_groups[type_names[idx]]
        idx2 = pick_from_list(
            machines_in_type,
            "machine",
            lambda i, m: print(f"  [{i:3d}] {m['name']}")
        )
        if idx2 is None:
            return None
        return machines_in_type[idx2]

    elif choice == '2':
        query = input("Search query: ").strip()
        results = db.search_machines(query)
        if not results:
            print(f"  No machines found matching '{query}'")
            return None
        idx = pick_from_list(
            results,
            "machine",
            lambda i, m: print(f"  [{i:3d}] {m['name']}")
        )
        if idx is None:
            return None
        return results[idx]

    elif choice == '3':
        iname = input("Internal name: ").strip()
        m = db.machines_by_id.get(iname)
        if not m:
            print(f"  Machine '{iname}' not found.")
        return m

    elif choice == '4':
        return browse_by_cpu_package(db)

    return None


def view_category(db: HardwareDB, machine: dict, category: str):
    """Browse compatible devices in a category."""
    label = CATEGORY_LABELS.get(category, category)
    devices = db.get_compatible(machine, category)

    print(f"\n{label} compatible with {machine['name']}")
    hr()
    print(f"  Found {len(devices)} compatible devices")
    hr('-')

    if not devices:
        return

    # Show list
    def show_item(i, d):
        name = d.get('name', '?')
        flags = d.get('flags', [])
        bus_flags = [f for f in flags if f in BUS_FLAG_LABELS]
        bus_str = BUS_FLAG_LABELS.get(bus_flags[0], bus_flags[0]) if bus_flags else 'Built-in'
        has_config = '[cfg]' if d.get('config') else '     '
        print(f"  [{i:3d}] {has_config} {name:<50} {bus_str}")

    if category == 'cdrom_drive_types':
        # Special display for CD-ROM drives
        for i, d in enumerate(devices):
            spd = d.get('speed_x', 0)
            dvd = ' (DVD)' if d.get('is_dvd') else ''
            spd_str = f'{spd}x' if spd > 0 else 'speed?'
            print(f"  [{i:3d}] {d.get('vendor', '?'):10} {d.get('model', '?'):25} "
                  f"{d.get('revision', '?'):6} {spd_str}{dvd}")

        idx = pick_from_list(devices, "drive")
        if idx is not None:
            d = devices[idx]
            print(f"\n  Drive: {d.get('display_name', d.get('model', '?'))}")
            print(f"  Internal name: {d.get('internal_name', '?')}")
            print(f"  Speed: {d.get('speed_x', 0)}x{'  (DVD)' if d.get('is_dvd') else ''}")
        return

    idx = pick_from_list(devices, "device", show_item)
    if idx is None:
        return

    # Show detail view with config
    selected = devices[idx]
    print()
    hr('=')
    print_device_info(selected, show_config=True)
    hr('=')
    input("\nPress Enter to continue...")


def view_cpus(db: HardwareDB, machine: dict):
    """Show CPU families for the machine."""
    families = db.get_cpu_families_for_machine(machine)

    print(f"\nCPU Families for {machine['name']}")
    hr()

    if not families:
        pkgs = machine.get('cpu_packages', [])
        print(f"  No matching CPU families found (packages: {pkgs})")
        return

    for fam in families:
        print(f"\n  {fam['manufacturer']} {fam['name']}  (package: {fam['package']})")
        cpus = fam.get('cpus', [])
        for cpu in cpus:
            mhz = cpu['rspeed'] / 1_000_000
            print(f"    • {cpu['name']:<15} {mhz:.2f} MHz  (voltage: {cpu['voltage_mv']}mV)")

    input("\nPress Enter to continue...")


def main_loop(db: HardwareDB):
    """Main interactive loop."""
    current_machine: Optional[dict] = None

    categories = db.get_categories()
    cat_options = [(c, CATEGORY_LABELS.get(c, c)) for c in categories]

    while True:
        print()
        hr('=')
        if current_machine:
            print(f"  Current machine: {current_machine['name']}")
        else:
            print("  No machine selected")
        hr('=')
        print()
        print("  [1] Select / change machine")
        if current_machine:
            print("  [2] Show machine details")
            print("  [3] Browse compatible hardware by category")
            print("  [4] Show compatible CPUs")
            print("  [5] Run compatibility check (all categories summary)")
        print("  [6] Browse machines by CPU socket / package")
        print("  [7] Find compatible machines for a device")
        print("  [q] Quit")
        print()

        choice = input("Choice: ").strip().lower()

        if choice in ('q', 'quit', 'exit'):
            break

        elif choice == '1':
            m = search_and_select_machine(db)
            if m:
                current_machine = m
                print(f"\n  Selected: {m['name']}")

        elif choice == '2' and current_machine:
            print_machine_info(current_machine)
            input("\nPress Enter to continue...")

        elif choice == '3' and current_machine:
            print("\nCategories:")
            for i, (cat, label) in enumerate(cat_options):
                n = len(db.get_compatible(current_machine, cat))
                print(f"  [{i:2d}] {label:<40} ({n} compatible)")
            idx = pick_from_list(cat_options, "category", lambda i, c: None)
            if idx is not None:
                view_category(db, current_machine, cat_options[idx][0])

        elif choice == '4' and current_machine:
            view_cpus(db, current_machine)

        elif choice == '5' and current_machine:
            print(f"\n  Compatibility summary for: {current_machine['name']}")
            hr()
            for cat, label in cat_options:
                compat = db.get_compatible(current_machine, cat)
                total = len(db.db.get(cat, []))
                print(f"  {label:<40} {len(compat):3d} / {total:3d} compatible")
            input("\nPress Enter to continue...")

        elif choice == '6':
            m = browse_by_cpu_package(db)
            if m:
                current_machine = m
                print(f"\n  Selected: {m['name']}")

        elif choice == '7':
            find_machines_for_device(db)

        elif not current_machine and choice in ('2', '3', '4', '5'):
            print("  Please select a machine first.")

        else:
            print("  Invalid choice.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _default_db_path() -> str:
    """
    Resolve the default database path.

    Search order (first existing file wins):
      1. /data/cache/86box_hardware_db.json  — runtime-generated path inside the container
      2. /app/app/86box_hardware_db.json     — bundled fallback inside the container
      3. ./86box_hardware_db.json             — local dev / standalone use
    """
    candidates = [
        Path('/data/cache/86box_hardware_db.json'),
        Path('/app/app/86box_hardware_db.json'),
        Path(__file__).parent.parent / 'backend' / 'app' / '86box_hardware_db.json',
        Path('86box_hardware_db.json'),
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return '86box_hardware_db.json'  # let it fail with a clear error


def main():
    parser = argparse.ArgumentParser(
        description='Browse 86Box hardware compatibility database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Interactive browser (auto-finds the DB)
  86box-query

  # List all machine internal names
  86box-query --list-machines

  # Show compatible video cards for a specific machine
  86box-query --machine ibmpc --category video_cards

  # Override the database path
  86box-query --db /path/to/86box_hardware_db.json
""",
    )
    parser.add_argument('--db', default=None,
                        help='Path to hardware database JSON (default: auto-detect)')
    parser.add_argument('--machine', help='Start with a specific machine internal_name')
    parser.add_argument('--category', help='Show one category and exit (non-interactive)')
    parser.add_argument('--list-machines', action='store_true',
                        help='Print all machine names and exit')
    args = parser.parse_args()

    db_path = args.db or _default_db_path()
    db = HardwareDB(db_path)

    if args.list_machines:
        for m in db.db['machines']:
            print(f"{m['internal_name']:<30} {m['name']}")
        return

    if args.machine and args.category:
        # Non-interactive mode
        machine = db.machines_by_id.get(args.machine)
        if not machine:
            print(f"Machine '{args.machine}' not found.")
            sys.exit(1)
        print_machine_info(machine)
        devices = db.get_compatible(machine, args.category)
        label = CATEGORY_LABELS.get(args.category, args.category)
        print(f"\n{label} compatible with {machine['name']} ({len(devices)} total):")
        hr()
        for d in devices:
            print_device_info(d)
        return

    # Interactive mode
    print()
    print("=" * 60)
    print("  86Box Hardware Compatibility Browser")
    print("=" * 60)
    print(f"  Database: {db_path}")
    print(f"  Machines: {len(db.db['machines'])}")
    print(f"  Video:    {len(db.db.get('video_cards', []))} cards")
    print(f"  Sound:    {len(db.db.get('sound_cards', []))} cards")
    print(f"  Network:  {len(db.db.get('network_cards', []))} cards")
    print(f"  HDC:      {len(db.db.get('hdc', []))} controllers")
    print(f"  SCSI:     {len(db.db.get('scsi', []))} controllers")
    print("=" * 60)

    if args.machine:
        current_machine = db.machines_by_id.get(args.machine)
        if current_machine:
            print(f"\nAuto-selected machine: {current_machine['name']}")
    else:
        current_machine = None

    # Patch main_loop to start with pre-selected machine
    if current_machine:
        orig_main_loop = main_loop
        db._start_machine = current_machine
        # Inline the loop with pre-selection
        main_loop_with_machine(db, current_machine)
    else:
        main_loop(db)


def main_loop_with_machine(db: HardwareDB, start_machine: dict):
    """Main loop with a pre-selected machine."""
    # Just reuse main_loop but pre-populate
    import types

    # Monkey-patch to pre-select machine
    current_machine = start_machine
    categories = db.get_categories()
    cat_options = [(c, CATEGORY_LABELS.get(c, c)) for c in categories]

    while True:
        print()
        hr('=')
        print(f"  Current machine: {current_machine['name']}")
        hr('=')
        print()
        print("  [1] Select / change machine")
        print("  [2] Show machine details")
        print("  [3] Browse compatible hardware by category")
        print("  [4] Show compatible CPUs")
        print("  [5] Run compatibility check (all categories summary)")
        print("  [6] Browse machines by CPU socket / package")
        print("  [7] Find compatible machines for a device")
        print("  [q] Quit")
        print()

        choice = input("Choice: ").strip().lower()

        if choice in ('q', 'quit', 'exit'):
            break
        elif choice == '1':
            m = search_and_select_machine(db)
            if m:
                current_machine = m
        elif choice == '2':
            print_machine_info(current_machine)
            input("\nPress Enter to continue...")
        elif choice == '3':
            print("\nCategories:")
            for i, (cat, label) in enumerate(cat_options):
                n = len(db.get_compatible(current_machine, cat))
                print(f"  [{i:2d}] {label:<40} ({n} compatible)")
            idx = pick_from_list(cat_options, "category", lambda i, c: None)
            if idx is not None:
                view_category(db, current_machine, cat_options[idx][0])
        elif choice == '4':
            view_cpus(db, current_machine)
        elif choice == '5':
            print(f"\n  Compatibility summary for: {current_machine['name']}")
            hr()
            for cat, label in cat_options:
                compat = db.get_compatible(current_machine, cat)
                total = len(db.db.get(cat, []))
                print(f"  {label:<40} {len(compat):3d} / {total:3d} compatible")
            input("\nPress Enter to continue...")
        elif choice == '6':
            m = browse_by_cpu_package(db)
            if m:
                current_machine = m
                print(f"\n  Selected: {m['name']}")
        elif choice == '7':
            find_machines_for_device(db)
        else:
            print("  Invalid choice.")


if __name__ == '__main__':
    main()
