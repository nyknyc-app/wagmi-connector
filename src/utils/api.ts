import type { 
  TransactionRequest, 
  TransactionResponse, 
  TransactionStatus,
  SignRequest,
  SignResponse,
  SignStatus 
} from '../types.js'

/**
 * Internal helper to perform an authenticated request with a single refresh-and-retry on 401.
 * - makeRequest receives a token and must return a fetch Response.
 * - accessToken is the current token to try first.
 * - onUnauthorized, if provided, should refresh and return a new access token.
 */
export async function withAuthFetch<T>(
  makeRequest: (token: string) => Promise<Response>,
  accessToken: string,
  onUnauthorized?: () => Promise<string>
): Promise<T> {
  let response = await makeRequest(accessToken)

  if (response.status === 401 && onUnauthorized) {
    // Attempt a single refresh, then retry once
    const newToken = await onUnauthorized()
    response = await makeRequest(newToken)
  }

  validateApiResponse(response)
  return response.json() as Promise<T>
}

/**
 * Internal normalization helpers (DRY)
 */
function unwrapApiPayload<T = any>(raw: any): T {
  if (raw && typeof raw === 'object' && 'data' in raw && (raw as any).data != null) {
    return (raw as any).data as T
  }
  return raw as T
}

type CanonicalStatus = TransactionStatus['status']

function mapStatus(rawStatus: any): CanonicalStatus {
  const s = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : ''
  switch (s) {
    case 'confirmed':
    case 'mined':
    case 'success':
    case 'completed':
      return 'completed'
    case 'broadcasted':
    case 'sent':
    case 'submitted':
    case 'broadcast':
      return 'broadcasted'
    case 'signed':
      return 'signed'
    case 'failed':
    case 'reverted':
    case 'error':
      return 'failed'
    case 'pending_signature':
    case 'pending':
    case 'awaiting_signature':
    default:
      return 'pending_signature'
  }
}

function normalizeTransactionStatus(raw: any, transactionId: string): TransactionStatus {
  const payload = unwrapApiPayload<any>(raw)

  const transaction_hash =
    payload?.transaction_hash ??
    payload?.tx_hash ??
    payload?.hash ??
    payload?.transactionHash

  let block_number: number | undefined
  if (typeof payload?.block_number === 'number') {
    block_number = payload.block_number
  } else if (typeof payload?.blockNumber === 'number') {
    block_number = payload.blockNumber
  } else if (typeof payload?.blockNumber === 'string' && payload.blockNumber.startsWith('0x')) {
    try { block_number = Number(BigInt(payload.blockNumber)) } catch {}
  }

  let gas_used: string | undefined
  if (typeof payload?.gas_used === 'string') {
    gas_used = payload.gas_used
  } else if (typeof payload?.gasUsed === 'bigint') {
    gas_used = payload.gasUsed.toString()
  } else if (typeof payload?.gasUsed === 'string' && payload.gasUsed.startsWith('0x')) {
    try { gas_used = BigInt(payload.gasUsed).toString() } catch {}
  }

  const status = mapStatus(payload?.status ?? payload?.state ?? payload?.tx_status)
  const error = payload?.error ?? payload?.message

  return {
    transaction_id: payload?.transaction_id ?? payload?.id ?? transactionId,
    status,
    transaction_hash,
    block_number,
    gas_used,
    error,
  }
}

/**
 * Creates a transaction via NYKNYC API
 */
export async function createTransaction(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  transaction: TransactionRequest,
  onUnauthorized?: () => Promise<string>
): Promise<TransactionResponse> {
  const raw = await withAuthFetch<any>(
    (token) =>
      fetch(`${apiUrl}/transactions/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Dapp-Id': dappId,
        },
        body: JSON.stringify(transaction),
      }),
    accessToken,
    onUnauthorized
  )

  // Unwrap possible { success, data } envelope & normalize to canonical shape.
  const payload = unwrapApiPayload<any>(raw)
  const id = payload?.id ?? payload?.transaction_id

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Malformed /transactions/create response: missing "id"')
  }

  const status = mapStatus(payload?.status)

  // Return a minimal, canonical response (id + normalized status).
  return {
    id,
    status,
  } as TransactionResponse
}

/**
 * Gets transaction status
 */
export async function getTransactionStatus(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  transactionId: string,
  onUnauthorized?: () => Promise<string>
): Promise<TransactionStatus> {
  const raw = await withAuthFetch<any>(
    (token) =>
      fetch(`${apiUrl}/transactions/${transactionId}/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Dapp-Id': dappId,
        },
      }),
    accessToken,
    onUnauthorized
  )
  return normalizeTransactionStatus(raw, transactionId)
}


/**
 * Create a signing request
 */
export async function createSignRequest(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  body: SignRequest,
  onUnauthorized?: () => Promise<string>
): Promise<SignResponse> {
  return withAuthFetch<SignResponse>(
    (token) =>
      fetch(`${apiUrl}/user/sign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Dapp-Id': dappId,
        },
        body: JSON.stringify(body),
      }),
    accessToken,
    onUnauthorized
  )
}

/**
 * Get signing status
 */
export async function getSignStatus(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  signId: string,
  onUnauthorized?: () => Promise<string>
): Promise<SignStatus> {
  const raw = await withAuthFetch<SignStatus>(
    (token) =>
      fetch(`${apiUrl}/user/sign/${signId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Dapp-Id': dappId,
        },
      }),
    accessToken,
    onUnauthorized
  )
  return raw
}

/**
 * Poll signing status until completion
 */
