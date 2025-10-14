import type { NyknycSession, NyknycParameters } from '../types.js'
import { NyknycStorage } from '../utils/storage.js'
import { refreshAccessToken, verifyAccessToken } from '../utils/auth.js'
import { getAddress } from 'viem'
import { Logger } from '../utils/logger.js'

/**
 * SessionManager consolidates all session-related logic
 * Single source of truth for session state and lifecycle
 */
export class SessionManager {
  private session: NyknycSession | null = null

  constructor(
    private readonly storage: NyknycStorage,
    private readonly params: NyknycParameters,
    private readonly logger: Logger,
  ) {}

  /**
   * Get current session
   */
  get(): NyknycSession | null {
    return this.session
  }

  /**
   * Set current session
   */
  set(session: NyknycSession): void {
    this.session = session
  }

  /**
   * Clear current session
   */
  clear(): void {
    this.session = null
  }

  /**
   * Check if current session is valid (not expired)
   */
  isValid(): boolean {
    if (!this.session) {
      return false
    }
    return this.storage.isSessionValid(this.session)
  }

  /**
   * Restore session from storage with token refresh if needed
   * This consolidates all session restoration logic from connector.ts
   * 
   * @returns Restored session or null if restoration fails
   */
  async restore(): Promise<NyknycSession | null> {
    try {
      const storedSession = await this.storage.getSession()
      
      if (!storedSession) {
        this.logger.log('No stored session found')
        return null
      }

      // Check if session is still valid
      if (this.storage.isSessionValid(storedSession)) {
        try {
          // Optionally verify access token with server
          if (this.params.verifyOnRestore) {
            const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
            const valid = await verifyAccessToken(apiUrl, storedSession.accessToken)
            
            if (!valid) {
              this.logger.log('Access token invalid on restore, attempting refresh')
              throw new Error('Access token invalid on restore')
            }
          }

          // Session is valid
          this.session = {
            ...storedSession,
            walletAddress: getAddress(storedSession.walletAddress),
          }
          
          this.logger.log('Session restored successfully:', {
            address: this.session.walletAddress,
            chainId: this.session.chainId,
          })
          
          return this.session
        } catch (e) {
          // Token invalidated or verification failed -> attempt refresh
          return await this.attemptRefresh(storedSession)
        }
      } else {
        // Session expired -> attempt refresh
        this.logger.log('Session expired, attempting token refresh')
        return await this.attemptRefresh(storedSession)
      }
    } catch (error) {
      this.logger.error('Failed to restore session:', error)
      await this.storage.removeSession()
      this.session = null
      return null
    }
  }

  /**
   * Attempt to refresh tokens using refresh token
   * 
   * @param storedSession - The expired/invalid session
   * @returns Refreshed session or null if refresh fails
   */
  private async attemptRefresh(storedSession: NyknycSession): Promise<NyknycSession | null> {
    try {
      const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
      const refreshedTokens = await refreshAccessToken(apiUrl, storedSession.refreshToken)
      
      this.session = {
        ...storedSession,
        accessToken: refreshedTokens.access_token,
        refreshToken: refreshedTokens.refresh_token,
        expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
        walletAddress: getAddress(storedSession.walletAddress),
      }
      
      await this.storage.setSession(this.session)
      this.logger.log('Token refresh successful')
      
      return this.session
    } catch (error) {
      this.logger.warn('Token refresh failed, clearing session:', error)
      await this.storage.removeSession()
      this.session = null
      return null
    }
  }

  /**
   * Refresh current session's access token
   * Used by provider when tokens expire during operations
   * 
   * @returns New access token
   * @throws Error if no active session or refresh fails
   */
  async refreshToken(): Promise<string> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const refreshedTokens = await refreshAccessToken(apiUrl, this.session.refreshToken)
    
    this.session.accessToken = refreshedTokens.access_token
    this.session.refreshToken = refreshedTokens.refresh_token
    this.session.expiresAt = Date.now() + refreshedTokens.expires_in * 1000
    
    try {
      await this.storage.setSession(this.session)
    } catch (error) {
      // Non-fatal: storage failures are handled gracefully
      this.logger.warn('Failed to persist refreshed session:', error)
    }
    
    return this.session.accessToken
  }

  /**
   * Persist current session to storage
   */
  async persist(): Promise<void> {
    if (!this.session) {
      throw new Error('No session to persist')
    }
    
    await this.storage.setSession(this.session)
    this.logger.log('Session persisted to storage')
  }

  /**
   * Remove session from storage
   */
  async remove(): Promise<void> {
    await this.storage.removeSession()
    this.session = null
    this.logger.log('Session removed from storage')
  }
}
