import type { Address, PublicClient } from 'viem'
import type { SignStatus } from '../types.js'
import { verifySmartSignature } from './verify.js'

/**
 * Normalize SignStatus payloads from backend.
 * Accepts:
 *  A) Canonical shape:
 *     {
 *       ...,
 *       signature_format,
 *       message_hash,
 *       typed_data_hash,
 *       envelope: { signature_6492, finalSignature, metadata }
 *     }
 *  B) Nested envelope shape (legacy):
 *     {
 *       envelope: {
 *         signature_format,
 *         message_hash,
 *         typed_data_hash,
 *         envelope: { signature_6492, finalSignature, metadata }
 *       }
 *     }
 */
export function normalizeSignStatusPayload(raw: any): SignStatus {
  if (!raw) return raw as SignStatus

  // Legacy nested shape: lift fields up and reassign envelope to inner object.
  if (raw.envelope && raw.envelope.envelope) {
    const outer = raw.envelope
    const inner = outer.envelope
    const normalized: SignStatus = {
      ...raw,
      signature_format: outer.signature_format ?? raw.signature_format,
      message_hash: outer.message_hash ?? raw.message_hash,
      typed_data_hash: outer.typed_data_hash ?? raw.typed_data_hash,
      envelope: {
        finalSignature: inner.finalSignature,
        signature_6492: inner.signature_6492,
        hashForVerification: inner.hashForVerification,
        kernelDigestSigned: inner.kernelDigestSigned,
        metadata: inner.metadata,
      },
    }
    // Remove legacy nesting artifacts for cleanliness
    delete (normalized as any).envelope.envelope
    delete (normalized as any).envelope.signature_format
    delete (normalized as any).envelope.message_hash
    delete (normalized as any).envelope.typed_data_hash
    return normalized
  }

  // Already canonical or unknown extra fields — return as-is.
  return raw as SignStatus
}

/**
 * Verify directly from a /user/sign/:id poll response (works for both deployed and undeployed).
 * - Normalizes payload shape.
 * - Uses message_hash / typed_data_hash when available to avoid hashing drift.
 */
export async function verifyFromSignPollResponse(params: {
  statusPayload: any
  client: PublicClient
  address?: Address
}): Promise<boolean> {
  const { statusPayload, client, address } = params
  const st = normalizeSignStatusPayload(statusPayload)

  if (st.status !== 'signed') return false

  const signer = (address ?? st.signer_address) as Address
  if (!signer) return false

  const kind = st.signature_type === 'eip712' ? 'eip712' : 'personal'
  const signature_6492 = st.envelope?.signature_6492 as `0x${string}` | undefined
  const finalSignature = st.envelope?.finalSignature as `0x${string}` | undefined

  return verifySmartSignature({
    address: signer,
    kind,
    signature_6492,
    finalSignature,
    message_hash: st.message_hash as `0x${string}` | undefined,
    typed_data_hash: st.typed_data_hash as `0x${string}` | undefined,
    client,
  })
}
