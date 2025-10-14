import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NyknycProvider } from './provider.js'
import type { NyknycParameters, NyknycSession } from './types.js'
import type { Address } from 'viem'

// Mock API utilities
vi.mock('./utils/api.js')
vi.mock('./utils/auth.js')
vi.mock('./utils/storage.js')
vi.mock('./utils/logger.js')

import * as api from './utils/api.js'
import * as auth from './utils/auth.js'
import { NyknycStorage } from './utils/storage.js'
import { Logger } from './utils/logger.js'

// Mock window
Object.defineProperty(global, 'window', {
  value: {
    location: {
      origin: 'http://localhost:3000',
    },
  },
  writable: true,
})

describe('NYKNYC Provider - Core Functionality', () => {
  const mockParameters: NyknycParameters = {
    appId: 'test_app_id',
    apiUrl: 'https://api.test.nyknyc.app',
    baseUrl: 'https://test.nyknyc.app',
    developmentMode: true,
  }

  const mockSession: NyknycSession = {
    walletAddress: '0x1234567890123456789012345678901234567890' as Address,
    chainId: 1,
    accessToken: 'mock_access_token',
    refreshToken: 'mock_refresh_token',
    expiresAt: Date.now() + 3600000,
    supportedChains: [1, 420, 10],
  }

  let provider: NyknycProvider
  let mockStorage: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock storage
    mockStorage = {
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      removeSession: vi.fn().mockResolvedValue(undefined),
      isSessionValid: vi.fn().mockReturnValue(true),
    }
    vi.mocked(NyknycStorage).mockImplementation(() => mockStorage)

    // Mock Logger
    vi.mocked(Logger).mockImplementation(() => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }) as any)

    // Create provider
    provider = new NyknycProvider(mockParameters, mockStorage)
    provider.updateSession(mockSession)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Session Management', () => {
    it('should update session and emit events', () => {
      const emitSpy = vi.spyOn(provider as any, 'emit')
      
      const newSession: NyknycSession = {
        ...mockSession,
        walletAddress: '0x9876543210987654321098765432109876543210' as Address,
        chainId: 420,
      }

      provider.updateSession(newSession)

      expect(emitSpy).toHaveBeenCalledWith('accountsChanged', [newSession.walletAddress])
      expect(emitSpy).toHaveBeenCalledWith('chainChanged', '0x1a4') // 420 in hex
    })

    it('should emit accountsChanged when session cleared', () => {
      const emitSpy = vi.spyOn(provider as any, 'emit')
      
      provider.updateSession(null)

      expect(emitSpy).toHaveBeenCalledWith('accountsChanged', [])
    })

    it('should not emit events if session unchanged', () => {
      const emitSpy = vi.spyOn(provider as any, 'emit')
      
      provider.updateSession(mockSession)

      expect(emitSpy).not.toHaveBeenCalled()
    })
  })

  describe('eth_requestAccounts / eth_accounts', () => {
    it('should return accounts when session exists', async () => {
      const result = await provider.request({ method: 'eth_accounts' })

      expect(result).toEqual([mockSession.walletAddress])
    })

    it('should return empty array when no session', async () => {
      provider.updateSession(null)

      const result = await provider.request({ method: 'eth_requestAccounts' })

      expect(result).toEqual([])
    })
  })

  describe('eth_chainId', () => {
    it('should return chain ID in hex format', async () => {
      const result = await provider.request({ method: 'eth_chainId' })

      expect(result).toBe('0x1') // 1 in hex
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({ method: 'eth_chainId' })
      ).rejects.toThrow('No active session')
    })
  })

  describe('eth_sendTransaction', () => {
    it('should send transaction and return hash', async () => {
      const mockTxResponse = { id: 'tx_123' }
      const mockTxStatus = { 
        transaction_hash: '0xabcdef123456789',
        status: 'completed',
      }

      vi.mocked(api.createTransaction).mockResolvedValue(mockTxResponse)
      vi.mocked(api.waitForTransactionHash).mockResolvedValue(mockTxStatus)
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)

      const tx = {
        to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' as Address,
        value: '0x1000',
        data: '0x',
      }

      const result = await provider.request({ 
        method: 'eth_sendTransaction',
        params: [tx],
      })

      expect(result).toBe(mockTxStatus.transaction_hash)
      expect(api.createTransaction).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.accessToken,
        mockParameters.appId,
        expect.objectContaining({
          wallet_address: mockSession.walletAddress,
          contract_address: tx.to,
          value: tx.value,
          data: tx.data,
          chain_id: mockSession.chainId,
        }),
        expect.any(Function)
      )
    })

    // TODO: Re-enable when token refresh flow is fully implemented
    it.skip('should refresh token on 401 error', async () => {
      const mockRefreshedTokens = {
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
      }

      vi.mocked(auth.refreshAccessToken).mockResolvedValue(mockRefreshedTokens)
      vi.mocked(api.createTransaction).mockResolvedValue({ id: 'tx_123' })
      vi.mocked(api.waitForTransactionHash).mockResolvedValue({
        transaction_hash: '0xabc',
        status: 'completed',
      })
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)

      const tx = { to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' as Address }

      await provider.request({ 
        method: 'eth_sendTransaction',
        params: [tx],
      })

      // Token refresh should happen through the callback passed to createTransaction
      expect(mockStorage.setSession).toHaveBeenCalled()
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({ 
          method: 'eth_sendTransaction',
          params: [{ to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }],
        })
      ).rejects.toThrow('No active session')
    })

    it('should emit error event on transaction failure', async () => {
      const emitSpy = vi.spyOn(provider as any, 'emit')
      const error = new Error('Transaction failed')

      vi.mocked(api.createTransaction).mockRejectedValue(error)

      await expect(
        provider.request({
          method: 'eth_sendTransaction',
          params: [{ to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }],
        })
      ).rejects.toThrow('Transaction failed')

      expect(emitSpy).toHaveBeenCalledWith('error', error)
    })
  })

  describe('personal_sign', () => {
    it('should sign hex message', async () => {
      const mockSignResponse = { 
        sign_id: 'sign_123',
        popup_url: 'https://test.nyknyc.app/sign/123',
      }
      const mockSignResult = {
        envelope: { signature: '0xsignature123' },
      }

      vi.mocked(api.createSignRequest).mockResolvedValue(mockSignResponse)
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.waitForSignCompletion).mockResolvedValue(mockSignResult)

      const hexMessage = '0x48656c6c6f' // "Hello" in hex
      const result = await provider.request({
        method: 'personal_sign',
        params: [hexMessage, mockSession.walletAddress],
      })

      expect(result).toBe('0xsignature123')
      expect(api.createSignRequest).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.accessToken,
        mockParameters.appId,
        expect.objectContaining({
          kind: 'personal_sign',
          message: hexMessage,
          message_encoding: 'hex',
          message_text: 'Hello',
        }),
        expect.any(Function)
      )
    })

    it('should sign UTF-8 message', async () => {
      const mockSignResponse = { 
        sign_id: 'sign_123',
        popup_url: 'https://test.nyknyc.app/sign/123',
      }
      const mockSignResult = {
        envelope: { signature: '0xsignature123' },
      }

      vi.mocked(api.createSignRequest).mockResolvedValue(mockSignResponse)
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.waitForSignCompletion).mockResolvedValue(mockSignResult)

      const utf8Message = 'Hello World'
      const result = await provider.request({
        method: 'personal_sign',
        params: [utf8Message, mockSession.walletAddress],
      })

      expect(result).toBe('0xsignature123')
      expect(api.createSignRequest).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.accessToken,
        mockParameters.appId,
        expect.objectContaining({
          kind: 'personal_sign',
          message: utf8Message,
          message_encoding: 'utf8',
        }),
        expect.any(Function)
      )
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({
          method: 'personal_sign',
          params: ['Hello', '0x123'],
        })
      ).rejects.toThrow('No active session')
    })

    it('should throw error when signature not returned', async () => {
      vi.mocked(api.createSignRequest).mockResolvedValue({ 
        sign_id: 'sign_123',
        popup_url: 'https://test.nyknyc.app/sign/123',
      })
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.waitForSignCompletion).mockResolvedValue({} as any)

      await expect(
        provider.request({
          method: 'personal_sign',
          params: ['Hello', mockSession.walletAddress],
        })
      ).rejects.toThrow('Signing completed but no signature returned')
    })
  })

  describe('eth_signTypedData_v4', () => {
    const mockTypedData = {
      domain: {
        name: 'Test',
        version: '1',
        chainId: 1,
      },
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
      primaryType: 'Person',
      message: {
        name: 'Alice',
        wallet: '0x123',
      },
    }

    it('should sign typed data (object format)', async () => {
      const mockSignResponse = { 
        sign_id: 'sign_123',
        popup_url: 'https://test.nyknyc.app/sign/123',
      }
      const mockSignResult = {
        envelope: { signature: '0xtypeddata_signature' },
      }

      vi.mocked(api.createSignRequest).mockResolvedValue(mockSignResponse)
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.waitForSignCompletion).mockResolvedValue(mockSignResult)

      const result = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [mockSession.walletAddress, mockTypedData],
      })

      expect(result).toBe('0xtypeddata_signature')
      expect(api.createSignRequest).toHaveBeenCalledWith(
        mockParameters.apiUrl,
        mockSession.accessToken,
        mockParameters.appId,
        expect.objectContaining({
          kind: 'eth_signTypedData_v4',
          typed_data: mockTypedData,
        }),
        expect.any(Function)
      )
    })

    it('should sign typed data (JSON string format)', async () => {
      const mockSignResponse = { 
        sign_id: 'sign_123',
        popup_url: 'https://test.nyknyc.app/sign/123',
      }
      const mockSignResult = {
        envelope: { signature: '0xtypeddata_signature' },
      }

      vi.mocked(api.createSignRequest).mockResolvedValue(mockSignResponse)
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.waitForSignCompletion).mockResolvedValue(mockSignResult)

      const result = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [mockSession.walletAddress, JSON.stringify(mockTypedData)],
      })

      expect(result).toBe('0xtypeddata_signature')
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({
          method: 'eth_signTypedData_v4',
          params: [mockSession.walletAddress, mockTypedData],
        })
      ).rejects.toThrow('No active session')
    })
  })

  describe('wallet_switchEthereumChain', () => {
    it('should switch to supported chain', async () => {
      vi.mocked(api.openUnsupportedChainWindow).mockReturnValue(undefined)
      const requestSpy = vi.spyOn(provider as any, 'request')

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1a4' }], // 420
      })

      // Internal call to switchChain should succeed
      expect(requestSpy).toHaveBeenCalled()
    })

    it('should throw error for unsupported chain', async () => {
      vi.mocked(api.openUnsupportedChainWindow).mockReturnValue(undefined)

      await expect(
        provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x3e7' }], // 999 - not in supportedChains
        })
      ).rejects.toThrow('Chain 999 is not supported by NYKNYC wallet')

      expect(api.openUnsupportedChainWindow).toHaveBeenCalledWith(
        999,
        mockParameters.baseUrl
      )
    })

    it('should switch chain when supportedChains is undefined', async () => {
      const sessionWithoutSupportedChains = {
        ...mockSession,
        supportedChains: undefined,
      }
      provider.updateSession(sessionWithoutSupportedChains)

      const emitSpy = vi.spyOn(provider as any, 'emit')

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1a4' }],
      })

      expect(emitSpy).toHaveBeenCalledWith('chainChanged', '0x1a4')
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1a4' }],
        })
      ).rejects.toThrow('No active session')
    })
  })

  describe('wallet_addEthereumChain', () => {
    it('should add supported chain', async () => {
      const result = await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: '0x1a4' }],
      })

      expect(result).toBeNull()
    })

    it('should throw error for unsupported chain', async () => {
      vi.mocked(api.openUnsupportedChainWindow).mockReturnValue(undefined)

      await expect(
        provider.request({
          method: 'wallet_addEthereumChain',
          params: [{ chainId: '0x3e7' }], // 999
        })
      ).rejects.toThrow('Chain 999 is not supported by NYKNYC wallet')
    })
  })

  // TODO: Uncomment these tests when EIP-5792 is implemented
  describe.skip('EIP-5792: wallet_getCapabilities', () => {
    it('should return capabilities for current chain', async () => {
      const result = await provider.request({ method: 'wallet_getCapabilities' })

      expect(result).toEqual({
        '0x1': {}, // Current chain (1 in hex)
      })
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({ method: 'wallet_getCapabilities' })
      ).rejects.toThrow('No active session')
    })
  })

  describe.skip('EIP-5792: wallet_sendCalls', () => {
    it('should send batch calls and return batch ID', async () => {
      vi.mocked(api.createTransaction).mockResolvedValue({ id: 'tx_1' })
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)

      const calls = [
        { to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' as `0x${string}`, value: '0x100' },
        { to: '0x123' as `0x${string}`, data: '0xabcd' },
      ]

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          version: '1.0',
          chainId: '0x1',
          from: mockSession.walletAddress as `0x${string}`,
          calls,
        }],
      })

      expect(result).toMatch(/^nyknyc_batch_/)
      expect(api.createTransaction).toHaveBeenCalledTimes(2)
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({
          method: 'wallet_sendCalls',
          params: [{
            chainId: '0x1',
            calls: [{ to: '0x123' as `0x${string}` }],
          }],
        })
      ).rejects.toThrow('No active session')
    })

    it('should throw error when chain mismatch', async () => {
      await expect(
        provider.request({
          method: 'wallet_sendCalls',
          params: [{
            chainId: '0x1a4', // Different from session chain
            calls: [{ to: '0x123' as `0x${string}` }],
          }],
        })
      ).rejects.toThrow('chainId mismatch with active session')
    })

    it('should throw error when calls array is empty', async () => {
      await expect(
        provider.request({
          method: 'wallet_sendCalls',
          params: [{
            chainId: '0x1',
            calls: [],
          }],
        })
      ).rejects.toThrow('missing calls')
    })
  })

  describe.skip('EIP-5792: wallet_getCallsReceipt', () => {
    it('should return PENDING when transactions not yet complete', async () => {
      vi.mocked(api.createTransaction).mockResolvedValue({ id: 'tx_1' })
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.getTransactionStatus).mockResolvedValue({
        status: 'pending',
        transaction_hash: undefined,
      } as any)

      // First create a batch
      const batchId = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          chainId: '0x1',
          calls: [{ to: '0x123' as `0x${string}` }],
        }],
      })

      // Then get receipt
      const result = await provider.request({
        method: 'wallet_getCallsReceipt',
        params: [batchId],
      })

      expect(result).toEqual({ status: 'PENDING' })
    })

    it('should return CONFIRMED with receipts when complete', async () => {
      vi.mocked(api.createTransaction).mockResolvedValue({ id: 'tx_1' })
      vi.mocked(api.openSigningWindow).mockResolvedValue(undefined)
      vi.mocked(api.getTransactionStatus).mockResolvedValue({
        status: 'completed',
        transaction_hash: '0xabc123',
        block_number: 12345,
        gas_used: '21000',
        execution_status: 'success',
      } as any)

      // First create a batch
      const batchId = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
          chainId: '0x1',
          calls: [{ to: '0x123' as `0x${string}` }],
        }],
      })

      // Then get receipt
      const result = await provider.request({
        method: 'wallet_getCallsReceipt',
        params: [batchId],
      })

      expect(result).toEqual({
        status: 'CONFIRMED',
        receipts: [
          expect.objectContaining({
            status: '0x1', // Success
            transactionHash: '0xabc123',
            blockNumber: '0x3039', // 12345 in hex
            gasUsed: '0x5208', // 21000 in hex
          }),
        ],
      })
    })

    it('should throw error for unknown batch ID', async () => {
      await expect(
        provider.request({
          method: 'wallet_getCallsReceipt',
          params: ['unknown_batch_id'],
        })
      ).rejects.toThrow('unknown id')
    })

    it('should throw error when no session', async () => {
      provider.updateSession(null)

      await expect(
        provider.request({
          method: 'wallet_getCallsReceipt',
          params: ['batch_123'],
        })
      ).rejects.toThrow('No active session')
    })
  })

  describe('Unsupported Methods', () => {
    it('should throw error for read-only methods', async () => {
      await expect(
        provider.request({ method: 'eth_getBalance', params: ['0x123', 'latest'] })
      ).rejects.toThrow('should be handled by RPC provider')
    })

    it('should throw error for unknown methods', async () => {
      await expect(
        provider.request({ method: 'unknown_method', params: [] })
      ).rejects.toThrow('not supported')
    })
  })

  describe('Event Listeners', () => {
    it('should add and trigger event listeners', () => {
      const listener = vi.fn()
      
      provider.on('accountsChanged', listener)
      
      // Trigger event
      const newSession = {
        ...mockSession,
        walletAddress: '0x9876543210987654321098765432109876543210' as Address,
      }
      provider.updateSession(newSession)

      expect(listener).toHaveBeenCalledWith([newSession.walletAddress])
    })

    it('should remove event listeners', () => {
      const listener = vi.fn()
      
      provider.on('accountsChanged', listener)
      provider.removeListener('accountsChanged', listener)
      
      // Trigger event
      const newSession = {
        ...mockSession,
        walletAddress: '0x9876543210987654321098765432109876543210' as Address,
      }
      provider.updateSession(newSession)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle errors in event listeners gracefully', () => {
      const listener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      provider.on('accountsChanged', listener)
      
      const newSession = {
        ...mockSession,
        walletAddress: '0x9876543210987654321098765432109876543210' as Address,
      }
      provider.updateSession(newSession)

      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Disconnect and Close', () => {
    it('should disconnect and clear state', () => {
      const emitSpy = vi.spyOn(provider as any, 'emit')
      
      provider.disconnect()

      expect(emitSpy).toHaveBeenCalledWith('disconnect')
      expect((provider as any).session).toBeNull()
      expect((provider as any).callBatches.size).toBe(0)
    })

    it('should close and remove all listeners', () => {
      const listener = vi.fn()
      provider.on('accountsChanged', listener)
      
      provider.close()

      expect((provider as any).listeners.size).toBe(0)
      expect((provider as any).session).toBeNull()
    })
  })
})
