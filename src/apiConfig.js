// API Configuration
// Supports optional VITE_API_BASE_URL when frontend and backend are deployed to separate domains
export const API_BASE = import.meta.env.VITE_API_BASE_URL 
  ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '') 
  : '';
