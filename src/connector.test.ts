import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nyknyc } from './connector.js'
import type { NyknycParameters } from './types.js'

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

// Mock window.open
Object.defineProperty(global, 'window', {
  value: {
    open: vi.fn(),
    location: {
      origin: 'http://localhost:3000',
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
})

// Mock sessionStorage
Object.defineProperty(global, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
})

// Mock fetch
global.fetch = vi.fn()

describe('NYKNYC Connector', () => {
  const mockConfig = {
    chains: [{ id: 1, name: 'Ethereum' }],
    emitter: {
      emit: vi.fn(),
    },
    storage: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  }

  const mockParameters: NyknycParameters = {
    appId: 'test_app_id',
    redirectUri: 'http://localhost:3000/callback',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create connector with correct properties', () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    expect(connectorInstance.id).toBe('nyknyc')
    expect(connectorInstance.name).toBe('NYKNYC')
    expect(connectorInstance.type).toBe('nyknyc')
    expect(connectorInstance.icon).toBe('https://nyknyc.app/logo.svg')
  })

  it('should validate crypto support during setup', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    // Should not throw with mocked crypto
    await expect(connectorInstance.setup()).resolves.not.toThrow()
  })

  it('should return empty accounts when not connected', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    const accounts = await connectorInstance.getAccounts()
    expect(accounts).toEqual([])
  })

  it('should return false for isAuthorized when not connected', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    const isAuthorized = await connectorInstance.isAuthorized()
    expect(isAuthorized).toBe(false)
  })

  it('should throw error when getting chain ID without connection', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    await expect(connectorInstance.getChainId()).rejects.toThrow('Not connected')
  })

  it('should throw error when getting provider before setup', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    await expect(connectorInstance.getProvider()).rejects.toThrow('Provider not initialized')
  })

  it('should handle disconnect properly', async () => {
    const connector = nyknyc(mockParameters)
    const connectorInstance = connector(mockConfig as any)

    await connectorInstance.disconnect()

    expect(mockConfig.storage.removeItem).toHaveBeenCalledWith('nyknyc.session')
    expect(mockConfig.emitter.emit).toHaveBeenCalledWith('disconnect')
  })

  // Note: Full integration tests would require mocking the entire OAuth flow
  // and API responses. For now, we're testing the basic structure and error cases.
})

describe('NYKNYC Connector - Manual Testing Instructions', () => {
  it('should provide manual testing instructions', () => {
    const instructions = `
    Manual Testing Instructions for NYKNYC Connector:

    1. Connection Flow:
       - Set up a test dApp with valid NYKNYC app_id
       - Click connect button
       - Verify popup opens to NYKNYC auth page
       - Complete authentication flow
       - Verify connection success and wallet address display

    2. Transaction Flow:
       - With connected wallet, initiate a test transaction
       - Verify transaction creation API call
       - Verify signing popup opens
       - Complete signing with passkey
       - Verify transaction hash is returned

    3. Chain Switching:
       - Test switching between supported chains
       - Verify API calls and UI updates

    4. Session Management:
       - Test page refresh with active session
       - Test token refresh functionality
       - Test logout/disconnect

    5. Error Scenarios:
       - Test popup blocking
       - Test network errors
       - Test user cancellation
       - Test invalid app_id

    Prerequisites:
    - Valid NYKNYC app_id from developer portal
    - Test environment with HTTPS (required for Web Crypto API)
    - Modern browser with popup support
    - NYKNYC backend API running and accessible
    `

    expect(instructions).toBeTruthy()
    console.log(instructions)
  })
})
