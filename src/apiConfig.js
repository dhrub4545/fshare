// API Configuration
// Automatically connects to your live deployed backend on Vercel
function normalizeApiBase() {
  let url = (import.meta.env.VITE_API_BASE_URL || '').trim();

  if (url) {
    // If protocol was omitted, auto-prepend https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url.replace(/\/$/, '');
  }

  // Fallback for production deployment if env var is empty
  if (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')) {
    return 'https://p2p-file-transfer-two.vercel.app';
  }

  return '';
}

export const API_BASE = normalizeApiBase();
