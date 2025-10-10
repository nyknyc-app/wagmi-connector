# NYKNYC Wallet Integration Guide (Wagmi + EIP-1193 + EIP-5792)

This document describes how the NYKNYC wallet backend and frontend should receive requests and return responses to fully support:

- Wagmi's standard flows (connect, sign, send transaction)
- EIP-1193 provider semantics
- EIP-5792 "Wallet Call API" (batch calls) semantics

It is written to align with the current connector implementation in this package and outlines recommended backend contracts and frontend UX requirements.


## Glossary

- App (Dapp): The developer's application that uses Wagmi and the NYKNYC custom connector.
- Connector: The `@nyknyc/wagmi-connector` library used by the app.
- Wallet Backend: NYKNYC API endpoints (e.g., `http://localhost:8001`).
- Wallet Frontend: NYKNYC web app (e.g., `http://localhost:3000`) that shows review/signing UI.
- Session: OAuth-based auth that provides `accessToken`, `refreshToken`, `walletAddress`, `chainId`.


## High-Level Flows

1) OAuth Connect
- The connector launches NYKNYC OAuth to authenticate the user and obtain tokens + wallet info.
- Backend must expose OAuth endpoints and a `GET /user/info` that returns:
  - `wallet_address` (EIP-55 format preferred)
  - `current_chain_id`
- Tokens are stored by the connector and refreshed as needed (`refresh_token` grant).

2) Sign (personal_sign & eth_signTypedData_v4)
- The connector calls `POST /user/sign` with the payload and opens a new tab for the user to approve in the Wallet Frontend.
- The connector polls `GET /user/sign/:id` until `status === "signed"`, and returns the final signature to the app.
- Optionally, the Wallet Frontend can `postMessage` to the opener to allow early close (see Events).

3) Send Transaction (eth_sendTransaction)
- The app (Wagmi) calls `eth_sendTransaction` with raw EVM tx fields (`to`, `data`, `value`).
- The connector creates a transaction via `POST /transactions/create`, opens a new tab for the Wallet Frontend review/signing page `/app/transactions/{tx_id}`, then polls `GET /transactions/{tx_id}/status` until `transaction_hash` is available (post-bundler broadcast).
- The connector returns `transaction_hash` to the dapp as soon as it is available (Wagmi-aligned).
- The dapp uses `useWaitForTransactionReceipt({ hash })` to confirm on-chain.

4) Batch Calls (EIP-5792 wallet_sendCalls + wallet_getCallsReceipt)
- The app calls `wallet_sendCalls` with an array of calls.
- MVP behavior today: the connector creates one NYKNYC transaction per call (not a single encoded calldata), opens the first `/app/transactions/{tx_id}` page, and returns a generated `batchId`.
- The app uses `useWaitForCallsStatus({ connector, id: batchId })`.
- The connector maps per-transaction statuses to an EIP-5792 `wallet_getCallsReceipt` result. When backend exposes execution outcome for each call, the connector returns `CONFIRMED` with minimal receipts. Otherwise it stays `PENDING` to avoid false positives (AA nuance).


## Backend API Contracts

Base URLs (dev defaults):
- Frontend (Wallet UI): `BASE_URL = http://localhost:3000`
- Backend API: `API_URL = http://localhost:8001`

The connector will use these endpoints:

### 1. Create Transaction
POST {API_URL}/transactions/create

- Purpose: Create a new transaction record and return a unique identifier.
- Request (JSON):
  ```
  {
    "wallet_address": "0x...",        // Smart account address
    "contract_address": "0x...",      // To address (may be omitted for deployment)
    "function_name": "...",           // Optional (not required for raw EVM flow)
    "function_abi": { ... },          // Optional
    "args": [ ... ],                  // Optional
    "value": "0",                     // Decimal string
    "data": "0x...",                  // Calldata (hex), optional
    "chain_id": 11155111              // Number
  }
  ```
- Response (JSON):
  ```
  {
    "transaction_id": "uuid-or-hash-like",
    "status": "pending_signature" | "signed" | "broadcasted" | "completed" | "failed"
  }
  ```

Notes:
- The connector builds the UI URL locally as:
  - `{BASE_URL}/app/transactions/{transaction_id}`
