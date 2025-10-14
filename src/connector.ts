import { 
  createConnector,
  ChainNotConfiguredError 
} from '@wagmi/core'
import {
  getAddress,
  numberToHex,
  SwitchChainError,
  UserRejectedRequestError,
  type ProviderRpcError
} from 'viem'
import type { Address, Chain, AddEthereumChainParameter, ProviderConnectInfo } from 'viem'
import type { NyknycParameters } from './types.js'
import { NyknycProvider } from './provider.js'
import { NyknycStorage } from './utils/storage.js'
import { validateCryptoSupport } from './utils/pkce.js'
import { Logger } from './utils/logger.js'
import { SessionManager } from './managers/SessionManager.js'
import { AuthFlowManager } from './managers/AuthFlowManager.js'
import { EventManager } from './managers/EventManager.js'

/**
 * NYKNYC 4337 Smart Wallet Connector for Wagmi
 */
export function nyknyc(parameters: NyknycParameters) {
  return createConnector<NyknycProvider>((config) => {
    // Top-level state
    let provider: NyknycProvider | null = null
    let sessionManager: SessionManager | null = null
    let authFlowManager: AuthFlowManager | null = null
    let eventManager: EventManager | null = null
    let logger: Logger
    let storage: NyknycStorage
    let isSetupComplete = false

    // Initialize logger and storage immediately
    logger = new Logger(parameters.developmentMode)
    storage = new NyknycStorage(config.storage, 'nyknyc')
    
    logger.log('Creating new connector instance')

    /**
     * Initialize managers (lazy initialization)
     */
    const initializeManagers = () => {
      if (!sessionManager) {
        sessionManager = new SessionManager(storage, parameters, logger)
      }
      if (!authFlowManager) {
        authFlowManager = new AuthFlowManager(parameters, sessionManager, logger)
      }
      if (!eventManager) {
        eventManager = new EventManager(logger)
      }
    }

    /**
     * Handle reconnection flow (uses cached session)
     */
    const handleReconnection = async (
      params: Parameters<typeof connector.connect>[0],
      prov: NyknycProvider
    ) => {
      logger.log('Reconnection flow started')
      
      const accounts = await connector.getAccounts().catch((err) => {
        logger.error('Failed to get accounts during reconnect:', err)
        return []
      })
      
      // If no cached accounts during reconnection, fail gracefully
      if (accounts.length === 0) {
        logger.warn('No cached session available for reconnection')
        throw new Error('No cached session available for reconnection')
      }
      
      logger.log('Reconnecting with cached accounts:', accounts)
      
      // Attach event listeners
      if (eventManager && !eventManager.isAttached()) {
        eventManager.attach(prov, connector)
        logger.log('Event listeners attached')
      }
      
      // Get current chain ID
      let currentChainId = await connector.getChainId()
      logger.log('Current chain ID:', currentChainId)
      
      // Switch to requested chain if provided
      if (params?.chainId && currentChainId !== params.chainId) {
        logger.log('Switching to requested chain:', params.chainId)
        const chain = await connector.switchChain!({ 
          chainId: params.chainId,
          addEthereumChainParameter: undefined 
        }).catch((error) => {
          logger.error('Chain switch failed:', error)
          if (error.code === UserRejectedRequestError.code) throw error
          return { id: currentChainId }
        })
        currentChainId = chain?.id ?? currentChainId
      }
      
      logger.log('Reconnection successful')
      
      // Return cached state
      return {
        accounts: (params?.withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as never,
        chainId: currentChainId,
      }
    }

    /**
     * Handle normal connection flow (may trigger OAuth)
     */
    const handleNormalConnection = async (
      params: Parameters<typeof connector.connect>[0],
      prov: NyknycProvider
    ) => {
      logger.log('Normal connection flow started')
      
      // Request accounts - provider returns cached if session exists
      let accounts = (
        (await prov.request({
          method: 'eth_requestAccounts',
          params: [],
        })) as string[]
      ).map((x) => getAddress(x))
      
      // If no accounts (no session), trigger OAuth flow
      if (accounts.length === 0) {
        logger.log('No session found, initiating OAuth flow')
        const preWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
        const result = await authFlowManager!.initiate(preWindow)
        accounts = [...result.accounts] as Address[]
        
        // Update provider with new session
        const session = sessionManager!.get()
        if (session) {
          prov.updateSession(session)
        }
        
        // Emit connect event
        config.emitter.emit('connect', {
          accounts: result.accounts,
          chainId: result.chainId,
        })
      }

      // Attach event listeners
      if (eventManager && !eventManager.isAttached()) {
        eventManager.attach(prov, connector)
        logger.log('Event listeners attached')
      }

      // Get current chain ID
      let currentChainId = await connector.getChainId()

      // Switch to requested chain if provided
      if (params?.chainId && currentChainId !== params.chainId) {
        logger.log('Switching to requested chain:', params.chainId)
        const chain = await connector.switchChain!({ 
          chainId: params.chainId,
          addEthereumChainParameter: undefined 
        }).catch((error) => {
          if (error.code === UserRejectedRequestError.code) throw error
          return { id: currentChainId }
        })
        currentChainId = chain?.id ?? currentChainId
      }

      logger.log('Normal connection successful')

      // Return result
      return {
        accounts: (params?.withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as never,
        chainId: currentChainId,
      }
    }

    const connector = {
      id: 'nyknyc',
      name: 'NYKNYC',
      type: 'nyknyc' as const,
      icon: 'https://nyknyc.app/logo.svg',

      async setup() {
        logger.log('setup() called, isSetupComplete:', isSetupComplete)
        if (isSetupComplete) return
        
        try {
          // Initialize managers
          initializeManagers()
          
          // Initialize provider to ensure it's ready
          await this.getProvider()
          
          // Try to restore session during setup
          const session = sessionManager!.get()
          if (!session) {
            const restored = await sessionManager!.restore()
            if (restored) {
              logger.log('Session restored during setup:', {
                address: restored.walletAddress,
                chainId: restored.chainId
              })
            }
          }
          
          isSetupComplete = true
          logger.log('setup() completed successfully')
        } catch (error) {
          logger.error('setup() failed:', error)
          // Don't throw - setup failures shouldn't break the connector
        }
      },

      async connect({ chainId, isReconnecting, withCapabilities }: { 
        chainId?: number
        isReconnecting?: boolean
        withCapabilities?: boolean
      } = {}) {
        try {
          logger.log('connect() called with params:', {
            isReconnecting,
            chainId
          })
          
          const isReconnectingFlow = isReconnecting || false
          
          // Ensure setup is complete
          if (!isSetupComplete) {
            logger.log('Setup not complete, calling setup()')
            await this.setup?.()
          }
          
          // Get provider
          const prov = await this.getProvider()
          logger.log('Provider obtained, has session:', !!sessionManager!.get())
          
          // Handle reconnection flow
          if (isReconnectingFlow) {
            return await handleReconnection({ chainId, isReconnecting, withCapabilities }, prov)
          }
          
          // Handle normal connection flow
          return await handleNormalConnection({ chainId, isReconnecting, withCapabilities }, prov)
        } catch (error) {
          logger.error('connect() failed:', error)
          
          // Clean up OAuth state on error
          authFlowManager?.cleanup()
          
          // Wrap user rejection errors
          if (
            /(user closed modal|accounts received is empty|user denied account|request rejected)/i.test(
              (error as Error).message,
            )
          ) {
            throw new UserRejectedRequestError(error as Error)
          }
          throw error
        }
      },

      async disconnect(): Promise<void> {
        logger.log('disconnect() called')
        const prov = await this.getProvider()

        // Clear session
        sessionManager?.clear()

        // Detach event listeners
        if (eventManager) {
          eventManager.detach(prov)
        }

        // Disconnect and close the provider
        prov.disconnect()
        prov.close()

        // Remove from storage
        await sessionManager?.remove()

        // Emit disconnect event
        config.emitter.emit('disconnect')
        logger.log('Disconnected successfully')
      },

      async getAccounts(): Promise<Address[]> {
        logger.log('getAccounts() called')
        const session = sessionManager?.get()
        if (!session) {
          return []
        }
        return [session.walletAddress]
      },

      async getChainId(): Promise<number> {
        logger.log('getChainId() called')
        const session = sessionManager?.get()
        if (!session) {
          throw new Error('Not connected')
        }
        return session.chainId
      },

      async getProvider(): Promise<NyknycProvider> {
        logger.log('getProvider() called, provider exists:', !!provider)
        
        if (!provider) {
          logger.log('Creating new provider instance')
          
          // Validate crypto support
          validateCryptoSupport(parameters.developmentMode)
          
          // Initialize managers if not already done
          initializeManagers()
          
          // Initialize provider
          provider = new NyknycProvider(parameters, storage)
          
          // Try to restore session from storage
          const restored = await sessionManager!.restore()
          if (restored) {
            provider.updateSession(restored)
            logger.log('Session restored in getProvider:', {
              address: restored.walletAddress,
              chainId: restored.chainId
            })
          }
        }
        
        return provider
      },

      async isAuthorized(): Promise<boolean> {
        try {
          initializeManagers()
          
          // Try to restore session if we don't have one
          const session = sessionManager!.get()
          if (!session) {
            await sessionManager!.restore()
          }
          
          // Check if we have a valid session
          return sessionManager!.isValid()
        } catch {
          return false
        }
      },

      async switchChain({ addEthereumChainParameter, chainId }: { 
        addEthereumChainParameter?: AddEthereumChainParameter
        chainId: number 
      }): Promise<Chain> {
        logger.log('switchChain() called for chain:', chainId)
        
        const session = sessionManager?.get()
        if (!session) {
          logger.error('switchChain failed: Not connected')
          throw new Error('Not connected')
        }
        
        const prov = await this.getProvider()
        logger.log('Provider obtained for chain switch')

        const chain = config.chains.find((chain) => chain.id === chainId)
        if (!chain) {
          logger.error('Chain not configured:', chainId)
          throw new SwitchChainError(new ChainNotConfiguredError())
        }

        try {
          await prov.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: numberToHex(chain.id) }],
          })
          return chain
        } catch (error) {
          // Indicates chain is not added to provider
          if ((error as ProviderRpcError).code === 4902) {
            try {
              let blockExplorerUrls: string[] | undefined
              if (addEthereumChainParameter?.blockExplorerUrls)
                blockExplorerUrls = addEthereumChainParameter.blockExplorerUrls
              else
                blockExplorerUrls = chain.blockExplorers?.default.url
                  ? [chain.blockExplorers?.default.url]
                  : []

              let rpcUrls: readonly string[]
              if (addEthereumChainParameter?.rpcUrls?.length)
                rpcUrls = addEthereumChainParameter.rpcUrls
              else rpcUrls = [chain.rpcUrls.default?.http[0] ?? '']

              const addEthereumChain = {
                blockExplorerUrls,
                chainId: numberToHex(chainId),
                chainName: addEthereumChainParameter?.chainName ?? chain.name,
                iconUrls: addEthereumChainParameter?.iconUrls,
                nativeCurrency:
                  addEthereumChainParameter?.nativeCurrency ??
                  chain.nativeCurrency,
                rpcUrls,
              } satisfies AddEthereumChainParameter

              await prov.request({
                method: 'wallet_addEthereumChain',
                params: [addEthereumChain],
              })

              return chain
            } catch (error) {
              throw new UserRejectedRequestError(error as Error)
            }
          }

          throw new SwitchChainError(error as Error)
        }
      },

      onAccountsChanged(accounts: Address[]): void {
        if (accounts.length === 0) this.onDisconnect()
        else
          config.emitter.emit('change', {
            accounts: accounts.map(getAddress),
          })
      },

      onChainChanged(chainId: string | number): void {
        const id = Number(chainId)
        const session = sessionManager?.get()
        if (session) {
          if (session.chainId !== id) {
            session.chainId = id
            sessionManager!.set(session)
            storage.setSession(session)
          }
        }
        config.emitter.emit('change', { chainId: id })
      },

      onConnect(connectInfo: ProviderConnectInfo): void {
        const chainId = parseInt(connectInfo.chainId, 16)
        const session = sessionManager?.get()
        config.emitter.emit('connect', {
          accounts: session ? [session.walletAddress] : [],
          chainId,
        })
      },

      async onDisconnect(_error?: Error): Promise<void> {
        config.emitter.emit('disconnect')

        const prov = provider
        
        // Clear session
        sessionManager?.clear()

        // Remove event listeners
        if (prov && eventManager) {
          eventManager.detach(prov)
        }

        // Remove from storage
        await sessionManager?.remove()
      },
    }

    return connector
  })
}
