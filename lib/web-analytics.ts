import type { BeforeSendEvent } from '@vercel/analytics/next';

export function redactAnalyticsUrl(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // Workspace queries and room invitation fragments can contain private data.
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}