- The wallet frontend must render a review/signing page for this transaction id.

### 2. Get Transaction Status
GET {API_URL}/transactions/{transaction_id}/status

- Purpose: Return real-time status for an individual transaction.
- Response (JSON):
  ```
  {
    "transaction_id": "string",
    "status": "pending_signature" | "signed" | "broadcasted" | "completed" | "failed",
    "transaction_hash": "0x...",          // Present after broadcast
    "block_number": 123456,               // Optional
    "gas_used": "21000",                  // Optional (decimal string)
    "error": "string",                    // Optional error message

    // Strongly recommended for AA correctness:
    "execution_status": "success" | "failed" | "unknown",    // derived from receipt.status and/or UserOperationEvent.success
    "user_operation_status": "success" | "failed" | "unknown", // Optional
    "logs": [                                                // Optional, logs relevant to this user operation
      { "address": "0x...", "topics": ["0x..."], "data": "0x..." }
    ],
    "block_hash": "0x..."              // Optional (for mapping to receipts)
  }
  ```

Status meaning:
- `pending_signature`: Waiting for user action in the Wallet Frontend.
- `signed`: User approved; preparing for broadcast (or bundler pipeline started).
- `broadcasted`: Transaction submitted to bundler / mempool. `transaction_hash` should be included once available.
- `completed`: Execution finished successfully (preferably AA-aware).
- `failed`: Execution failed (preferably AA-aware).

Execution correctness:
- For ERC-4337 nuance (userOp vs tx), please derive `execution_status` based on receipt and UserOperationEvent.success (as shown in your AnalyzeUserOpDevView logic), and include it in the response when available.


### 3. Create Sign Request
POST {API_URL}/user/sign

- Purpose: Initiate a signing request.
- Request (JSON):
  ```
  // Personal Sign:
  {
    "kind": "personal_sign",
    "wallet_address": "0x...",
    "chain_id": 11155111,
    "app_id": "app-id",
    "callback_origin": "https://dapp-origin.tld",
    "message": "string | 0xhex",
    "message_encoding": "utf8" | "hex",
    "message_text": "decoded message if hex"
  }

  // EIP-712:
  {
    "kind": "eth_signTypedData_v4",
    "wallet_address": "0x...",
    "chain_id": 11155111,
    "app_id": "app-id",
    "callback_origin": "https://dapp-origin.tld",
    "typed_data": { domain, primaryType, types, message, version?: "V4" }
  }
  ```
- Response (JSON):
  ```
  {
    "sign_id": "string",
    "status": "pending_signature",
    "popup_url": "https://nyknyc.app/app/sign/..."
  }
  ```

### 4. Get Sign Status
GET {API_URL}/user/sign/{sign_id}

- Response (JSON):
  ```
  {
    "sign_id": "string",
    "status": "pending_signature" | "signed" | "rejected" | "expired" | "failed",
    "signer_address": "0x...",
    "signature": "0x...",                // optional raw
    "signature_type": "personal" | "eip712",
    "signature_format": "erc6492" | "raw",
    "message_hash": "0x...",             // optional (EIP-191 digest)
    "typed_data_hash": "0x...",          // optional (EIP-712 digest)
    "envelope": {
      "finalSignature": "0x...",
      "signature_6492": "0x...",
      "metadata": { ... }
    },
    "chain_id": 11155111,
    "error": "string"
  }
  ```


## Wallet Frontend Requirements

### Review/Sign Tabs

- Transactions page: `/app/transactions/{transaction_id}`
  - Shows the intended actions (to, value, decoded function, human-readable summaries).
  - Guides the user to approve/reject.
  - After approval, triggers the backend pipeline (bundler, paymaster, etc.).
  - Once broadcasted, ensure the backend includes `transaction_hash` on `/status`.

- Sign page: `/app/sign/{sign_id}` (or your current location)
  - Shows message/typed data details.
  - Approve/reject flows.

### Optional window.postMessage Events

The connector's `openSigningWindow` listens for:
- `NYKNYC_SIGN_SUCCESS`
- `NYKNYC_SIGN_ERROR`

