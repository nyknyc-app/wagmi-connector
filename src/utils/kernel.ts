import type { Hex } from 'viem'
import { hashTypedData } from 'viem'

/**
 * Kernel typed-data domain for digest wrapping.
 * Matches Kernel v0.3.3 WeightedValidator expectations.
 */
export function computeKernelDomain(account: Hex, chainId: number) {
  return {
    name: 'Kernel',
    version: '0.3.3',
    chainId: BigInt(chainId),
    verifyingContract: account,
  }
}

/**
 * Wraps a raw 32-byte digest into the Kernel typed-data envelope.
 * Returns the kernelDigest (bytes32) to be used for verification.
 */
export function kernelWrapDigest(rawHash: Hex, domain: any): Hex {
  return hashTypedData({
    domain,
    types: { Kernel: [{ name: 'hash', type: 'bytes32' }] },
    primaryType: 'Kernel',
    message: { hash: rawHash },
  }) as Hex
}
