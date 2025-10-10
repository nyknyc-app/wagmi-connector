import type { 
  AuthCallbackData, 
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
  const redirectUri = params.redirectUri || `${window.location.origin}/callback`
  
  const url = new URL(`${baseUrl}/auth`)
  url.searchParams.set('app_id', params.appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', pkceParams.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', pkceParams.state)
  url.searchParams.set('response_type', 'code')
  
  return url.toString()
}

/**
 * Initiates OAuth redirect flow
 */
export function initiateAuthRedirect(authUrl: string): void {
  // Store current URL for post-auth redirect
  sessionStorage.setItem('nyknyc.preAuthUrl', window.location.href)
  
  // Redirect to OAuth provider
  window.location.href = authUrl
}

/**
 * Checks if current URL contains OAuth callback parameters
 */
export function isAuthCallback(): boolean {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.has('code') && urlParams.has('state')
}

/**
 * Extracts OAuth callback data from current URL
 */
export function extractCallbackData(): AuthCallbackData {
  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get('code')
  const state = urlParams.get('state')

  if (!code || !state) {
    throw new Error('Missing OAuth callback parameters')
  }

  return { code, state }
}

/**
 * Cleans up OAuth callback parameters from URL
 */
export function cleanupCallbackUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  
  // Update URL without triggering page reload
  window.history.replaceState({}, document.title, url.toString())
}

/**
 * Handles OAuth redirect flow - checks for callback and processes if present
 */
export async function handleAuthRedirect(
  _params: NyknycParameters
): Promise<AuthCallbackData | null> {
  if (!isAuthCallback()) {
    console.log('No OAuth callback detected in current URL')
    return null
  }

  console.log('OAuth callback detected, processing...')

  try {
    // Extract callback data
    const callbackData = extractCallbackData()
    console.log('Extracted callback data:', { code: callbackData.code.substring(0, 10) + '...', state: callbackData.state })
    
    // Get stored PKCE parameters
    const storedPkce = sessionStorage.getItem('nyknyc.pkce')
    if (!storedPkce) {
      console.error('Missing PKCE parameters in sessionStorage')
      throw new Error('Missing PKCE parameters. Authentication session may have expired.')
    }

    const pkceParams = JSON.parse(storedPkce)
    console.log('Retrieved PKCE parameters:', { state: pkceParams.state })
    
    // Validate state parameter
    validateState(callbackData.state, pkceParams.state)
    console.log('State parameter validated successfully')
    
    // Clean up URL but DON'T remove PKCE parameters yet - they're needed for token exchange
    cleanupCallbackUrl()
    console.log('Callback URL cleaned up')
    
    return callbackData
  } catch (error) {
    console.error('Error handling auth redirect:', error)
    // Clean up on error
    cleanupCallbackUrl()
    sessionStorage.removeItem('nyknyc.pkce')
    throw error
  }
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
  const redirectUri = params.redirectUri || `${window.location.origin}/callback`
  
  const requestBody = {
    grant_type: 'authorization_code',
    code,
    app_id: params.appId,
    redirect_uri: redirectUri,
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
 * Opens OAuth in a new tab/window (not a sized popup) and resolves on callback postMessage.
 * The child window is expected to land on redirectUri (same-origin with the dApp by default)
 * and post to the opener:
 *   window.opener.postMessage({ type: 'NYKNYC_AUTH_SUCCESS', code, state }, window.location.origin);
 * On error, it should post:
 *   window.opener.postMessage({ type: 'NYKNYC_AUTH_ERROR', error }, window.location.origin);
 *
 * Security:
 * - Only accepts messages from window.location.origin (i.e., same-origin callback page).
 * - Times out after 5 minutes.
 * - Detects manual close via win.closed polling.
 */
export function openAuthWindow(
  authUrl: string,
  preOpenedWindow?: Window | null
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    // Open a new tab/window. If a preOpenedWindow was provided (opened synchronously on user gesture), reuse it to avoid popup blockers.
    let win: Window | null = preOpenedWindow ?? null
    if (win) {
      try { win.location.href = authUrl } catch {}
    } else {
      win = window.open(authUrl, '_blank')
    }
    if (!win) {
      reject(new Error('Failed to open authentication window. Please allow popups for this site.'))
      return
    }

    const expectedOrigin = window.location.origin

    const onMessage = (event: MessageEvent) => {
      try {
        if (event.origin !== expectedOrigin) {
          return
        }
      } catch {
        // Ignore unparsable origins
        return
      }

      const data = event.data || {}
      if (data?.type === 'NYKNYC_AUTH_SUCCESS' && typeof data.code === 'string' && typeof data.state === 'string') {
        cleanup()
        try { win.close() } catch {}
        resolve({ code: data.code, state: data.state })
      } else if (data?.type === 'NYKNYC_AUTH_ERROR') {
        cleanup()
        try { win.close() } catch {}
        reject(new Error(data.error || 'Authentication failed'))
      }
    }

    const onClosedCheck = setInterval(() => {
      if (win.closed) {
        cleanup()
        reject(new Error('Authentication window was closed by the user'))
      }
    }, 1000)

    const onTimeout = window.setTimeout(() => {
      cleanup()
      try { if (!win.closed) win.close() } catch {}
      reject(new Error('Authentication timed out'))
    }, 5 * 60 * 1000)

    function cleanup() {
      window.removeEventListener('message', onMessage)
      clearInterval(onClosedCheck)
      clearTimeout(onTimeout)
    }

    window.addEventListener('message', onMessage)
  })
}
