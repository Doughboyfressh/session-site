'use client';

import { Analytics } from '@vercel/analytics/next';
import { redactAnalyticsUrl } from '../lib/web-analytics';

export default function SessionAnalytics() {
  return <Analytics beforeSend={redactAnalyticsUrl} />;
}
