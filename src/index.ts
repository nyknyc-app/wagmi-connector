// Main connector export
export { nyknyc } from './connector.js'

// Provider export
export { NyknycProvider } from './provider.js'

// Type exports
export type {
  NyknycParameters,
  NyknycSession,
  UserInfo,
  TokenResponse,
  TransactionRequest,
  TransactionResponse,
  TransactionStatus,
  PKCEParams,
  AuthCallbackData,
  ChainSwitchRequest,
  ChainSwitchResponse,
  // Signing types
  SignKind,
  SignRequest,
  SignResponse,
  SignStatus,
  NyknycSignatureEnvelope,
} from './types.js'

// Utility exports (for advanced usage)
export {
  generatePKCEParams,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  validateCryptoSupport,
} from './utils/pkce.js'

export {
  NyknycStorage,
} from './utils/storage.js'

export {
  buildAuthUrl,
  exchangeCodeForToken,
  getUserInfo,
  refreshAccessToken,
  validateState,
  openAuthWindow,
} from './utils/auth.js'

export {
  createTransaction,
  getTransactionStatus,
  openSigningPopup,
  waitForTransactionCompletion,
  // Signing helpers
  createSignRequest,
  getSignStatus,
  waitForSignCompletion,
  openSigningWindow,
} from './utils/api.js'


/**
 * ERC-6492 utilities (minimal helpers)
 */
export {
  ERC6492_MAGIC_SUFFIX,
  isErc6492Signature,
  sanitizeErc6492,
} from './utils/verify.js'

/**
 * Kernel digest helpers
 */
export {
  computeKernelDomain,
  kernelWrapDigest,
} from './utils/kernel.js'
