import './originals-harness';
// Match Next's public compile-time constant in this isolated Vite UI fixture.
Object.assign(globalThis, {
  process: { env: { NEXT_PUBLIC_DEPLOYMENT_TARGET: 'vercel' } },
});
const fixtureFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.startsWith('/api/project/')) {
    const response = await fixtureFetch('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'projectRead', id: 'audition-project' }),
    });
    const project = (await response.json()) as Record<string,unknown>;
    return Response.json({ ...project, canEdit: true, canManage: true });
  }
  return fixtureFetch(input, init);
};
