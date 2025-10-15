# NYKNYC Wagmi Connector

The most reliable wagmi connector for Web3. No more dealing with unstable MetaMask or WalletConnect integrations.

## Web3 Wallets, Web2 Simple

NYKNYC brings the next million users to Web3 with a noncustodial smart wallet that works like Web2:
- 🔐 **OAuth Sign-In** - Google, Twitter, or Email (no seed phrases required)
- 🚀 **No Extensions** - Works in any browser without downloads
- ⚡ **Always Working** - Unlike MetaMask or WalletConnect, NYKNYC just works
- 💰 **$5 Free Gas** - Every new user gets $5 gas credits across all networks
- 🏦 **100% Noncustodial** - OAuth for authentication only, users own their keys

## Current Status (v0.1.1)

### ✅ Fully Tested & Working
- **Wallet Connection** - OAuth 2.1 authentication with PKCE
- **Send Transactions** - 4337 account abstraction transactions  
- **Network Switching** - Switch between supported chains
- **SSR Support** - Compatible with Next.js and other SSR frameworks

### ⚠️ Known Limitations
- **Message Signing** - Not yet fully tested, may have issues
- **Typed Data Signing** - Not yet fully tested, may have issues

We're actively working on testing and improving all features. Please report any issues you encounter.

## Supported Networks

NYKNYC supports 5 blockchain networks:

- **Ethereum** (1)
- **Arbitrum One** (42161)
- **BNB Smart Chain** (56)
- **Base** (8453)
- **Polygon** (137)

More networks coming soon!

## Quick Start

### Step 1: Register Your App

Get your App ID from the [NYKNYC Developer Portal](https://nyknyc.app/app/dev/apps)

### Step 2: Install

```bash
npm install @nyknyc/wagmi-connector
```

### Step 3: Add to Your Wagmi Config

```typescript
import { createConfig, http } from 'wagmi'
import { mainnet, polygon, arbitrum, base, bsc } from 'wagmi/chains'
import { nyknyc } from '@nyknyc/wagmi-connector'

const config = createConfig({
  chains: [mainnet, polygon, arbitrum, base, bsc],
  connectors: [
    nyknyc({
      appId: 'your_app_id_here', // Get this from NYKNYC Developer Portal
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [bsc.id]: http(),
  },
})
```

That's it! 🎉

## Usage Examples

### Connect Wallet

```typescript
import { useConnect } from 'wagmi'
import { nyknyc } from '@nyknyc/wagmi-connector'

function ConnectButton() {
  const { connect } = useConnect()
  
  return (
    <button onClick={() => connect({ connector: nyknyc({ appId: 'your_app_id' }) })}>
      Connect NYKNYC
    </button>
  )
}
```

### Send Transaction

```typescript
import { useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'

function SendTransaction() {
  const { sendTransaction } = useSendTransaction()

  const handleSend = () => {
    sendTransaction({
      to: '0x...',
      value: parseEther('0.01')
    })
  }

  return <button onClick={handleSend}>Send Transaction</button>
}
```

### Switch Network

```typescript
import { useSwitchChain } from 'wagmi'
import { polygon } from 'wagmi/chains'

function SwitchNetwork() {
  const { switchChain } = useSwitchChain()

  return (
    <button onClick={() => switchChain({ chainId: polygon.id })}>
      Switch to Polygon
    </button>
  )
}
```

## With Multiple Connectors

NYKNYC works seamlessly alongside other wallet connectors:

```typescript
import { createConfig, http } from 'wagmi'
import { mainnet, polygon } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { nyknyc } from '@nyknyc/wagmi-connector'

const config = createConfig({
  chains: [mainnet, polygon],
  connectors: [
    injected(),
    walletConnect({ projectId: 'YOUR_WC_PROJECT_ID' }),
    nyknyc({ appId: 'your_app_id_here' }), // Always works!
  ],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
  },
})
```

## Next.js / SSR Support

NYKNYC works perfectly with server-side rendering:

```typescript
import { createConfig, http, cookieStorage, createStorage } from 'wagmi'
import { mainnet, polygon } from 'wagmi/chains'
import { nyknyc } from '@nyknyc/wagmi-connector'

export function getConfig() {
  return createConfig({
    chains: [mainnet, polygon],
    connectors: [
      nyknyc({
        appId: process.env.NEXT_PUBLIC_NYKNYC_APP_ID!,
      }),
    ],
    storage: createStorage({
      storage: cookieStorage,
    }),
    ssr: true,
    transports: {
      [mainnet.id]: http(),
      [polygon.id]: http(),
    },
  })
}
```

## How It Works

1. **User clicks connect** - Your dApp initiates NYKNYC connection
2. **OAuth popup opens** - User signs in with Google, Twitter, or Email
3. **Secure authentication** - PKCE flow authorizes your app
4. **Wallet ready** - User can immediately start transacting

All signing happens on NYKNYC with passkeys or connected wallets. Your dApp stays simple.

## Why NYKNYC?

### For Users
- Sign in with Google/Twitter/Email (no browser extensions)
- Passkey signing (Face ID, Touch ID, Windows Hello)
- $5 free gas credits on registration
- Works across 5 networks seamlessly

### For Developers
- Most reliable wagmi connector
- No more MetaMask/WalletConnect instability
- OAuth-based, always works
- Optional transaction sponsorship
- 4337 smart account benefits

## Transaction Sponsorship

Want to sponsor gas for your users? NYKNYC makes it simple. Every new user gets $5 gas credits automatically, and you can sponsor additional transactions.

### How to Set Up Sponsorship

1. Go to [NYKNYC Gas Policies](https://nyknyc.app/app/dev/gas-policies)
2. Create a new policy:
   - Choose your application from the dropdown
   - Select supported chains
   - Choose supported contract addresses
3. That's it! Your users' transactions will be sponsored automatically

With gas sponsorship, your users can interact with your dApp without worrying about gas fees.

## Built on Standards

NYKNYC leverages battle-tested protocols:

- **ERC-4337** - Account abstraction standard
- **Kernel 3.3** - Smart account implementation by ZeroDev
- **EIP-1193** - Provider specification for dApp compatibility
- **OAuth 2.1 + PKCE** - Secure authentication flow

## Browser Support

Works in all modern browsers:
- Chrome 67+
- Firefox 60+
- Safari 13+
- Edge 79+

## Support

- 📧 Email: dev@nyknyc.app
- 📖 Documentation: [docs.nyknyc.app](https://docs.nyknyc.app)
- 🌐 Website: [nyknyc.app](https://nyknyc.app)
- 💬 Community: [NYKNYC in DAOForum](https://daoforum.org/forums/nyknyc/)

## License

MIT License - see [LICENSE](LICENSE) file for details.
