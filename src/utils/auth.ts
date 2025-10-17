import type { 
  TokenResponse, 
  UserInfo, 
  PKCEParams,
  NyknycParameters 
} from '../types.js'

/**
 * Builds the OAuth authorization URL with PKCE parameters
 */
export function buildAuthUrl(
  params: NyknycParameters,
  pkceParams: PKCEParams
): string {
  const baseUrl = params.baseUrl || 'https://nyknyc.app'
  
  const url = new URL(`${baseUrl}/auth`)
  url.searchParams.set('app_id', params.appId)
  url.searchParams.set('code_challenge', pkceParams.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', pkceParams.state)
  url.searchParams.set('response_type', 'code')
  
  // Add callback origin so the OAuth page knows where to send postMessage
  url.searchParams.set('callback_origin', window.location.origin)
  
  return url.toString()
}

/**
 * Exchanges authorization code for access token
 */
export async function exchangeCodeForToken(
  params: NyknycParameters,
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const apiUrl = params.apiUrl || 'https://api.nyknyc.app'
  
  const requestBody = {
    grant_type: 'authorization_code',
    code,
    app_id: params.appId,
    code_verifier: codeVerifier,
  }
  
  console.log('Token exchange request:', {
    url: `${apiUrl}/oauth/token`,
    body: { ...requestBody, code: code.substring(0, 10) + '...', code_verifier: codeVerifier.substring(0, 10) + '...' }
  })
  
  const response = await fetch(`${apiUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  console.log('Token exchange response status:', response.status, response.statusText)

  if (!response.ok) {
    const error = await response.text()
    console.error('Token exchange failed with error:', error)
    throw new Error(`Token exchange failed (${response.status}): ${error}`)
  }

  const tokenData = await response.json()
  console.log('Token exchange successful, received token type:', tokenData.token_type)
  return tokenData
}

/**
 * Fetches user information using access token
 */
export async function getUserInfo(
  apiUrl: string,
  accessToken: string
): Promise<UserInfo> {
  const response = await fetch(`${apiUrl}/user/info`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to fetch user info: ${error}`)
  }

  return response.json()
}

/**
 * Refreshes access token using refresh token
 */
export async function refreshAccessToken(
  apiUrl: string,
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(`${apiUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${error}`)
  }

  return response.json()
}

/**
 * Verifies an access token with the API. Intended for optional, one-shot checks on restore.
 * Returns true if valid, false if invalid/revoked/expired.
 */
export async function verifyAccessToken(apiUrl: string, accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/oauth/verify-token/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.ok) return true
    if (response.status === 401 || response.status === 403) return false

    // Non-auth related errors: treat as invalid but do not throw to keep UX smooth
    console.warn('verifyAccessToken: unexpected status', response.status, response.statusText)
    return false
  } catch (err) {
    console.warn('verifyAccessToken: request failed', err)
    return false
  }
}

/**
 * Validates state parameter to prevent CSRF attacks
 */
export function validateState(receivedState: string, expectedState: string): void {
  if (receivedState !== expectedState) {
    throw new Error('Invalid state parameter. Possible CSRF attack.')
  }
}

/**
 * Opens OAuth in a new tab/window with hybrid postMessage + polling fallback strategy.
 * 
 * This function implements a robust authentication flow that handles both:
 * 1. Direct postMessage communication (when NYKNYC page can message back)
 * 2. Polling fallback (when OAuth redirects break postMessage context)
 * 
 * Flow:
 * - Opens NYKNYC OAuth page in new window
 * - Listens for postMessage immediately (fast path for non-OAuth flows)
 * - After 10 seconds without postMessage, starts polling backend
 * - First successful method wins and returns the authorization code
 * 
 * Use Cases:
 * - postMessage wins: User logs in with email/OTP (no external redirect)
 * - Polling wins: User logs in with Google/Discord (external OAuth breaks postMessage)
 * 
 * Security:
 * - Only accepts postMessages from NYKNYC's origin
 * - Authorization code is useless without PKCE code_verifier
 * - 5-minute total timeout for both methods
 * - Window close detection for user cancellation
 * 
 * @param authUrl - Full URL to NYKNYC auth page (includes PKCE params)
 * @param state - PKCE state parameter (used for polling fallback)
 * @param apiUrl - API URL for polling endpoint
 * @param preOpenedWindow - Optional pre-opened window to avoid popup blockers
 * @param baseUrl - Base URL for validating postMessage origin
 * @returns Promise resolving to {code, state} when auth completes
 * @throws Error if auth fails, is cancelled, or times out
 */
