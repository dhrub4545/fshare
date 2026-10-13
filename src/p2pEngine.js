// Pure Serverless WebRTC P2P Engine using PeerJS & Universal HTTPS Live Discovery
// Zero Server Storage • Zero Backend Server • Direct Browser-to-Browser Streaming

import Peer from 'peerjs';

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
const NTFY_TOPIC = 'ghostdrop_live_channels_v3';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// In-memory registry of active channels
const activeAnnouncements = new Map();

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
      } else if (msg && msg.type === 'close' && msg.code) {
        activeAnnouncements.delete(msg.code);
      }
    };
  }
} catch (err) {
  console.warn('[Discovery] BroadcastChannel not supported:', err);
}

// Global Cross-Device Discovery using universal HTTPS REST & SSE (Never blocked by Brave/Shields)
let eventSource = null;
let isListenerInitialized = false;

function initDiscoveryListener() {
  if (isListenerInitialized || typeof window === 'undefined') return;
  isListenerInitialized = true;

  // 1. Initial poll of any active channels created in the last 2 minutes
  fetch(`${NTFY_URL}/json?poll=1&since=2m`)
    .then((res) => res.text())
    .then((text) => {
      parseNtfyLines(text);
    })
    .catch((err) => {
      console.warn('[Discovery] Initial poll warning:', err);
    });

  // 2. Real-time stream using Server-Sent Events (SSE)
  if (typeof EventSource !== 'undefined') {
    try {
      eventSource = new EventSource(`${NTFY_URL}/sse?since=10s`);

      eventSource.onmessage = (e) => {
        try {
          const item = JSON.parse(e.data);
          if (item && item.message) {
            const data = JSON.parse(item.message);
            if (data.type === 'announce' && data.code) {
              activeAnnouncements.set(data.code, {
                ...data,
                lastSeen: (item.time * 1000) || Date.now()
              });
            } else if (data.type === 'close' && data.code) {
              activeAnnouncements.delete(data.code);
            }
          }
        } catch (err) {}
      };

      eventSource.onerror = () => {
        // SSE automatically reconnects on network blips
      };
    } catch (e) {
      console.warn('[Discovery] EventSource init error:', e);
    }
  }
}

function parseNtfyLines(text) {
  if (!text) return;
  const lines = text.trim().split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      if (item && item.message) {
        const data = JSON.parse(item.message);
        if (data.type === 'announce' && data.code) {
          activeAnnouncements.set(data.code, {
            ...data,
            lastSeen: (item.time * 1000) || Date.now()
          });
        } else if (data.type === 'close' && data.code) {
          activeAnnouncements.delete(data.code);
        }
      }
    } catch (e) {}
  }
}

export function publishChannel(data) {
  // Broadcast locally across tabs
  if (bc) bc.postMessage(data);

  // Broadcast globally across devices via universal HTTPS
  try {
    fetch(NTFY_URL, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Title': 'GhostDrop' }
    }).catch(() => {});
  } catch (e) {}
}

export function requestChannelScan() {
  // Re-poll the last 2 minutes for immediate fresh list
  fetch(`${NTFY_URL}/json?poll=1&since=2m`)
    .then((res) => res.text())
    .then((text) => {
      parseNtfyLines(text);
    })
    .catch(() => {});
}

// ----------------------------------------------------
// DISCOVERY HOOK FOR RECEIVER (Listens for Open Channels)
// ----------------------------------------------------
export function subscribeToOpenChannels(onUpdate) {
  initDiscoveryListener();
  requestChannelScan();

  // Periodic poll & clean up expired channels
  const interval = setInterval(() => {
    requestChannelScan();

    const now = Date.now();
    const list = [];
    for (const [code, data] of activeAnnouncements.entries()) {
      if (now - data.lastSeen < 30000 && now < data.expiresAt) {
        list.push({
          id: data.code,
          code: data.code,
          originalName: data.name,
          size: data.size,
          mimeType: data.typeMime || data.type,
          expiresAt: data.expiresAt
        });
      } else if (now - data.lastSeen >= 30000) {
        activeAnnouncements.delete(code);
      }
    }
    onUpdate(list);
  }, 1500);

  return () => clearInterval(interval);
}

