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

  // Default to live Vercel backend for both local and production
  return 'https://p2p-file-transfer-two.vercel.app';
}

export const API_BASE = normalizeApiBase();
