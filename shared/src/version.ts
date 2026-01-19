// @ts-ignore - Vite environment variables
const GIT_COMMIT_HASH = import.meta.env?.VITE_GIT_COMMIT_HASH || '';
// @ts-ignore - Vite environment variables  
const BUILD_NUMBER = import.meta.env?.VITE_BUILD_NUMBER || '0';

export const APP_VERSION = GIT_COMMIT_HASH
  ? `${new Date().toISOString().split('T')[0].replace(/-/g, '.')}+${BUILD_NUMBER}-${GIT_COMMIT_HASH.substring(0, 7)}`
  : '2026.1.19+6-aafe55e';