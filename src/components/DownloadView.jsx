import React, { useState, useEffect, useRef } from 'react';
import { 
  DownloadCloud, Search, File, Clock, AlertTriangle, 
  CheckCircle2, ArrowDownCircle, ShieldCheck, HardDrive, Zap, Radio, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { formatBytes } from '../utils';
import CountdownTimer from './CountdownTimer';
import { startReceiverTunnel, subscribeToOpenChannels, requestChannelScan } from '../p2pEngine';

export default function DownloadView({ initialCode, showToast }) {
  const [openChannels, setOpenChannels] = useState([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [receivingStatus, setReceivingStatus] = useState('idle'); // 'idle' | 'connecting' | 'transferring' | 'assembling' | 'completed'
  const [downloadStats, setDownloadStats] = useState({ percent: 0, bytesReceived: 0, totalBytes: 0, speedMBps: 0 });
  const [showManualInput, setShowManualInput] = useState(Boolean(initialCode));
  const [manualCode, setManualCode] = useState(initialCode || '');
  const [completedFile, setCompletedFile] = useState(null);
  const receiverSessionRef = useRef(null);

  // Subscribe to live open broadcast channels via P2P relay lobby
  useEffect(() => {
    const unsubscribe = subscribeToOpenChannels((channels) => {
      setOpenChannels(channels);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Clean up WebRTC session on unmount
  useEffect(() => {
    return () => {
      if (receiverSessionRef.current) {
        receiverSessionRef.current.close();
      }
    };
  }, []);

  // Auto-connect if initialCode passed from URL hash
  useEffect(() => {
    if (initialCode) {
      connectToChannel(initialCode, { name: 'Shared File', size: 0 });
    }
  }, [initialCode]);

  // Connect to an Open Channel with 1 click (NO CODE / NO QR REQUIRED)
  const connectToChannel = (code, fileInfo) => {
    setSelectedChannel({ code, file: fileInfo });
    setReceivingStatus('connecting');
    setCompletedFile(null);
    showToast(`Connecting to channel: ${fileInfo.name || code}...`);

    receiverSessionRef.current = startReceiverTunnel(code, {
      onStatus: (status) => {
        setReceivingStatus(status);
        if (status === 'completed') {
          confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
          showToast('File transfer complete! Ready to save.');
        }
      },
      onProgress: (stats) => {
        setDownloadStats(stats);
      },
      onComplete: (fileData) => {
        console.log('[P2P Receiver] Completed transfer:', fileData);
        setCompletedFile(fileData);
      },
      onError: (err) => {
        setReceivingStatus('idle');
        showToast(err || 'Transfer interrupted. Is the sender tab still open?', 'error');
      }
    });
  };

  const handleManualConnect = () => {
    let cleanCode = manualCode.trim();
    if (cleanCode.includes('/download/')) {
      cleanCode = cleanCode.split('/download/').pop().split('?')[0].split('/')[0];
    }
    if (!cleanCode) {
      showToast('Please enter a channel code', 'error');
      return;
    }

    // Direct WebRTC connection to peer
    connectToChannel(cleanCode, { name: 'Shared File', size: 0 });
  };

  const disconnectSession = () => {
    if (receiverSessionRef.current) {
      receiverSessionRef.current.close();
      receiverSessionRef.current = null;
    }
    setSelectedChannel(null);
    setCompletedFile(null);
    setReceivingStatus('idle');
    setDownloadStats({ percent: 0, bytesReceived: 0, totalBytes: 0, speedMBps: 0 });
  };

  return (
    <div className="glass-panel">
      {/* ACTIVE TRANSFER PROGRESS VIEW */}
      {selectedChannel && receivingStatus !== 'idle' ? (
        <div className="file-card-preview" style={{ marginTop: 0 }}>
          <div className="file-preview-header">
            <div>
              <span className="badge badge-green" style={{ marginBottom: '0.75rem', display: 'inline-block' }}>
                <Zap size={12} style={{ display: 'inline', marginRight: '4px' }} /> Direct P2P Tunnel Active
              </span>
              <h2 className="file-title-large">{selectedChannel.file?.name || 'Incoming File'}</h2>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Streaming Directly from Sender
                </span>
                <span style={{ color: 'var(--text-dim)' }}>•</span>
                <span style={{ color: '#a5b4fc', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                  Channel: {selectedChannel.code}
                </span>
              </div>
            </div>

            <button 
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              onClick={disconnectSession}
            >
              Disconnect
            </button>
          </div>

          {/* Stats Grid */}
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-label">File Size</div>
              <div className="stat-value">
                <HardDrive size={16} color="#818cf8" /> {formatBytes(selectedChannel.file?.size || downloadStats.totalBytes)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Transfer Speed</div>
              <div className="stat-value" style={{ color: '#38bdf8' }}>
                <Zap size={16} /> {downloadStats.speedMBps} MB/s
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Connection</div>
              <div className="stat-value" style={{ color: '#34d399' }}>
                <Radio size={16} /> Encrypted P2P
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Server Storage</div>
              <div className="stat-value" style={{ color: '#10b981' }}>
                <ShieldCheck size={16} /> 0 MB Stored
              </div>
            </div>
          </div>

          {/* Transfer Progress Bar */}
          {(receivingStatus === 'transferring' || receivingStatus === 'assembling') && (
            <div className="progress-container" style={{ marginBottom: '1.5rem' }}>
              <div className="progress-header">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                  <Zap size={14} /> 
                  {receivingStatus === 'assembling' ? 'Assembling file...' : `Direct Stream: ${downloadStats.speedMBps} MB/s`}
                </span>
                <span>{downloadStats.percent}%</span>
              </div>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${downloadStats.percent}%` }}
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'right' }}>
                {formatBytes(downloadStats.bytesReceived)} of {formatBytes(selectedChannel.file?.size || downloadStats.totalBytes)} received
              </div>
            </div>
          )}

          {/* Status Display */}
          {receivingStatus === 'connecting' && (
            <button className="btn btn-primary btn-large" disabled>
              <Radio size={22} className="animate-spin" /> Establishing P2P WebRTC Connection...
            </button>
          )}

          {receivingStatus === 'transferring' && (
            <button className="btn btn-secondary btn-large" disabled>
              <DownloadCloud size={22} className="animate-bounce" /> Receiving Direct Stream ({downloadStats.percent}%)...
            </button>
          )}

          {receivingStatus === 'assembling' && (
            <button className="btn btn-secondary btn-large" disabled>
              <HardDrive size={22} className="animate-pulse" /> Saving File to Downloads...
            </button>
          )}

          {receivingStatus === 'completed' && (
            <div style={{ textAlign: 'center', padding: '1.75rem 1.25rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '16px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <CheckCircle2 size={42} color="#10b981" style={{ margin: '0 auto 0.75rem' }} />
              <div style={{ fontWeight: 700, fontSize: '1.25rem', color: '#10b981' }}>File Ready for Download!</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem', marginBottom: '1.25rem' }}>
                Transferred {formatBytes(completedFile?.size || downloadStats.totalBytes)} directly with zero server storage.
              </p>

              {completedFile?.url && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px', margin: '0 auto 1.25rem' }}>
                  <a 
                    href={completedFile.url} 
                    download={completedFile.name}
                    className="btn btn-primary"
                    style={{ padding: '0.9rem 1.5rem', fontSize: '1rem', width: '100%', textDecoration: 'none' }}
                  >
                    <ArrowDownCircle size={20} /> Tap to Save / Download File
                  </a>

                  {typeof navigator !== 'undefined' && navigator.canShare && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        try {
                          const fileObj = new File([completedFile.blob], completedFile.name, { type: completedFile.mimeType });
                          if (navigator.canShare({ files: [fileObj] })) {
                            navigator.share({ files: [fileObj], title: completedFile.name });
                          }
                        } catch (e) {
                          console.warn('Share error:', e);
                        }
                      }}
                      style={{ fontSize: '0.85rem', padding: '0.65rem 1rem' }}
                    >
                      📲 Save to Device / Share
                    </button>
                  )}
                </div>
              )}

              <button 
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
                onClick={disconnectSession}
              >
                Connect to Another Channel
              </button>
            </div>
          )}
        </div>
      ) : (
        /* OPEN CHANNELS DISCOVERY VIEW (NO CODES / NO QR REQUIRED) */
        <div className="open-channels-section">
          <div className="radar-header">
            <div className="radar-title">
              <span className="radar-pulse-dot"></span>
              <span>Available Open Channels ({openChannels.length})</span>
            </div>
            <button 
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              onClick={requestChannelScan}
              title="Scan for open channels"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {openChannels.length > 0 ? (
            <div className="channels-list">
              {openChannels.map((channel) => (
                <div key={channel.id} className="channel-card">
                  <div className="channel-left">
                    <div className="channel-icon">
                      <File size={26} />
                    </div>
                    <div className="channel-info">
                      <div className="channel-file-name" title={channel.originalName}>
                        {channel.originalName}
                      </div>
                      <div className="channel-meta-row">
                        <span>{formatBytes(channel.size)}</span>
                        <span>•</span>
                        <span style={{ color: '#38bdf8' }}>🟢 Sender Ready</span>
                        <span>•</span>
                        <CountdownTimer expiresAt={channel.expiresAt} />
                      </div>
                    </div>
                  </div>

                  {/* 1-CLICK CONNECT BUTTON */}
                  <button 
                    className="channel-btn-connect"
                    onClick={() => connectToChannel(channel.code, { name: channel.originalName, size: channel.size, type: channel.mimeType })}
                  >
                    <Zap size={18} />
                    <span>Click to Connect & Stream</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* NO OPEN CHANNELS DETECTED */
            <div className="no-channels-box">
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem', color: '#818cf8' }}>
                <Radio size={32} className="animate-pulse" />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Scanning for Open Channels...
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto' }}>
                When someone opens a tunnel on the <strong>Send File</strong> tab, their channel will appear here instantly. Just click it to connect!
              </p>
            </div>
          )}

          {/* Optional manual connect toggle */}
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button 
              className="manual-toggle-btn"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              {showManualInput ? 'Hide manual channel code input' : 'Or connect via specific channel code'}
            </button>

            {showManualInput && (
              <div className="download-search-box" style={{ marginTop: '1rem', maxWidth: '480px', margin: '1rem auto 0' }}>
                <div className="download-input-wrapper">
                  <Search size={18} className="download-input-icon" />
                  <input 
                    type="text"
                    className="download-input"
                    placeholder="Enter channel code..."
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualConnect()}
                  />
                </div>
                <button 
                  className="btn btn-primary"
                  onClick={handleManualConnect}
                  disabled={loadingChannels || !manualCode.trim()}
                >
                  Connect
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