export async function waitForSignCompletion(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  signId: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000,
  onUnauthorized?: () => Promise<string>
): Promise<SignStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getSignStatus(apiUrl, accessToken, dappId, signId, onUnauthorized)
    if (status.status === 'signed') {
      return status
    }
    if (status.status === 'rejected' || status.status === 'expired' || status.status === 'failed') {
      throw new Error(status.error || `Signing ${status.status}`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Signing timeout - status polling exceeded maximum attempts')
}

/**
 * Opens unsupported chain error page in a new tab/window
 */
export function openUnsupportedChainWindow(chainId: number, baseUrl?: string): void {
  const base = baseUrl || 'https://nyknyc.app'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = `${base}/error/unsupported-chain?chainId=${chainId}&origin=${encodeURIComponent(origin)}`
  
  if (typeof window !== 'undefined') {
    window.open(url, '_blank')
  }
}

/**
 * Opens signing flow in a new tab/window and waits for completion message (postMessage).
 * Polling is expected to be handled by the caller after this resolves.
 */
export function openSigningWindow(popupUrl: string, baseUrl?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Open as a new tab/window without sizing features so it's not a small popup.
    const win = window.open(popupUrl, '_blank')
    if (!win) {
      reject(new Error('Failed to open NYKNYC window. Please allow popups for this site.'))
      return
    }

    const allowedHost = baseUrl ? new URL(baseUrl).host : 'nyknyc.app'

    // Optional message handling: if the child can postMessage to opener, close the window early.
    const messageListener = (event: MessageEvent) => {
      try {
        const eventHost = new URL(event.origin).host
        if (eventHost !== allowedHost) return
      } catch {
        return
      }

      if (event.data?.type === 'NYKNYC_SIGN_SUCCESS' || event.data?.type === 'NYKNYC_SIGN_ERROR') {
        window.removeEventListener('message', messageListener)
        try { win.close() } catch {}
      }
    }
    window.addEventListener('message', messageListener)

    // Clean up if user closes the tab manually; do not reject here to allow polling-based flows to proceed.
    const checkClosed = setInterval(() => {
      if (win.closed) {
        clearInterval(checkClosed)
        window.removeEventListener('message', messageListener)
      }
    }, 1000)

    // // Auto-close after 10 minutes to avoid orphaned tabs.
    // const timeoutId = setTimeout(() => {
    //   clearInterval(checkClosed)
    //   window.removeEventListener('message', messageListener)
    //   try { if (!win.closed) win.close() } catch {}
    // }, 10 * 60 * 1000)

    // Resolve immediately so the caller can start polling server-side status.
    resolve()
  })
}

/**
 * Opens transaction signing popup and waits for completion
 */
export function openSigningPopup(popupUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      popupUrl,
      'nyknyc-sign',
      'width=400,height=500,scrollbars=yes,resizable=yes'
    )

    if (!popup) {
      reject(new Error('Failed to open signing popup. Please allow popups for this site.'))
      return
    }

    // Listen for messages from the popup
    const messageListener = (event: MessageEvent) => {
      // Verify origin for security
      if (!event.origin.includes('nyknyc.app')) {
        return
      }

      if (event.data.type === 'NYKNYC_SIGN_SUCCESS') {
        window.removeEventListener('message', messageListener)
        popup.close()
        resolve()
      } else if (event.data.type === 'NYKNYC_SIGN_ERROR') {
        window.removeEventListener('message', messageListener)
        popup.close()
        reject(new Error(event.data.error || 'Transaction signing failed'))
      }
    }

    window.addEventListener('message', messageListener)

    // Check if popup was closed manually
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed)
        window.removeEventListener('message', messageListener)
        reject(new Error('Transaction signing was cancelled'))
      }
    }, 1000)

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkClosed)
      window.removeEventListener('message', messageListener)
      if (!popup.closed) {
        popup.close()
      }
      reject(new Error('Transaction signing timeout'))
    }, 5 * 60 * 1000)
  })
}

/**
 * Polls transaction status until a transaction hash is available (post-broadcast).
 * Returns as soon as the backend includes transaction_hash in the payload.
 * Throws if the backend reports a terminal "failed" status.
 */
export async function waitForTransactionHash(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  transactionId: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000,
  onUnauthorized?: () => Promise<string>
): Promise<TransactionStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getTransactionStatus(apiUrl, accessToken, dappId, transactionId, onUnauthorized)

    // Return as soon as hash is present (usually at 'broadcasted' or later)
    if (status.transaction_hash) {
      return status
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Transaction failed')
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Transaction hash timeout - polling exceeded maximum attempts')
}

/**
 * Polls transaction status until completion
 */
export async function waitForTransactionCompletion(
  apiUrl: string,
  accessToken: string,
  dappId: string,
  transactionId: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000,
  onUnauthorized?: () => Promise<string>
): Promise<TransactionStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getTransactionStatus(apiUrl, accessToken, dappId, transactionId, onUnauthorized)
    
    if (status.status === 'completed') {
      return status
    }
    
    if (status.status === 'failed') {
      throw new Error(status.error || 'Transaction failed')
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  
  throw new Error('Transaction timeout - status polling exceeded maximum attempts')
}

/**
 * Validates API response and throws appropriate errors
 */
export function validateApiResponse(response: Response): void {
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Please reconnect your wallet.')
    } else if (response.status === 403) {
      throw new Error('Access denied. Please check your permissions.')
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.')
    } else if (response.status >= 500) {
      throw new Error('Server error. Please try again later.')
    } else {
      throw new Error(`API request failed with status ${response.status}`)
    }
  }
}