If you wish to close the tab earlier (optimization), you can `postMessage` to `window.opener` with:
```
window.opener?.postMessage({ type: 'NYKNYC_SIGN_SUCCESS' }, origin)
```
or
```
window.opener?.postMessage({ type: 'NYKNYC_SIGN_ERROR', error: '...' }, origin)
```

Note:
- For transactions, the connector relies on backend polling and does not require postMessage to proceed.
- For sign flows, postMessage allows the connector to close the tab early while it still polls server-side for final status.


## EIP-1193 Behavior (What Wagmi Expects)

- `eth_sendTransaction` MUST resolve with the transaction hash once available.
  - The connector returns when `/status` includes `transaction_hash`.
  - The app uses `useWaitForTransactionReceipt({ hash })` to confirm.

- `personal_sign` MUST resolve with the final signature (ERC-1271-compatible / envelope-supported).
- `eth_signTypedData_v4` MUST resolve with the final signature (ERC-1271 / envelope-supported).
- `wallet_switchEthereumChain` updates the session chain id locally (the platform enforces chain per action).


## EIP-5792 Behavior (Batch Calls)

The connector implements:

### A) wallet_getCapabilities

- Response shape:
  ```
  {
    "0x...chainIdHex": {
      // "atomicBatch": { "supported": true } // add when backend supports true atomic batch
    }
  }
  ```

### B) wallet_sendCalls

- Parameters:
  ```
  {
    "version": "1.0",               // optional
    "chainId": "0x...hex",
    "from": "0x...optional",
    "calls": [
      { "to": "0x...", "data": "0x...", "value": "0x..." }, // any subset (value is hex)
      ...
    ],
    "capabilities": { ... }         // optional (e.g., paymaster options)
  }
  ```
- Current connector behavior:
  - Creates one NYKNYC transaction per call using raw EVM fields (not encoded multicall).
  - Opens `/app/transactions/{first_tx_id}` in a new tab for review/signing.
  - Returns a `batchId` (string): maps to the list of `transaction_id`s internally.
- Return (string): `"nyknyc_batch_<uuid>"`

Notes:
- When backend supports it, you can switch to a single batch UI (e.g., `/app/calls/{batchId}`) and/or atomic batch execution. The connector is documented to accommodate this change (see provider comments).

### C) wallet_getCallsReceipt

- Return shape (per EIP-5792):
  ```
  {
    "status": "PENDING" | "CONFIRMED",
    "receipts": [
      {
        "logs": [{ "address": "0x...", "topics": ["0x..."], "data": "0x..." }],
        "status": "0x1" | "0x0",
        "blockHash": "0x...",
        "blockNumber": "0x...",
        "gasUsed": "0x...",
        "transactionHash": "0x..."
      }
      // ... one per call if not atomic; single receipt if atomic batch in future
    ]
  }
  ```
- Mapping policy (current):
  - If any call is missing `transaction_hash` → return `{ status: "PENDING" }`.
  - When execution outcome is reliable (via `execution_status` or terminal states), return `status: "CONFIRMED"` and include a minimal `receipts` array. `status` in receipts must be `"0x1"` or `"0x0"`.
  - If backend cannot provide reliable execution outcome yet, keep `PENDING` to avoid false positives.

- Backend recommendation:
  - Extend `/transactions/{id}/status` with `execution_status` and optionally logs, blockHash, gasUsed so the connector can populate `receipts` correctly.
  - For AA, use `UserOperationEvent.success` and/or receipt.status to derive execution outcome.


## Value, Encoding, and Formatting

- `value` on `/transactions/create` is a decimal string. The connector converts EIP-5792 hex values to decimal strings for this endpoint.
- `data` is hex (`0x`-prefixed).
- Addresses should be normalized (EIP-55 recommended).
- `chain_id` is a number on backend endpoints; EIP-5792 `chainId` is hex in the request.


## Error Handling

- API must use proper HTTP statuses:
  - 401: expired/invalid token (connector will refresh and retry once)
  - 403: access denied
  - 429: rate limit
  - 5xx: server error
- JSON errors:
  ```
  { "error": "human readable message" }
  ```
- `/status` `failed` should include an `error` field where possible (e.g., revert reason snippet).

Connector behavior:
- On 401, it refreshes token once and retries.
- On `failed` from `/status`, it throws with the included error message.


