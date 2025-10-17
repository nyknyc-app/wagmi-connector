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
 * 
 * @param popupUrl - The URL to open in the window
 * @param baseUrl - Base URL for validating postMessage origin
 * @param preOpenedWindow - Optional pre-opened window to avoid popup blockers
 * @param forcePopupBlock - Optional testing parameter to simulate popup blocking
 */
export function openSigningWindow(
  popupUrl: string, 
  baseUrl?: string,
  preOpenedWindow?: Window | null,
  forcePopupBlock?: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const allowedHost = baseUrl ? new URL(baseUrl).host : 'nyknyc.app'

    const tryOpenWindow = (url: string): Window | null => {
      // If a pre-opened window was provided, navigate it to the URL
      if (preOpenedWindow && !preOpenedWindow.closed) {
        try {
          preOpenedWindow.location.href = url
          return preOpenedWindow
        } catch {
          // If navigation fails, fall through to open new window
        }
      }
      
      // Otherwise try to open a new window
      return window.open(url, '_blank')
    }

    const setupWindow = (win: Window) => {
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

      // Resolve immediately so the caller can start polling server-side status.
      resolve()
    }

    // Try to open the window
    let win = tryOpenWindow(popupUrl)

    // For testing: force popup block detection even if window opened successfully
    if (forcePopupBlock && win) {
      // Close the successfully opened window for testing
      try { win.close() } catch {}
      win = null
    }

    if (!win) {
      // Popup was blocked - show snackbar with retry button
      // Import snackbar dynamically to avoid circular dependencies
      import('./snackbar.js').then(({ getSnackbar, RETRY_BUTTON }) => {
        const snackbar = getSnackbar()
        
        snackbar.presentItem({
          autoExpand: true,
          message: 'Popup was blocked. Please try again.',
          menuItems: [
            {
              ...RETRY_BUTTON,
              onClick: () => {
                win = tryOpenWindow(popupUrl)
                if (win) {
                  snackbar.clear()
                  setupWindow(win)
                } else {
                  // Still blocked after retry
                  snackbar.clear()
                  reject(new Error('Failed to open window. Please allow popups for this site.'))
                }
              },
            },
          ],
        })
      }).catch(() => {
        // Fallback if snackbar fails to load
        reject(new Error('Failed to open NYKNYC window. Please allow popups for this site.'))
      })
    } else {
      setupWindow(win)
    }
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

/**
 * Polls the OAuth status endpoint to retrieve authorization code
 * 
 * This is used as a fallback when postMessage communication fails due to OAuth redirects
 * (e.g., when user authenticates via Google/Discord which causes the popup to lose context)
 * 
 * Flow:
 * 1. NYKNYC backend stores authorization code in Redis after OAuth callback
 * 2. This function polls GET /oauth/poll-status/{state} every 2 seconds
 * 3. Returns when status becomes 'completed' (with code) or 'error'/'expired'
 * 4. Backend maintains a 30-second grace period after first retrieval
 * 
 * Security:
 * - Authorization code is useless without PKCE code_verifier (which only client has)
 * - State parameter is cryptographically random (32 bytes)
 * - Redis key auto-expires after 5 minutes
 * - Code can only be exchanged once at token endpoint
 * 
 * @param apiUrl - Base API URL (e.g., 'https://api.nyknyc.app')
 * @param state - PKCE state parameter (used as Redis key identifier)
 * @param maxAttempts - Maximum number of polling attempts (default: 150 = 5 minutes at 2s interval)
 * @param intervalMs - Milliseconds between polling attempts (default: 2000 = 2 seconds)
 * @returns Promise resolving to {code, state} when auth completes
 * @throws Error if auth fails, expires, or times out
 */
export async function pollAuthStatus(
  apiUrl: string,
  state: string,
  maxAttempts: number = 150, // 150 * 2s = 5 minutes total timeout
  intervalMs: number = 2000   // Poll every 2 seconds
): Promise<{ code: string; state: string }> {
  // Validate inputs
  if (!state || typeof state !== 'string') {
    throw new Error('Invalid state parameter for polling')
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Make GET request to polling endpoint
      const response = await fetch(`${apiUrl}/oauth/poll-status/${state}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      // Parse response body (even for non-200 responses to check for specific error structures)
      let data: import('../types.js').AuthPollResponse
      try {
        data = await response.json() as import('../types.js').AuthPollResponse
      } catch (parseError) {
        // If we can't parse JSON, fall back to HTTP status code handling
        if (!response.ok) {
          if (response.status === 404) {
            // State not found - continue polling (may not be created yet)
            await new Promise((resolve) => setTimeout(resolve, intervalMs))
            continue
          } else if (response.status === 429) {
            // Rate limited - wait longer before next attempt
            await new Promise((resolve) => setTimeout(resolve, intervalMs * 2))
            continue
          } else if (response.status >= 500) {
            // Server error - continue polling with exponential backoff
            const backoffMs = Math.min(intervalMs * Math.pow(1.5, attempt), 10000)
            await new Promise((resolve) => setTimeout(resolve, backoffMs))
            continue
          }
          
          throw new Error(`Polling failed with status ${response.status}`)
        }
        throw parseError
      }

      // Check for "not_found" status in response body (backend may return this instead of 404)
      if (data.status === 'not_found') {
        // Authorization request not found yet - continue polling (backend may not have created it yet)
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
        continue
      }

      // Handle different status values
      switch (data.status) {
        case 'completed':
          // Success! Authorization code is ready
          if (!data.code || typeof data.code !== 'string') {
            throw new Error('Invalid response: missing authorization code')
          }
          return { code: data.code, state }

        case 'error':
          // Authentication failed (e.g., user denied consent)
          throw new Error(data.error || 'Authentication failed')

        case 'expired':
          // Request expired or was not found
          throw new Error(data.error || 'Authentication request expired')

        case 'pending':
          // Still waiting - continue polling
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
          break

        default:
          // Unknown status - continue polling but log warning
          console.warn('Unknown polling status:', data.status)
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
    } catch (error) {
      // If this is the last attempt, throw the error
      if (attempt === maxAttempts - 1) {
        throw error
      }

      // For network errors, continue polling with backoff
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const backoffMs = Math.min(intervalMs * Math.pow(1.5, attempt), 10000)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
        continue
      }

      // For other errors, rethrow immediately
      throw error
    }
  }

  // Timeout - exceeded maximum polling attempts
  throw new Error('Authentication timeout: polling exceeded maximum duration (5 minutes)')
}
