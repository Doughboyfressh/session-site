const MAX_BODY = 26 * 1024 * 1024;
function tooLarge(): never {
  throw Object.assign(new Error('Choose a file smaller than 25 MB.'), {
    status: 413,
  });
}
// Bound the actual body, including unused fields, before parsing multipart data.
export async function uploadForm(req: Request): Promise<FormData> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) tooLarge();
  if (!req.body)
    throw Object.assign(new Error('Choose a file.'), { status: 400 });
  const reader = req.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      if (req.signal.aborted)
        throw Object.assign(new Error('Upload cancelled.'), { status: 499 });
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) tooLarge();
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { 'Content-Type': req.headers.get('content-type') || '' },
    }).formData();
  } catch {
    throw Object.assign(
      new Error('The upload body is invalid. Choose the file again.'),
      { status: 400 },
    );
  }
}
