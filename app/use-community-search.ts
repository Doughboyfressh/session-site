'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  initialCommunitySearch,
  startCommunitySearch,
} from '@/lib/community-search';

export function useCommunitySearch(query: string) {
  const [state, setState] = useState(() => initialCommunitySearch(query));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => startCommunitySearch(query, setState), [query, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current =
    state.query === query.trim() ? state : initialCommunitySearch(query);
  return { ...current, retry };
}
