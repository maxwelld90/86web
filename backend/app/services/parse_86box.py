#!/usr/bin/env python3
"""
86Box Hardware Compatibility Database Builder
=============================================
Parses the 86Box source tree and produces a JSON database of all hardware
components, their bus requirements, and configuration options.

Usage:
    python3 parse_86box.py [--src /path/to/86box/src] [--out hardware_db.json]

Author: Generated for 86Box web UI compatibility layer
"""

import os
import re
import json
import sys
import argparse
from pathlib import Path
from typing import Optional, Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEVICE_BUS_MASK = 0x1FFFFF  # DEVICE_BUS in device.h

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip_comments(text: str) -> str:
    """Remove C block and line comments, preserving newlines for line count."""
    # Block comments
    text = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group().count('\n'), text, flags=re.DOTALL)
    # Line comments
    text = re.sub(r'//[^\n]*', '', text)
    return text


def strip_preprocessor(text: str) -> str:
    """Remove #ifdef / #if 0 blocks (simple pass — keeps #define lines)."""
    # Remove #if 0 ... #endif blocks
    text = re.sub(r'#if\s+0\b.*?#endif', '', text, flags=re.DOTALL)
    return text


def extract_balanced_braces(text: str, start: int) -> str:
    """
    Extract the substring from text[start] through the matching closing brace.
    text[start] must be '{'.
    Returns the full balanced {…} string, or empty string on failure.
    """
    if start >= len(text) or text[start] != '{':
        return ''
    depth = 0
    i = start
    in_string = False
    escape = False
    while i < len(text):
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == '\\':
                escape = True
            elif c == '"':
                in_string = False
        else:
            if c == '"':
                in_string = True
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        i += 1
    return text[start:]  # unbalanced, return rest


def get_string_field(body: str, field: str) -> str:
    m = re.search(rf'\.{field}\s*=\s*"((?:[^"\\]|\\.)*)"', body)
    return m.group(1) if m else ''


def get_raw_field(body: str, field: str) -> str:
    """Get the raw (non-string) value of a .field = value assignment."""
    m = re.search(rf'\.{field}\s*=\s*([^,;\n{{}}]+)', body)
    return m.group(1).strip() if m else ''


# ---------------------------------------------------------------------------
# Macro / constant resolver
# ---------------------------------------------------------------------------

class MacroResolver:
    """
    Resolves C preprocessor #define macros to integer values.
    Handles expressions like:  MACHINE_PCI | MACHINE_AT
    or: (MACHINE_BUS_ISA | MACHINE_BUS_ISA16)
    """

    def __init__(self):
        self._defs: dict[str, str] = {}     # name → raw expression string
        self._cache: dict[str, int] = {}    # name → resolved int

    def load_file(self, path: Path) -> None:
        text = path.read_text(encoding='utf-8', errors='replace')
        text = strip_comments(text)
        # Match:  #define NAME expr  (stopping before a comment or newline)
        # Allow multi-token expr (bitwise | combinations, parentheses, integers)
        pattern = r'^\s*#\s*define\s+(\w+)\s+(.+?)\s*$'
        for m in re.finditer(pattern, text, re.MULTILINE):
            name, val = m.group(1), m.group(2).strip()
            # Skip function-like macros
            if '(' in name:
                continue
            self._defs[name] = val
            self._cache.pop(name, None)
        # Also parse C enum definitions
        self._parse_enums(text)

    def _parse_enums(self, text: str) -> None:
        """Parse C enum definitions and resolve their sequential/explicit values."""
        for enum_m in re.finditer(r'\benum\b\s*(?:\w+\s*)?\{([^}]+)\}', text, re.DOTALL):
            body = enum_m.group(1)
            counter = 0
            for item in re.split(r',', body):
                item = item.strip()
                if not item or item.startswith('//') or item.startswith('/*'):
                    continue
                eq_m = re.match(r'(\w+)\s*=\s*(.+)', item)
                if eq_m:
                    name = eq_m.group(1)
                    val_str = eq_m.group(2).strip()
                    val = self._eval(val_str, set())
                    if val is not None:
                        counter = val
                        self._defs[name] = str(val)
                        self._cache[name] = val
                    else:
                        self._defs[name] = val_str
                        self._cache.pop(name, None)
                        counter += 1
                        continue
                else:
                    name = item.split()[0] if item.split() else ''
                    if name and re.match(r'^[A-Za-z_]\w*$', name):
                        self._defs[name] = str(counter)
                        self._cache[name] = counter
                counter += 1

    def resolve(self, name: str) -> Optional[int]:
        if name in self._cache:
            return self._cache[name]
        if name not in self._defs:
            return None
        val = self._eval(self._defs[name], set())
        if val is not None:
            self._cache[name] = val
        return val

    def resolve_expr(self, expr: str) -> int:
        """Resolve an arbitrary expression string to int."""
        return self._eval(expr.strip(), set()) or 0

    def _eval(self, expr: str, seen: set) -> Optional[int]:
        expr = expr.strip()
        # Strip outer parentheses repeatedly
        while expr.startswith('(') and expr.endswith(')'):
            inner = expr[1:-1].strip()
            if self._balanced(inner):
                expr = inner
            else:
                break

        # Try direct int
        try:
            return int(expr, 0)
        except ValueError:
            pass

        # Try bitwise OR split (top-level only)
        parts = self._split_top_level(expr, '|')
        if len(parts) > 1:
            result = 0
            for p in parts:
                v = self._eval(p.strip(), seen)
                if v is None:
                    return None
                result |= v
            return result

        # Try bitwise AND split
        parts = self._split_top_level(expr, '&')
        if len(parts) > 1:
            result = 0xFFFFFFFF
            for p in parts:
                v = self._eval(p.strip(), seen)
                if v is None:
                    return None
                result &= v
            return result & 0xFFFFFFFF

        # Try left shift: A << B
        m = re.match(r'^(.+?)\s*<<\s*(.+)$', expr)
        if m:
            lhs = self._eval(m.group(1).strip(), seen)
            rhs = self._eval(m.group(2).strip(), seen)
            if lhs is not None and rhs is not None:
                return (lhs << rhs) & 0xFFFFFFFF

        # Try right shift: A >> B
        m = re.match(r'^(.+?)\s*>>\s*(.+)$', expr)
        if m:
            lhs = self._eval(m.group(1).strip(), seen)
            rhs = self._eval(m.group(2).strip(), seen)
            if lhs is not None and rhs is not None:
                return lhs >> rhs

        # Try ~ complement
        if expr.startswith('~'):
            v = self._eval(expr[1:].strip(), seen)
            if v is not None:
                return (~v) & 0xFFFFFFFF
            return None

        # Try known macro
        if expr in self._defs and expr not in seen:
            return self._eval(self._defs[expr], seen | {expr})

        # Try known macro with cast/parens stripped
        clean = re.sub(r'^\s*\([^)]*\)\s*', '', expr).strip()  # strip cast
        if clean and clean != expr:
            return self._eval(clean, seen)

        return None

    @staticmethod
    def _balanced(s: str) -> bool:
        depth = 0
        for c in s:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth < 0:
                    return False
        return depth == 0

    @staticmethod
    def _split_top_level(expr: str, sep: str) -> list:
        parts = []
        depth = 0
        current = []
        i = 0
        while i < len(expr):
            c = expr[i]
            if c in '(':
                depth += 1
                current.append(c)
            elif c == ')':
                depth -= 1
                current.append(c)
            elif expr[i:i + len(sep)] == sep and depth == 0:
                parts.append(''.join(current))
                current = []
                i += len(sep)
                continue
            else:
                current.append(c)
            i += 1
        if current:
            parts.append(''.join(current))
        return parts


