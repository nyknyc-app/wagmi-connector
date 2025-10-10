# Development Guide

## Testing the Connector Locally

Since the package isn't published to npm yet, here are several ways to test it in a dummy project:

### Method 1: npm link (Recommended)

This is the most common way to test local packages:

1. **In your connector project** (current directory):
```bash
# Install dependencies and build the package
npm install
npm run build

# Create a global symlink
npm link
```

2. **In your test project**:
```bash
# Create a new test project
mkdir nyknyc-test-app
cd nyknyc-test-app
npm init -y

# Install wagmi dependencies
npm install @wagmi/core @wagmi/connectors viem

# Link your local connector
npm link @nyknyc/wagmi-connector
```

3. **Use in your test project**:
```typescript
import { nyknyc } from '@nyknyc/wagmi-connector'
// ... rest of your code
```

### Method 2: File Path Installation

You can install directly from the file system:

1. **Build your connector**:
```bash
npm run build
```

2. **In your test project**:
```bash
# Install from local path
npm install ../path/to/nyknyc-wagmi

# Or if in the same parent directory:
npm install ../nyknyc-wagmi
```

### Method 3: Packed Tarball

Create a tarball and install it:

1. **In your connector project**:
```bash
npm run build
npm pack
# This creates @nyknyc-wagmi-connector-0.1.0.tgz
```

2. **In your test project**:
```bash
npm install ../nyknyc-wagmi/@nyknyc-wagmi-connector-0.1.0.tgz
```

### Method 4: Yalc (Alternative to npm link)

Yalc is a better alternative to npm link that avoids symlink issues:

1. **Install yalc globally**:
```bash
npm install -g yalc
```

2. **In your connector project**:
```bash
npm run build
yalc publish
```

3. **In your test project**:
```bash
yalc add @nyknyc/wagmi-connector
npm install
```

4. **To update after changes**:
```bash
# In connector project
npm run build
yalc push

# Test project will automatically update
```

## Complete Test Project Setup

Here's a complete example of setting up a test project:

### 1. Create Test Project Structure

```bash
mkdir nyknyc-test-app
cd nyknyc-test-app
npm init -y
```

### 2. Install Dependencies

```bash
# Core wagmi dependencies
npm install @wagmi/core @wagmi/connectors viem

# Development dependencies
npm install -D vite @vitejs/plugin-react typescript

# Link your connector (choose one method above)
npm link @nyknyc/wagmi-connector
```

### 3. Create Test Files

**package.json**:
```json
{
  "name": "nyknyc-test-app",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

**index.html**:
```html
<!DOCTYPE html>
<html>
<head>
    <title>NYKNYC Connector Test</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**src/main.ts**:
```typescript
import { createConfig, connect, disconnect, getAccount } from '@wagmi/core'
import { mainnet, sepolia } from '@wagmi/core/chains'
import { http } from 'viem'
import { nyknyc } from '@nyknyc/wagmi-connector'

// Create wagmi config
const config = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    nyknyc({
      appId: 'your_test_app_id', // Replace with your actual app ID
    })
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
})

// Test connection
async function testConnection() {
  try {
    console.log('Connecting to NYKNYC...')
    const result = await connect(config, { 
      connector: nyknyc({ appId: 'your_test_app_id' }) 
    })
    console.log('Connected:', result)
    
    const account = getAccount(config)
    console.log('Account:', account)
    
  } catch (error) {
    console.error('Connection failed:', error)
  }
}

// Add button to test
document.getElementById('app')!.innerHTML = `
  <h1>NYKNYC Connector Test</h1>
  <button onclick="testConnection()">Connect Wallet</button>
`

// Make function global for button
;(window as any).testConnection = testConnection
```

**vite.config.ts**:
```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    https: true, // Required for Web Crypto API
  },
})
```

### 4. Run Test Project

```bash
npm run dev
```

## Development Workflow

When making changes to your connector:

1. **Make changes** to your connector code
2. **Rebuild**: `npm run build`
3. **Update test project**:
   - If using npm link: Changes should be reflected automatically
   - If using yalc: Run `yalc push`
   - If using file path: Run `npm install` again in test project

## Debugging Tips

### 1. Check Build Output
```bash
# Verify the build worked
ls -la dist/
cat dist/index.d.ts
```

### 2. Verify Package Structure
```bash
# Check what would be published
npm pack --dry-run
```

### 3. Test Import Resolution
```bash
# In your test project, check if the import resolves
node -e "console.log(require.resolve('@nyknyc/wagmi-connector'))"
```

### 4. Browser DevTools
- Check Network tab for API calls
- Check Console for errors
- Check Application tab for localStorage/sessionStorage

## Common Issues

### 1. Module Resolution Errors
- Ensure you've built the package: `npm run build`
- Check that `dist/` directory exists and has files
- Verify `package.json` exports are correct

### 2. TypeScript Errors
- Make sure `.d.ts` files are generated in `dist/`
- Check `tsconfig.json` configuration
- Ensure peer dependencies are installed in test project

### 3. Web Crypto API Errors
- Must serve over HTTPS (use `vite --https` or similar)
- Check browser compatibility
- Ensure secure context

### 4. OAuth Popup Issues
- Check popup blocker settings
- Verify redirect URIs in NYKNYC app config
- Test with different browsers

## Publishing Checklist

Before publishing to npm:

1. ✅ All tests pass: `npm test`
2. ✅ Build succeeds: `npm run build`
3. ✅ TypeScript types are correct: `npm run typecheck`
4. ✅ Package can be imported in test project
5. ✅ OAuth flow works end-to-end
6. ✅ Transactions can be sent successfully
7. ✅ Chain switching works
8. ✅ Documentation is complete
9. ✅ Version number is updated
10. ✅ Changelog is updated

Then publish:
```bash
npm publish --access public
