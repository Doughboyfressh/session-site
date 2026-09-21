import { getChatGPTUser } from '@/app/chatgpt-auth';
import { bucket, fileAccess } from '@/lib/server';

const PRIVATE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};
type Params = { params: Promise<{ id: string }> };
async function serve(req: Request, { params }: Params, head = false) {
  try {
    const { id } = await params;
    const user = await getChatGPTUser();
    const file = await fileAccess(id, user?.userId || '');
    if (!file) return new Response(null, { status: 404, headers: PRIVATE });
    const headers = {
      ...PRIVATE,
      'Content-Type': file.mime,
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(file.size),
    };
    if (head) return new Response(null, { headers });
    let range: { offset: number; length: number } | undefined;
    const requested = req.headers.get('range');
    // No validators are exposed; an If-Range condition cannot be confirmed.
    if (requested && !req.headers.has('if-range')) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
      let start = 0,
        end = -1;
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, file.size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(file.size - 1, Number(match[2]))
            : file.size - 1;
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= file.size
      )
        return new Response(null, {
          status: 416,
          headers: { ...PRIVATE, 'Content-Range': `bytes */${file.size}` },
        });
      range = { offset: start, length: end - start + 1 };
    }
    const obj = await bucket().get(id, range ? { range } : undefined);
    if (!obj) return new Response(null, { status: 404, headers: PRIVATE });
    return new Response(obj.body, {
      status: range ? 206 : 200,
      headers: range
        ? {
            ...headers,
            'Content-Length': String(range.length),
            'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${file.size}`,
          }
        : headers,
    });
  } catch (e) {
    console.error('File access failed', e);
    return new Response(null, { status: 503, headers: PRIVATE });
  }
}
export const GET = (req: Request, params: Params) => serve(req, params);
export const HEAD = (req: Request, params: Params) => serve(req, params, true);