# ---------------------------------------------------------------------------
# Device config parser
# ---------------------------------------------------------------------------

CONFIG_TYPE_NAMES = {
    -1: 'CONFIG_END',
    0:  'CONFIG_INT',
    1:  'CONFIG_BINARY',
    2:  'CONFIG_SELECTION',
    3:  'CONFIG_MIDI_OUT',
    4:  'CONFIG_SPINNER',
    5:  'CONFIG_MIDI_IN',
    6:  'CONFIG_MEMORY',
    16: 'CONFIG_STRING',
    17: 'CONFIG_FNAME',
    18: 'CONFIG_SERPORT',
    19: 'CONFIG_BIOS',
    32: 'CONFIG_HEX16',
    48: 'CONFIG_HEX20',
    64: 'CONFIG_MAC',
}

# Human-readable CFG key derivation: section is the device internal_name,
# key is the config entry .name field.
# Value stored depends on type:
#   INT/BINARY/SELECTION/SPINNER/MIDI_OUT/MIDI_IN/MEMORY → integer
#   STRING/FNAME/SERPORT/BIOS → string
#   HEX16/HEX20 → hex integer
#   MAC → MAC address string


class DeviceConfigParser:
    """Parses device_config_t arrays from C source."""

    def __init__(self, resolver: MacroResolver):
        self.resolver = resolver

    def parse_config_array(self, content: str, var_name: str) -> list:
        """
        Find and parse a device_config_t array named var_name in content.
        Returns list of config entry dicts.
        """
        # Match: static? const? device_config_t var_name[] = {
        patterns = [
            rf'(?:static\s+)?(?:const\s+)?device_config_t\s+{re.escape(var_name)}\s*\[\s*\]\s*=\s*\{{',
        ]
        m = None
        for pat in patterns:
            m = re.search(pat, content)
            if m:
                break
        if not m:
            return []

        brace_start = content.rfind('{', 0, m.end())
        array_body = extract_balanced_braces(content, brace_start)
        if not array_body:
            return []

        return self._parse_entries(array_body[1:-1])

    def _parse_entries(self, inner: str) -> list:
        entries = []
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            body = extract_balanced_braces(inner, bpos)
            if not body:
                break
            entry = self._parse_single_entry(body)
            if entry is not None:
                if entry.get('type') == 'CONFIG_END':
                    break
                entries.append(entry)
            i = bpos + len(body)
        return entries

    def _parse_single_entry(self, body: str) -> Optional[dict]:
        name = get_string_field(body, 'name')
        description = get_string_field(body, 'description')
        type_raw = get_raw_field(body, 'type')

        # Resolve type to string name
        type_val = self.resolver.resolve_expr(type_raw) if type_raw else -1
        type_name = CONFIG_TYPE_NAMES.get(type_val, type_raw or 'CONFIG_END')

        # An empty name with no type, or -1 type = end marker
        if type_name == 'CONFIG_END' or (not name and type_val == -1):
            return {'type': 'CONFIG_END'}

        # Skip truly empty entries
        if not name and not description:
            return None

        entry: dict[str, Any] = {
            'name': name,
            'description': description,
            'type': type_name,
        }

        # default_int
        m = re.search(r'\.default_int\s*=\s*(-?(?:0x[0-9a-fA-F]+|\d+))', body)
        if m:
            try:
                entry['default_int'] = int(m.group(1), 0)
            except ValueError:
                entry['default_int'] = 0

        # default_string
        m = re.search(r'\.default_string\s*=\s*"([^"]*)"', body)
        if m:
            entry['default_string'] = m.group(1)
        else:
            m = re.search(r'\.default_string\s*=\s*(\w+)', body)
            if m and m.group(1) != 'NULL':
                entry['default_string'] = m.group(1)

        # file_filter
        m = re.search(r'\.file_filter\s*=\s*"([^"]*)"', body)
        if m:
            entry['file_filter'] = m.group(1)

        # spinner
        sm = re.search(r'\.spinner\s*=\s*\{([^}]+)\}', body)
        if sm:
            sb = sm.group(1)
            min_m = re.search(r'\.min\s*=\s*(-?\d+)', sb)
            max_m = re.search(r'\.max\s*=\s*(-?\d+)', sb)
            step_m = re.search(r'\.step\s*=\s*(-?\d+)', sb)
            entry['spinner'] = {
                'min': int(min_m.group(1)) if min_m else 0,
                'max': int(max_m.group(1)) if max_m else 0,
                'step': int(step_m.group(1)) if step_m else 1,
            }

        # selections
        sels = self._parse_selections(body)
        if sels:
            entry['selection'] = sels

        # bios entries
        bios = self._parse_bios_entries(body)
        if bios:
            entry['bios'] = bios

        return entry

    def _parse_selections(self, config_body: str) -> list:
        m = re.search(r'\.selection\s*=\s*\{', config_body)
        if not m:
            return []
        bstart = config_body.find('{', m.start())
        sel_body = extract_balanced_braces(config_body, bstart)
        if not sel_body:
            return []
        results = []
        inner = sel_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            entry_body = extract_balanced_braces(inner, bpos)
            desc = get_string_field(entry_body, 'description')
            vm = re.search(r'\.value\s*=\s*(-?(?:0x[0-9a-fA-F]+|\d+))', entry_body)
            if desc:
                results.append({
                    'description': desc,
                    'value': int(vm.group(1), 0) if vm else 0,
                })
            i = bpos + len(entry_body)
        return results

    def _parse_bios_entries(self, config_body: str) -> list:
        m = re.search(r'\.bios\s*=\s*\{', config_body)
        if not m:
            return []
        bstart = config_body.find('{', m.start())
        bios_body = extract_balanced_braces(config_body, bstart)
        if not bios_body:
            return []
        results = []
        inner = bios_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            entry_body = extract_balanced_braces(inner, bpos)
            name = get_string_field(entry_body, 'name')
            iname = get_string_field(entry_body, 'internal_name')
            if name and iname:
                entry: dict[str, Any] = {'name': name, 'internal_name': iname}
                files_m = re.findall(r'"([^"]+\.[a-zA-Z0-9]{2,6})"', entry_body)
                if files_m:
                    # Filter out name/internal_name strings
                    entry['files'] = [f for f in files_m if f not in (name, iname)]
                results.append(entry)
            i = bpos + len(entry_body)
        return results