export function openAuthWindow(
  authUrl: string,
  state: string,
  apiUrl: string,
  preOpenedWindow?: Window | null,
  baseUrl?: string
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    // Track which method completed first
    let resolved = false
    let pollingStarted = false
    let pollingAbortController: AbortController | null = null

    // Open a new tab/window. If preOpenedWindow was provided (opened synchronously on user gesture),
    // reuse it to avoid popup blockers.
    let win: Window | null = preOpenedWindow ?? null
    if (win) {
      try { 
        win.location.href = authUrl 
      } catch {
        // If navigation fails, fall through to open new window
        win = null
      }
    }
    
    if (!win) {
      win = window.open(authUrl, '_blank')
    }
    
    if (!win) {
      reject(new Error('Failed to open authentication window. Please allow popups for this site.'))
      return
    }

    // Expected origin is NYKNYC's origin (where the OAuth page is hosted)
    const expectedOrigin = baseUrl || 'https://nyknyc.app'

    /**
     * PostMessage handler (primary method - fast path)
     * Handles direct communication from NYKNYC page
     * Note: No longer rejects on errors - falls back to polling instead
     */
    const onMessage = (event: MessageEvent) => {
      // Validate origin for security
      try {
        if (event.origin !== expectedOrigin) {
          return
        }
      } catch {
        return
      }

      const data = event.data || {}
      
      // Success case - postMessage wins!
      if (data?.type === 'NYKNYC_AUTH_SUCCESS' && typeof data.code === 'string' && typeof data.state === 'string') {
        if (!resolved) {
          resolved = true
          cleanup()
          try { win?.close() } catch {}
          resolve({ code: data.code, state: data.state })
        }
      } 
      // Error case - log but don't reject, let polling determine actual status
      // This prevents false negatives from postMessage errors during redirects
      else if (data?.type === 'NYKNYC_AUTH_ERROR') {
        console.warn('[NYKNYC] PostMessage error received (will rely on polling):', data.error)
        // Don't reject - polling will provide definitive answer from backend
      }
    }

    /**
     * Polling (concurrent method - reliable fallback)
     * Starts immediately alongside postMessage
     * Handles cases where postMessage fails (OAuth redirects, cross-origin issues, etc.)
     */
    const startPollingFallback = async () => {
      if (resolved || pollingStarted) return
      
      pollingStarted = true
      pollingAbortController = new AbortController()

      try {
        // Import polling function
        const { pollAuthStatus } = await import('./api.js')
        
        // Start polling (will run until success, error, or timeout)
        const result = await pollAuthStatus(apiUrl, state)
        
        // Only resolve if postMessage hasn't already won
        if (!resolved) {
          resolved = true
          cleanup()
          try { win?.close() } catch {}
          resolve(result)
        }
      } catch (error) {
        // Only reject if postMessage hasn't already won
        if (!resolved) {
          resolved = true
          cleanup()
          try { win?.close() } catch {}
          reject(error)
        }
      }
    }

    /**
     * Overall timeout (5 minutes)
     * Ensures we don't wait forever
     */
    const onTimeout = window.setTimeout(() => {
      if (!resolved) {
        resolved = true
        cleanup()
        try { 
          if (win && !win.closed) {
            win.close()
          }
        } catch {}
        reject(new Error('Authentication timed out (5 minutes)'))
      }
    }, 5 * 60 * 1000)

    /**
     * Cleanup function
     * Removes all listeners and timers
     */
    function cleanup() {
      window.removeEventListener('message', onMessage)
      clearTimeout(onTimeout)
      
      // Abort ongoing polling if any
      if (pollingAbortController) {
        pollingAbortController.abort()
      }
    }

    // Start listening for postMessage immediately (fast path)
    window.addEventListener('message', onMessage)
    
    // Start polling immediately (reliable path)
    // This prevents false positives from window closure detection during OAuth redirects
    // and ensures we get definitive status from the backend
    startPollingFallback()
  })
}