// ----------------------------------------------------
// SENDER ENGINE (PeerJS Direct Stream)
// ----------------------------------------------------
export function startSenderTunnel(code, file, { onStatus, onProgress, onError }) {
  const peerId = `ghostdrop-${code}`;
  let isClosed = false;
  let broadcastTimer = null;

  const peer = new PeerConstructor(peerId, {
    config: RTC_CONFIG,
    debug: 1
  });

  initDiscoveryListener();

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

  // Announce immediately
  publishChannel(channelData);

  // Re-announce heartbeat every 6 seconds to keep channel alive
  broadcastTimer = setInterval(() => {
    if (isClosed) return;
    channelData.lastSeen = Date.now();
    publishChannel(channelData);
  }, 6000);

  peer.on('open', (id) => {
    console.log('[P2P Sender] Registered on PeerJS Cloud with ID:', id);
    onStatus('waiting');
  });

  peer.on('connection', (conn) => {
    console.log('[P2P Sender] Incoming connection from Receiver!');
    onStatus('connecting');

    conn.on('open', () => {
      console.log('[P2P Sender] ⚡ WebRTC Data Channel OPEN! Streaming file...');
      onStatus('transferring');
      if (broadcastTimer) clearInterval(broadcastTimer);

      // Send metadata header first
      conn.send({
        type: 'header',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream'
      });

      let offset = 0;
      const startTime = Date.now();
      let lastTime = startTime;
      let lastOffset = 0;

      const readAndSendChunk = () => {
        if (isClosed || conn.open === false) return;

        if (offset >= file.size) {
          // Finished sending!
          conn.send({ type: 'complete' });
          console.log('[P2P Sender] File streaming complete!');
          onStatus('completed');
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = (e) => {
          if (isClosed || conn.open === false) return;

          conn.send(e.target.result);
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

          // Flow control backpressure check
          const dataChannel = conn.dataChannel;
          if (dataChannel && dataChannel.bufferedAmount > CHUNK_SIZE * 8) {
            dataChannel.onbufferedamountlow = () => {
              dataChannel.onbufferedamountlow = null;
              readAndSendChunk();
            };
          } else {
            readAndSendChunk();
          }
        };

        reader.readAsArrayBuffer(slice);
      };

      // Start streaming
      readAndSendChunk();
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
      if (broadcastTimer) clearInterval(broadcastTimer);
      activeAnnouncements.delete(code);
      publishChannel({ type: 'close', code });
      try { peer.destroy(); } catch (e) {}
    }
  };
}

// ----------------------------------------------------
// RECEIVER ENGINE (PeerJS Direct Receive)
// ----------------------------------------------------
export function startReceiverTunnel(code, { onStatus, onProgress, onComplete, onError }) {
  const targetPeerId = `ghostdrop-${code}`;
  let isClosed = false;
  let receivedChunks = [];
  let fileInfo = null;
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

    conn.on('open', () => {
      console.log('[P2P Receiver] ⚡ WebRTC Data Channel OPEN! Receiving stream...');
      onStatus('transferring');
      startTime = Date.now();
      lastTime = startTime;
    });

    conn.on('data', (data) => {
      if (isClosed) return;

      const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Blob;

      if (!isBinary && typeof data === 'object' && data !== null) {
        if (data.type === 'header') {
          fileInfo = data;
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
        // Binary Chunk: handle ArrayBuffer or Uint8Array view
        const chunk = ArrayBuffer.isView(data)
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : data;
        const chunkSize = chunk.byteLength || chunk.size || 0;

        receivedChunks.push(chunk);
        receivedBytes += chunkSize;

        const total = fileInfo ? fileInfo.size : receivedBytes;
        const percent = Math.min(100, Math.round((receivedBytes / total) * 100));

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
