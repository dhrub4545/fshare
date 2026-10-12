// WebRTC Peer-to-Peer Tunnel Engine
// Zero server storage - direct browser-to-browser encrypted streaming

import { API_BASE } from './apiConfig';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const CHUNK_SIZE = 64 * 1024; // 64 KB optimal chunk size for WebRTC

// Helper: Post a signal to backend matchmaker
async function postSignal(code, role, signal) {
  try {
    await fetch(`${API_BASE}/api/tunnel/signal/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, signal })
    });
  } catch (err) {
    console.error('Error posting WebRTC signal:', err);
  }
}

// ==========================================
// SENDER ENGINE (Streams file directly to peer)
// ==========================================
export function startSenderTunnel(code, file, { onStatus, onProgress, onError }) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  let pollInterval = null;
  let isClosed = false;

  // Create DataChannel
  const dataChannel = pc.createDataChannel('ghostdrop-stream', { ordered: true });
  dataChannel.binaryType = 'arraybuffer';
  dataChannel.bufferedAmountLowThreshold = CHUNK_SIZE * 8; // 512 KB backpressure threshold

  // ICE Candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && !isClosed) {
      postSignal(code, 'sender', { type: 'candidate', candidate: event.candidate });
    }
  };

  let pendingCandidates = [];

  // Connection state monitoring
  pc.onconnectionstatechange = () => {
    console.log('[WebRTC Sender] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      if (onError) onError('Direct connection failed. Please retry.');
    }
  };

  // Start polling for receiver signals
  const pollForReceiverSignals = () => {
    pollInterval = setInterval(async () => {
      if (isClosed) return;
      try {
        const res = await fetch(`${API_BASE}/api/tunnel/poll/${code}?role=sender`);
        const data = await res.json();
        if (data.success && data.signals && data.signals.length > 0) {
          for (const item of data.signals) {
            if (item.type === 'answer') {
              console.log('[WebRTC Sender] Received SDP Answer from Receiver!');
              await pc.setRemoteDescription(new RTCSessionDescription(item.sdp));
              onStatus('connecting');
              // Flush buffered candidates
              for (const cand of pendingCandidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
              }
              pendingCandidates = [];
            } else if (item.type === 'candidate' && item.candidate) {
              if (pc.remoteDescription) {
                try { await pc.addIceCandidate(new RTCIceCandidate(item.candidate)); } catch (e) {}
              } else {
                pendingCandidates.push(item.candidate);
              }
            }
          }
        }
      } catch (e) {}
    }, 800);
  };

  // When tunnel opens: stream file with flow control
  dataChannel.onopen = async () => {
    console.log('[WebRTC Sender] ⚡ P2P Direct Tunnel OPEN! Streaming file...');
    if (pollInterval) clearInterval(pollInterval);
    onStatus('transferring');

    // Send metadata header first
    dataChannel.send(JSON.stringify({
      type: 'header',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    }));

    let offset = 0;
    const startTime = Date.now();
    let lastTime = startTime;
    let lastOffset = 0;

    const readAndSendChunk = () => {
      if (isClosed || dataChannel.readyState !== 'open') return;

      if (offset >= file.size) {
        // Transfer complete!
        dataChannel.send(JSON.stringify({ type: 'complete' }));
        console.log('[WebRTC Sender] File stream finished successfully!');
        onStatus('completed');
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();

      reader.onload = (e) => {
        if (isClosed || dataChannel.readyState !== 'open') return;

        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;

        // Calculate progress & transfer speed
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

        // Backpressure check
        if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
          dataChannel.onbufferedamountlow = () => {
            dataChannel.onbufferedamountlow = null;
            readAndSendChunk();
          };
        } else {
          // Continue next chunk immediately
          readAndSendChunk();
        }
      };

      reader.readAsArrayBuffer(slice);
    };

    // Kick off first chunk
    readAndSendChunk();
  };

  dataChannel.onerror = (err) => {
    console.error('[WebRTC Sender] DataChannel error:', err);
    if (onError) onError('DataChannel communication error');
  };

  dataChannel.onclose = () => {
    console.log('[WebRTC Sender] DataChannel closed');
  };

  // Generate and send initial Offer
  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await postSignal(code, 'sender', { type: 'offer', sdp: offer });
      onStatus('waiting');
      pollForReceiverSignals();
    } catch (err) {
      console.error('[WebRTC Sender] Offer error:', err);
      if (onError) onError('Failed to generate connection offer');
    }
  })();

  // Return cancel handler
  return {
    close: () => {
      isClosed = true;
      if (pollInterval) clearInterval(pollInterval);
      try { dataChannel.close(); } catch (e) {}
      try { pc.close(); } catch (e) {}
    }
  };
}

// ==========================================
// RECEIVER ENGINE (Receives stream & downloads)
// ==========================================
export function startReceiverTunnel(code, { onStatus, onProgress, onComplete, onError }) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  let pollInterval = null;
  let isClosed = false;
  let receivedChunks = [];
  let fileInfo = null;
  let receivedBytes = 0;
  let startTime = Date.now();
  let lastTime = startTime;
  let lastBytes = 0;

  // ICE Candidates
  pc.onicecandidate = (event) => {
    if (event.candidate && !isClosed) {
      postSignal(code, 'receiver', { type: 'candidate', candidate: event.candidate });
    }
  };

  // Incoming DataChannel from Sender
  pc.ondatachannel = (event) => {
    const dataChannel = event.channel;
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
      console.log('[WebRTC Receiver] ⚡ P2P Direct Tunnel OPEN! Receiving stream...');
      if (pollInterval) clearInterval(pollInterval);
      onStatus('transferring');
      startTime = Date.now();
      lastTime = startTime;
    };

    dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'header') {
            fileInfo = msg;
            console.log('[WebRTC Receiver] Receiving file metadata:', fileInfo);
          } else if (msg.type === 'complete') {
            console.log('[WebRTC Receiver] Transfer complete! Assembling file...');
            onStatus('assembling');

            // Assemble Blob and trigger browser download
            const blob = new Blob(receivedChunks, {
              type: fileInfo?.mimeType || 'application/octet-stream'
            });

            // Trigger instant browser download
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
        } catch (e) {}
      } else {
        // Binary Chunk (ArrayBuffer)
        receivedChunks.push(event.data);
        receivedBytes += event.data.byteLength;

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
    };

    dataChannel.onerror = (err) => {
      console.error('[WebRTC Receiver] DataChannel error:', err);
      if (onError) onError('Tunnel transfer interrupted');
    };
  };

  let pendingCandidates = [];

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC Receiver] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      if (onError) onError('Connection to sender failed. Please retry.');
    }
  };

  // Poll for Sender Offer and ICE Candidates
  let offerReceived = false;
  pollInterval = setInterval(async () => {
    if (isClosed) return;
    try {
      const res = await fetch(`${API_BASE}/api/tunnel/poll/${code}?role=receiver`);
      const data = await res.json();
      if (data.success && data.signals && data.signals.length > 0) {
        for (const item of data.signals) {
          if (item.type === 'offer' && !offerReceived) {
            offerReceived = true;
            console.log('[WebRTC Receiver] Received Offer from Sender! Generating Answer...');
            await pc.setRemoteDescription(new RTCSessionDescription(item.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await postSignal(code, 'receiver', { type: 'answer', sdp: answer });
            onStatus('connecting');
            // Flush buffered candidates
            for (const cand of pendingCandidates) {
              try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
            }
            pendingCandidates = [];
          } else if (item.type === 'candidate' && item.candidate) {
            if (pc.remoteDescription) {
              try { await pc.addIceCandidate(new RTCIceCandidate(item.candidate)); } catch (e) {}
            } else {
              pendingCandidates.push(item.candidate);
            }
          }
        }
      }
    } catch (e) {}
  }, 800);

  return {
    close: () => {
      isClosed = true;
      if (pollInterval) clearInterval(pollInterval);
      try { pc.close(); } catch (e) {}
      receivedChunks = [];
    }
  };
}