# ---------------------------------------------------------------------------
# Device resolver — finds device_t defs across source tree
# ---------------------------------------------------------------------------

class DeviceResolver:
    """
    Locates and parses device_t struct definitions by their C symbol name.
    """

    def __init__(self, src_root: Path, resolver: MacroResolver):
        self.src_root = src_root
        self.macro = resolver
        self.config_parser = DeviceConfigParser(resolver)
        self._file_cache: dict[str, str] = {}
        self._device_cache: dict[str, Optional[dict]] = {}
        # Build a symbol → file index to speed up lookups
        self._index: dict[str, Path] = {}
        self._build_index()

    def _build_index(self):
        """Scan all .c files and record which ones define each device_t symbol."""
        for path in self.src_root.rglob('*.c'):
            try:
                content = path.read_text(encoding='utf-8', errors='replace')
            except Exception:
                continue
            # Quick scan for device_t definitions
            for m in re.finditer(r'\bconst\s+device_t\s+(\w+)\s*=', content):
                sym = m.group(1)
                if sym not in self._index:
                    self._index[sym] = path

    def _read(self, path: Path) -> str:
        key = str(path)
        if key not in self._file_cache:
            try:
                self._file_cache[key] = path.read_text(encoding='utf-8', errors='replace')
            except Exception:
                self._file_cache[key] = ''
        return self._file_cache[key]

    def resolve_device(self, symbol: str) -> dict:
        """
        Return a dict with name, internal_name, flags (list), flags_value, config.
        """
        if symbol in self._device_cache:
            return self._device_cache[symbol]

        result = self._do_resolve(symbol)
        self._device_cache[symbol] = result
        return result

    def _do_resolve(self, symbol: str) -> dict:
        # Special cases
        if symbol == 'device_none':
            return {'name': 'None', 'internal_name': 'none', 'flags': [], 'flags_value': 0, 'config': []}
        if symbol == 'device_internal':
            return {'name': 'Internal', 'internal_name': 'internal', 'flags': [], 'flags_value': 0, 'config': []}

        path = self._index.get(symbol)
        if not path:
            return {'name': symbol, 'internal_name': '', 'flags': [], 'flags_value': 0, 'config': []}

        content = self._read(path)
        clean = strip_comments(content)

        pattern = rf'\bconst\s+device_t\s+{re.escape(symbol)}\s*=\s*\{{'
        m = re.search(pattern, clean)
        if not m:
            return {'name': symbol, 'internal_name': '', 'flags': [], 'flags_value': 0, 'config': []}

        bstart = clean.rfind('{', 0, m.end())
        body = extract_balanced_braces(clean, bstart)

        name = get_string_field(body, 'name')
        internal_name = get_string_field(body, 'internal_name')
        flags_raw = get_raw_field(body, 'flags')
        config_var = get_raw_field(body, 'config')

        flags_value = self.macro.resolve_expr(flags_raw) if flags_raw else 0
        flags_value &= 0xFFFFFFFF
        flags_names = self._flags_to_names(flags_value)

        config = []
        if config_var and config_var not in ('NULL', '0', ''):
            config = self.config_parser.parse_config_array(clean, config_var.strip())

        return {
            'name': name or symbol,
            'internal_name': internal_name,
            'flags': flags_names,
            'flags_value': flags_value,
            'config': config,
        }

    DEVICE_FLAG_NAMES = {
        0x00000001: 'DEVICE_CASETTE',
        0x00000002: 'DEVICE_SIDECAR',
        0x00000004: 'DEVICE_ISA',
        0x00000008: 'DEVICE_XT_KBC',
        0x00000010: 'DEVICE_CBUS',
        0x00000020: 'DEVICE_ISA16',
        0x00000040: 'DEVICE_AT_KBC',
        0x00000080: 'DEVICE_MCA',
        0x00000100: 'DEVICE_MCA32',
        0x00000200: 'DEVICE_PS2_KBC',
        0x00000400: 'DEVICE_PCMCIA',
        0x00000800: 'DEVICE_HIL',
        0x00001000: 'DEVICE_EISA',
        0x00002000: 'DEVICE_AT32',
        0x00004000: 'DEVICE_OLB',
        0x00008000: 'DEVICE_VLB',
        0x00010000: 'DEVICE_PCI',
        0x00020000: 'DEVICE_CARDBUS',
        0x00040000: 'DEVICE_USB',
        0x00080000: 'DEVICE_AGP',
        0x00100000: 'DEVICE_AC97',
        0x00200000: 'DEVICE_COM',
        0x00400000: 'DEVICE_LPT',
        0x00800000: 'DEVICE_KBC',
        0x01000000: 'DEVICE_SOFTRESET',
        0x40000000: 'DEVICE_ONBOARD',
        0x80000000: 'DEVICE_PIT',
    }

    def _flags_to_names(self, value: int) -> list:
        names = []
        for bit, name in sorted(self.DEVICE_FLAG_NAMES.items()):
            if value & bit:
                names.append(name)
        return names


# ---------------------------------------------------------------------------
# Category table parsers
# ---------------------------------------------------------------------------

def parse_device_symbol_list(content: str, array_patterns: list) -> list:
    """
    Extract a list of C symbol names from an array like:
        static const SOME_TYPE arr[] = {
            { &symbol1 },
            { &symbol2, ...},
            { NULL }
        };
    Returns list of symbol strings (without &).
    """
    clean = strip_comments(content)
    clean = strip_preprocessor(clean)

    # Find the array
    body = None
    for pat in array_patterns:
        m = re.search(pat, clean, re.DOTALL)
        if m:
            bstart = clean.find('{', m.end() - 1)
            body = extract_balanced_braces(clean, bstart)
            break

    if not body:
        return []

    # Extract &symbol references
    symbols = re.findall(r'&\s*(\w+)', body)
    # Filter out NULL and internal implementation
    return [s for s in symbols if s not in ('NULL',)]


# ---------------------------------------------------------------------------
# Machine table parser
# ---------------------------------------------------------------------------

