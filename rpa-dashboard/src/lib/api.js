/**
 * Backwards-compatible re-export.
 *
 * The canonical client lives in `src/api/client.js`; new code should import
 * from there. This shim keeps existing imports working.
 */
export * from '../api/client'
import api from '../api/client'

export default api
