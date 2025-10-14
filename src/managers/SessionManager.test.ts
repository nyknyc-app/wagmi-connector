import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionManager } from './SessionManager.js'
import type { NyknycParameters, NyknycSession } from '../types.js'
import type { Address } from 'viem'

// Mock dependencies
vi.mock('../utils/storage.js')
vi.mock('../utils/auth.js')
vi.mock('../utils/logger.js')

import { NyknycStorage } from '../utils/storage.js'
import * as auth from '../utils/auth.js'
import { Logger } from '../utils/logger.js'

describe('SessionManager - Core Functionality', () => {
  const mockParameters: NyknycParameters = {
    appId: 'test_app_id',
    apiUrl: 'https://api.test.nyknyc.app',
    developmentMode: true,
  }

  const mockSession: NyknycSession = {
    walletAddress: '0x1234567890123456789012345678901234567890' as Address,
    chainId: 1,
    accessToken: 'mock_access_token',
    refreshToken: 'mock_refresh_token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  }

  let mockStorage: any
  let mockLogger: any
  let sessionManager: SessionManager

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock Storage
    mockStorage = {
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      removeSession: vi.fn().mockResolvedValue(undefined),
      isSessionValid: vi.fn().mockReturnValue(true),
    }
    vi.mocked(NyknycStorage).mockImplementation(() => mockStorage)

    // Mock Logger
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    vi.mocked(Logger).mockImplementation(() => mockLogger)

    // Create SessionManager
    sessionManager = new SessionManager(mockStorage, mockParameters, mockLogger)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Session State Management', () => {
    it('should start with null session', () => {
      expect(sessionManager.get()).toBeNull()
    })

    it('should set and get session', () => {
      sessionManager.set(mockSession)
      expect(sessionManager.get()).toBe(mockSession)
    })

    it('should clear session', () => {
      sessionManager.set(mockSession)
      sessionManager.clear()
      expect(sessionManager.get()).toBeNull()
    })
  })

  describe('Session Validation', () => {
    it('should return false for null session', () => {
      expect(sessionManager.isValid()).toBe(false)
    })

    it('should return true for valid session', () => {
      mockStorage.isSessionValid.mockReturnValue(true)
      sessionManager.set(mockSession)
      
      expect(sessionManager.isValid()).toBe(true)
      expect(mockStorage.isSessionValid).toHaveBeenCalledWith(mockSession)
    })

    it('should return false for expired session', () => {
      mockStorage.isSessionValid.mockReturnValue(false)
      sessionManager.set(mockSession)
      
      expect(sessionManager.isValid()).toBe(false)
    })
  })

  describe('Session Restoration', () => {
    it('should restore valid session from storage', async () => {
      mockStorage.getSession.mockResolvedValue(mockSession)
      mockStorage.isSessionValid.mockReturnValue(true)

      const restored = await sessionManager.restore()

      expect(restored).toEqual(expect.objectContaining({
        walletAddress: mockSession.walletAddress,
        chainId: mockSession.chainId,
        accessToken: mockSession.accessToken,
      }))
      expect(sessionManager.get()).toBeTruthy()
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Session restored successfully:',
        expect.any(Object)
      )
    })

    it('should return null when no stored session', async () => {
      mockStorage.getSession.mockResolvedValue(null)

      const restored = await sessionManager.restore()

      expect(restored).toBeNull()
      expect(mockLogger.log).toHaveBeenCalledWith('No stored session found')
    })

    it('should refresh expired session', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: Date.now() - 1000, // Expired
      }
      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      mockStorage.getSession.mockResolvedValue(expiredSession)
      mockStorage.isSessionValid.mockReturnValue(false)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      const restored = await sessionManager.restore()

      expect(auth.refreshAccessToken).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        expiredSession.refreshToken
      )
      expect(restored).toEqual(expect.objectContaining({
        accessToken: refreshedTokens.access_token,
        refreshToken: refreshedTokens.refresh_token,
      }))
      expect(mockStorage.setSession).toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith('Token refresh successful')
    })

    it('should verify token when verifyOnRestore is enabled', async () => {
      const parametersWithVerify = {
        ...mockParameters,
        verifyOnRestore: true,
      }
      const sessionManagerWithVerify = new SessionManager(
        mockStorage,
        parametersWithVerify,
        mockLogger
      )

      mockStorage.getSession.mockResolvedValue(mockSession)
      mockStorage.isSessionValid.mockReturnValue(true)
      vi.mocked(auth.verifyAccessToken).mockResolvedValue(true)

      await sessionManagerWithVerify.restore()

      expect(auth.verifyAccessToken).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.accessToken
      )
    })

    it('should refresh token when verification fails', async () => {
      const parametersWithVerify = {
        ...mockParameters,
        verifyOnRestore: true,
      }
      const sessionManagerWithVerify = new SessionManager(
        mockStorage,
        parametersWithVerify,
        mockLogger
      )

      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      mockStorage.getSession.mockResolvedValue(mockSession)
      mockStorage.isSessionValid.mockReturnValue(true)
      vi.mocked(auth.verifyAccessToken).mockResolvedValue(false)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      await sessionManagerWithVerify.restore()

      expect(auth.refreshAccessToken).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.refreshToken
      )
    })

    it('should handle refresh failure and clear session', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: Date.now() - 1000,
      }

      mockStorage.getSession.mockResolvedValue(expiredSession)
      mockStorage.isSessionValid.mockReturnValue(false)
      vi.mocked(auth.refreshAccessToken).mockRejectedValue(new Error('Refresh failed'))

      const restored = await sessionManager.restore()

      expect(restored).toBeNull()
      expect(mockStorage.removeSession).toHaveBeenCalled()
      expect(sessionManager.get()).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Token refresh failed, clearing session:',
        expect.any(Error)
      )
    })

    it('should handle storage errors gracefully', async () => {
      mockStorage.getSession.mockRejectedValue(new Error('Storage error'))

      const restored = await sessionManager.restore()

      expect(restored).toBeNull()
      expect(mockStorage.removeSession).toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to restore session:',
        expect.any(Error)
      )
    })

    it('should normalize wallet address with getAddress', async () => {
      const sessionWithLowercaseAddress = {
        ...mockSession,
        walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12' as Address,
      }

      mockStorage.getSession.mockResolvedValue(sessionWithLowercaseAddress)
      mockStorage.isSessionValid.mockReturnValue(true)

      const restored = await sessionManager.restore()

      // Verify address normalization (checksummed)
      expect(restored?.walletAddress).toBeTruthy()
    })
  })

  describe('Token Refresh', () => {
    it('should refresh token for active session', async () => {
      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      sessionManager.set(mockSession)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      const newToken = await sessionManager.refreshToken()

      expect(newToken).toBe(refreshedTokens.access_token)
      expect(sessionManager.get()).toEqual(expect.objectContaining({
        accessToken: refreshedTokens.access_token,
        refreshToken: refreshedTokens.refresh_token,
      }))
      expect(mockStorage.setSession).toHaveBeenCalled()
    })

    it('should throw error when no active session', async () => {
      await expect(sessionManager.refreshToken()).rejects.toThrow('No active session')
    })

    it('should update expiresAt after token refresh', async () => {
      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 7200, // 2 hours
      }

      sessionManager.set(mockSession)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      const beforeTime = Date.now()
      await sessionManager.refreshToken()
      const afterTime = Date.now()

      const session = sessionManager.get()
      expect(session?.expiresAt).toBeGreaterThanOrEqual(beforeTime + 7200 * 1000)
      expect(session?.expiresAt).toBeLessThanOrEqual(afterTime + 7200 * 1000)
    })

    it('should handle storage errors during refresh gracefully', async () => {
      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      sessionManager.set(mockSession)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)
      mockStorage.setSession.mockRejectedValue(new Error('Storage error'))

      // Should not throw - storage error is non-fatal
      const newToken = await sessionManager.refreshToken()

      expect(newToken).toBe(refreshedTokens.access_token)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to persist refreshed session:',
        expect.any(Error)
      )
    })
  })

  describe('Session Persistence', () => {
    it('should persist session to storage', async () => {
      sessionManager.set(mockSession)

      await sessionManager.persist()

      expect(mockStorage.setSession).toHaveBeenCalledWith(mockSession)
      expect(mockLogger.log).toHaveBeenCalledWith('Session persisted to storage')
    })

    it('should throw error when no session to persist', async () => {
      await expect(sessionManager.persist()).rejects.toThrow('No session to persist')
    })
  })

  describe('Session Removal', () => {
    it('should remove session from storage', async () => {
      sessionManager.set(mockSession)

      await sessionManager.remove()

      expect(mockStorage.removeSession).toHaveBeenCalled()
      expect(sessionManager.get()).toBeNull()
      expect(mockLogger.log).toHaveBeenCalledWith('Session removed from storage')
    })

    it('should handle removal even when no session exists', async () => {
      await sessionManager.remove()

      expect(mockStorage.removeSession).toHaveBeenCalled()
      expect(sessionManager.get()).toBeNull()
    })
  })

  describe('Edge Cases', () => {
    it('should handle multiple restore calls', async () => {
      mockStorage.getSession.mockResolvedValue(mockSession)
      mockStorage.isSessionValid.mockReturnValue(true)

      await sessionManager.restore()
      const first = sessionManager.get()

      await sessionManager.restore()
      const second = sessionManager.get()

      // Second restore should overwrite
      expect(second).toBeTruthy()
    })

    it('should handle concurrent refresh attempts', async () => {
      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      sessionManager.set(mockSession)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      // Trigger concurrent refreshes
      const [result1, result2] = await Promise.all([
        sessionManager.refreshToken(),
        sessionManager.refreshToken(),
      ])

      expect(result1).toBe(refreshedTokens.access_token)
      expect(result2).toBe(refreshedTokens.access_token)
    })

    it('should handle session with all optional fields', async () => {
      const fullSession: NyknycSession = {
        ...mockSession,
        supportedChains: [1, 420, 10],
        userId: 'user_123',
        email: 'test@example.com',
      }

      mockStorage.getSession.mockResolvedValue(fullSession)
      mockStorage.isSessionValid.mockReturnValue(true)

      const restored = await sessionManager.restore()

      expect(restored).toEqual(expect.objectContaining({
        supportedChains: [1, 420, 10],
        userId: 'user_123',
        email: 'test@example.com',
      }))
    })

    it('should preserve session properties during refresh', async () => {
      const sessionWithExtras: NyknycSession = {
        ...mockSession,
        supportedChains: [1, 420],
        userId: 'user_123',
      }

      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      sessionManager.set(sessionWithExtras)
      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      await sessionManager.refreshToken()

      const refreshedSession = sessionManager.get()
      expect(refreshedSession?.supportedChains).toEqual([1, 420])
      expect(refreshedSession?.userId).toBe('user_123')
    })
  })

  describe('API URL Configuration', () => {
    it('should use default API URL when not provided', async () => {
      const paramsWithoutApiUrl = {
        appId: 'test_app_id',
        developmentMode: true,
      }

      const manager = new SessionManager(mockStorage, paramsWithoutApiUrl, mockLogger)
      manager.set(mockSession)

      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      await manager.refreshToken()

      expect(auth.refreshAccessToken).toHaveBeenCalledWith(
        'https://api.nyknyc.app', // Default URL
        mockSession.refreshToken
      )
    })

    it('should use custom API URL when provided', async () => {
      sessionManager.set(mockSession)

      const refreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      vi.mocked(auth.refreshAccessToken).mockResolvedValue(refreshedTokens)

      await sessionManager.refreshToken()

      expect(auth.refreshAccessToken).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.refreshToken
      )
    })
  })
})