class MachineTableParser:
    """Parse the machine_table.c file."""

    def __init__(self, resolver: MacroResolver, device_resolver: DeviceResolver):
        self.macro = resolver
        self.device_resolver = device_resolver

    MACHINE_FLAG_NAMES = {
        0x00000002: 'MACHINE_VIDEO',
        0x00000004: 'MACHINE_VIDEO_8514A',
        0x00000008: 'MACHINE_VIDEO_ONLY',
        0x00000010: 'MACHINE_CARTRIDGE',
        0x00000020: 'MACHINE_NEC_APC3',
        0x00000040: 'MACHINE_AT_KBD_ONLY',
        0x00000080: 'MACHINE_M6117',
        0x00000100: 'MACHINE_XTA',
        0x00000200: 'MACHINE_MFM',
        0x00000400: 'MACHINE_RLL',
        0x00000800: 'MACHINE_ESDI',
        0x00001000: 'MACHINE_IDE_PRI',
        0x00002000: 'MACHINE_IDE_SEC',
        0x00004000: 'MACHINE_IDE_TER',
        0x00008000: 'MACHINE_IDE_QUA',
        0x00010000: 'MACHINE_SCSI',
        0x00020000: 'MACHINE_SOUND',
        0x00040000: 'MACHINE_GAMEPORT',
        0x00080000: 'MACHINE_FDC',
        0x00100000: 'MACHINE_NIC',
        0x00200000: 'MACHINE_PCI_INTERNAL',
        0x00400000: 'MACHINE_MOUSE',
        0x00800000: 'MACHINE_NONMI',
        0x01000000: 'MACHINE_AGP_VIDEO',
        0x02000000: 'MACHINE_BUS_REMAP',
        0x04000000: 'MACHINE_PS55',
        0x08000000: 'MACHINE_BUS_MSS',
    }

    MACHINE_BUS_NAMES = {
        0x00000001: 'MACHINE_BUS_CASSETTE',
        0x00000002: 'MACHINE_BUS_SIDECAR',
        0x00000004: 'MACHINE_BUS_ISA',
        0x00000008: 'MACHINE_BUS_XT_KBD',
        0x00000010: 'MACHINE_BUS_CBUS',
        0x00000020: 'MACHINE_BUS_ISA16',
        0x00000040: 'MACHINE_BUS_AT_KBD',
        0x00000080: 'MACHINE_BUS_MCA',
        0x00000100: 'MACHINE_BUS_MCA32',
        0x00000200: 'MACHINE_BUS_PS2_PORTS',
        0x00000400: 'MACHINE_BUS_PCMCIA',
        0x00000800: 'MACHINE_BUS_HIL',
        0x00001000: 'MACHINE_BUS_EISA',
        0x00002000: 'MACHINE_BUS_AT32',
        0x00004000: 'MACHINE_BUS_OLB',
        0x00008000: 'MACHINE_BUS_VLB',
        0x00010000: 'MACHINE_BUS_PCI',
        0x00020000: 'MACHINE_BUS_CARDBUS',
        0x00040000: 'MACHINE_BUS_USB',
        0x00080000: 'MACHINE_BUS_AGP',
        0x00100000: 'MACHINE_BUS_AC97',
    }

    MACHINE_TYPE_NAMES = {
        0:  'MACHINE_TYPE_NONE',
        1:  'MACHINE_TYPE_8088',
        2:  'MACHINE_TYPE_8086',
        3:  'MACHINE_TYPE_286',
        4:  'MACHINE_TYPE_386SX',
        5:  'MACHINE_TYPE_M6117',
        6:  'MACHINE_TYPE_486SLC',
        7:  'MACHINE_TYPE_386DX',
        8:  'MACHINE_TYPE_386DX_486',
        9:  'MACHINE_TYPE_486',
        10: 'MACHINE_TYPE_486_S2',
        11: 'MACHINE_TYPE_486_S3',
        12: 'MACHINE_TYPE_486_S3_PCI',
        13: 'MACHINE_TYPE_486_MISC',
        14: 'MACHINE_TYPE_SOCKET4',
        15: 'MACHINE_TYPE_SOCKET4_5',
        16: 'MACHINE_TYPE_SOCKET5',
        17: 'MACHINE_TYPE_SOCKET7_3V',
        18: 'MACHINE_TYPE_SOCKET7',
        19: 'MACHINE_TYPE_SOCKETS7',
        20: 'MACHINE_TYPE_SOCKET8',
        21: 'MACHINE_TYPE_SLOT1',
        22: 'MACHINE_TYPE_SLOT1_2',
        23: 'MACHINE_TYPE_SLOT1_370',
        24: 'MACHINE_TYPE_SLOT2',
        25: 'MACHINE_TYPE_SOCKET370',
        26: 'MACHINE_TYPE_MISC',
    }

    CPU_PACKAGE_NAMES = {
        # These match the enum in cpu.h: CPU_PKG_X = (1 << N)
        (1 << 0):  'CPU_PKG_8088',
        (1 << 1):  'CPU_PKG_8088_EUROPC',
        (1 << 2):  'CPU_PKG_8088_VTECH',
        (1 << 3):  'CPU_PKG_8086',
        (1 << 4):  'CPU_PKG_8086_MAZOVIA',
        (1 << 5):  'CPU_PKG_8086_VTECH',
        (1 << 6):  'CPU_PKG_188',
        (1 << 7):  'CPU_PKG_186',
        (1 << 8):  'CPU_PKG_286',
        (1 << 9):  'CPU_PKG_386SX',
        (1 << 10): 'CPU_PKG_386DX',
        (1 << 11): 'CPU_PKG_386DX_DESKPRO386',
        (1 << 12): 'CPU_PKG_M6117',
        (1 << 13): 'CPU_PKG_386SLC_IBM',
        (1 << 14): 'CPU_PKG_486SLC',
        (1 << 15): 'CPU_PKG_486SLC_IBM',
        (1 << 16): 'CPU_PKG_486BL',
        (1 << 17): 'CPU_PKG_486DLC',
        (1 << 18): 'CPU_PKG_SOCKET1',
        (1 << 19): 'CPU_PKG_SOCKET3',
        (1 << 20): 'CPU_PKG_SOCKET3_PC330',
        (1 << 21): 'CPU_PKG_STPC',
        (1 << 22): 'CPU_PKG_SOCKET4',
        (1 << 23): 'CPU_PKG_SOCKET5_7',
        (1 << 24): 'CPU_PKG_SOCKET8',
        (1 << 25): 'CPU_PKG_SLOT1',
        (1 << 26): 'CPU_PKG_SLOT2',
        (1 << 27): 'CPU_PKG_SOCKET370',
    }

    def parse(self, content: str) -> list:
        clean = strip_comments(content)

        # Find machines[] array
        m = re.search(r'\bconst\s+machine_t\s+machines\s*\[\s*\]\s*=\s*\{', clean)
        if not m:
            print("Warning: could not find machines[] array", file=sys.stderr)
            return []

        bstart = clean.rfind('{', 0, m.end())
        array_body = extract_balanced_braces(clean, bstart)
        if not array_body:
            return []

        machines = []
        inner = array_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            body = extract_balanced_braces(inner, bpos)
            if not body:
                break
            machine = self._parse_machine_entry(body)
            if machine and machine.get('internal_name'):
                machines.append(machine)
            i = bpos + len(body)

        return machines

    def _parse_machine_entry(self, body: str) -> Optional[dict]:
        name = get_string_field(body, 'name')
        internal_name = get_string_field(body, 'internal_name')

        if not internal_name:
            return None

        # Type
        type_raw = get_raw_field(body, 'type')
        type_val = self.macro.resolve_expr(type_raw) if type_raw else 0
        type_name = self.MACHINE_TYPE_NAMES.get(type_val, type_raw)

        # Chipset
        chipset_raw = get_raw_field(body, 'chipset')
        chipset_name = chipset_raw  # Keep as string name

        # bus_flags
        bus_raw = get_raw_field(body, 'bus_flags')
        bus_value = self.macro.resolve_expr(bus_raw) if bus_raw else 0
        bus_value &= 0xFFFFFFFF
        bus_names = self._bus_value_to_names(bus_value)

        # flags
        flags_raw = get_raw_field(body, 'flags')
        flags_value = self.macro.resolve_expr(flags_raw) if flags_raw else 0
        flags_names = self._flags_value_to_names(flags_value)

        # CPU package info
        cpu_section_m = re.search(r'\.cpu\s*=\s*\{', body)
        cpu_packages = []
        cpu_block = 'CPU_BLOCK_NONE'
        if cpu_section_m:
            cpu_bstart = body.find('{', cpu_section_m.start())
            cpu_body = extract_balanced_braces(body, cpu_bstart)
            pkg_raw = get_raw_field(cpu_body, 'package')
            pkg_val = self.macro.resolve_expr(pkg_raw) if pkg_raw else 0
            # Package can be bitfield of multiple packages
            cpu_packages = self._cpu_packages_from_value(pkg_val)
            block_raw = get_raw_field(cpu_body, 'block')
            cpu_block = block_raw or 'CPU_BLOCK_NONE'

        # RAM
        ram_m = re.search(r'\.ram\s*=\s*\{', body)
        ram_min = ram_max = ram_step = 0
        if ram_m:
            ram_bstart = body.find('{', ram_m.start())
            ram_body = extract_balanced_braces(body, ram_bstart)
            def getint(field):
                fm = re.search(rf'\.{field}\s*=\s*(\d+)', ram_body)
                return int(fm.group(1)) if fm else 0
            ram_min = getint('min')
            ram_max = getint('max')
            ram_step = getint('step')

        # Built-in devices (vid_device, snd_device, net_device etc.)
        builtin = {}
        for dev_field in ('vid_device', 'snd_device', 'net_device', 'kbd_device', 'fdc_device'):
            m2 = re.search(rf'\.{dev_field}\s*=\s*&\s*(\w+)', body)
            if m2:
                sym = m2.group(1)
                if sym not in ('NULL', 'device_none', 'device_internal'):
                    builtin[dev_field] = sym

        return {
            'name': name,
            'internal_name': internal_name,
            'type': type_name,
            'chipset': chipset_name,
            'cpu_packages': cpu_packages,
            'cpu_block': cpu_block,
            'bus_flags': bus_names,
            'bus_flags_value': bus_value,
            'flags': flags_names,
            'flags_value': flags_value,
            'ram': {
                'min_kb': ram_min,
                'max_kb': ram_max,
                'step_kb': ram_step,
            },
            'builtin_devices': builtin,
        }

    def _bus_value_to_names(self, value: int) -> list:
        return [name for bit, name in sorted(self.MACHINE_BUS_NAMES.items()) if value & bit]

    def _flags_value_to_names(self, value: int) -> list:
        return [name for bit, name in sorted(self.MACHINE_FLAG_NAMES.items()) if value & bit]

    def _cpu_packages_from_value(self, value: int) -> list:
        return [name for bit, name in sorted(self.CPU_PACKAGE_NAMES.items()) if value & bit]


