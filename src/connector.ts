import { createConnector } from '@wagmi/core'
import { getAddress } from 'viem'
import type { 
  NyknycParameters, 
  NyknycSession 
} from './types.js'
import { NyknycProvider } from './provider.js'
import { NyknycStorage } from './utils/storage.js'
import { validateCryptoSupport, generatePKCEParams } from './utils/pkce.js'
import { 
  buildAuthUrl,
  handleAuthRedirect,
  isAuthCallback,
  exchangeCodeForToken, 
  getUserInfo,
  refreshAccessToken,
  openAuthWindow,
  verifyAccessToken
} from './utils/auth.js'
import type { ProviderConnectInfo } from 'viem'

const PKCE_STORAGE_KEY = 'nyknyc.pkce'

/**
 * NYKNYC 4337 Smart Wallet Connector for Wagmi
 */
export function nyknyc(parameters: NyknycParameters) {
  return createConnector<NyknycProvider>((config) => {
    let provider: NyknycProvider | null = null
    let session: NyknycSession | null = null

    // Provider event listener references (attached on connect, removed on disconnect)
    type Listener = (...args: any[]) => void
    let onAccountsChangedListener: Listener | undefined
    let onChainChangedListener: Listener | undefined
    let onDisconnectListener: Listener | undefined
    
    // Initialize internal storage with wagmi storage as primary and localStorage as fallback
    const storage = new NyknycStorage(config.storage, 'nyknyc')
    const apiUrl = parameters.apiUrl || 'https://api.nyknyc.app'

    /**
     * Restores session from storage and handles token refresh if needed
     */
    const restoreSession = async (): Promise<void> => {
      try {
        const storedSession = await storage.getSession()
        
        if (!storedSession) {
          return
        }

        // Check if session is still valid
        if (storage.isSessionValid(storedSession)) {
          try {
            // Optionally verify access token with server to catch revocation/blacklist
            if (parameters.verifyOnRestore) {
              const valid = await verifyAccessToken(apiUrl, storedSession.accessToken)
              if (!valid) {
                throw new Error('Access token invalid on restore')
              }
            }

            session = {
              ...storedSession,
              walletAddress: getAddress(storedSession.walletAddress),
            }

            if (provider) {
              provider.updateSession(session)
            }
          } catch (e) {
            // Token invalidated or verification failed -> attempt refresh
            try {
              console.log('NYKNYC: Stored access token invalid, attempting token refresh...')
              const refreshedTokens = await refreshAccessToken(apiUrl, storedSession.refreshToken)
              
              session = {
                ...storedSession,
                accessToken: refreshedTokens.access_token,
                refreshToken: refreshedTokens.refresh_token,
                expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
                walletAddress: getAddress(storedSession.walletAddress),
              }
              
              await storage.setSession(session)
              console.log('NYKNYC: Token refresh successful after failed verification')
              
              if (provider) {
                provider.updateSession(session)
              }
            } catch (error) {
              console.warn('NYKNYC: Verification+refresh failed, clearing session:', error)
              await storage.removeSession()
            }
          }
        } else {
          // Try to refresh the token
          try {
            console.log('NYKNYC: Session expired, attempting token refresh...')
            const refreshedTokens = await refreshAccessToken(
              apiUrl,
              storedSession.refreshToken
            )
            
            session = {
              ...storedSession,
              accessToken: refreshedTokens.access_token,
              refreshToken: refreshedTokens.refresh_token,
              expiresAt: Date.now() + (refreshedTokens.expires_in * 1000),
              walletAddress: getAddress(storedSession.walletAddress),
            }
            
            await storage.setSession(session)
            console.log('NYKNYC: Token refresh successful')
            
            if (provider) {
              provider.updateSession(session)
            }
          } catch (error) {
            console.warn('NYKNYC: Token refresh failed, clearing session:', error)
            await storage.removeSession()
          }
        }
      } catch (error) {
        console.error('NYKNYC: Failed to restore session:', error)
        await storage.removeSession()
      }
    }

    // Helper functions for auth flow
    const initiateAuthFlow = async (preOpenedWindow?: Window | null): Promise<{ accounts: readonly `0x${string}`[]; chainId: number }> => {
      // Generate PKCE parameters
      const pkceParams = await generatePKCEParams(parameters.developmentMode)
      
      // Store PKCE parameters temporarily
      sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(pkceParams))

      // Build authorization URL
      const authUrl = buildAuthUrl(parameters, pkceParams)

      // Open OAuth in a new tab/window and wait for callback message
      const { code, state } = await openAuthWindow(authUrl, preOpenedWindow)

      // Complete the flow with received code/state
      return await completeAuthFlow({ code, state })
    }

    const completeAuthFlow = async (callbackData: any): Promise<{ accounts: readonly `0x${string}`[]; chainId: number }> => {
      console.log('Starting auth flow completion with callback data:', { code: callbackData.code.substring(0, 10) + '...', state: callbackData.state })
      
      // Get stored PKCE parameters
      const storedPkce = sessionStorage.getItem(PKCE_STORAGE_KEY)
      if (!storedPkce) {
        console.error('Missing PKCE parameters in sessionStorage during completeAuthFlow')
        console.log('Available sessionStorage keys:', Object.keys(sessionStorage))
        throw new Error('Missing PKCE parameters. Authentication session may have expired.')
      }

      const pkceParams = JSON.parse(storedPkce)
      console.log('Retrieved PKCE parameters for token exchange:', { state: pkceParams.state, hasCodeVerifier: !!pkceParams.codeVerifier })

      try {
        // Exchange authorization code for tokens
        console.log('Exchanging authorization code for tokens...')
        const tokens = await exchangeCodeForToken(
          parameters,
          callbackData.code,
          pkceParams.codeVerifier
        )
        console.log('Token exchange successful, expires in:', tokens.expires_in, 'seconds')

        // Get user information
        console.log('Fetching user information...')
        const userInfo = await getUserInfo(apiUrl, tokens.access_token)
        console.log('User info retrieved:', { 
          wallet_address: userInfo.wallet_address, 
          current_chain_id: userInfo.current_chain_id
        })

        // Create session
        session = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in * 1000),
          walletAddress: getAddress(userInfo.wallet_address),
          chainId: userInfo.current_chain_id,
        }

        // Store session using internal storage
        await storage.setSession(session)
        console.log('NYKNYC: Session stored successfully')

        // Update provider
        if (provider) {
          provider.updateSession(session)
          console.log('Provider updated with new session')
        }

        // Clean up PKCE parameters
        sessionStorage.removeItem(PKCE_STORAGE_KEY)
        console.log('PKCE parameters cleaned up')

        // Emit connect event
        config.emitter.emit('connect', {
          accounts: [session.walletAddress],
          chainId: session.chainId,
        })
        console.log('Connect event emitted')

        return {
          accounts: [session.walletAddress],
          chainId: session.chainId,
        }
      } catch (error) {
        console.error('Error during auth flow completion:', error)
        // Clean up PKCE parameters on error
        sessionStorage.removeItem(PKCE_STORAGE_KEY)
        throw error
      }
    }

    return {
      id: 'nyknyc',
      name: 'NYKNYC',
      type: 'nyknyc' as const,
      icon: 'https://nyknyc.app/logo.svg', // You can update this with your actual logo URL

      async setup() {
        // Validate crypto support
        validateCryptoSupport(parameters.developmentMode)
        
        // Initialize provider
        provider = new NyknycProvider(parameters, storage)
        
        // Try to restore session from storage
        await restoreSession()
      },

      async connect() {
        try {
          // Helper to attach provider listeners once
          const attachProviderListeners = async () => {
            const p = await this.getProvider()
            if (!onAccountsChangedListener) {
              const listener: Listener = this.onAccountsChanged.bind(this) as Listener
              onAccountsChangedListener = listener
              p.on('accountsChanged', listener)
            }
            if (!onChainChangedListener) {
              const listener: Listener = this.onChainChanged.bind(this) as Listener
              onChainChangedListener = listener
              p.on('chainChanged', listener)
            }
            if (!onDisconnectListener) {
              const listener: Listener = this.onDisconnect.bind(this) as Listener
              onDisconnectListener = listener
              p.on('disconnect', listener)
            }
          }

          // If we already have a valid session, attach listeners and return
          if (session && storage.isSessionValid(session)) {
            await attachProviderListeners()
            return {
              accounts: [session.walletAddress],
              chainId: session.chainId,
            }
          }

          // If URL contains OAuth callback params, handle them (no new window)
          if (isAuthCallback()) {
            const callbackData = await handleAuthRedirect(parameters)
            if (callbackData) {
              const result = await completeAuthFlow(callbackData)
              await attachProviderListeners()
              return result
            }
          }

          // Start new OAuth flow in a new tab/window (pre-open to avoid popup blockers)
          const preWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
          // Optional: let consumers know we're connecting
          // @ts-ignore - emitter may accept message events with arbitrary payloads
          config.emitter.emit?.('message', { type: 'connecting' })

          const result = await initiateAuthFlow(preWindow)
          await attachProviderListeners()
          return result
        } catch (error) {
          // Clean up on error
          sessionStorage.removeItem(PKCE_STORAGE_KEY)
          throw error
        }
      },

      async disconnect() {
        // Clear session
        session = null

        // Update provider
        if (provider) {
          provider.updateSession(null)
        }

        // Detach provider listeners
        if (provider) {
          if (onAccountsChangedListener) {
            provider.removeListener('accountsChanged', onAccountsChangedListener)
            onAccountsChangedListener = undefined
          }
          if (onChainChangedListener) {
            provider.removeListener('chainChanged', onChainChangedListener)
            onChainChangedListener = undefined
          }
          if (onDisconnectListener) {
            provider.removeListener('disconnect', onDisconnectListener)
            onDisconnectListener = undefined
          }
        }

        // Remove from storage using internal storage
        await storage.removeSession()

        // Emit disconnect event
        config.emitter.emit('disconnect')
      },

      async getAccounts() {
        if (!session) {
          return []
        }
        return [session.walletAddress]
      },

      async getChainId() {
        if (!session) {
          throw new Error('Not connected')
        }
        return session.chainId
      },

      async getProvider() {
        if (!provider) {
          throw new Error('Provider not initialized')
        }
        return provider
      },

      async isAuthorized() {
        if (!session) {
          return false
        }
        return storage.isSessionValid(session)
      },

      async switchChain({ chainId }) {
        if (!session || !provider) {
          throw new Error('Not connected')
        }

        // Delegate to provider (mock/local). Provider emits 'chainChanged',
        // and connector.onChainChanged will persist + emit wagmi 'change'.
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        })

        // Return the requested chain (Wagmi contract)
        return config.chains.find((c) => c.id === chainId) || config.chains[0]
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) {
          // Clear session and emit disconnect
          session = null
          if (provider) {
            provider.updateSession(null)
          }
          config.emitter.emit('disconnect')
        } else {
          config.emitter.emit('change', {
            accounts: accounts.map(getAddress),
          })
        }
      },

      onChainChanged(chainId: string | number) {
        const id = Number(chainId)
        if (session) {
          if (session.chainId !== id) {
            session.chainId = id
            storage.setSession(session)
          }
        }
        config.emitter.emit('change', { chainId: id })
      },

      onConnect(connectInfo: ProviderConnectInfo) {
        // Convert chainId from hex string to number for the event
        const chainId = parseInt(connectInfo.chainId, 16)
        config.emitter.emit('connect', {
          accounts: session ? [session.walletAddress] : [],
          chainId,
        })
      },

      onDisconnect(_error?: Error) {
        config.emitter.emit('disconnect')
      },
    }
  })
}
