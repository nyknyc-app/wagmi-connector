import type { Address } from 'viem'

export interface NyknycParameters {
  /** The app ID registered with NYKNYC platform */
  appId: string
  /** Base URL for NYKNYC platform (defaults to 'https://nyknyc.app') */
  baseUrl?: string
  /** API URL for NYKNYC platform (defaults to 'https://api.nyknyc.app') */
  apiUrl?: string
  /** Enable development mode to bypass HTTPS requirements (defaults to false) */
  developmentMode?: boolean
  /** Optionally verify existing access token against server on restore (defaults to false) */
  verifyOnRestore?: boolean
}

export interface NyknycSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  walletAddress: Address
  chainId: number
  supportedChains?: number[]
}

export interface UserInfo {
  wallet_address: Address
  supported_chains: number[]
  current_chain_id: number
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope?: string
}

export interface TransactionRequest {
  wallet_address: Address
  contract_address?: Address
  function_name?: string
  function_abi?: any
  args?: any[]
  value: string
  data?: string
  chain_id: number
}

export interface TransactionResponse {
  id: string
  status: 'pending_signature' | 'signed' | 'broadcasted' | 'completed' | 'failed'
}

export interface TransactionStatus {
  transaction_id: string
  status: 'pending_signature' | 'signed' | 'broadcasted' | 'completed' | 'failed'
  transaction_hash?: string
  block_number?: number
  gas_used?: string
  error?: string
}

export interface PKCEParams {
  codeVerifier: string
  codeChallenge: string
  state: string
}

export interface AuthCallbackData {
  code: string
  state: string
}

export interface ChainSwitchRequest {
  chain_id: number
}

export interface ChainSwitchResponse {
  success: boolean
  current_chain_id: number
}

/**
 * Signing Types (personal_sign & EIP-712)
 */

export type SignKind = 'personal_sign' | 'eth_signTypedData_v4'

export type MessageEncoding = 'utf8' | 'hex'

export interface NyknycSignatureEnvelope {
  /** Final validator / kernel-compatible signature to be used with ERC-1271 isValidSignature */
  finalSignature: `0x${string}`
  /** ERC-6492 container for off-chain verification (present for Kernel smart accounts) */
  signature_6492?: `0x${string}`
  /** Off-chain verification hash (e.g. EIP-191 or EIP-712 digest) if applicable */
  hashForVerification?: `0x${string}`
  /** Kernel-specific digest that was signed, if applicable */
  kernelDigestSigned?: `0x${string}`
  /** Optional metadata returned by NYKNYC sign service */
  metadata?: {
    validatorIdentifier?: `0x${string}`
    usedReplayable?: boolean
    wrapped6492?: boolean
    isDeployed?: boolean
    guardianIndex?: number
    guardianType?: 'passkey' | 'ecdsa' | string
    chainId?: number
  }
}

export interface SignRequest {
  kind: SignKind
  wallet_address: Address
  chain_id: number
  app_id: string
  /** Used for postMessage origin check in window/tab flow */
  callback_origin?: string
  /** Payload for personal_sign */
  message?: string
  /** Encoding for message (personal_sign) */
  message_encoding?: MessageEncoding
  /** Required when message_encoding === 'hex' (must equal UTF-8 decoding of message) */
  message_text?: string
  /** Payload for eth_signTypedData_v4 */
  typed_data?: {
    domain: Record<string, any>
    primaryType: string
    types: Record<string, { name: string; type: string }[]>
    message: any
    version?: 'V4'
  }
}

export interface SignResponse {
  sign_id: string
  status: 'pending_signature'
  popup_url: string
  expires_at?: number
}

export interface SignStatus {
  sign_id: string
  status: 'pending_signature' | 'signed' | 'rejected' | 'expired' | 'failed'
  signer_address?: Address
  /** Optional generic signature field if backend returns a simple hex as well */
  signature?: `0x${string}`
  signature_type?: 'personal' | 'eip712'
  /** Format of returned signature */
  signature_format?: 'erc6492' | 'raw'
  /** EIP-191 digest for personal_sign */
  message_hash?: `0x${string}`
  /** EIP-712 digest for typed data */
  typed_data_hash?: `0x${string}`
  /** Rich signature envelope with finalSignature & metadata */
  envelope?: NyknycSignatureEnvelope
  chain_id?: number
  error?: string
}
