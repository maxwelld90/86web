export const BUS_SLOTS: [number, string][] = [
  [0x00000004, 'ISA'],
  [0x00000020, 'ISA 16-bit'],
  [0x00000080, 'MCA'],
  [0x00001000, 'EISA'],
  [0x00008000, 'VL-Bus'],
  [0x00010000, 'PCI'],
  [0x00080000, 'AGP'],
  [0x00100000, "AC'97"],
]

export function busLabel(flags: number): string {
  for (const [mask, label] of BUS_SLOTS) {
    if (flags & mask) return label
  }
  return 'Built-in / Other'
}

const BUS_ORDER = ['Built-in / Other', ...BUS_SLOTS.map(([, l]) => l)]

export function withBusGroups<T extends { bus_flags?: number }>(
  items: T[],
): (T & { category: string })[] {
  return items
    .map(item => ({ ...item, category: busLabel(item.bus_flags ?? 0) }))
    .sort((a, b) => BUS_ORDER.indexOf(a.category) - BUS_ORDER.indexOf(b.category))
}
