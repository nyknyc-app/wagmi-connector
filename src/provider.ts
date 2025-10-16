import type { Address } from 'viem'
import type { 
  NyknycSession, 
  NyknycParameters,
  TransactionRequest,
  SignRequest
} from './types.js'
import {
  createTransaction,
  getTransactionStatus,
  waitForTransactionHash,
  createSignRequest,
  waitForSignCompletion,
  openSigningWindow,
  openUnsupportedChainWindow,
} from './utils/api.js'
import { refreshAccessToken } from './utils/auth.js'
import { NyknycStorage } from './utils/storage.js'
import { Logger } from './utils/logger.js'

const isStrictHex = (s: string) =>
  typeof s === 'string' && /^0x[0-9a-fA-F]*$/.test(s)

function hexToUtf8(hex: string): string {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) throw new Error('Invalid hex string length')
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

export interface EthereumProvider {
  request(args: { method: string; params?: any[] }): Promise<any>
  on(event: string, listener: (...args: any[]) => void): void
  removeListener(event: string, listener: (...args: any[]) => void): void
}

/**
 * Custom provider for NYKNYC 4337 smart wallet transactions
 */
export class NyknycProvider implements EthereumProvider {
  private session: NyknycSession | null = null
  private params: NyknycParameters
  private storage: NyknycStorage
  private logger: Logger
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map()
  /**
   * EIP-5792 call batches: map of batch id -> list of NYKNYC transaction_ids
   * Note: in-memory for MVP. Consider persisting with storage if you want cross-reload resilience.
   */
  private callBatches: Map<string, string[]> = new Map()

  constructor(params: NyknycParameters, storage: NyknycStorage) {
    this.params = params
    this.storage = storage
    this.logger = new Logger(params.developmentMode)
  }

  /**
   * Updates the current session
   */
  updateSession(session: NyknycSession | null): void {
    const previousChainId = this.session?.chainId
    const previousAccounts = this.session ? [this.session.walletAddress] : []
    
    this.session = session
    
    // Emit events if session changed
    if (session) {
      const currentAccounts = [session.walletAddress]
      const currentChainId = session.chainId
      
      // Check if accounts changed
      if (JSON.stringify(previousAccounts) !== JSON.stringify(currentAccounts)) {
        this.emit('accountsChanged', currentAccounts)
      }
      
      // Check if chain changed
      if (previousChainId !== currentChainId) {
        this.emit('chainChanged', `0x${currentChainId.toString(16)}`)
      }
    } else {
      // Session cleared (disconnected)
      if (previousAccounts.length > 0) {
        this.emit('accountsChanged', [])
      }
    }
  }

