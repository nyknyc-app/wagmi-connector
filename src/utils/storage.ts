import type { NyknycSession } from '../types.js'

/**
 * Storage interface for abstracting different storage backends
 */
interface StorageBackend {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

/**
 * Internal storage manager for NYKNYC connector
 * Provides a unified interface for session persistence with fallback strategies
 */
export class NyknycStorage {
  private readonly storageKey: string
  private readonly wagmiStorage: StorageBackend | null
  private readonly fallbackStorage: StorageBackend

  constructor(wagmiStorage: StorageBackend | null = null, keyPrefix: string = 'nyknyc') {
    this.storageKey = 'session'
    this.wagmiStorage = wagmiStorage
    this.fallbackStorage = new LocalStorageBackend(keyPrefix)
  }

  /**
   * Retrieves session data from storage
   * @returns Parsed session data or null if not found
   */
  async getSession(): Promise<NyknycSession | null> {
    try {
      const sessionData = await this.getItem(this.storageKey)
      if (!sessionData) {
        return null
      }

      const parsed = JSON.parse(sessionData) as NyknycSession
      
      // Validate session structure
      if (!this.isValidSession(parsed)) {
        console.warn('NYKNYC: Invalid session data found, clearing storage')
        await this.removeSession()
        return null
      }

      return parsed
    } catch (error) {
      console.warn('NYKNYC: Failed to retrieve session from storage:', error)
      return null
    }
  }

  /**
   * Stores session data to storage
   * @param session - Session data to store
   */
  async setSession(session: NyknycSession): Promise<void> {
    try {
      const serialized = JSON.stringify(session)
      await this.setItem(this.storageKey, serialized)
    } catch (error) {
      console.warn('NYKNYC: Failed to store session:', error)
      // Don't throw - graceful degradation for storage failures
    }
  }

  /**
   * Removes session data from storage
   */
  async removeSession(): Promise<void> {
    try {
      await this.removeItem(this.storageKey)
    } catch (error) {
      console.warn('NYKNYC: Failed to remove session from storage:', error)
      // Silent fail for cleanup operations
    }
  }

  /**
   * Checks if session data is still valid (not expired)
   * @param session - Session to validate
   * @param bufferMinutes - Buffer time in minutes before expiration
   * @returns True if session is valid and not expired
   */
  isSessionValid(session: NyknycSession | null, bufferMinutes: number = 5): boolean {
    if (!session) {
      return false
    }

    // Check if token is expired (with buffer)
    const bufferMs = bufferMinutes * 60 * 1000
    const isExpired = Date.now() >= (session.expiresAt - bufferMs)
    
    return !isExpired
  }

  /**
   * Gets item from storage with fallback strategy
   * @private
   */
  private async getItem(key: string): Promise<string | null> {
    // Try wagmi storage first
    if (this.wagmiStorage) {
      try {
        const result = await this.wagmiStorage.getItem(key)
        if (result !== null) {
          return result
        }
      } catch (error) {
        console.warn('NYKNYC: Wagmi storage getItem failed, falling back to localStorage:', error)
      }
    }

    // Fallback to localStorage
    try {
      return await this.fallbackStorage.getItem(key)
    } catch (error) {
      console.warn('NYKNYC: Fallback storage getItem failed:', error)
      return null
    }
  }

  /**
   * Sets item in storage with fallback strategy
   * @private
   */
  private async setItem(key: string, value: string): Promise<void> {
    let wagmiSuccess = false

    // Try wagmi storage first
    if (this.wagmiStorage) {
      try {
        await this.wagmiStorage.setItem(key, value)
        wagmiSuccess = true
      } catch (error) {
        console.warn('NYKNYC: Wagmi storage setItem failed, falling back to localStorage:', error)
      }
    }

    // Always try fallback storage as well for redundancy
    try {
      await this.fallbackStorage.setItem(key, value)
    } catch (error) {
      console.warn('NYKNYC: Fallback storage setItem failed:', error)
      
      // If both storages failed, throw error
      if (!wagmiSuccess) {
        throw new Error('Failed to persist session data')
      }
    }
  }

  /**
   * Removes item from storage with fallback strategy
   * @private
   */
  private async removeItem(key: string): Promise<void> {
    // Try wagmi storage first
    if (this.wagmiStorage) {
      try {
        await this.wagmiStorage.removeItem(key)
      } catch (error) {
        console.warn('NYKNYC: Wagmi storage removeItem failed:', error)
      }
    }

    // Also remove from fallback storage
    try {
      await this.fallbackStorage.removeItem(key)
    } catch (error) {
      console.warn('NYKNYC: Fallback storage removeItem failed:', error)
    }
  }

  /**
   * Validates session object structure
   * @private
   */
  private isValidSession(session: any): session is NyknycSession {
    return (
      session &&
      typeof session === 'object' &&
      typeof session.accessToken === 'string' &&
      typeof session.refreshToken === 'string' &&
      typeof session.expiresAt === 'number' &&
      typeof session.walletAddress === 'string' &&
      typeof session.chainId === 'number'
    )
  }
}

/**
 * LocalStorage backend implementation
 * SSR-safe: Checks for browser environment before accessing localStorage
 * @private
 */
class LocalStorageBackend implements StorageBackend {
  private readonly keyPrefix: string

  constructor(keyPrefix: string) {
    this.keyPrefix = keyPrefix
  }

  /**
   * Check if localStorage is available (browser environment)
   * Prevents SSR errors in Next.js and other server-side frameworks
   * @private
   */
  private isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
  }

  getItem(key: string): string | null {
    // Guard against SSR - return null if not in browser
    if (!this.isAvailable()) {
      return null
    }

    try {
      return localStorage.getItem(this.getFullKey(key))
    } catch (error) {
      console.warn('NYKNYC: localStorage getItem failed:', error)
      return null
    }
  }

  setItem(key: string, value: string): void {
    // Guard against SSR - silently fail if not in browser
    if (!this.isAvailable()) {
      console.warn('NYKNYC: localStorage not available (SSR environment)')
      return
    }

    try {
      localStorage.setItem(this.getFullKey(key), value)
    } catch (error) {
      console.warn('NYKNYC: localStorage setItem failed:', error)
      throw error
    }
  }

  removeItem(key: string): void {
    // Guard against SSR - silently fail if not in browser
    if (!this.isAvailable()) {
      return
    }

    try {
      localStorage.removeItem(this.getFullKey(key))
    } catch (error) {
      console.warn('NYKNYC: localStorage removeItem failed:', error)
    }
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}.${key}`
  }
}
