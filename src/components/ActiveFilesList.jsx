import React, { useState, useEffect } from 'react';
import { 
  FolderClock, Copy, Trash2, Check, File, ExternalLink, RefreshCw, Zap 
} from 'lucide-react';
import { formatBytes } from '../utils';
import CountdownTimer from './CountdownTimer';
import { API_BASE } from '../apiConfig';

export default function ActiveFilesList({ refreshTrigger, onSelectFileForDownload, showToast }) {
  const [tunnels, setTunnels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const fetchActiveTunnels = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tunnel/active`);
      const data = await res.json();
      if (data.success && Array.isArray(data.files)) {
        setTunnels(data.files);
      }
    } catch (err) {
      console.warn('Could not fetch active tunnels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveTunnels();
    const interval = setInterval(fetchActiveTunnels, 10000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  const copyCode = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast(`Code ${code} copied!`);
  };

  const closeTunnel = async (code) => {
    try {
      const res = await fetch(`${API_BASE}/api/tunnel/${code}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Tunnel closed.');
        fetchActiveTunnels();
      }
    } catch (err) {
      showToast('Error closing tunnel', 'error');
    }
  };

  if (tunnels.length === 0 && !loading) {
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
          onClick={fetchActiveTunnels}
          title="Refresh active tunnels"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
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
                  onExpire={fetchActiveTunnels} 
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

              <button 
                className="btn btn-danger"
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => closeTunnel(t.code)}
                title="Close Tunnel"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
