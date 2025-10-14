import type { Connector } from '@wagmi/core'
import type { NyknycProvider } from '../provider.js'
import { Logger } from '../utils/logger.js'

/**
 * EventManager handles event listener lifecycle
 * Consolidates attach/detach logic to avoid duplication
 */
export class EventManager {
  private listeners = new Map<string, (...args: any[]) => void>()

  constructor(private readonly logger: Logger) {}

  /**
   * Attach all event listeners to provider
   * 
   * @param provider - Provider to attach listeners to
   * @param connector - Connector instance with event handler methods
   */
  attach(provider: NyknycProvider, connector: {
    onAccountsChanged: Connector['onAccountsChanged']
    onChainChanged: Connector['onChainChanged']
    onDisconnect: Connector['onDisconnect']
  }): void {
    if (this.isAttached()) {
      this.logger.warn('Event listeners already attached')
      return
    }

    // Bind and store listeners
    const accountsChangedListener = connector.onAccountsChanged.bind(connector)
    const chainChangedListener = connector.onChainChanged.bind(connector)
    const disconnectListener = connector.onDisconnect.bind(connector)

    this.listeners.set('accountsChanged', accountsChangedListener)
    this.listeners.set('chainChanged', chainChangedListener)
    this.listeners.set('disconnect', disconnectListener)

    // Attach to provider
    provider.on('accountsChanged', accountsChangedListener)
    provider.on('chainChanged', chainChangedListener)
    provider.on('disconnect', disconnectListener)

    this.logger.log('Event listeners attached')
  }

  /**
   * Detach all event listeners from provider
   * 
   * @param provider - Provider to detach listeners from
   */
  detach(provider: NyknycProvider): void {
    if (!this.isAttached()) {
      this.logger.log('No event listeners to detach')
      return
    }

    // Remove listeners from provider
    const accountsChangedListener = this.listeners.get('accountsChanged')
    const chainChangedListener = this.listeners.get('chainChanged')
    const disconnectListener = this.listeners.get('disconnect')

    if (accountsChangedListener) {
      provider.removeListener('accountsChanged', accountsChangedListener)
    }
    if (chainChangedListener) {
      provider.removeListener('chainChanged', chainChangedListener)
    }
    if (disconnectListener) {
      provider.removeListener('disconnect', disconnectListener)
    }

    // Clear stored references
    this.listeners.clear()

    this.logger.log('Event listeners detached')
  }

  /**
   * Check if listeners are currently attached
   */
  isAttached(): boolean {
    return this.listeners.size > 0
  }
}
