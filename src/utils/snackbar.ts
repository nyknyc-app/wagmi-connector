/**
 * Snackbar component for displaying messages with action buttons
 * Enhanced design with NYKNYC branding
 */

export interface SnackbarMenuItem {
  isRed?: boolean
  info: string
  svgWidth?: string
  svgHeight?: string
  path?: string
  defaultFillRule?: string
  defaultClipRule?: string
  onClick: () => void
}

export interface SnackbarItemProps {
  message: string
  menuItems?: SnackbarMenuItem[]
  autoExpand?: boolean
  dismissible?: boolean
  onDismiss?: () => void
}

const RETRY_SVG_PATH = 'M5.5 1.5L1.5 5.5m0 0L1.5 1.5m0 4l4-4m-4 4l-4 4m4-4l4 4'

const ALERT_SVG_PATH = 'M12 4.354a.647.647 0 0 1 1.14.431v6.43a.647.647 0 0 1-1.28 0v-6.43a.647.647 0 0 1 .14-.431ZM12.5 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'

const CLOSE_SVG_PATH = 'M6.225 4.811a1 1 0 0 0-1.414 1.414L10.586 12 4.81 17.775a1 1 0 1 0 1.414 1.414L12 13.414l5.775 5.775a1 1 0 0 0 1.414-1.414L13.414 12l5.775-5.775a1 1 0 0 0-1.414-1.414L12 10.586 6.225 4.81Z'

// NYKNYC Logo SVG
const NYKNYC_LOGO = `<svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="#0bb4ff"/>
  <text x="16" y="23" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="white" text-anchor="middle">N</text>
</svg>`

export const RETRY_BUTTON: Omit<SnackbarMenuItem, 'onClick'> = {
  isRed: false,
  info: 'Retry',
  svgWidth: '10',
  svgHeight: '11',
  path: RETRY_SVG_PATH,
  defaultFillRule: 'evenodd',
  defaultClipRule: 'evenodd',
}

export class Snackbar {
  private root: HTMLElement | null = null
  private container: HTMLElement | null = null
  private currentItem: HTMLElement | null = null

  constructor() {
    // Snackbar will be attached when needed
  }

  /**
   * Attach snackbar to a DOM element
   */
  attach(root: HTMLElement): void {
    this.root = root
    this.container = document.createElement('div')
    this.container.className = 'nyknyc-snackbar-container'
    this.applyContainerStyles(this.container)
    this.root.appendChild(this.container)
  }

  /**
   * Present a snackbar item
   */
  presentItem(item: SnackbarItemProps): void {
    if (!this.container) {
      console.warn('Snackbar not attached to DOM')
      return
    }

    this.clear()

    const itemElement = this.createItemElement(item)
    this.currentItem = itemElement
    this.container.appendChild(itemElement)

    // Auto-expand if requested
    if (item.autoExpand) {
      setTimeout(() => {
        itemElement.classList.add('expanded')
      }, 10)
    }
  }

  /**
   * Clear current snackbar
   */
  clear(): void {
    if (this.currentItem && this.currentItem.parentElement) {
      this.currentItem.parentElement.removeChild(this.currentItem)
      this.currentItem = null
    }
  }

  /**
   * Remove snackbar from DOM
   */
  detach(): void {
    if (this.root && this.container) {
      this.root.removeChild(this.container)
      this.root = null
      this.container = null
      this.currentItem = null
    }
  }

  private createItemElement(item: SnackbarItemProps): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'nyknyc-snackbar-item'
    this.applyItemStyles(wrapper)

    // Add logo
    const logoDiv = document.createElement('div')
    logoDiv.className = 'nyknyc-snackbar-logo'
    logoDiv.innerHTML = NYKNYC_LOGO
    this.applyLogoStyles(logoDiv)
    wrapper.appendChild(logoDiv)

    // Content container (message + actions)
    const contentDiv = document.createElement('div')
    contentDiv.className = 'nyknyc-snackbar-content'
    this.applyContentStyles(contentDiv)

    // Alert icon + message
    const messageContainer = document.createElement('div')
    messageContainer.className = 'nyknyc-snackbar-message-container'
    this.applyMessageContainerStyles(messageContainer)

    const alertIcon = this.createAlertIcon()
    messageContainer.appendChild(alertIcon)

    const messageDiv = document.createElement('div')
    messageDiv.className = 'nyknyc-snackbar-message'
    messageDiv.textContent = item.message
    this.applyMessageStyles(messageDiv)
    messageContainer.appendChild(messageDiv)

    contentDiv.appendChild(messageContainer)

    if (item.menuItems && item.menuItems.length > 0) {
      const menuDiv = document.createElement('div')
      menuDiv.className = 'nyknyc-snackbar-menu'
      this.applyMenuStyles(menuDiv)

      item.menuItems.forEach((menuItem) => {
        const button = this.createMenuButton(menuItem)
        menuDiv.appendChild(button)
      })

      contentDiv.appendChild(menuDiv)
    }

    wrapper.appendChild(contentDiv)

    // Add close button if dismissible
    if (item.dismissible) {
      const closeButton = this.createCloseButton(() => {
        if (item.onDismiss) item.onDismiss()
        this.clear()
      })
      wrapper.appendChild(closeButton)
    }

