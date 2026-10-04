'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { createForegroundActivity } from '../lib/foreground-activity';

let recorder: ReturnType<typeof createForegroundActivity> | undefined;

export default function SessionActivity() {
  const pathname = usePathname();
  useEffect(() => {
    recorder ??= createForegroundActivity({
      now: Date.now,
      visible: () => document.visibilityState === 'visible',
      send: async () => {
        const response = await fetch('/api/activity', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
        });
        return response.status === 204;
      },
    });
    const current = recorder;
    const activity = () => void current.record();
    // StrictMode's first setup is cleaned up before its timer can send a visit.
    const firstVisit = window.setTimeout(() => void current.record(true), 0);
    document.addEventListener('visibilitychange', activity);
    document.addEventListener('pointerdown', activity, { passive: true });
    document.addEventListener('keydown', activity);
    document.addEventListener('scroll', activity, { passive: true, capture: true });
    window.addEventListener('focus', activity);
    return () => {
      window.clearTimeout(firstVisit);
      document.removeEventListener('visibilitychange', activity);
      document.removeEventListener('pointerdown', activity);
      document.removeEventListener('keydown', activity);
      document.removeEventListener('scroll', activity, true);
      window.removeEventListener('focus', activity);
    };
  }, [pathname]);
  return null;
}
