// Pure Serverless WebRTC P2P Engine using PeerJS & Dynamic Backend API Tunnel Discovery
// Zero Server Storage • Direct Browser-to-Browser Streaming
import Peer from 'peerjs';
import { API_BASE } from './apiConfig';

const PeerConstructor = Peer.Peer || Peer;

// STUN + Open Relay TURN servers for reliable Mobile 4G/5G <-> PC connections
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ]
};

const CHUNK_SIZE = 64 * 1024; // 64 KB chunk size

// In-memory registry of active channels
const activeAnnouncements = new Map();
const channelSubscribers = new Set();
let pollInterval = null;

// Local cross-tab BroadcastChannel for same-device instant discovery
let bc = null;
try {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel('ghostdrop-local-lobby');
    bc.onmessage = (e) => {
      const msg = e.data;
      if (msg && msg.type === 'announce' && msg.code) {
        activeAnnouncements.set(msg.code, {
          ...msg,
          lastSeen: Date.now()
        });
        notifySubscribers();
      } else if (msg && msg.type === 'close' && msg.code) {
        activeAnnouncements.delete(msg.code);
        notifySubscribers();
      }
    };
  }
} catch (err) {
  console.warn('[Discovery] BroadcastChannel not supported:', err);
}

// Notify all mounted components (DownloadView, ActiveFilesList) of current channel list
function notifySubscribers() {
  const now = Date.now();
  const list = [];
  for (const [code, data] of activeAnnouncements.entries()) {
    if (now < data.expiresAt) {
      list.push({
        id: data.code,
        code: data.code,
        originalName: data.name,
        size: data.size,
        mimeType: data.typeMime || data.type,
        expiresAt: data.expiresAt
      });
    } else {
      activeAnnouncements.delete(code);
    }
  }
  for (const cb of channelSubscribers) {
    try { cb(list); } catch (e) {}
  }
}

