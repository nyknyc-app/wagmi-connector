/**
 * SSR-safe sessionStorage helpers
 * These functions check for browser environment before accessing sessionStorage
 * to prevent errors in Next.js and other server-side rendering frameworks
 */

/**
 * Check if sessionStorage is available (browser environment)
 */
function isAvailable(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined'
}

/**
 * Set an item in sessionStorage (SSR-safe)
 * @param key - Storage key
 * @param value - Value to store
 */
export function setItem(key: string, value: string): void {
  if (!isAvailable()) {
    return
  }

  try {
    sessionStorage.setItem(key, value)
  } catch (error) {
    console.warn('NYKNYC: sessionStorage setItem failed:', error)
  }
}

/**
 * Get an item from sessionStorage (SSR-safe)
 * @param key - Storage key
 * @returns The stored value or null if not found/not available
 */
export function getItem(key: string): string | null {
  if (!isAvailable()) {
    return null
  }

  try {
    return sessionStorage.getItem(key)
  } catch (error) {
    console.warn('NYKNYC: sessionStorage getItem failed:', error)
    return null
  }
}

/**
 * Remove an item from sessionStorage (SSR-safe)
 * @param key - Storage key
 */
export function removeItem(key: string): void {
  if (!isAvailable()) {
    return
  }

  try {
    sessionStorage.removeItem(key)
  } catch (error) {
    console.warn('NYKNYC: sessionStorage removeItem failed:', error)
  }
}
