import type { PKCEParams } from '../types.js'

/**
 * Development mode fallback for crypto.getRandomValues
 */
function fallbackGetRandomValues(array: Uint8Array): void {
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256)
  }
}

/**
 * Development mode fallback for crypto.subtle.digest
 */
async function fallbackDigest(data: Uint8Array): Promise<ArrayBuffer> {
  // Simple hash implementation for development only
  // This is NOT cryptographically secure and should only be used for development
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data[i]
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  
  // Create a 32-byte array from the hash
  const result = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    result[i] = (hash >> (i % 4 * 8)) & 0xFF
  }
  
  return result.buffer
}

/**
 * Check if we're in development mode and crypto is not available
 */
function shouldUseFallback(developmentMode: boolean = false): boolean {
  return developmentMode && (typeof crypto === 'undefined' || !crypto.subtle)
}

/**
 * Generates a cryptographically secure random string for PKCE code verifier
 */
export function generateCodeVerifier(developmentMode: boolean = false): string {
  const array = new Uint8Array(32)
  
  if (shouldUseFallback(developmentMode)) {
    fallbackGetRandomValues(array)
  } else {
    crypto.getRandomValues(array)
  }
  
  return base64URLEncode(array)
}

/**
 * Generates a code challenge from a code verifier using SHA256
 */
export async function generateCodeChallenge(verifier: string, developmentMode: boolean = false): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  
  let digest: ArrayBuffer
  
  if (shouldUseFallback(developmentMode)) {
    digest = await fallbackDigest(new Uint8Array(data))
  } else {
    digest = await crypto.subtle.digest('SHA-256', data)
  }
  
  return base64URLEncode(new Uint8Array(digest))
}

/**
 * Generates a random state parameter for CSRF protection
 */
export function generateState(developmentMode: boolean = false): string {
  const array = new Uint8Array(16)
  
  if (shouldUseFallback(developmentMode)) {
    fallbackGetRandomValues(array)
  } else {
    crypto.getRandomValues(array)
  }
  
  return base64URLEncode(array)
}

/**
 * Generates complete PKCE parameters
 */
export async function generatePKCEParams(developmentMode: boolean = false): Promise<PKCEParams> {
  const codeVerifier = generateCodeVerifier(developmentMode)
  const codeChallenge = await generateCodeChallenge(codeVerifier, developmentMode)
  const state = generateState(developmentMode)
  
  return {
    codeVerifier,
    codeChallenge,
    state
  }
}

/**
 * Base64URL encode without padding
 */
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Validates that required crypto APIs are available
 */
export function validateCryptoSupport(developmentMode: boolean = false): void {
  // Skip validation in development mode
  if (developmentMode) {
    console.warn('NYKNYC: Running in development mode with fallback crypto functions. This is NOT secure for production use.')
    return
  }
  
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is not available. NYKNYC connector requires a secure context (HTTPS).')
  }
  
  if (typeof crypto.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available.')
  }
}
