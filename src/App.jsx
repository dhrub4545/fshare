import React, { useState, useEffect } from 'react';
import { 
  UploadCloud, DownloadCloud, Shield, Clock, Zap, CheckCircle2, AlertCircle, Sparkles 
} from 'lucide-react';
import UploadView from './components/UploadView';
import DownloadView from './components/DownloadView';
import ActiveFilesList from './components/ActiveFilesList';

export default function App() {
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'download'
  const [downloadTargetCode, setDownloadTargetCode] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toast, setToast] = useState(null);

  // Show Toast helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Listen to URL hash routing for direct share links (e.g. /#/download/581294)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/download/')) {
        const code = hash.replace('#/download/', '').trim();
        if (code) {
          setDownloadTargetCode(code);
          setActiveTab('download');
        }
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleUploadSuccess = (file) => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSelectActiveFile = (code) => {
    setDownloadTargetCode(code);
    setActiveTab('download');
    window.location.hash = `#/download/${code}`;
    window.scrollTo({ top: 220, behavior: 'smooth' });
  };

  return (
    <div className="app-container">
      {/* Navigation Header */}
      <header className="app-header">
        <div className="header-content">
          <div 
            className="logo-area" 
            onClick={() => {
              setActiveTab('upload');
              window.location.hash = '';
            }}
          >
            <div className="logo-icon">
              <Zap size={22} fill="white" />
            </div>
            <div className="logo-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h1>GhostDrop</h1>
                <span className="logo-badge">
                  <Zap size={11} /> P2P Direct Tunnel
                </span>
              </div>
            </div>
          </div>

          <div className="status-indicator">
            <span className="status-dot"></span>
            <span>0 MB Server Storage • P2P Active</span>
          </div>
        </div>
      </header>

      {/* Main Wrapper */}
      <main className="main-wrapper">
        {/* Hero Section */}
        <div className="hero-banner">
          <div className="hero-pill">
            <Sparkles size={14} color="#818cf8" />
            <span>Direct Browser-to-Browser Encrypted Tunnel</span>
          </div>
          <h2 className="hero-title">
            Transfer Any File with <span className="gradient-text">Zero Storage</span>
          </h2>
          <p className="hero-subtitle">
            Files stream directly between devices via <strong>WebRTC</strong>. No file size limits, 100% end-to-end encrypted, and zero server storage.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="tabs-container">
          <div className="tabs-wrapper">
            <button 
              className={`tab-button ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('upload');
                window.location.hash = '';
              }}
            >
              <UploadCloud size={18} />
              <span>Send File (Open Tunnel)</span>
            </button>
            <button 
              className={`tab-button ${activeTab === 'download' ? 'active' : ''}`}
              onClick={() => setActiveTab('download')}
            >
              <DownloadCloud size={18} />
              <span>Receive File (Connect)</span>
            </button>
          </div>
        </div>

        {/* Dynamic View Component */}
        {activeTab === 'upload' ? (
          <UploadView 
            onUploadSuccess={handleUploadSuccess} 
            showToast={showToast} 
          />
        ) : (
          <DownloadView 
            initialCode={downloadTargetCode} 
            showToast={showToast} 
          />
        )}

        {/* Active Tunnels Section */}
        <ActiveFilesList 
          refreshTrigger={refreshTrigger}
          onSelectFileForDownload={handleSelectActiveFile}
          showToast={showToast}
        />
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-features">
          <div className="footer-feature-item">
            <Zap size={15} color="#38bdf8" />
            <span>Unlimited File Size</span>
          </div>
          <div className="footer-feature-item">
            <Shield size={15} color="#10b981" />
            <span>0 MB Server Storage (E2EE)</span>
          </div>
          <div className="footer-feature-item">
            <Clock size={15} color="#f59e0b" />
            <span>Auto-Timeout After 2 Hours</span>
          </div>
        </div>
        <p>© {new Date().getFullYear()} GhostDrop • Direct Peer-to-Peer Streaming Tunnel</p>
      </footer>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="toast-msg">
          {toast.type === 'error' ? (
            <AlertCircle size={18} color="#ef4444" />
          ) : (
            <CheckCircle2 size={18} color="#10b981" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
