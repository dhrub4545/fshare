// Pure Serverless WebRTC P2P Engine using PeerJS & Public Relay Discovery
// Zero Server Storage • Zero Backend Server • Direct Browser-to-Browser Streaming

import Peer from 'peerjs';
import { joinRoom } from 'trystero';

const PeerConstructor = Peer.Peer || Peer;

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const CHUNK_SIZE = 64 * 1024; // 64 KB chunk size
const LOBBY_ROOM_ID = 'ghostdrop-discovery-v1';

// Global Trystero Discovery Lobby for 1-Click Open Channel Detection
let lobbyRoom = null;
let broadcastAction = null;
let requestAction = null;
const activeAnnouncements = new Map(); // Senders currently broadcasting

function getLobby() {
  if (!lobbyRoom) {
    try {
      lobbyRoom = joinRoom({ appId: 'ghostdrop-file-sharing' }, LOBBY_ROOM_ID);
      const [sendBroadcast, onBroadcast] = lobbyRoom.makeAction('broadcast');
      const [sendRequest, onRequest] = lobbyRoom.makeAction('request');

      broadcastAction = sendBroadcast;
      requestAction = sendRequest;

      // When another sender announces their channel
      onBroadcast((channelData) => {
        if (channelData && channelData.code) {
          activeAnnouncements.set(channelData.code, {
            ...channelData,
            lastSeen: Date.now()
          });
        }
      });

      // When a new receiver joins and requests currently open channels
      onRequest(() => {
        // Reply with all local active broadcasts
        for (const [code, data] of activeAnnouncements.entries()) {
          if (data && data.isLocal) {
            sendBroadcast(data);
          }
        }
      });
    } catch (err) {
      console.warn('[Discovery Lobby] Error initializing relay lobby:', err);
    }
  }
  return { lobbyRoom, broadcastAction, requestAction };
}

export function requestChannelScan() {
  const { requestAction } = getLobby();
  if (requestAction) {
    requestAction('ping');
  }
}

// ----------------------------------------------------
// DISCOVERY HOOK FOR RECEIVER (Listens for Open Channels)
// ----------------------------------------------------
export function subscribeToOpenChannels(onUpdate) {
  const { requestAction } = getLobby();

  // Ask any active senders to announce
  if (requestAction) {
    requestAction('ping');
  }

  // Periodic cleanup and update callback
  const interval = setInterval(() => {
    const now = Date.now();
    const list = [];
    for (const [code, data] of activeAnnouncements.entries()) {
      if (now - data.lastSeen < 15000 && now < data.expiresAt) {
        list.push({
          id: data.code,
          code: data.code,
          originalName: data.name,
          size: data.size,
          mimeType: data.type,
          expiresAt: data.expiresAt
        });
      } else if (now - data.lastSeen >= 15000) {
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

  // Announce channel in discovery lobby so receivers can click it with 1 click
  const { broadcastAction } = getLobby();
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

  const sendAnnounce = () => {
    if (isClosed || !broadcastAction) return;
    broadcastAction(channelData);
  };
  sendAnnounce();
  broadcastTimer = setInterval(sendAnnounce, 3000);

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

      if (data && typeof data === 'object' && !(data instanceof ArrayBuffer)) {
        if (data.type === 'header') {
          fileInfo = data;
          console.log('[P2P Receiver] Receiving file metadata:', fileInfo);
        } else if (data.type === 'complete') {
          console.log('[P2P Receiver] Transfer complete! Assembling file...');
          onStatus('assembling');

          // Assemble Blob
          const blob = new Blob(receivedChunks, {
            type: fileInfo?.mimeType || 'application/octet-stream'
          });

          // Trigger browser download directly
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = fileInfo?.name || 'downloaded_file';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);

          onComplete({
            blob,
            name: fileInfo?.name || 'file',
            size: fileInfo?.size || blob.size
          });
          onStatus('completed');
        }
      } else {
        // Binary Chunk (ArrayBuffer)
        receivedChunks.push(data);
        receivedBytes += data.byteLength;

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
