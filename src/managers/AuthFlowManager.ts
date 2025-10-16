import type { Address } from 'viem'
import { getAddress } from 'viem'
import type { NyknycParameters, PKCEParams } from '../types.js'
import { SessionManager } from './SessionManager.js'
import { Logger } from '../utils/logger.js'
import { generatePKCEParams } from '../utils/pkce.js'
import { buildAuthUrl, exchangeCodeForToken, getUserInfo, openAuthWindow } from '../utils/auth.js'
import * as sessionStorage from '../utils/session-storage.js'

const PKCE_STORAGE_KEY = 'nyknyc.pkce'

/**
 * AuthFlowManager handles OAuth authentication flow
 * Consolidates PKCE generation, window management, and token exchange
 */
export class AuthFlowManager {
  constructor(
    private readonly params: NyknycParameters,
    private readonly sessionManager: SessionManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Initiate OAuth authentication flow
   * 
   * @param preOpenedWindow - Optional pre-opened window to avoid popup blockers
   * @returns Accounts and chain ID after successful authentication
   */
  async initiate(preOpenedWindow?: Window | null): Promise<{
    accounts: readonly Address[]
    chainId: number
  }> {
    this.logger.log('Initiating OAuth flow')

    // Generate PKCE parameters
    const pkceParams = await generatePKCEParams(this.params.developmentMode)
    
    // Store PKCE parameters temporarily
    sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pkceParams))
    this.logger.debug('OAuth', 'PKCE parameters generated and stored')

    // Build authorization URL
    const authUrl = buildAuthUrl(this.params, pkceParams)
    this.logger.debug('OAuth', 'Authorization URL built')

    // Get API URL for polling
    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'

    // Open OAuth in a new tab/window with hybrid postMessage + polling strategy
    // This handles both direct auth (email/OTP) and OAuth redirects (Google/Discord)
    const { code, state } = await openAuthWindow(
      authUrl,
      pkceParams.state,  // Used for polling fallback
      apiUrl,            // For polling endpoint
      preOpenedWindow,
      this.params.baseUrl
    )
    this.logger.debug('OAuth', 'Authorization code received via postMessage or polling')

    // Complete the flow with received code/state
    return await this.complete({ code, state })
  }

  /**
   * Complete OAuth authentication flow
   * Exchanges authorization code for tokens and creates session
   * 
   * @param callbackData - Authorization code and state from callback
   * @returns Accounts and chain ID after successful authentication
   */
  async complete(callbackData: { code: string; state: string }): Promise<{
    accounts: readonly Address[]
    chainId: number
  }> {
    this.logger.log('Completing OAuth flow')
    
    // Get stored PKCE parameters
    const storedPkce = sessionStorage.getItem(PKCE_STORAGE_KEY)
    if (!storedPkce) {
      this.logger.error('Missing PKCE parameters during auth completion')
      throw new Error('Missing PKCE parameters. Authentication session may have expired.')
    }

    const pkceParams: PKCEParams = JSON.parse(storedPkce)
    this.logger.debug('OAuth', 'Retrieved PKCE parameters for token exchange')

    try {
      // Exchange authorization code for tokens
      this.logger.debug('OAuth', 'Exchanging authorization code for tokens')
      const tokens = await exchangeCodeForToken(
        this.params,
        callbackData.code,
        pkceParams.codeVerifier,
      )
      this.logger.debug('OAuth', `Token exchange successful, expires in: ${tokens.expires_in}s`)

      // Get user information
      this.logger.debug('OAuth', 'Fetching user information')
      const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
      const userInfo = await getUserInfo(apiUrl, tokens.access_token)
      this.logger.debug('OAuth', 'User info retrieved:', {
        wallet_address: userInfo.wallet_address,
        current_chain_id: userInfo.current_chain_id,
      })

      // Create and store session
      const session = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        walletAddress: getAddress(userInfo.wallet_address),
        chainId: userInfo.current_chain_id,
        supportedChains: userInfo.supported_chains,
      }

      this.sessionManager.set(session)
      await this.sessionManager.persist()
      this.logger.log('Session created and stored successfully')

      // Clean up PKCE parameters
      sessionStorage.removeItem(PKCE_STORAGE_KEY)
      this.logger.debug('OAuth', 'PKCE parameters cleaned up')

      return {
        accounts: [session.walletAddress],
        chainId: session.chainId,
      }
    } catch (error) {
      this.logger.error('Error during OAuth flow completion:', error)
      // Clean up PKCE parameters on error
      sessionStorage.removeItem(PKCE_STORAGE_KEY)
      throw error
    }
  }

  /**
   * Clean up any temporary OAuth state
   * Call this on errors or cancellation
   */
  cleanup(): void {
    sessionStorage.removeItem(PKCE_STORAGE_KEY)
    this.logger.debug('OAuth', 'Temporary state cleaned up')
  }
}
