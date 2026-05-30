// EXTENSION: centralized API base URL — single source of truth for backend host
export const API_BASE = 'http://localhost:8000'

export const apiUrl = (path) => `${API_BASE}${path}`
