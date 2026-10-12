import React, { useState, useRef, useEffect } from 'react';
import { 
  UploadCloud, File, CheckCircle2, Copy, Check, 
  QrCode, RefreshCw, Shield, Clock, Zap, AlertCircle, Radio, XCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { formatBytes } from '../utils';
import CountdownTimer from './CountdownTimer';
import { startSenderTunnel } from '../webrtc';
import { API_BASE } from '../apiConfig';

export default function UploadView({ onUploadSuccess, showToast }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [tunnelData, setTunnelData] = useState(null);
  const [tunnelStatus, setTunnelStatus] = useState('idle'); // 'idle' | 'waiting' | 'connecting' | 'transferring' | 'completed'
  const [transferStats, setTransferStats] = useState({ percent: 0, bytesSent: 0, totalBytes: 0, speedMBps: 0 });
  const [showQr, setShowQr] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const fileInputRef = useRef(null);
  const senderSessionRef = useRef(null);

  // Clean up WebRTC session on unmount
  useEffect(() => {
    return () => {
      if (senderSessionRef.current) {
        senderSessionRef.current.close();
      }
    };
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file) => {
    setSelectedFile(file);
    setTunnelData(null);
    setTunnelStatus('idle');
    setTransferStats({ percent: 0, bytesSent: 0, totalBytes: 0, speedMBps: 0 });
  };

  const createTunnel = async () => {
    if (!selectedFile) return;

    try {
      // Step 1: Create signaling room on server
      const res = await fetch(`${API_BASE}/api/tunnel/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: selectedFile.name,
          size: selectedFile.size,
          mimeType: selectedFile.type
        })
      });

      const data = await res.json();
      if (!data.success) {
        showToast(data.message || 'Failed to create tunnel', 'error');
        return;
      }

      setTunnelData(data);
      setTunnelStatus('waiting');
      showToast('P2P Tunnel created! Share the 6-digit code.');

      // Step 2: Initialize WebRTC P2P Sender
      senderSessionRef.current = startSenderTunnel(data.code, selectedFile, {
        onStatus: (status) => {
          setTunnelStatus(status);
          if (status === 'completed') {
            confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
            showToast('Transfer complete! File streamed directly to receiver.');
          }
        },
        onProgress: (stats) => {
          setTransferStats(stats);
        },
        onError: (err) => {
          showToast(err, 'error');
        }
      });

      if (onUploadSuccess) {
        onUploadSuccess(data);
      }
    } catch (err) {
      showToast('Error establishing tunnel. Check network.', 'error');
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'code') {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      showToast('6-digit access code copied!');
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      showToast('Direct download link copied!');
    }
  };

  const cancelTunnel = () => {
    if (senderSessionRef.current) {
      senderSessionRef.current.close();
      senderSessionRef.current = null;
    }
    if (tunnelData?.code) {
      fetch(`${API_BASE}/api/tunnel/${tunnelData.code}`, { method: 'DELETE' }).catch(() => {});
    }
    setTunnelData(null);
    setTunnelStatus('idle');
    setSelectedFile(null);
    setShowQr(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    showToast('Tunnel closed.');
  };

  return (
    <div className="glass-panel">
      {!tunnelData ? (
        <>
          {/* Dropzone */}
          <div 
            className={`dropzone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              style={{ display: 'none' }} 
              onChange={handleFileInput}
            />

            <div className="upload-icon-circle">
              <Zap size={36} color="#818cf8" />
            </div>

            <h3 className="dropzone-title">
              {dragActive ? 'Drop your file to open tunnel' : 'Drag & drop file for Direct P2P Stream'}
            </h3>
            <p className="dropzone-desc">
              or <span className="browse-pill">browse from device</span>
            </p>

            <div className="upload-meta-info">
              <span className="meta-item">
                <Zap size={15} color="#38bdf8" /> Unlimited File Size (P2P Stream)
              </span>
              <span className="meta-item">
                <Shield size={15} color="#10b981" /> 0 MB Server Storage (E2EE)
              </span>
              <span className="meta-item">
                <Clock size={15} color="#f59e0b" /> Real-Time Direct Tunnel
              </span>
            </div>
          </div>

          {/* Selected File Card */}
          {selectedFile && (
            <div className="selected-file-card">
              <div className="file-left">
                <div className="file-icon-box">
                  <File size={26} />
                </div>
                <div className="file-details">
                  <div className="file-name-text" title={selectedFile.name}>
                    {selectedFile.name}
                  </div>
                  <div className="file-sub-info">
                    <span>{formatBytes(selectedFile.size)}</span>
                    <span>•</span>
                    <span style={{ color: '#38bdf8' }}>Ready for Direct P2P Stream</span>
                  </div>
                </div>
              </div>

              <button 
                className="btn btn-primary"
                onClick={createTunnel}
              >
                <Zap size={16} /> Open Direct Tunnel
              </button>
            </div>
          )}
        </>
      ) : (
        /* ACTIVE TUNNEL SENDER VIEW */
        <div className="upload-success-container">
          <div className="success-banner">
            <div 
              className="success-icon-badge"
              style={{
                background: tunnelStatus === 'completed' 
                  ? 'rgba(16, 185, 129, 0.15)' 
                  : 'rgba(99, 102, 241, 0.15)',
                color: tunnelStatus === 'completed' ? '#10b981' : '#818cf8'
              }}
            >
              {tunnelStatus === 'completed' ? (
                <CheckCircle2 size={36} />
              ) : (
                <Radio size={36} className={tunnelStatus === 'transferring' ? 'animate-pulse' : ''} />
              )}
            </div>

            <h3 className="success-title">
              {tunnelStatus === 'waiting' && 'Direct Tunnel Ready — Waiting for Peer'}
              {tunnelStatus === 'connecting' && 'Connecting to Receiver...'}
              {tunnelStatus === 'transferring' && 'Streaming Directly to Receiver!'}
              {tunnelStatus === 'completed' && 'Direct P2P Stream Completed!'}
            </h3>

            <p className="success-desc">
              {tunnelStatus !== 'completed' ? (
                <span style={{ color: '#fbbf24' }}>
                  ⚠️ Keep this browser tab open while the receiver streams the file.
                </span>
              ) : (
                'The file was successfully received without ever being stored on any server.'
              )}
            </p>
          </div>

          {/* Live Open Channel Banner */}
          <div className="open-channel-broadcast-alert">
            <Radio size={24} color="#34d399" className="animate-pulse" style={{ flexShrink: 0 }} />
            <div>
              <strong>📡 Open Channel Broadcasted Live:</strong>
              <div>The receiver can simply go to the <strong>Receive File</strong> tab and click <strong>"⚡ Click to Connect & Stream"</strong> — no codes or QR scanning needed!</div>
            </div>
          </div>

          {/* 6-Digit Download Code (Optional fallback) */}
          <div className="code-box-wrapper">
            <div className="code-title">Optional: Direct Channel Code</div>
            <div className="code-digits">{tunnelData.code}</div>
            
            <div className="code-actions">
              <button 
                className="btn btn-secondary"
                onClick={() => copyToClipboard(tunnelData.code, 'code')}
              >
                {copiedCode ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                {copiedCode ? 'Code Copied!' : 'Copy Code'}
              </button>

              <CountdownTimer 
                expiresAt={tunnelData.expiresAt} 
                onExpire={cancelTunnel} 
              />
            </div>
          </div>

          {/* Real-time Streaming Progress Bar */}
          {tunnelStatus === 'transferring' && (
            <div className="progress-container" style={{ margin: '1.5rem 0' }}>
              <div className="progress-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                  <Zap size={14} /> Direct P2P Stream: {transferStats.speedMBps} MB/s
                </span>
                <span>{transferStats.percent}%</span>
              </div>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${transferStats.percent}%` }}
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'right' }}>
                {formatBytes(transferStats.bytesSent)} of {formatBytes(selectedFile?.size || 0)} sent
              </div>
            </div>
          )}

          {/* Shareable Direct Link */}
          <div style={{ margin: '1.25rem 0' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Direct Shareable Link:
            </label>
            <div className="share-link-input-group">
              <input 
                type="text" 
                readOnly 
                value={`${window.location.origin}/#/download/${tunnelData.code}`} 
              />
              <button 
                className="btn btn-primary"
                style={{ padding: '0.5rem 1rem' }}
                onClick={() => copyToClipboard(`${window.location.origin}/#/download/${tunnelData.code}`, 'link')}
              >
                {copiedLink ? <Check size={16} /> : <Copy size={16} />}
                {copiedLink ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* QR Code toggle */}
          {tunnelData.qrCode && (
            <div style={{ textAlign: 'center', margin: '1.25rem 0' }}>
              <button 
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem' }}
                onClick={() => setShowQr(!showQr)}
              >
                <QrCode size={16} /> {showQr ? 'Hide Mobile QR Code' : 'Show Mobile QR Code'}
              </button>

              {showQr && (
                <div className="qr-container">
                  <img src={tunnelData.qrCode} alt="Download QR Code" className="qr-image" />
                  <p className="qr-caption">Scan with receiver's phone to connect immediately</p>
                </div>
              )}
            </div>
          )}

          {/* File details & Cancel button */}
          <div className="selected-file-card" style={{ marginTop: '1rem' }}>
            <div className="file-left">
              <div className="file-icon-box">
                <File size={24} />
              </div>
              <div className="file-details">
                <div className="file-name-text">{selectedFile?.name}</div>
                <div className="file-sub-info">
                  <span>{formatBytes(selectedFile?.size || 0)}</span>
                  <span>•</span>
                  <span>0 MB Server Storage</span>
                </div>
              </div>
            </div>

            <button 
              className="btn btn-danger"
              style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
              onClick={cancelTunnel}
            >
              <XCircle size={15} /> Close Tunnel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
