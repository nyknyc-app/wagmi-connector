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
 * Opens OAuth in a new tab/window (not a sized popup) and resolves when NYKNYC sends postMessage.
 * The window opens NYKNYC's OAuth page where the user authenticates.
 * After authentication, NYKNYC posts the result back to the opener:
 *   window.opener.postMessage({ type: 'NYKNYC_AUTH_SUCCESS', code, state }, dappOrigin);
 * On error, it posts:
 *   window.opener.postMessage({ type: 'NYKNYC_AUTH_ERROR', error }, dappOrigin);
 *
 * Security:
 * - Only accepts postMessages from NYKNYC's origin (validated against baseUrl parameter).
 * - Times out after 5 minutes.
 * - Detects manual close via win.closed polling.
 */
export function openAuthWindow(
  authUrl: string,
  preOpenedWindow?: Window | null,
  baseUrl?: string
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

    // Expected origin is NYKNYC's origin (where the OAuth page is hosted)
    // NOT the dApp's origin (window.location.origin)
    const expectedOrigin = baseUrl || 'https://nyknyc.app'

    const onMessage = (event: MessageEvent) => {
      try {
        if (event.origin !== expectedOrigin) {
          return
        }
      } catch {
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
      try { 
        if (!win.closed) {
          win.close()
        }
      } catch {}
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
