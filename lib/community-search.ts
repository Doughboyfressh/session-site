import type { Track } from './catalog';

export type SearchTrack = Pick<Track, 'id' | 'title' | 'creator' | 'genre'> &
  Partial<Track>;
export type SearchProfile = {
  id: string;
  name: string;
  username: string;
  roles: string;
  bio?: string;
  avatar?: string | null;
  followers?: number;
  [key: string]: unknown;
};
export type CommunitySearchResults = {
  tracks: SearchTrack[];
  profiles: SearchProfile[];
};
export type CommunitySearchState = {
  query: string;
  results: CommunitySearchResults | null;
  searching: boolean;
  error: string;
};

export function initialCommunitySearch(query: string): CommunitySearchState {
  const q = query.trim();
  return {
    query: q,
    results: null,
    searching: q.length >= 2,
    error: '',
  };
}

export function startCommunitySearch(
  query: string,
  update: (state: CommunitySearchState) => void,
  fetcher: typeof fetch = fetch,
): () => void {
  const initial = initialCommunitySearch(query);
  const controller = new AbortController();
  let active = true;
  update(initial);
  const timer = initial.searching
    ? setTimeout(async () => {
        try {
          const response = await fetcher(
            '/api/search?q=' + encodeURIComponent(initial.query),
            { signal: controller.signal },
          );
          const raw: unknown = await response.json();
          const payload = (
            raw && typeof raw === 'object' ? raw : {}
          ) as Partial<CommunitySearchResults>;
          if (!response.ok)
            throw new Error('Community search is unavailable. Try again.');
          if (!active) return;
          update({
            ...initial,
            searching: false,
            results: {
              tracks: Array.isArray(payload.tracks) ? payload.tracks : [],
              profiles: Array.isArray(payload.profiles) ? payload.profiles : [],
            },
          });
        } catch {
          if (!active) return;
          update({
            ...initial,
            searching: false,
            error: 'Community search is unavailable. Try again.',
          });
        }
      }, 350)
    : null;
  return () => {
    active = false;
    controller.abort();
    if (timer !== null) clearTimeout(timer);
  };
}

export function mergeSearchTracks(
  query: string,
  remote: readonly SearchTrack[],
  originals: readonly Track[],
): SearchTrack[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const matches = originals.filter((track) =>
    `${track.title} ${track.creator} ${track.genre}`.toLowerCase().includes(q),
  );
  const ids = new Set<string>();
  return [...remote, ...matches].filter((track) => {
    if (ids.has(track.id)) return false;
    ids.add(track.id);
    return true;
  });
}

export function trackPermalink(id: string) {
  return '/t/' + encodeURIComponent(id);
}
