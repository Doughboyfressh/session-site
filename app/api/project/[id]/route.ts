import { getChatGPTUser } from '@/app/chatgpt-auth';
import { readProject, fail, limit } from '@/lib/server';
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await getChatGPTUser();
    if (!u) fail('Sign in to open this project.', 401);
    await limit(u.userId, 'projectRead', 120);
    const { id } = await params,
      p = await readProject(id, u.userId);
    const since = new URL(req.url).searchParams.get('revision');
    return Response.json(
      {
        ...p,
        data:
          since !== null && Number(since) === p.revision ? undefined : p.data,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: any) {
    return Response.json(
      { error: e.status ? e.message : 'Project updates could not load.' },
      {
        status: e.status || 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