# ---------------------------------------------------------------------------
# CPU family parser
# ---------------------------------------------------------------------------

def parse_cpu_families(content: str, resolver: MacroResolver) -> list:
    clean = strip_comments(content)

    m = re.search(r'\bconst\s+cpu_family_t\s+cpu_families\s*\[\s*\]\s*=\s*\{', clean)
    if not m:
        return []

    bstart = clean.rfind('{', 0, m.end())
    array_body = extract_balanced_braces(clean, bstart)
    if not array_body:
        return []

    families = []
    inner = array_body[1:-1]
    i = 0
    while i < len(inner):
        bpos = inner.find('{', i)
        if bpos == -1:
            break
        body = extract_balanced_braces(inner, bpos)
        if not body:
            break

        pkg_raw = get_raw_field(body, 'package')
        pkg_val = resolver.resolve_expr(pkg_raw) if pkg_raw else 0
        manufacturer = get_string_field(body, 'manufacturer')
        name = get_string_field(body, 'name')
        internal_name = get_string_field(body, 'internal_name')

        if not name:
            i = bpos + len(body)
            continue

        # Parse CPUs array inside
        cpus = _parse_cpu_array(body)

        families.append({
            'package': pkg_raw,
            'package_value': pkg_val,
            'manufacturer': manufacturer,
            'name': name,
            'internal_name': internal_name,
            'cpus': cpus,
        })

        i = bpos + len(body)

    return families


def _parse_cpu_array(family_body: str) -> list:
    m = re.search(r'\.cpus\s*=\s*\(const CPU\[\]\)\s*\{', family_body)
    if not m:
        return []

    bstart = family_body.find('{', m.end() - 1)
    arr_body = extract_balanced_braces(family_body, bstart)
    if not arr_body:
        return []

    cpus = []
    inner = arr_body[1:-1]
    i = 0
    while i < len(inner):
        bpos = inner.find('{', i)
        if bpos == -1:
            break
        body = extract_balanced_braces(inner, bpos)
        name = get_string_field(body, 'name')
        if not name:
            i = bpos + len(body)
            continue

        rspeed_m = re.search(r'\.rspeed\s*=\s*(\d+)', body)
        multi_m = re.search(r'\.multi\s*=\s*(\d+)', body)
        voltage_m = re.search(r'\.voltage\s*=\s*(\d+)', body)

        cpus.append({
            'name': name,
            'rspeed': int(rspeed_m.group(1)) if rspeed_m else 0,
            'multi': int(multi_m.group(1)) if multi_m else 1,
            'voltage_mv': int(voltage_m.group(1)) if voltage_m else 5000,
        })

        i = bpos + len(body)

    return cpus


# ---------------------------------------------------------------------------
# Main database builder
# ---------------------------------------------------------------------------

