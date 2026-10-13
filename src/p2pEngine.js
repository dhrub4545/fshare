// Pure Serverless WebRTC P2P Engine using PeerJS & Dual Relay Discovery
// Zero Server Storage • Zero Backend Server • Direct Browser-to-Browser Streaming

import Peer from 'peerjs';
import { joinRoom } from 'trystero';

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
const LOBBY_ROOM_ID = 'ghostdrop-discovery-v2';

// In-memory registry of active channels
const activeAnnouncements = new Map();

// Local cross-tab broadcast channel
let bc = null;
try {
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel('ghostdrop-local-lobby');
    bc.onmessage = (e) => {
      const msg = e.data;
      if (msg && msg.type === 'broadcast' && msg.data) {
        activeAnnouncements.set(msg.data.code, {
          ...msg.data,
          lastSeen: Date.now()
        });
      } else if (msg && msg.type === 'request') {
        for (const [, data] of activeAnnouncements.entries()) {
          if (data && data.isLocal) {
            bc.postMessage({ type: 'broadcast', data });
          }
        }
      }
    };
  }
} catch (err) {
  console.warn('[Discovery] BroadcastChannel not supported:', err);
}

// Global Trystero Relay Lobby for cross-device discovery
let lobbyRoom = null;
let broadcastSend = null;
let requestSend = null;

function getLobby() {
  if (!lobbyRoom && typeof window !== 'undefined') {
    try {
      lobbyRoom = joinRoom({ appId: 'ghostdrop-file-sharing' }, LOBBY_ROOM_ID);

      const broadcastAction = lobbyRoom.makeAction('broadcast');
      const requestAction = lobbyRoom.makeAction('request');

      broadcastSend = (data, targetPeer) => {
        try {
          if (broadcastAction && typeof broadcastAction.send === 'function') {
            broadcastAction.send(data, targetPeer);
          }
        } catch (e) {}
      };

      requestSend = (data, targetPeer) => {
        try {
          if (requestAction && typeof requestAction.send === 'function') {
            requestAction.send(data, targetPeer);
          }
        } catch (e) {}
      };

      // In Trystero, onReceive is a setter
      broadcastAction.onReceive = (channelData) => {
        if (channelData && channelData.code) {
          activeAnnouncements.set(channelData.code, {
            ...channelData,
            lastSeen: Date.now()
          });
        }
      };

      requestAction.onReceive = () => {
        for (const [, data] of activeAnnouncements.entries()) {
          if (data && data.isLocal) {
            broadcastSend(data);
          }
        }
      };

      // When another peer joins the lobby, push local active channels immediately
      lobbyRoom.onPeerJoin((peerId) => {
        for (const [, data] of activeAnnouncements.entries()) {
          if (data && data.isLocal) {
            broadcastSend(data, peerId);
          }
        }
      });
    } catch (err) {
      console.warn('[Discovery Lobby] Error initializing relay lobby:', err);
    }
  }
  return { lobbyRoom, broadcastSend, requestSend };
}

export function requestChannelScan() {
  const { requestSend: sendReq } = getLobby();
  if (sendReq) sendReq('ping');
  if (bc) bc.postMessage({ type: 'request' });
}

// ----------------------------------------------------
// DISCOVERY HOOK FOR RECEIVER (Listens for Open Channels)
// ----------------------------------------------------
export function subscribeToOpenChannels(onUpdate) {
  requestChannelScan();

  // Periodic scan & clean up expired channels
  const interval = setInterval(() => {
    requestChannelScan();

    const now = Date.now();
    const list = [];
    for (const [code, data] of activeAnnouncements.entries()) {
      if (now - data.lastSeen < 20000 && now < data.expiresAt) {
        list.push({
          id: data.code,
          code: data.code,
          originalName: data.name,
          size: data.size,
          mimeType: data.type,
          expiresAt: data.expiresAt
        });
      } else if (now - data.lastSeen >= 20000) {
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

  getLobby();

  const channelData = {
    code,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    expiresAt: Date.now() + 2 * 3600 * 1000,
    isLocal: true,
    lastSeen: Date.now()
  };
  activeAnnouncements.set(code, channelData);

  const announce = () => {
    if (isClosed) return;
    if (broadcastSend) broadcastSend(channelData);
    if (bc) bc.postMessage({ type: 'broadcast', data: channelData });
  };
  announce();
  broadcastTimer = setInterval(announce, 2500);

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
        // Binary Chunk (ArrayBuffer or Uint8Array view)
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
