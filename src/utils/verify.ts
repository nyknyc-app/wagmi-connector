import type { Hex } from 'viem'

/**
 * ERC-6492 magic suffix used to mark wrapped signatures.
 * This exact value is used by widely adopted implementations.
 */
export const ERC6492_MAGIC_SUFFIX =
  '0x6492649264926492649264926492649264926492649264926492649264926492' as const

/**
 * Returns true if the signature appears to be ERC-6492 wrapped.
 */
export function isErc6492Signature(signature: Hex): boolean {
  if (!signature || signature.length < ERC6492_MAGIC_SUFFIX.length) return false
  return signature.toLowerCase().endsWith(ERC6492_MAGIC_SUFFIX.slice(2).toLowerCase())
}

/**
 * Trim any trailing bytes after the ERC-6492 magic suffix.
 * Some producers may accidentally append extra data; verifiers expect magic at the very end.
 */
export function sanitizeErc6492(signature: Hex): Hex {
  if (!signature || signature.length < ERC6492_MAGIC_SUFFIX.length) return signature
  const content = signature.slice(2)
  const lower = content.toLowerCase()
  const magic = ERC6492_MAGIC_SUFFIX.slice(2).toLowerCase()
  const idx = lower.lastIndexOf(magic)
  if (idx === -1) return signature
  const end = idx + magic.length
  return (`0x${content.slice(0, end)}`) as Hex
}
