// API Configuration
// Automatically connects to your live deployed backend on Vercel
export const API_BASE = import.meta.env.VITE_API_BASE_URL 
  ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') 
  : (typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
      ? 'https://p2p-file-transfer-two.vercel.app'
      : '');