// Fetch active open tunnels from backend dynamically
async function fetchActiveBackendTunnels() {
  try {
    const res = await fetch(`${API_BASE}/api/tunnel/active?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.success && Array.isArray(data.files)) {
      const currentRemoteCodes = new Set(data.files.map((f) => f.code));

      // Update or add active channels from backend
      for (const item of data.files) {
        activeAnnouncements.set(item.code, {
          code: item.code,
          name: item.originalName,
          size: item.size,
          typeMime: item.mimeType,
          expiresAt: item.expiresAt,
          lastSeen: Date.now()
        });
      }

      // Remove non-local channels that are no longer reported active by backend
      for (const [code, val] of activeAnnouncements.entries()) {
        if (!val.isLocal && !currentRemoteCodes.has(code)) {
          activeAnnouncements.delete(code);
        }
      }

      notifySubscribers();
    }
  } catch (err) {
    console.warn('[Discovery] Backend poll warning:', err);
  }
}

export function publishChannel(data) {
  // Broadcast locally across tabs
  if (bc) {
    try { bc.postMessage(data); } catch (e) {}
  }
}

export function requestChannelScan() {
  fetchActiveBackendTunnels();
}

// ----------------------------------------------------
// DISCOVERY HOOK FOR RECEIVER (Listens for Open Channels)
// ----------------------------------------------------
export function subscribeToOpenChannels(onUpdate) {
  channelSubscribers.add(onUpdate);

  // Send current cached list immediately
  notifySubscribers();

  // Fetch fresh tunnels from backend immediately
  fetchActiveBackendTunnels();

  // Polling every 2.5 seconds (shared across all subscribers)
  if (!pollInterval) {
    pollInterval = setInterval(fetchActiveBackendTunnels, 2500);
  }

  return () => {
    channelSubscribers.delete(onUpdate);
    if (channelSubscribers.size === 0 && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
}

// ----------------------------------------------------
// SENDER ENGINE (PeerJS Direct Stream)
// ----------------------------------------------------
export function startSenderTunnel(code, file, { onStatus, onProgress, onError }) {
  const peerId = `ghostdrop-${code}`;
  let isClosed = false;
  let heartbeatTimer = null;

  const peer = new PeerConstructor(peerId, {
    config: RTC_CONFIG,
    debug: 1
  });

  const channelData = {
    type: 'announce',
    code,
    name: file.name,
    size: file.size,
    typeMime: file.type || 'application/octet-stream',
    expiresAt: Date.now() + 2 * 3600 * 1000,
    isLocal: true,
    lastSeen: Date.now()
  };
  activeAnnouncements.set(code, channelData);
  notifySubscribers();
  publishChannel(channelData);

  // 1. Register active tunnel on backend so other devices can discover it dynamically
  fetch(`${API_BASE}/api/tunnel/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      originalName: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    })
  }).catch((err) => {
    console.warn('[Backend] Register tunnel warning:', err);
  });

  // 2. Send heartbeat to backend every 7 seconds to keep channel listed as active
  heartbeatTimer = setInterval(() => {
    if (isClosed) return;
    fetch(`${API_BASE}/api/tunnel/heartbeat/${code}`, {
      method: 'POST'
    }).catch(() => {});
  }, 7000);

  // Auto clean-up on tab close / reload
  const handleUnload = () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_BASE}/api/tunnel/${code}`);
      } else {
        fetch(`${API_BASE}/api/tunnel/${code}`, { method: 'DELETE', keepalive: true });
      }
    } catch (e) {}
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleUnload);
  }

  peer.on('open', (id) => {
    console.log('[P2P Sender] Registered on PeerJS Cloud with ID:', id);
    onStatus('waiting');
  });

  peer.on('connection', (conn) => {
    console.log('[P2P Sender] Incoming connection from Receiver!');
    onStatus('connecting');

    let streamStarted = false;

    const startStreaming = () => {
      if (streamStarted || isClosed) return;
      streamStarted = true;

      console.log('[P2P Sender] ⚡ WebRTC Data Channel OPEN! Streaming file...');
      onStatus('transferring');

      // Send metadata header first
      try {
        conn.send({
          type: 'header',
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
        });
      } catch (err) {
        console.warn('[P2P Sender] Error sending header:', err);
      }

      let offset = 0;
      const startTime = Date.now();
      let lastTime = startTime;
      let lastOffset = 0;

      const readAndSendChunk = () => {
        if (isClosed || conn.open === false) return;

        if (offset >= file.size) {
          // Finished sending!
          try {
            conn.send({ type: 'complete' });
          } catch (e) {}
          console.log('[P2P Sender] File streaming complete!');
          onStatus('completed');
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = (e) => {
          if (isClosed || conn.open === false) return;

          try {
            conn.send(e.target.result);
          } catch (sendErr) {
            console.error('[P2P Sender] Send chunk error:', sendErr);
            if (onError) onError('Data send interrupted: ' + sendErr.message);
            return;
          }

          offset += e.target.result.byteLength;

          // Progress calculation
          const now = Date.now();
          const percent = Math.min(100, Math.round((offset / file.size) * 100));
          let speedMBps = 0;
          if (now - lastTime >= 500) {
            const bytesDiff = offset - lastOffset;
            const timeDiff = (now - lastTime) / 1000;
            speedMBps = ((bytesDiff / (1024 * 1024)) / timeDiff).toFixed(2);
            lastTime = now;
            lastOffset = offset;
          }

          onProgress({
            percent,
            bytesSent: offset,
            totalBytes: file.size,
            speedMBps
          });

          // Pacing check for smooth non-blocking streaming
          const dataChannel = conn.dataChannel;
          if (dataChannel && dataChannel.bufferedAmount > CHUNK_SIZE * 4) {
            setTimeout(readAndSendChunk, 20);
          } else {
            setTimeout(readAndSendChunk, 0);
          }
        };

        reader.readAsArrayBuffer(slice);
      };

      // Start streaming
      readAndSendChunk();
    };

    if (conn.open) {
      setTimeout(startStreaming, 100);
    } else {
      conn.on('open', () => {
        setTimeout(startStreaming, 150);
      });
    }

    conn.on('data', (data) => {
      if (data && data.type === 'ready') {
        startStreaming();
      }
    });

    conn.on('error', (err) => {
      console.error('[P2P Sender] Connection error:', err);
      if (onError) onError('Peer connection interrupted');
    });
  });

  peer.on('error', (err) => {
    console.error('[P2P Sender] Peer error:', err);
    if (err.type === 'unavailable-id') {
      if (onError) onError('Channel code in use. Please generate a new code.');
    } else {
      if (onError) onError(err.message || 'P2P signaling error');
    }
  });

  return {
    close: () => {
      isClosed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleUnload);
      }
      activeAnnouncements.delete(code);
      notifySubscribers();
      publishChannel({ type: 'close', code });
      fetch(`${API_BASE}/api/tunnel/${code}`, { method: 'DELETE' }).catch(() => {});
      try { peer.destroy(); } catch (e) {}
    }
  };
}

// ----------------------------------------------------
// RECEIVER ENGINE (PeerJS Direct Receive)
// ----------------------------------------------------
export function startReceiverTunnel(code, { initialFileInfo, onStatus, onProgress, onComplete, onError }) {
  const targetPeerId = `ghostdrop-${code}`;
  let isClosed = false;
  let receivedChunks = [];
  let fileInfo = initialFileInfo || null;
  let receivedBytes = 0;
  let startTime = Date.now();
  let lastTime = startTime;
  let lastBytes = 0;

  const peer = new PeerConstructor({
    config: RTC_CONFIG,
    debug: 1
  });

  peer.on('open', () => {
    console.log('[P2P Receiver] Connecting to Sender:', targetPeerId);
    onStatus('connecting');

    const conn = peer.connect(targetPeerId, { reliable: true });

    const handleConnOpen = () => {
      console.log('[P2P Receiver] ⚡ WebRTC Data Channel OPEN! Sending ready signal...');
      onStatus('transferring');
      startTime = Date.now();
      lastTime = startTime;
      try {
        conn.send({ type: 'ready' });
      } catch (e) {}
    };

    if (conn.open) {
      handleConnOpen();
    } else {
      conn.on('open', handleConnOpen);
    }

    conn.on('data', (data) => {
      if (isClosed) return;

      const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Blob;

      if (!isBinary && typeof data === 'object' && data !== null) {
        if (data.type === 'header') {
          fileInfo = { ...fileInfo, ...data };
          console.log('[P2P Receiver] Receiving file metadata:', fileInfo);
        } else if (data.type === 'complete') {
          console.log('[P2P Receiver] Transfer complete! Assembling file with', receivedChunks.length, 'chunks...');
          onStatus('assembling');

          // Assemble Blob
          const blob = new Blob(receivedChunks, {
            type: fileInfo?.mimeType || 'application/octet-stream'
          });

          // Create permanent object URL for download
          const downloadUrl = URL.createObjectURL(blob);
          const fileName = fileInfo?.name || 'downloaded_file';

          // Try automatic desktop click download
          try {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (e) {
            console.warn('[P2P Receiver] Auto click error:', e);
          }

          onComplete({
            blob,
            url: downloadUrl,
            name: fileName,
            size: fileInfo?.size || blob.size,
            mimeType: fileInfo?.mimeType || 'application/octet-stream'
          });
          onStatus('completed');
        }
      } else {
        // Binary Chunk: handle ArrayBuffer, Uint8Array view, or Blob
        let chunk;
        if (data instanceof ArrayBuffer) {
          chunk = data;
        } else if (ArrayBuffer.isView(data)) {
          chunk = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else if (data instanceof Blob) {
          chunk = data;
        } else {
          return;
        }

        const chunkSize = chunk.byteLength || chunk.size || 0;
        receivedChunks.push(chunk);
        receivedBytes += chunkSize;

        const total = (fileInfo && fileInfo.size > 0) ? fileInfo.size : (receivedBytes || 1);
        const percent = total > 0 ? Math.min(100, Math.round((receivedBytes / total) * 100)) : 0;

        // Speed calculation
        const now = Date.now();
        let speedMBps = 0;
        if (now - lastTime >= 500) {
          const diff = receivedBytes - lastBytes;
          const timeDiff = (now - lastTime) / 1000;
          speedMBps = ((diff / (1024 * 1024)) / timeDiff).toFixed(2);
          lastTime = now;
          lastBytes = receivedBytes;
        }

        onProgress({
          percent,
          bytesReceived: receivedBytes,
          totalBytes: total,
          speedMBps
        });
      }
    });

    conn.on('error', (err) => {
      console.error('[P2P Receiver] DataConnection error:', err);
      if (onError) onError('Direct transfer interrupted');
    });

    conn.on('close', () => {
      console.log('[P2P Receiver] Connection closed');
    });
  });

  peer.on('error', (err) => {
    console.error('[P2P Receiver] Peer error:', err);
    if (err.type === 'peer-unavailable') {
      if (onError) onError('Sender not found or has closed the tab. Make sure the sender tab is open!');
    } else {
      if (onError) onError(err.message || 'P2P connection error');
    }
  });

  return {
    close: () => {
      isClosed = true;
      try { peer.destroy(); } catch (e) {}
      receivedChunks = [];
    }
  };
}
