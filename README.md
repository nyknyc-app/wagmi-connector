# NYKNYC Wagmi Connector

A Wagmi connector for NYKNYC's 4337 smart wallet platform, enabling seamless integration of account abstraction wallets into your dApps.

## Features

- 🔐 **OAuth 2.1 with PKCE** - Secure authentication flow without requiring backend secrets
- 🏦 **4337 Account Abstraction** - Smart wallet functionality with gasless transactions
- 🌐 **Multi-chain Support** - Works across 10+ major blockchain networks
- 🔄 **Auto Token Refresh** - Seamless session management
- 📱 **Popup-based Auth** - User-friendly authentication experience
- 🛡️ **Type Safe** - Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @nyknyc/wagmi-connector @wagmi/core viem
```

## Quick Start

### 1. Register Your dApp

First, register your dApp on the [NYKNYC Developer Portal](https://nyknyc.app/developers) to get your `app_id`.

### 2. Configure the Connector

```typescript
import { createConfig } from '@wagmi/core'
import { mainnet, polygon, arbitrum } from '@wagmi/core/chains'
import { nyknyc } from '@nyknyc/wagmi-connector'

const config = createConfig({
  chains: [mainnet, polygon, arbitrum],
  connectors: [
    nyknyc({
      appId: 'your_app_id_here', // Get this from NYKNYC Developer Portal
      redirectUri: 'http://localhost:3000/callback', // Optional: defaults to current origin + '/callback'
    })
  ],
  // ... other wagmi config
})
```

### 3. Connect Wallet

```typescript
import { connect } from '@wagmi/core'

// Connect to NYKNYC wallet
await connect(config, { connector: nyknyc({ appId: 'your_app_id' }) })
```

### 4. Send Transactions

```typescript
import { sendTransaction } from '@wagmi/core'

const hash = await sendTransaction(config, {
  to: '0x...',
  value: parseEther('0.1'),
  data: '0x...'
})
```

## Configuration Options

```typescript
interface NyknycParameters {
  /** Your app ID from NYKNYC Developer Portal */
  appId: string
  
  /** OAuth redirect URI (optional) */
  redirectUri?: string
  
  /** NYKNYC platform base URL (optional) */
  baseUrl?: string
  
  /** NYKNYC API base URL (optional) */
  apiUrl?: string
}
```

## Supported Chains

NYKNYC supports the following blockchain networks:

- Ethereum Mainnet (1)
- Ethereum Sepolia (11155111)
- Polygon (137)
- Arbitrum One (42161)
- Optimism (10)
- BNB Smart Chain (56)
- Avalanche (43114)
- Fantom (250)
- Gnosis Chain (100)
- Base (8453)

## Authentication Flow

The NYKNYC connector uses OAuth 2.1 with PKCE (Proof Key for Code Exchange) for secure authentication:

1. User clicks connect
2. Popup opens to NYKNYC authentication page
3. User completes registration/login and approves your dApp
4. Authorization code is returned via callback
5. Connector exchanges code for access token
6. User wallet information is retrieved and stored

## Transaction Flow

NYKNYC uses 4337 account abstraction for transactions:

1. dApp initiates transaction via Wagmi
2. Transaction details sent to NYKNYC API
3. Signing popup opens for user approval
4. User signs with passkey/biometric authentication
5. Transaction is broadcast and confirmed
6. Transaction hash returned to dApp

## React Example

```typescript
import { useConnect, useAccount, useSendTransaction } from 'wagmi'
import { nyknyc } from '@nyknyc/wagmi-connector'
import { parseEther } from 'viem'

function WalletConnection() {
  const { connect } = useConnect()
  const { address, isConnected } = useAccount()
  const { sendTransaction } = useSendTransaction()

  const handleConnect = () => {
    connect({ 
      connector: nyknyc({ 
        appId: 'your_app_id_here' 
      }) 
    })
  }

  const handleSendTransaction = () => {
    sendTransaction({
      to: '0x...',
      value: parseEther('0.01')
    })
  }

  if (isConnected) {
    return (
      <div>
        <p>Connected: {address}</p>
        <button onClick={handleSendTransaction}>
          Send Transaction
        </button>
      </div>
    )
  }

  return (
    <button onClick={handleConnect}>
      Connect NYKNYC Wallet
    </button>
  )
}
```

## Next.js Example

```typescript
// pages/_app.tsx
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig } from '@wagmi/core'
import { nyknyc } from '@nyknyc/wagmi-connector'

const config = createConfig({
  chains: [mainnet, polygon],
  connectors: [
    nyknyc({
      appId: process.env.NEXT_PUBLIC_NYKNYC_APP_ID!,
      redirectUri: `${process.env.NEXT_PUBLIC_BASE_URL}/callback`
    })
  ],
  // ... other config
})

const queryClient = new QueryClient()

export default function App({ Component, pageProps }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

## Error Handling

The connector provides detailed error messages for common scenarios:

```typescript
try {
  await connect(config, { connector: nyknycConnector })
} catch (error) {
  if (error.message.includes('popup')) {
    // User blocked popups or closed popup
    console.log('Please allow popups for this site')
  } else if (error.message.includes('cancelled')) {
    // User cancelled authentication
    console.log('Authentication was cancelled')
  } else {
    // Other errors
    console.error('Connection failed:', error.message)
  }
}
```

## Advanced Usage

### Custom Provider Access

```typescript
import { getConnectorClient } from '@wagmi/core'

const client = await getConnectorClient(config)
const provider = await client.getProvider()

// Access NYKNYC-specific methods
if (provider instanceof NyknycProvider) {
  // Custom provider methods available here
}
```

### Manual Token Management

```typescript
import { 
  exchangeCodeForToken, 
  refreshAccessToken,
  getUserInfo 
} from '@nyknyc/wagmi-connector'

// Exchange authorization code manually
const tokens = await exchangeCodeForToken(params, code, codeVerifier)

// Refresh tokens manually
const newTokens = await refreshAccessToken(apiUrl, refreshToken)

// Get user info manually
const userInfo = await getUserInfo(apiUrl, accessToken)
```

## Security Considerations

- Always use HTTPS in production
- Validate redirect URIs in your NYKNYC app configuration
- Store sensitive data securely (tokens are automatically handled)
- Implement proper error handling for authentication flows

## Browser Support

- Chrome 67+
- Firefox 60+
- Safari 13+
- Edge 79+

Requires Web Crypto API support for PKCE implementation.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Support

- 📧 Email: dev@nyknyc.app
- 📖 Documentation: [docs.nyknyc.app](https://docs.nyknyc.app)
- 💬 Discord: [NYKNYC Community](https://discord.gg/nyknyc)

## License

MIT License - see [LICENSE](LICENSE) file for details.