    return wrapper
  }

  private createAlertIcon(): HTMLElement {
    const iconContainer = document.createElement('div')
    iconContainer.className = 'nyknyc-snackbar-alert-icon'
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', ALERT_SVG_PATH)
    path.setAttribute('fill', '#FFA500')
    
    svg.appendChild(path)
    iconContainer.appendChild(svg)
    
    this.applyAlertIconStyles(iconContainer)
    return iconContainer
  }

  private createCloseButton(onClick: () => void): HTMLElement {
    const button = document.createElement('button')
    button.className = 'nyknyc-snackbar-close'
    button.setAttribute('aria-label', 'Close')
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', CLOSE_SVG_PATH)
    path.setAttribute('fill', 'currentColor')
    
    svg.appendChild(path)
    button.appendChild(svg)
    
    button.onclick = (e) => {
      e.preventDefault()
      onClick()
    }
    
    this.applyCloseButtonStyles(button)
    return button
  }

  private createMenuButton(item: SnackbarMenuItem): HTMLElement {
    const button = document.createElement('button')
    button.className = 'nyknyc-snackbar-button'
    this.applyButtonStyles(button, item.isRed)

    if (item.path) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', item.svgWidth || '12')
      svg.setAttribute('height', item.svgHeight || '12')
      svg.setAttribute('viewBox', `0 0 ${item.svgWidth || '12'} ${item.svgHeight || '12'}`)
      svg.setAttribute('fill', 'none')

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', item.path)
      path.setAttribute('fill', 'currentColor')
      if (item.defaultFillRule) {
        path.setAttribute('fill-rule', item.defaultFillRule)
      }
      if (item.defaultClipRule) {
        path.setAttribute('clip-rule', item.defaultClipRule)
      }

      svg.appendChild(path)
      button.appendChild(svg)
    }

    const text = document.createElement('span')
    text.textContent = item.info
    button.appendChild(text)

    button.onclick = (e) => {
      e.preventDefault()
      item.onClick()
    }

    return button
  }

  private applyContainerStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '999999',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    })
  }

  private applyItemStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '14px 16px',
      // Glassmorphism effect - subtle and professional
      background: 'rgba(26, 26, 26, 0.95)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: '#FFFFFF',
      borderRadius: '12px',
      // Enhanced shadow for depth
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)',
      minWidth: '320px',
      maxWidth: '480px',
      opacity: '0',
      transform: 'translateY(20px)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    })

    // Add expanded class styles with bounce effect
    setTimeout(() => {
      element.style.opacity = '1'
      element.style.transform = 'translateY(0)'
    }, 10)

    // Mobile responsive
    if (window.innerWidth < 640) {
      element.style.minWidth = '280px'
      element.style.maxWidth = 'calc(100vw - 40px)'
    }
  }

  private applyLogoStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      width: '24px',
      height: '24px',
    })
  }

  private applyContentStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      flex: '1',
      minWidth: '0', // Prevent flex overflow
    })
  }

  private applyMessageContainerStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    })
  }

  private applyAlertIconStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
    })
  }

  private applyMessageStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      flex: '1',
      fontSize: '14px',
      lineHeight: '1.5',
      color: 'rgba(255, 255, 255, 0.95)',
    })
  }

  private applyMenuStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
    })
  }

  private applyButtonStyles(element: HTMLElement, isRed?: boolean): void {
    // Use brand color for primary button
    const primaryColor = '#0bb4ff'
    const primaryHover = '#0099dd'
    
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 16px',
      backgroundColor: isRed ? '#DC2626' : primaryColor,
      color: '#FFFFFF',
      border: 'none',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
      boxShadow: isRed 
        ? '0 2px 8px rgba(220, 38, 38, 0.3)' 
        : '0 2px 8px rgba(11, 180, 255, 0.3)',
    })

    element.onmouseenter = () => {
      element.style.backgroundColor = isRed ? '#B91C1C' : primaryHover
      element.style.transform = 'translateY(-1px)'
      element.style.boxShadow = isRed 
        ? '0 4px 12px rgba(220, 38, 38, 0.4)' 
        : '0 4px 12px rgba(11, 180, 255, 0.4)'
    }

    element.onmouseleave = () => {
      element.style.backgroundColor = isRed ? '#DC2626' : primaryColor
      element.style.transform = 'translateY(0)'
      element.style.boxShadow = isRed 
        ? '0 2px 8px rgba(220, 38, 38, 0.3)' 
        : '0 2px 8px rgba(11, 180, 255, 0.3)'
    }
  }

  private applyCloseButtonStyles(element: HTMLElement): void {
    Object.assign(element.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      width: '32px',
      height: '32px',
      padding: '0',
      backgroundColor: 'transparent',
      color: 'rgba(255, 255, 255, 0.5)',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    })

    element.onmouseenter = () => {
      element.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
      element.style.color = 'rgba(255, 255, 255, 0.9)'
    }

    element.onmouseleave = () => {
      element.style.backgroundColor = 'transparent'
      element.style.color = 'rgba(255, 255, 255, 0.5)'
    }
  }
}

let snackbarInstance: Snackbar | null = null

/**
 * Get or create the global snackbar instance
 */
export function getSnackbar(): Snackbar {
  if (!snackbarInstance) {
    const root = document.createElement('div')
    root.className = 'nyknyc-snackbar-root'
    document.body.appendChild(root)
    snackbarInstance = new Snackbar()
    snackbarInstance.attach(root)
  }
  return snackbarInstance
}