class DatabaseBuilder:
    """Orchestrates the full parse and produces the JSON database."""

    def __init__(self, src_root: str):
        self.src = Path(src_root)
        self.inc = self.src / 'include' / '86box'
        self.resolver = MacroResolver()
        self._load_macros()
        self.dev_resolver = DeviceResolver(self.src, self.resolver)

    def _load_macros(self):
        """Load relevant header files for macro resolution."""
        for hdr in ['machine.h', 'device.h', 'video.h', 'sound.h', 'network.h', 'hdc.h', 'cdrom.h']:
            path = self.inc / hdr
            if path.exists():
                self.resolver.load_file(path)
        # Also load cpu.h
        cpu_h = self.src / 'cpu' / 'cpu.h'
        if cpu_h.exists():
            self.resolver.load_file(cpu_h)

    # ---- Category table helpers ----

    def _parse_floppy_types(self, content: str) -> list:
        """Parse drive_types[] from floppy/fdd.c.

        Format: { max_track, flags, "name", "internal_name" }
        Sentinel: { -1, -1, "", "" }
        """
        clean = strip_comments(content)
        m = re.search(r'\bdrive_types\s*\[\s*\]\s*=\s*\{', clean)
        if not m:
            return []

        bstart = clean.find('{', m.end() - 1)
        arr_body = extract_balanced_braces(clean, bstart)
        if not arr_body:
            return []

        types = []
        inner = arr_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            body = extract_balanced_braces(inner, bpos)
            strings = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
            if len(strings) >= 2:
                name = strings[0].replace('\\"', '"').replace('\\\\', '\\')
                internal_name = strings[1].replace('\\"', '"').replace('\\\\', '\\')
                # Sentinel entry — stop here
                if internal_name == '' and name == '':
                    break
                types.append({'name': name, 'id': internal_name})
            i = bpos + len(body)

        return types

    def _parse_mouse_types(self) -> list:
        """Parse mouse_devices[] from device/mouse.c using the device resolver."""
        path = self.src / 'device' / 'mouse.c'
        if not path.exists():
            return []

        content = path.read_text(encoding='utf-8', errors='replace')
        symbols = parse_device_symbol_list(content, [r'\bmouse_devices\s*\[\s*\]\s*=\s*\{'])

        types = []
        for sym in symbols:
            dev = self.dev_resolver.resolve_device(sym)
            name = dev.get('name', '')
            internal_name = dev.get('internal_name', '')
            if not internal_name:
                continue
            # Skip on-board/internal mouse — not user-selectable in config
            if internal_name == 'internal':
                continue
            types.append({'name': name, 'id': internal_name})

        return types

    def _parse_joystick_types(self) -> list:
        """Parse joysticks[] from game/gameport.c.

        Joystick types use joystick_t structs (not device_t), so we scan all
        game/*.c files for joystick_t definitions and match by symbol name.
        """
        gameport_path = self.src / 'game' / 'gameport.c'
        if not gameport_path.exists():
            return []

        content = gameport_path.read_text(encoding='utf-8', errors='replace')
        # Extract symbol names from joysticks[] array (entries like { &symbol })
        clean = strip_comments(content)
        m = re.search(r'\bjoysticks\s*\[\s*\]\s*=\s*\{', clean)
        if not m:
            return []

        bstart = clean.find('{', m.end() - 1)
        arr_body = extract_balanced_braces(clean, bstart)
        if not arr_body:
            return []

        symbols = re.findall(r'&\s*(\w+)', arr_body)

        # Build a map of symbol → (name, internal_name) by scanning game/ files
        game_dir = self.src / 'game'
        sym_map: dict = {}
        for path in sorted(game_dir.glob('*.c')):
            try:
                fc = strip_comments(path.read_text(encoding='utf-8', errors='replace'))
            except Exception:
                continue
            for sym_m in re.finditer(r'(?:const\s+|static\s+)*joystick_t\s+(\w+)\s*=\s*\{', fc):
                sym = sym_m.group(1)
                bstart2 = fc.find('{', sym_m.end() - 1)
                body = extract_balanced_braces(fc, bstart2)
                name_m = re.search(r'\.name\s*=\s*"((?:[^"\\]|\\.)*)"', body)
                iname_m = re.search(r'\.internal_name\s*=\s*"((?:[^"\\]|\\.)*)"', body)
                if name_m and iname_m:
                    sym_map[sym] = (name_m.group(1), iname_m.group(1))

        # Also check gameport.c itself (joystick_none is static there)
        for sym_m in re.finditer(r'(?:const\s+|static\s+)*joystick_t\s+(\w+)\s*=\s*\{', clean):
            sym = sym_m.group(1)
            bstart2 = clean.find('{', sym_m.end() - 1)
            body = extract_balanced_braces(clean, bstart2)
            name_m = re.search(r'\.name\s*=\s*"((?:[^"\\]|\\.)*)"', body)
            iname_m = re.search(r'\.internal_name\s*=\s*"((?:[^"\\]|\\.)*)"', body)
            if name_m and iname_m:
                sym_map[sym] = (name_m.group(1), iname_m.group(1))

        types = []
        for sym in symbols:
            if sym in sym_map:
                name, internal_name = sym_map[sym]
                if internal_name:
                    types.append({'name': name, 'id': internal_name})

        return types

    def _load_category(self, rel_path: str, array_patterns: list, label: str) -> list:
        path = self.src / rel_path
        if not path.exists():
            print(f"Warning: {rel_path} not found", file=sys.stderr)
            return []
        content = path.read_text(encoding='utf-8', errors='replace')
        symbols = parse_device_symbol_list(content, array_patterns)
        print(f"  Found {len(symbols)} {label} symbols", file=sys.stderr)
        results = []
        for sym in symbols:
            dev = self.dev_resolver.resolve_device(sym)
            entry = dict(dev)
            entry['symbol'] = sym
            results.append(entry)
        return results

    def build(self) -> dict:
        print("Building 86Box hardware database...", file=sys.stderr)

        db: dict[str, Any] = {}

        # ---- Machines ----
        print("Parsing machines...", file=sys.stderr)
        machine_table_path = self.src / 'machine' / 'machine_table.c'
        if machine_table_path.exists():
            content = machine_table_path.read_text(encoding='utf-8', errors='replace')
            mp = MachineTableParser(self.resolver, self.dev_resolver)
            db['machines'] = mp.parse(content)
            print(f"  Found {len(db['machines'])} machines", file=sys.stderr)
        else:
            db['machines'] = []

        # ---- CPUs ----
        print("Parsing CPU families...", file=sys.stderr)
        cpu_table_path = self.src / 'cpu' / 'cpu_table.c'
        if cpu_table_path.exists():
            content = cpu_table_path.read_text(encoding='utf-8', errors='replace')
            db['cpu_families'] = parse_cpu_families(content, self.resolver)
            print(f"  Found {len(db['cpu_families'])} CPU families", file=sys.stderr)
        else:
            db['cpu_families'] = []

        # ---- Video cards ----
        print("Parsing video cards...", file=sys.stderr)
        db['video_cards'] = self._load_category(
            'video/vid_table.c',
            [r'\bvideo_cards\s*\[\s*\]\s*=\s*\{'],
            'video cards'
        )

        # ---- Sound cards ----
        print("Parsing sound cards...", file=sys.stderr)
        db['sound_cards'] = self._load_category(
            'sound/sound.c',
            [r'\bsound_cards\s*\[\s*\]\s*=\s*\{'],
            'sound cards'
        )

        # ---- Network cards ----
        print("Parsing network cards...", file=sys.stderr)
        db['network_cards'] = self._load_category(
            'network/network.c',
            [r'\bnet_cards\s*\[\s*\]\s*=\s*\{'],
            'network cards'
        )

        # ---- HDC (Hard Disk Controllers) ----
        print("Parsing HDC...", file=sys.stderr)
        db['hdc'] = self._load_category(
            'disk/hdc.c',
            [r'\bcontrollers\s*\[\s*\]\s*=\s*\{'],
            'HDC'
        )

        # ---- SCSI controllers ----
        print("Parsing SCSI controllers...", file=sys.stderr)
        db['scsi'] = self._load_category(
            'scsi/scsi.c',
            [r'\bscsi_cards\s*\[\s*\]\s*=\s*\{'],
            'SCSI'
        )

        # ---- FDC (Floppy Disk Controllers) ----
        print("Parsing FDC...", file=sys.stderr)
        db['fdc'] = self._load_category(
            'floppy/fdc.c',
            [r'\bfdc_cards\s*\[\s*\]\s*=\s*\{'],
            'FDC'
        )

        # ---- CD-ROM interfaces ----
        print("Parsing CD-ROM interfaces...", file=sys.stderr)
        cdrom_path = self.src / 'cdrom' / 'cdrom.c'
        if cdrom_path.exists():
            content = cdrom_path.read_text(encoding='utf-8', errors='replace')
            # The CD-ROM interface controllers[] array in cdrom.c
            symbols = parse_device_symbol_list(content, [
                r'\bcontrollers\s*\[\s*\]\s*=\s*\{',
            ])
            db['cdrom_interface'] = []
            for sym in symbols:
                dev = self.dev_resolver.resolve_device(sym)
                entry = dict(dev)
                entry['symbol'] = sym
                db['cdrom_interface'].append(entry)
            print(f"  Found {len(db['cdrom_interface'])} CD-ROM interface symbols", file=sys.stderr)

            # Parse cdrom_drive_types from cdrom.h (where the array is defined)
            cdrom_h_path = self.inc / 'cdrom.h'
            if cdrom_h_path.exists():
                cdrom_h_content = cdrom_h_path.read_text(encoding='utf-8', errors='replace')
                db['cdrom_drive_types'] = self._parse_cdrom_drive_types(cdrom_h_content)
            else:
                db['cdrom_drive_types'] = self._parse_cdrom_drive_types(content)
            print(f"  Found {len(db['cdrom_drive_types'])} CD-ROM drive types", file=sys.stderr)
        else:
            db['cdrom_interface'] = []
            db['cdrom_drive_types'] = []

        # ---- HDD speed presets ----
        hdd_c_path = self.src / 'disk' / 'hdd.c'
        if hdd_c_path.exists():
            hdd_c_content = hdd_c_path.read_text(encoding='utf-8', errors='replace')
            db['hdd_speed_presets'] = self._parse_hdd_speed_presets(hdd_c_content)
            print(f"  Found {len(db['hdd_speed_presets'])} HDD speed presets", file=sys.stderr)
        else:
            db['hdd_speed_presets'] = []

        # ---- ISA RTC, ISA Memory, ISA ROM peripherals ----
        print("Parsing other peripherals...", file=sys.stderr)
        db['isartc'] = self._parse_generic_device_list(
            self.src / 'device', 'isartc.c',
            [r'\bisartc_devices\s*\[\s*\]\s*=\s*\{',
             r'\bisartc_cards\s*\[\s*\]\s*=\s*\{',
             r'\bboards\s*\[\s*\]\s*=\s*\{']  # isartc.c uses static boards[]
        )
        db['isamem'] = self._parse_generic_device_list(
            self.src / 'device', 'isamem.c',
            [r'\bisamem_devices\s*\[\s*\]\s*=\s*\{',
             r'\bisamem_cards\s*\[\s*\]\s*=\s*\{',
             r'\bboards\s*\[\s*\]\s*=\s*\{']  # isamem.c uses static boards[]
        )

        # ---- Floppy drive types ----
        print("Parsing floppy drive types...", file=sys.stderr)
        fdd_c_path = self.src / 'floppy' / 'fdd.c'
        if fdd_c_path.exists():
            fdd_content = fdd_c_path.read_text(encoding='utf-8', errors='replace')
            db['floppy_types'] = self._parse_floppy_types(fdd_content)
            print(f"  Found {len(db['floppy_types'])} floppy drive types", file=sys.stderr)
        else:
            db['floppy_types'] = []

        # ---- Mouse types ----
        print("Parsing mouse types...", file=sys.stderr)
        db['mouse_types'] = self._parse_mouse_types()
        print(f"  Found {len(db['mouse_types'])} mouse types", file=sys.stderr)

        # ---- Joystick types ----
        print("Parsing joystick types...", file=sys.stderr)
        db['joystick_types'] = self._parse_joystick_types()
        print(f"  Found {len(db['joystick_types'])} joystick types", file=sys.stderr)

        # ---- Metadata ----
        db['metadata'] = {
            'src_root': str(self.src),
            'categories': [
                'machines', 'cpu_families', 'video_cards', 'sound_cards',
                'network_cards', 'hdc', 'scsi', 'fdc', 'cdrom_interface',
                'cdrom_drive_types', 'hdd_speed_presets', 'isartc', 'isamem',
                'floppy_types', 'mouse_types', 'joystick_types',
            ],
            'compatibility_note': (
                'A device is compatible with a machine when: '
                '(device.flags_value & 0x1FFFFF) is non-zero AND '
                '(machine.bus_flags_value & (device.flags_value & 0x1FFFFF)) != 0. '
                'Exception: DEVICE_PCI devices are excluded from machines with '
                'MACHINE_PCI_INTERNAL flag set (flags bit 0x200000).'
            ),
            'cfg_note': (
                'In the 86Box CFG file, each device is saved under a section named '
                'after the device internal_name. Each config entry .name is the key. '
                'Integer/selection values are stored as decimals; hex values as 0x-prefixed hex.'
            ),
        }

        return db

    def _parse_generic_device_list(self, base_dir: Path, filename: str, patterns: list) -> list:
        """Try to find and parse a device list from files in common locations."""
        search_dirs = [base_dir, self.src / 'device', self.src]
        for d in search_dirs:
            path = d / filename
            if path.exists():
                content = path.read_text(encoding='utf-8', errors='replace')
                symbols = parse_device_symbol_list(content, patterns)
                result = []
                for sym in symbols:
                    dev = self.dev_resolver.resolve_device(sym)
                    entry = dict(dev)
                    entry['symbol'] = sym
                    result.append(entry)
                return result
        return []

    def _parse_cdrom_drive_types(self, content: str) -> list:
        """
        Parse cdrom_drive_types[] array.
        The entries use positional initialization:
            { vendor, model_name, revision, internal_name, bus_type, caddy, speed, ... }
        """
        clean = strip_comments(content)
        # Find the array definition - handles both in .c and .h files
        m = re.search(r'\bcdrom_drive_types\s*\[\s*\]\s*=\s*\{', clean)
        if not m:
            # Also try typedef struct version: } cdrom_drive_types[] = {
            m = re.search(r'\}\s+cdrom_drive_types\s*\[\s*\]\s*=\s*\{', clean)
            if not m:
                return []

        bstart = clean.find('{', m.end() - 1)
        arr_body = extract_balanced_braces(clean, bstart)
        if not arr_body:
            return []

        drives = []
        inner = arr_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            body = extract_balanced_braces(inner, bpos)

            # Extract all string literals in order: vendor, model, revision, internal_name
            strings = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
            if len(strings) >= 3:
                vendor = strings[0]
                model = strings[1]
                revision = strings[2]
                internal_name = strings[3] if len(strings) > 3 else ''

                # Extract speed (look for a standalone integer after the strings)
                # In the format: vendor, model, rev, internal_name, bus_type, caddy, speed, ...
                # Speed is the 7th positional field (0-indexed: 6)
                # Extract all non-string tokens
                no_strings = re.sub(r'"[^"]*"', '', body)
                tokens = re.findall(r'-?\d+', no_strings)
                speed = int(tokens[1]) if len(tokens) > 1 else 0  # tokens[0] is bus_type, [1] is caddy, [2] is speed
                is_dvd = False
                if len(tokens) > 3:
                    is_dvd = tokens[3] == '1'

                drives.append({
                    'vendor': vendor,
                    'model': model,
                    'revision': revision,
                    'internal_name': internal_name,
                    'speed_x': speed,
                    'is_dvd': is_dvd,
                    'display_name': f"{vendor} {model} {revision}".strip() + (f" ({speed}x)" if speed > 0 else ''),
                })

            i = bpos + len(body)

        return drives

    def _parse_hdd_speed_presets(self, content: str) -> list:
        """Parse hdd_speed_presets[] from hdd.c.

        Each entry uses named-field initialisation:
            { .name = "...", .internal_name = "...", .zones = N, .avg_spt = N,
              .heads = N, .rpm = N, .full_stroke_ms = N, .track_seek_ms = N,
              .rcache_num_seg = N, .rcache_seg_size = N, .max_multiple = N }
        """
        clean = strip_comments(content)
        m = re.search(r'\bhdd_speed_presets\s*\[\s*\]\s*=\s*\{', clean)
        if not m:
            return []

        bstart = clean.find('{', m.end() - 1)
        arr_body = extract_balanced_braces(clean, bstart)
        if not arr_body:
            return []

        presets = []
        inner = arr_body[1:-1]
        i = 0
        while i < len(inner):
            bpos = inner.find('{', i)
            if bpos == -1:
                break
            body = extract_balanced_braces(inner, bpos)

            strings = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
            if len(strings) >= 2:
                name = strings[0]
                internal_name = strings[1]

                def _field(fname: str) -> int | None:
                    fm = re.search(rf'\.{fname}\s*=\s*(-?\d+)', body)
                    return int(fm.group(1)) if fm else None

                # Determine category from the name prefix
                nl = name.lower()
                if 'mfm' in nl or nl.startswith('[mfm]'):
                    category = 'MFM'
                elif 'rll' in nl or nl.startswith('[rll]'):
                    category = 'RLL'
                elif '[generic]' in nl or 'ram disk' in nl:
                    category = 'Generic'
                elif '[pio' in nl or 'pio ide' in nl:
                    category = 'PIO / ATA-1'
                elif '[ata-1]' in nl:
                    category = 'ATA-1'
                elif '[ata-2]' in nl:
                    category = 'ATA-2'
                elif '[ata-3]' in nl:
                    category = 'ATA-3'
                elif '[ata-4]' in nl:
                    category = 'ATA-4'
                elif '[ata-5]' in nl:
                    category = 'ATA-5'
                else:
                    category = 'Other'

                # Strip the "[Xxx] " category prefix from the display name
                display = re.sub(r'^\[[^\]]+\]\s*', '', name)

                presets.append({
                    'name': display,
                    'internal_name': internal_name,
                    'category': category,
                    'rpm': _field('rpm'),
                    'heads': _field('heads'),
                    'avg_spt': _field('avg_spt'),
                    'zones': _field('zones'),
                    'full_stroke_ms': _field('full_stroke_ms'),
                    'track_seek_ms': _field('track_seek_ms'),
                })

            i = bpos + len(body)

        return presets


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Parse 86Box source and build hardware DB')
    parser.add_argument('--src', default='src', help='Path to 86Box src directory')
    parser.add_argument('--out', default='86box_hardware_db.json', help='Output JSON file')
    parser.add_argument('--pretty', action='store_true', default=True,
                        help='Pretty-print JSON output')
    args = parser.parse_args()

    src_path = Path(args.src)
    if not src_path.exists():
        print(f"Error: src directory '{args.src}' not found", file=sys.stderr)
        sys.exit(1)

    builder = DatabaseBuilder(str(src_path))
    db = builder.build()

    out_path = Path(args.out)
    indent = 2 if args.pretty else None
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(db, f, indent=indent, ensure_ascii=False)

    # Summary
    print(f"\nDatabase written to: {out_path}", file=sys.stderr)
    print(f"  Machines:          {len(db.get('machines', []))}", file=sys.stderr)
    print(f"  CPU families:      {len(db.get('cpu_families', []))}", file=sys.stderr)
    print(f"  Video cards:       {len(db.get('video_cards', []))}", file=sys.stderr)
    print(f"  Sound cards:       {len(db.get('sound_cards', []))}", file=sys.stderr)
    print(f"  Network cards:     {len(db.get('network_cards', []))}", file=sys.stderr)
    print(f"  HDC:               {len(db.get('hdc', []))}", file=sys.stderr)
    print(f"  SCSI:              {len(db.get('scsi', []))}", file=sys.stderr)
    print(f"  FDC:               {len(db.get('fdc', []))}", file=sys.stderr)
    print(f"  CD-ROM interfaces: {len(db.get('cdrom_interface', []))}", file=sys.stderr)
    print(f"  CD-ROM drives:     {len(db.get('cdrom_drive_types', []))}", file=sys.stderr)


if __name__ == '__main__':
    main()
