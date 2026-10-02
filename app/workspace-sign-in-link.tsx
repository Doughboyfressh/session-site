'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { workspaceSignInHref } from '@/lib/workspace-entry';

const serverHref = workspaceSignInHref();

function getServerSnapshot() {
  return serverHref;
}

function getSnapshot() {
  return workspaceSignInHref(window.location);
}

function subscribe(onLocationChange: () => void) {
  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);
  return () => {
    window.removeEventListener('popstate', onLocationChange);
    window.removeEventListener('hashchange', onLocationChange);
  };
}

export function WorkspaceSignInLink({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const href = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <a href={href} target="_top" className={className}>
      {children}
    </a>
  );
}
