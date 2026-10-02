export type EntrySearch = Record<string, string | string[] | undefined>;

// Existing shared URLs must bypass the landing page, including #invite tokens
// which the browser reads only after the room workspace has mounted.
export function hasWorkspaceIntent(search: EntrySearch) {
  return ['view', 'room', 'project', 'track', 'stripe', 'order'].some((key) => {
    const value = search[key];
    return Array.isArray(value) ? value.some(Boolean) : Boolean(value);
  });
}

export function workspaceSignInHref(location?: {
  search: string;
  hash: string;
}) {
  const destination =
    '/app' + (location?.search || '') + (location?.hash || '');
  return '/signin-with-chatgpt?return_to=' + encodeURIComponent(destination);
}
