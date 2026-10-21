export function logAuthDiagnostic(source: string, event: string, details: Record<string, unknown> = {}) {
  if (import.meta.env.DEV) console.info(`[auth-debug:${source}] ${event}`, details);
}

export function nextAuthDiagnosticMountCount(key: string) {
  if (!import.meta.env.DEV) return null;
  try {
    const nextCount = Number(window.sessionStorage.getItem(key) ?? '0') + 1;
    window.sessionStorage.setItem(key, String(nextCount));
    return nextCount;
  } catch {
    return null;
  }
}

export function errorDiagnosticCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const code = 'code' in error ? error.code : null;
  return typeof code === 'string' ? code : null;
}
