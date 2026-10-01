export function safeReturnPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const url = new URL(value, 'https://session.local');
    if (url.origin !== 'https://session.local' || url.pathname.startsWith('//')) return '/';
    for (const char of value) if (char === '\\' || char.charCodeAt(0) < 32) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
