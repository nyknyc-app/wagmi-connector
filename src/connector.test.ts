import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nyknyc } from './connector.js'
import type { NyknycParameters, NyknycSession } from './types.js'
import type { Address } from 'viem'

// Mock all dependencies
vi.mock('./provider.js')
vi.mock('./utils/storage.js')
vi.mock('./utils/pkce.js')
vi.mock('./utils/logger.js')
vi.mock('./managers/SessionManager.js')
vi.mock('./managers/AuthFlowManager.js')
vi.mock('./managers/EventManager.js')

// Mock modules
import { NyknycProvider } from './provider.js'
import { NyknycStorage } from './utils/storage.js'
import { validateCryptoSupport } from './utils/pkce.js'
import { Logger } from './utils/logger.js'
import { SessionManager } from './managers/SessionManager.js'
import { AuthFlowManager } from './managers/AuthFlowManager.js'
import { EventManager } from './managers/EventManager.js'

// Mock the Web Crypto API
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
    getRandomValues: vi.fn((arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256)
      }
      return arr
    }),
  },
})

// Mock window
Object.defineProperty(global, 'window', {
  value: {
    open: vi.fn(),
    location: {
      origin: 'http://localhost:3000',
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
})

describe('NYKNYC Connector - Core Functionality', () => {
  const mockConfig = {
    chains: [
      { id: 1, name: 'Ethereum', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://eth.llamarpc.com'] } } },
      { id: 420, name: 'Optimism Goerli', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://goerli.optimism.io'] } } },
    ],
    emitter: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    storage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  }

  const mockParameters: NyknycParameters = {
    appId: 'test_app_id',
    developmentMode: true,
  }

  const mockSession: NyknycSession = {
    walletAddress: '0x1234567890123456789012345678901234567890' as Address,
    chainId: 1,
    accessToken: 'mock_access_token',
    refreshToken: 'mock_refresh_token',
    expiresAt: Date.now() + 3600000,
  }

  let mockSessionManager: any
  let mockAuthFlowManager: any
  let mockEventManager: any
  let mockProvider: any
  let mockStorage: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock SessionManager
    mockSessionManager = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      clear: vi.fn(),
      isValid: vi.fn().mockReturnValue(false),
      restore: vi.fn().mockResolvedValue(null),
      persist: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      refreshToken: vi.fn().mockResolvedValue('new_token'),
    }
    vi.mocked(SessionManager).mockImplementation(() => mockSessionManager)

    // Mock AuthFlowManager
    mockAuthFlowManager = {
      initiate: vi.fn().mockResolvedValue({
        accounts: [mockSession.walletAddress],
        chainId: mockSession.chainId,
      }),
      cleanup: vi.fn(),
    }
    vi.mocked(AuthFlowManager).mockImplementation(() => mockAuthFlowManager)

    // Mock EventManager
    mockEventManager = {
      attach: vi.fn(),
      detach: vi.fn(),
      isAttached: vi.fn().mockReturnValue(false),
    }
    vi.mocked(EventManager).mockImplementation(() => mockEventManager)

    // Mock Provider
    mockProvider = {
      request: vi.fn(),
      updateSession: vi.fn(),
      disconnect: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    vi.mocked(NyknycProvider).mockImplementation(() => mockProvider)

    // Mock Storage
    mockStorage = {
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      removeSession: vi.fn().mockResolvedValue(undefined),
      isSessionValid: vi.fn().mockReturnValue(false),
    }
    vi.mocked(NyknycStorage).mockImplementation(() => mockStorage)

    // Mock crypto validation
    vi.mocked(validateCryptoSupport).mockReturnValue(undefined)

    // Mock Logger
    vi.mocked(Logger).mockImplementation(() => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }) as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Connector Properties', () => {
    it('should create connector with correct properties', () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      expect(connectorInstance.id).toBe('nyknyc')
      expect(connectorInstance.name).toBe('NYKNYC')
      expect(connectorInstance.type).toBe('nyknyc')
      expect(connectorInstance.icon).toBe('https://nyknyc.app/logo.svg')
    })
  })

  describe('Setup', () => {
    it('should initialize managers and provider on first setup', async () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.setup()

      expect(SessionManager).toHaveBeenCalledWith(
        expect.any(Object),
        mockParameters,
        expect.any(Object)
      )
      expect(AuthFlowManager).toHaveBeenCalled()
      expect(EventManager).toHaveBeenCalled()
      expect(validateCryptoSupport).toHaveBeenCalledWith(true)
    })

    it('should not re-initialize on subsequent setup calls', async () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.setup()
      await connectorInstance.setup()

      // Should only be called once
      expect(SessionManager).toHaveBeenCalledTimes(1)
    })

    it('should attempt to restore session during setup', async () => {
      mockSessionManager.restore.mockResolvedValue(mockSession)
      
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.setup()

      expect(mockSessionManager.restore).toHaveBeenCalled()
    })

    it('should not throw on setup failure', async () => {
      mockSessionManager.restore.mockRejectedValue(new Error('Storage error'))
      
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await expect(connectorInstance.setup()).resolves.not.toThrow()
    })
  })

  describe('Connection - Reconnection Flow', () => {
    it('should reconnect with cached session', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const result = await connectorInstance.connect({ isReconnecting: true })

      expect(result.accounts).toEqual([mockSession.walletAddress])
      expect(result.chainId).toBe(mockSession.chainId)
      expect(mockEventManager.attach).toHaveBeenCalledWith(mockProvider, connectorInstance)
      expect(mockAuthFlowManager.initiate).not.toHaveBeenCalled()
    })

    it('should fail reconnection if no cached session', async () => {
      mockSessionManager.get.mockReturnValue(null)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await expect(
        connectorInstance.connect({ isReconnecting: true })
      ).rejects.toThrow('No cached session available for reconnection')
    })

    it('should switch chain during reconnection if requested', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      // Mock switchChain
      const mockSwitchChain = vi.fn().mockResolvedValue({ id: 420 })
      connectorInstance.switchChain = mockSwitchChain

      await connectorInstance.connect({ isReconnecting: true, chainId: 420 })

      expect(mockSwitchChain).toHaveBeenCalledWith({
        chainId: 420,
        addEthereumChainParameter: undefined,
      })
    })
  })

  describe('Connection - Normal Flow', () => {
    it('should connect with existing session without OAuth', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const result = await connectorInstance.connect()

      expect(result.accounts).toEqual([mockSession.walletAddress])
      expect(result.chainId).toBe(mockSession.chainId)
      expect(mockAuthFlowManager.initiate).not.toHaveBeenCalled()
      expect(mockEventManager.attach).toHaveBeenCalled()
    })

    it('should trigger OAuth flow when no session exists', async () => {
      // Setup: no session initially, then session exists after OAuth
      mockSessionManager.get
        .mockReturnValueOnce(null) // First call in getProvider - no session
        .mockReturnValueOnce(null) // Second call in handleNormalConnection - no session
        .mockReturnValueOnce(mockSession) // Third call after initiate - has session
        .mockReturnValue(mockSession) // All subsequent calls return session
      
      mockProvider.request.mockResolvedValue([]) // No accounts initially
      mockAuthFlowManager.initiate.mockResolvedValue({
        accounts: [mockSession.walletAddress],
        chainId: mockSession.chainId,
      })

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const result = await connectorInstance.connect()

      expect(mockAuthFlowManager.initiate).toHaveBeenCalled()
      expect(mockProvider.updateSession).toHaveBeenCalledWith(mockSession)
      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('connect', {
        accounts: [mockSession.walletAddress],
        chainId: mockSession.chainId,
      })
      expect(result.accounts).toEqual([mockSession.walletAddress])
    })

    it('should call setup if not completed before connect', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      // Don't call setup manually
      await connectorInstance.connect()

      // Verify setup was called internally
      expect(validateCryptoSupport).toHaveBeenCalled()
    })

    it('should switch chain during connection if requested', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const mockSwitchChain = vi.fn().mockResolvedValue({ id: 420 })
      connectorInstance.switchChain = mockSwitchChain

      await connectorInstance.connect({ chainId: 420 })

      expect(mockSwitchChain).toHaveBeenCalledWith({
        chainId: 420,
        addEthereumChainParameter: undefined,
      })
    })

    it('should handle user rejection during OAuth', async () => {
      mockSessionManager.get.mockReturnValue(null)
      mockProvider.request.mockResolvedValue([])
      mockAuthFlowManager.initiate.mockRejectedValue(new Error('user closed modal'))

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await expect(connectorInstance.connect()).rejects.toThrow()
      expect(mockAuthFlowManager.cleanup).toHaveBeenCalled()
    })

    it('should return accounts with capabilities if requested', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue([mockSession.walletAddress])

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const result = await connectorInstance.connect({ withCapabilities: true })

      expect(result.accounts).toEqual([
        { address: mockSession.walletAddress, capabilities: {} }
      ])
    })
  })

  describe('Disconnect', () => {
    it('should clear session and emit disconnect event', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.disconnect()

      expect(mockSessionManager.clear).toHaveBeenCalled()
      expect(mockEventManager.detach).toHaveBeenCalledWith(mockProvider)
      expect(mockProvider.disconnect).toHaveBeenCalled()
      expect(mockProvider.close).toHaveBeenCalled()
      expect(mockSessionManager.remove).toHaveBeenCalled()
      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('disconnect')
    })
  })

  describe('Get Accounts', () => {
    it('should return accounts from session', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      const accounts = await connectorInstance.getAccounts()

      expect(accounts).toEqual([mockSession.walletAddress])
    })

    it('should return empty array when no session', async () => {
      mockSessionManager.get.mockReturnValue(null)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      const accounts = await connectorInstance.getAccounts()

      expect(accounts).toEqual([])
    })
  })

  describe('Get Chain ID', () => {
    it('should return chain ID from session', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      const chainId = await connectorInstance.getChainId()

      expect(chainId).toBe(mockSession.chainId)
    })

    it('should throw error when no session', async () => {
      mockSessionManager.get.mockReturnValue(null)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      await expect(connectorInstance.getChainId()).rejects.toThrow('Not connected')
    })
  })

  describe('Is Authorized', () => {
    it('should return true for valid session', async () => {
      mockSessionManager.isValid.mockReturnValue(true)
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const isAuthorized = await connectorInstance.isAuthorized()

      expect(isAuthorized).toBe(true)
    })

    it('should return false when no session', async () => {
      mockSessionManager.isValid.mockReturnValue(false)
      mockSessionManager.get.mockReturnValue(null)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const isAuthorized = await connectorInstance.isAuthorized()

      expect(isAuthorized).toBe(false)
    })

    it('should attempt to restore session if not present', async () => {
      mockSessionManager.get
        .mockReturnValueOnce(null) // First check
        .mockReturnValueOnce(mockSession) // After restore
      mockSessionManager.restore.mockResolvedValue(mockSession)
      mockSessionManager.isValid.mockReturnValue(true)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.isAuthorized()

      expect(mockSessionManager.restore).toHaveBeenCalled()
    })
  })

  describe('Switch Chain', () => {
    it('should switch to supported chain', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request.mockResolvedValue(undefined)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      const result = await connectorInstance.switchChain({ chainId: 420 })

      expect(result.id).toBe(420)
      expect(mockProvider.request).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1a4' }],
      })
    })

    it('should throw error if not connected', async () => {
      mockSessionManager.get.mockReturnValue(null)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      await expect(
        connectorInstance.switchChain({ chainId: 420 })
      ).rejects.toThrow('Not connected')
    })

    it('should throw error for unconfigured chain', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      await expect(
        connectorInstance.switchChain({ chainId: 999 })
      ).rejects.toThrow()
    })

    it('should add chain if not added (4902 error)', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request
        .mockRejectedValueOnce({ code: 4902 }) // Chain not added
        .mockResolvedValueOnce(undefined) // wallet_addEthereumChain success

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      const result = await connectorInstance.switchChain({ chainId: 420 })

      expect(result.id).toBe(420)
      expect(mockProvider.request).toHaveBeenCalledWith({
        method: 'wallet_addEthereumChain',
        params: [expect.objectContaining({ chainId: '0x1a4' })],
      })
    })

    it('should throw UserRejectedRequestError if user rejects chain add', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)
      mockProvider.request
        .mockRejectedValueOnce({ code: 4902 }) // Chain not added
        .mockRejectedValueOnce(new Error('User rejected')) // User rejects add

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await expect(
        connectorInstance.switchChain({ chainId: 420 })
      ).rejects.toThrow()
    })
  })

  describe('Event Handlers', () => {
    it('onAccountsChanged should emit change event', () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const newAccounts = ['0x9876543210987654321098765432109876543210' as Address]
      connectorInstance.onAccountsChanged(newAccounts)

      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('change', {
        accounts: newAccounts,
      })
    })

    it('onAccountsChanged should disconnect if accounts empty', () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      const disconnectSpy = vi.spyOn(connectorInstance, 'onDisconnect')
      
      connectorInstance.onAccountsChanged([])

      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('onChainChanged should update session and emit change', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      connectorInstance.onChainChanged('0x1a4') // 420 in hex

      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('change', { chainId: 420 })
      expect(mockSessionManager.set).toHaveBeenCalled()
      expect(mockStorage.setSession).toHaveBeenCalled()
    })

    it('onConnect should emit connect event', async () => {
      mockSessionManager.get.mockReturnValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      connectorInstance.onConnect({ chainId: '0x1' })

      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('connect', {
        accounts: [mockSession.walletAddress],
        chainId: 1,
      })
    })

    it('onDisconnect should clean up and emit disconnect', async () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)
      
      // Ensure managers are initialized
      await connectorInstance.setup()

      await connectorInstance.onDisconnect()

      expect(mockSessionManager.clear).toHaveBeenCalled()
      expect(mockEventManager.detach).toHaveBeenCalled()
      expect(mockSessionManager.remove).toHaveBeenCalled()
      expect(mockConfig.emitter.emit).toHaveBeenCalledWith('disconnect')
    })
  })

  describe('Get Provider', () => {
    it('should create provider on first call', async () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      const provider = await connectorInstance.getProvider()

      expect(provider).toBe(mockProvider)
      expect(NyknycProvider).toHaveBeenCalledWith(mockParameters, expect.any(Object))
    })

    it('should return existing provider on subsequent calls', async () => {
      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.getProvider()
      await connectorInstance.getProvider()

      // Provider constructor should only be called once
      expect(NyknycProvider).toHaveBeenCalledTimes(1)
    })

    it('should restore session when creating provider', async () => {
      mockSessionManager.restore.mockResolvedValue(mockSession)

      const connector = nyknyc(mockParameters)
      const connectorInstance = connector(mockConfig as any)

      await connectorInstance.getProvider()

      expect(mockSessionManager.restore).toHaveBeenCalled()
      expect(mockProvider.updateSession).toHaveBeenCalledWith(mockSession)
    })
  })
})