  /**
   * Main request method implementing EIP-1193
   */
  async request(args: { method: string; params?: any[] }): Promise<any> {
    const { method, params = [] } = args

    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        // For eth_requestAccounts during reconnection, return cached accounts if available
        // Otherwise return empty array (connector will handle OAuth if needed)
        return this.getAccounts()

      case 'eth_chainId':
        return this.getChainId()

      case 'eth_sendTransaction':
        return this.sendTransaction(params[0])

      case 'personal_sign':
        return this.personalSign(params[0], params[1])

      case 'eth_signTypedData_v4':
        return this.signTypedData(params[0], params[1])

      case 'wallet_switchEthereumChain':
        return this.switchChain(params[0].chainId)

      case 'wallet_addEthereumChain':
        return this.addEthereumChain(params[0])

      case 'eth_getBalance':
      case 'eth_getTransactionCount':
      case 'eth_call':
      case 'eth_estimateGas':
      case 'eth_getTransactionReceipt':
      case 'eth_getTransactionByHash':
        // These are read-only methods that should be handled by the RPC provider
        throw new Error(`Method ${method} should be handled by RPC provider`)

      /**
       * EIP-5792 methods
       */
      case 'wallet_getCapabilities':
        return this.walletGetCapabilities()

      case 'wallet_sendCalls':
        return this.walletSendCalls(params[0])

      case 'wallet_getCallsReceipt':
        return this.walletGetCallsReceipt(params[0])

      default:
        throw new Error(`Method ${method} is not supported`)
    }
  }

  /**
   * Gets current accounts
   */
  private getAccounts(): Address[] {
    if (!this.session) {
      return []
    }
    return [this.session.walletAddress]
  }

  /**
   * Gets current chain ID
   */
  private getChainId(): string {
    if (!this.session) {
      throw new Error('No active session')
    }
    return `0x${this.session.chainId.toString(16)}`
  }

  /**
   * Refresh access token and persist updated session.
   * Returns the new access token. Throws on failure.
   */
  private async refreshAndPersist(): Promise<string> {
    if (!this.session) {
      throw new Error('No active session')
    }
    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const refreshed = await refreshAccessToken(apiUrl, this.session.refreshToken)
    this.session.accessToken = refreshed.access_token
    this.session.refreshToken = refreshed.refresh_token
    this.session.expiresAt = Date.now() + refreshed.expires_in * 1000
    try {
      await this.storage.setSession(this.session)
    } catch (error) {
      // Non-fatal: storage failures are already handled gracefully
      this.logger.warn('Failed to persist refreshed session:', error)
    }
    return this.session.accessToken
  }

  /**
   * Sends a transaction through NYKNYC API
   */
  private async sendTransaction(transaction: {
    from?: Address
    to?: Address
    value?: string
    data?: string
    gas?: string
    gasPrice?: string
  }): Promise<string> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const baseUrl = this.params.baseUrl || 'https://nyknyc.app'

    // Open about:blank synchronously to avoid popup blockers
    const preWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null

    // Prepare transaction request (raw EVM fields)
    const transactionRequest: TransactionRequest = {
      wallet_address: this.session.walletAddress,
      contract_address: transaction.to,
      value: transaction.value || '0',
      data: transaction.data,
      chain_id: this.session.chainId,
    }

    try {
      // Create NYKNYC transaction
      const resp = await createTransaction(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        transactionRequest,
        this.refreshAndPersist.bind(this)
      )

      // Build and open transactions page URL in a new tab (align with signing flow)
      const popupUrl = `${baseUrl}/app/transactions/${resp.id}?autoClose=true`
      await openSigningWindow(popupUrl, baseUrl, preWindow) // resolves immediately, polling continues below

      // Return as soon as the backend provides a transaction hash (post-bundler broadcast)
      const status = await waitForTransactionHash(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        resp.id,
        undefined,
        undefined,
        this.refreshAndPersist.bind(this)
      )

      if (!status.transaction_hash) {
        throw new Error('Transaction broadcasted but no hash returned')
      }

      return status.transaction_hash
    } catch (error) {
      // Close pre-opened window if it exists and there was an error
      if (preWindow && !preWindow.closed) {
        try {
          preWindow.close()
        } catch {}
      }
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Signs a personal message
   */
  private async personalSign(message: string, _address: Address): Promise<string> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const baseUrl = this.params.baseUrl || 'https://nyknyc.app'

    // Open about:blank synchronously to avoid popup blockers
    const preWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null

    // Build sign request payload (Policy A: include message_text when hex)
    const body: SignRequest = {
      kind: 'personal_sign',
      wallet_address: this.session.walletAddress,
      chain_id: this.session.chainId,
      app_id: this.params.appId,
      callback_origin: window.location.origin,
    }

    if (isStrictHex(message)) {
      let text: string
      try {
        text = hexToUtf8(message)
      } catch {
        throw new Error('Invalid hex message: cannot decode to UTF-8')
      }
      body.message = message
      body.message_encoding = 'hex'
      body.message_text = text
    } else {
      body.message = message
      body.message_encoding = 'utf8'
    }

    try {
      // Create sign request via API
      const resp = await createSignRequest(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        body,
        this.refreshAndPersist.bind(this)
      )

      // Open signing in a new tab/window (postMessage optional)
      await openSigningWindow(resp.popup_url, baseUrl, preWindow)

      // Wait until signing completes
      const done = await waitForSignCompletion(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        resp.sign_id,
        undefined,
        undefined,
        this.refreshAndPersist.bind(this)
      )

      const sig = (done as any)?.envelope?.signature
      if (!sig) {
        throw new Error('Signing completed but no signature returned')
      }

      // Return the final signature (validator / ERC-1271 compatible)
      return sig
    } catch (error) {
      // Close pre-opened window if it exists and there was an error
      if (preWindow && !preWindow.closed) {
        try {
          preWindow.close()
        } catch {}
      }
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Signs typed data (EIP-712)
   */
  private async signTypedData(_address: Address, _typedData: any): Promise<string> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const baseUrl = this.params.baseUrl || 'https://nyknyc.app'

    // Open about:blank synchronously to avoid popup blockers
    const preWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null

    // Accept both JSON string and object for v4
    const typedData = typeof _typedData === 'string' ? JSON.parse(_typedData) : _typedData

    const signReq = {
      kind: 'eth_signTypedData_v4' as const,
      wallet_address: this.session.walletAddress,
      chain_id: this.session.chainId,
      app_id: this.params.appId,
      callback_origin: window.location.origin,
      typed_data: typedData,
    }

    try {
      const resp = await createSignRequest(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        signReq,
        this.refreshAndPersist.bind(this)
      )
      await openSigningWindow(resp.popup_url, baseUrl, preWindow)
      const done = await waitForSignCompletion(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        resp.sign_id,
        undefined,
        undefined,
        this.refreshAndPersist.bind(this)
      )

      const sig = (done as any)?.envelope?.signature
      if (!sig) {
        throw new Error('Typed data signing completed but no signature returned')
      }

      return sig
    } catch (error) {
      // Close pre-opened window if it exists and there was an error
      if (preWindow && !preWindow.closed) {
        try {
          preWindow.close()
        } catch {}
      }
      this.emit('error', error)
      throw error
    }
  }

  /**
   * EIP-5792: wallet_getCapabilities
   * Return per-chain capabilities. For now, no atomic batch is advertised until backend supports it.
   * Example structure:
   * {
   *   "0x1a4": { "atomicBatch": { "supported": true } }
   * }
   */
  private walletGetCapabilities(): Record<`0x${string}`, Record<string, any>> {
    if (!this.session) {
      throw new Error('No active session')
    }
    const chainHex = `0x${this.session.chainId.toString(16)}`
    // No special capabilities yet; keep object map per spec for future extension
    return {
      [chainHex]: {
        // atomicBatch: { supported: true }, // Enable when backend supports true atomic batching
      },
    }
  }

  /**
   * EIP-5792: wallet_sendCalls
   * Sends one or more calls. MVP behavior:
   * - Create one NYKNYC transaction per call (sequential, not encoded as a single multicall).
   * - Open a single tab for the FIRST transaction to show signing UI (backend batch UI may replace this later).
   * - Return a "batch id" (string) that can be resolved via wallet_getCallsReceipt.
   * NOTE: Values in payload are hex per EIP-5792; we convert to decimal string for backend.
   */
  private async walletSendCalls(payload: {
    version?: string
    chainId: `0x${string}`
    from?: `0x${string}`
    calls: { to?: `0x${string}`; data?: `0x${string}`; value?: `0x${string}` }[]
    capabilities?: Record<string, any>
  }): Promise<string> {
    if (!this.session) throw new Error('No active session')
    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'
    const baseUrl = this.params.baseUrl || 'https://nyknyc.app'

    if (!payload || !Array.isArray(payload.calls) || payload.calls.length === 0) {
      throw new Error('wallet_sendCalls: missing calls')
    }

    // Enforce chain match
    const reqChainId = parseInt(payload.chainId, 16)
    if (Number.isNaN(reqChainId)) throw new Error('wallet_sendCalls: invalid chainId')
    if (reqChainId !== this.session.chainId) {
      throw new Error('wallet_sendCalls: chainId mismatch with active session')
    }

    const txIds: string[] = []
    for (const call of payload.calls) {
      const valueHex = call.value ?? '0x0'
      let valueDecimal = '0'
      try {
        valueDecimal = BigInt(valueHex).toString()
      } catch {
        valueDecimal = '0'
      }

      const req: TransactionRequest = {
        wallet_address: this.session.walletAddress,
        contract_address: call.to as any,
        value: valueDecimal,
        data: call.data as any,
        chain_id: this.session.chainId,
      }

      const resp = await createTransaction(
        apiUrl,
        this.session.accessToken,
        this.params.appId,
        req,
        this.refreshAndPersist.bind(this)
      )
      txIds.push(resp.id)
    }

    // Open the first transaction page to initiate signing UX.
    // When backend supports batch UI, replace with `${baseUrl}/app/calls/${batchId}` or similar.
    if (txIds.length > 0) {
      const firstUrl = `${baseUrl}/app/transactions/${txIds[0]}`
      await openSigningWindow(firstUrl, baseUrl)
    }

    // Create a batch id and remember mapping
    const rnd = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? (crypto as any).randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`
    const batchId = `nyknyc_batch_${rnd}`
    this.callBatches.set(batchId, txIds)

    // Return id per EIP-5792
    return batchId
  }

  /**
   * EIP-5792: wallet_getCallsReceipt
   * Map NYKNYC per-transaction statuses into EIP-5792 receipt shape.
   *
   * Shape:
   * {
   *   status: 'PENDING' | 'CONFIRMED',
   *   receipts?: [{
   *     logs: [{ address, topics, data }],  // optional when backend provides
   *     status: '0x1' | '0x0',               // hex 1 success, 0 failure
   *     blockHash?: '0x..',
   *     blockNumber?: '0x..',
   *     gasUsed?: '0x..',
   *     transactionHash: '0x..'
   *   }]
   * }
   *
   * Mapping policy (MVP):
   * - If any call does not yet have transaction_hash, return { status: 'PENDING' } (no receipts).
   * - If all calls have hashes AND backend supplies execution outcome, return 'CONFIRMED' with per-call receipts.
   * - If backend does not supply execution outcome yet, prefer to keep 'PENDING' to avoid false positives.
   *   You can later switch to 'CONFIRMED' + partial receipts when /status includes execution_status & logs.
   */
  private async walletGetCallsReceipt(id: string): Promise<{
    status: 'PENDING' | 'CONFIRMED'
    receipts?: {
      logs: { address: `0x${string}`; data: `0x${string}`; topics: `0x${string}`[] }[]
      status: `0x${string}`
      blockHash?: `0x${string}`
      blockNumber?: `0x${string}`
      gasUsed?: `0x${string}`
      transactionHash: `0x${string}`
    }[]
  }> {
    if (!this.session) throw new Error('No active session')
    const apiUrl = this.params.apiUrl || 'https://api.nyknyc.app'

    const txIds = this.callBatches.get(id)
    if (!txIds || txIds.length === 0) {
      // Optionally, try to restore from storage if you later persist batches.
      throw new Error('wallet_getCallsReceipt: unknown id')
    }

    const statuses = await Promise.all(
      txIds.map((tid) =>
        getTransactionStatus(
          apiUrl,
          this.session!.accessToken,
          this.params.appId,
          tid,
          this.refreshAndPersist.bind(this)
        )
      )
    )

    // If any call is missing a transaction_hash, remain PENDING
    const allHaveHash = statuses.every((s) => !!s.transaction_hash)
    if (!allHaveHash) {
      return { status: 'PENDING' }
    }

    // If backend exposes execution outcome, we can construct receipts.
    // For now, we conservatively return PENDING unless we can set a reliable status code.
    // You may change this to CONFIRMED once /status includes execution_status and (optionally) receipt fields.
    const canDeriveOutcome = statuses.every(
      (s) =>
        typeof (s as any).execution_status === 'string' ||
        s.status === 'completed' ||
        s.status === 'failed'
    )

    if (!canDeriveOutcome) {
      // All hashes known, but outcome unknown — keep PENDING to prevent false positives.
      return { status: 'PENDING' }
    }

    // Build minimal receipts array.
    const receipts = statuses.map((s) => {
      // Decide success/failure:
      // Prefer explicit execution_status when provided by backend.
      const exec = (s as any).execution_status as 'success' | 'failed' | undefined
      let statusHex: `0x${string}`
      if (exec === 'failed' || s.status === 'failed') statusHex = '0x0'
      else if (exec === 'success' || s.status === 'completed') statusHex = '0x1'
      else statusHex = '0x0' // default to failure if ambiguous in MVP

      return {
        logs: [], // TODO: populate when backend exposes per-call logs (filtered to this userOp)
        status: statusHex,
        // Optional fields when backend provides them:
        blockHash: (s as any).block_hash as `0x${string}` | undefined,
        blockNumber: (s.block_number ? `0x${s.block_number.toString(16)}` : undefined) as
          | `0x${string}`
          | undefined,
        gasUsed: (s.gas_used ? `0x${BigInt(s.gas_used).toString(16)}` : undefined) as
          | `0x${string}`
          | undefined,
        transactionHash: s.transaction_hash as `0x${string}`,
      }
    })

    return { status: 'CONFIRMED', receipts }
  }

  /**
   * Switches the active chain.
   * Validates that the requested chain is supported by the wallet.
   */
  private async switchChain(chainId: string): Promise<void> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const numericChainId = parseInt(chainId, 16)
    if (Number.isNaN(numericChainId)) {
      throw new Error('Invalid chainId')
    }

    // Check if the chain is supported by the wallet (only if supportedChains is available)
    if (this.session.supportedChains && !this.session.supportedChains.includes(numericChainId)) {
      const baseUrl = this.params.baseUrl || 'https://nyknyc.app'
      openUnsupportedChainWindow(numericChainId, baseUrl)
      throw new Error(`Chain ${numericChainId} is not supported by NYKNYC wallet`)
    }

    // Update session locally and emit chainChanged.
    // Connector.onChainChanged will persist to storage and emit wagmi change event.
    this.session.chainId = numericChainId
    this.emit('chainChanged', `0x${numericChainId.toString(16)}`)
  }

  /**
   * Adds a new Ethereum chain.
   * Validates that the requested chain is supported by the wallet.
   */
  private async addEthereumChain(params: { chainId: string }): Promise<null> {
    if (!this.session) {
      throw new Error('No active session')
    }

    const numericChainId = parseInt(params.chainId, 16)
    if (Number.isNaN(numericChainId)) {
      throw new Error('Invalid chainId')
    }

    // Check if the chain is supported by the wallet (only if supportedChains is available)
    if (this.session.supportedChains && !this.session.supportedChains.includes(numericChainId)) {
      const baseUrl = this.params.baseUrl || 'https://nyknyc.app'
      openUnsupportedChainWindow(numericChainId, baseUrl)
      throw new Error(`Chain ${numericChainId} is not supported by NYKNYC wallet`)
    }

    // If the chain is already supported, return null (success)
    return null
  }

  /**
   * Adds event listener
   */
  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  /**
   * Removes event listener
   */
  removeListener(event: string, listener: (...args: any[]) => void): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.delete(listener)
    }
  }

  /**
   * Emits an event to all listeners
   */
  private emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(listener => {
        try {
          listener(...args)
        } catch (error) {
          console.error('Error in event listener:', error)
        }
      })
    }
  }

  /**
   * Disconnects the provider and clears internal state
   */
  disconnect(): void {
    this.session = null
    this.callBatches.clear()
    this.emit('disconnect')
  }

  /**
   * Closes the provider and removes all listeners
   */
  close(): void {
    this.listeners.clear()
    this.session = null
    this.callBatches.clear()
  }
}
