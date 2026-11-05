import { networkInterfaces } from 'node:os'

export interface LocalAddress {
  address: string
  iface: string
  kind: 'tailscale' | 'lan'
}

/** IPv4 locais úteis para o modo LAN/Tailscale (Tailscale usa 100.64.0.0/10). */
export function localAddresses(): LocalAddress[] {
  const out: LocalAddress[] = []
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const [a, b] = info.address.split('.').map(Number)
      const tailscale = a === 100 && b >= 64 && b <= 127
      out.push({ address: info.address, iface, kind: tailscale ? 'tailscale' : 'lan' })
    }
  }
  return out.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'tailscale' ? -1 : 1))
}
