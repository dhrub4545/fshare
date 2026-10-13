import React, { useState, useEffect } from 'react';
import { 
  FolderClock, Copy, Trash2, Check, File, ExternalLink, RefreshCw, Zap 
} from 'lucide-react';
import { formatBytes } from '../utils';
import CountdownTimer from './CountdownTimer';
import { subscribeToOpenChannels, requestChannelScan } from '../p2pEngine';

export default function ActiveFilesList({ refreshTrigger, onSelectFileForDownload, showToast }) {
  const [tunnels, setTunnels] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToOpenChannels((list) => {
      setTunnels(list);
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [refreshTrigger]);

  const copyCode = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast(`Code ${code} copied!`);
  };

  if (tunnels.length === 0) {
    return null;
  }

  return (
    <div className="active-section">
      <div className="active-section-header">
        <h3 className="active-section-title">
          <Zap size={20} color="#818cf8" />
          Active P2P Tunnels Open Now ({tunnels.length})
        </h3>
        <button 
          className="btn btn-secondary" 
          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
          onClick={requestChannelScan}
          title="Scan active channels"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="active-files-grid">
        {tunnels.map((t) => (
          <div key={t.id} className="active-file-card">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <span className="badge badge-blue">
                  CODE: {t.code}
                </span>
                <CountdownTimer 
                  expiresAt={t.expiresAt} 
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <div style={{ color: '#818cf8' }}>
                  <File size={22} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div 
                    style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={t.originalName}
                  >
                    {t.originalName}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {formatBytes(t.size)} • P2P Tunnel Ready
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <button 
                className="btn btn-secondary"
                style={{ flex: 1, padding: '0.45rem', fontSize: '0.8rem' }}
                onClick={() => copyCode(t.code, t.id)}
                title="Copy 6-digit Code"
              >
                {copiedId === t.id ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copiedId === t.id ? 'Copied' : 'Code'}
              </button>

              <button 
                className="btn btn-primary"
                style={{ flex: 1, padding: '0.45rem', fontSize: '0.8rem' }}
                onClick={() => onSelectFileForDownload(t.code)}
                title="Connect to Tunnel"
              >
                <Zap size={14} /> Connect
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
