// Single source of truth for the app version, injected at build time by
// vite.config.js as `__APP_VERSION__` (read from package.json). Bump the
// version field there to update everywhere (About modal, sidebar footer,
// any future debug overlay).
//
// Wrap in a function so consumers can do `useAppVersion()` consistently,
// even if we later switch to a reactive source (e.g. live build info).
/* global __APP_VERSION__ */
export function useAppVersion() {
  return __APP_VERSION__
}
