import type { SignStatus } from '../types.js'

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