## Security and Origin Checks

- `openSigningWindow(url, baseUrl)`:
  - Use `baseUrl` (e.g., `http://localhost:3000`) to verify `postMessage` origin in dev environments.
  - Ensure the frontend and backend enforce correct session ownership of `transaction_id` and `sign_id`.
- CORS:
  - Backend must allow the dapp origin for API calls, or rely on bearer tokens strictly serverside if proxied.


## UX Notes

- Transactions (eth_sendTransaction) should display:
  - To, Value, Decoded Function and Arguments (when derivable).
  - Paymaster/AA details if applicable.
- Batch Calls (EIP-5792) UX (future-ready):
  - Present a single coherent review for multiple calls, ideally atomic where supported.
  - If not atomic, clearly explain per-call execution semantics.

The connector currently opens the first transaction page to initiate signing. When you add a dedicated batch UI, update the connector to open that batch page instead and keep the internal batch mapping consistent (comments in code show where to change).


## Wagmi Alignment: What to return after user submits?

- For `eth_sendTransaction`:
  - Return the transaction hash as soon as it is available (post-broadcast). Do NOT wait for confirmations or the final receipt. The dapp will use `useWaitForTransactionReceipt` for confirmations.
- For EIP-5792 `wallet_sendCalls`:
  - Return a batch id string. The dapp will call `useWaitForCallsStatus({ id })` to observe `PENDING` → `CONFIRMED` and read receipts.


## Example Payloads

### Send Transaction (createDAO example)

Request:
```
POST /transactions/create
{
  "wallet_address": "0x1520F1C4b0ca589C73321C125A4f78bdF3C6Da67",
  "contract_address": "0xcC961E2a43762caD4c673d471b9fcddE233716Dd",
  "function_name": "createDAO",            // optional
  "function_abi": { ... },                 // optional
  "args": ["1.0.0", "MyDAO", "My Token", "MTK", 1000000000000000000000000], // optional
  "value": "0",
  "chain_id": 11155111,
  "data": "0x..."                          // Prepared calldata for raw EVM path (preferred by connector)
}
```

Response:
```
{ "transaction_id": "7d39c805-ad48-4878-bb89-f7a137f50309", "status": "pending_signature" }
```

Status:
```
GET /transactions/7d39c805-ad48-4878-bb89-f7a137f50309/status
{
  "transaction_id": "7d39c805-ad48-4878-bb89-f7a137f50309",
  "status": "broadcasted",
  "transaction_hash": "0xabc...",
  "execution_status": "unknown"  // update to "success"/"failed" when known
}
```


## Future Enhancements

- Atomic batch support:
  - Implement a backend endpoint that takes an array of calls and produces a single user operation / transaction with an id (for EIP-5792). Expose a batch page like `/app/calls/{batchId}` for UX.
  - Support `wallet_getCapabilities` with `"atomicBatch": { "supported": true }` for chains where it is available.

- Rich receipts:
  - `wallet_getCallsReceipt` can include per-call logs and gas usage when backend has these details (per EIP-5792 spec).

- Optional provider events:
  - Emit custom `'nyknyc:txStatus'` events from the connector after reading `/status` terminal outcomes to aid apps that only use hashes. Not required if apps use EIP-5792.


## Checklist Summary

- [x] OAuth to get `accessToken`, `walletAddress`, `chainId`.
- [x] Implement `/transactions/create` and `/transactions/{id}/status`:
  - Return `transaction_id` on create.
  - Include `transaction_hash` as soon as broadcasted.
  - Include `execution_status` when determined (AA-aware correctness).
- [x] Implement `/user/sign` and `/user/sign/:id`.
- [x] Frontend routes:
  - `/app/transactions/{transaction_id}` for transaction review/signing.
  - `/app/sign/{sign_id}` for message signing.
- [x] Optional `postMessage` events for early close (sign).
- [x] EIP-5792 semantics in connector:
  - `wallet_sendCalls`: return batch id (string).
  - `wallet_getCallsReceipt`: PENDING → CONFIRMED with minimal receipts.

With the above, developers can use the NYKNYC connector out-of-the-box with minimal or no changes to their Wagmi-based apps, and can opt into EIP-5792 for AA-correct batch workflows.
