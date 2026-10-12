# GhostDrop — P2P File Transfer (Frontend)

Fast, secure, browser-to-browser direct file streaming web client with zero server storage.

## Features

- **P2P Direct Streaming**: Files stream directly from sender to receiver via WebRTC DataChannels.
- **Unlimited File Sizes**: Backpressure flow control prevents browser memory overload.
- **One-Click Connect**: Receivers scan open channels and connect with a single click.
- **Zero Server Storage**: Server stores 0 MB of files.
- **Self-Destructing**: 2-hour channel lifetime.

## Production Configuration

When deployed on Vercel, requests are automatically proxied to the live signaling backend:
`https://p2p-file-transfer-two.vercel.app`

Optional custom backend URL:
```env
VITE_API_BASE_URL=https://your-backend-url.vercel.app
```

## Local Development

```bash
npm install
npm run dev
```
Runs at `http://localhost:5173`.
