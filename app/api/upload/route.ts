import { getChatGPTUser } from '@/app/chatgpt-auth';
import { uploadBankTake } from '@/lib/take-bank-server';
import { uploadForm } from '@/lib/upload-body';
import {
  one,
  run,
  bucket,
  choice,
  fail,
  projectEditCondition,
  str,
  limit,
} from '@/lib/server';
export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to upload music.', 401);
    if (
      req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      fail('Request not allowed.', 403);
    await limit(user.userId, 'upload', 30);
    const form = await uploadForm(req),
      file = form.get('file');
    const purpose = choice(form.get('purpose'), [
      'audio',
      'avatar',
      'take',
      'photo',
      'video',
    ]);
    if (!(file instanceof File) || file.size === 0) fail('Choose a file.');
    const purposeCap = {
      avatar: 3,
      audio: 25,
      photo: 8,
      video: 60,
      take: 25,
    }[purpose] as number;
    if (file.size > purposeCap * 1024 * 1024)
      fail(
        purpose === 'avatar'
          ? 'Choose a photo smaller than 3 MB.'
          : purpose === 'photo'
            ? 'Choose a photo smaller than 8 MB.'
            : purpose === 'video'
              ? 'Choose a video smaller than 60 MB.'
              : 'Choose audio smaller than 25 MB.',
        413,
      );
    if (purpose === 'take')
      return Response.json(await uploadBankTake(req, form, file, user.userId));
    const projectId = form.get('projectId')
      ? str(form.get('projectId'), 100)
      : '';
    if (
      projectId &&
      (purpose !== 'audio' ||
        !(await one(
          'SELECT 1 FROM projects p WHERE p.id=? AND ' +
            projectEditCondition('p'),
          projectId,
          user.userId,
          user.userId,
        )))
    )
      fail('Editing access ended. Keep a local copy of your take.', 403);
    const quota = await one(
      'SELECT COALESCE(SUM(size),0) AS total FROM files WHERE owner=?',
      user.userId,
    );
    if (quota.total + file.size > 500 * 1024 * 1024)
      fail('Your 500 MB preview storage is full.');
    const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    let mime = '';
    if (purpose === 'avatar') {
      if (bytes[0] === 137 && text.slice(1, 4) === 'PNG') mime = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        mime = 'image/jpeg';
      else if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP')
        mime = 'image/webp';
      else fail('Use a PNG, JPEG or WebP photo.');
    } else if (purpose === 'photo') {
      if (bytes[0] === 137 && text.slice(1, 4) === 'PNG') mime = 'image/png';
      else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        mime = 'image/jpeg';
      else if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP')
        mime = 'image/webp';
      else if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70)
        mime = 'image/gif';
      else fail('Use a PNG, JPEG, WebP or GIF photo.');
    } else if (purpose === 'video') {
      if (text.slice(4, 8) === 'ftyp') mime = 'video/mp4';
      else if (
        bytes[0] === 26 &&
        bytes[1] === 69 &&
        bytes[2] === 223 &&
        bytes[3] === 163
      )
        mime = 'video/webm';
      else fail('Use an MP4 or WebM video.');
    } else {
      if (text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE')
        mime = 'audio/wav';
      else if (
        text.startsWith('ID3') ||
        (bytes[0] === 255 && (bytes[1] & 224) === 224)
      )
        mime = 'audio/mpeg';
      else if (text.startsWith('OggS')) mime = 'audio/ogg';
      else if (text.startsWith('fLaC')) mime = 'audio/flac';
      else if (
        bytes[0] === 26 &&
        bytes[1] === 69 &&
        bytes[2] === 223 &&
        bytes[3] === 163
      )
        mime = 'audio/webm';
      else if (text.slice(4, 8) === 'ftyp') mime = 'audio/mp4';
      else fail('Use WAV, MP3, OGG, FLAC, WebM or M4A audio.');
    }
    const id = crypto.randomUUID();
    if (req.signal.aborted) fail('Upload cancelled.', 499);
    await bucket().put(id, file.stream(), {
      httpMetadata: { contentType: mime },
    });
    try {
      if (req.signal.aborted) fail('Upload cancelled.', 499);
      const result = await run(
        'INSERT INTO files (id,owner,name,mime,size,purpose,created) SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM files WHERE owner=?) + ? <= ?' +
          (projectId
            ? ' AND EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND ' +
              projectEditCondition('p') +
              ')'
            : ''),
        id,
        user.userId,
        file.name.slice(0, 180),
        mime,
        file.size,
        purpose,
        Date.now(),
        user.userId,
        file.size,
        500 * 1024 * 1024,
        ...(projectId ? [projectId, user.userId, user.userId] : []),
      );
      if (!result.meta.changes)
        fail(
          'Upload could not be accepted. Check your storage space and project editing access.',
          409,
        );
    } catch (e) {
      await bucket().delete(id);
      throw e;
    }
    return Response.json({ id, name: file.name, mime });
  } catch (e: any) {
    if (!e.status) console.error('Upload failed', e);
    return Response.json(
      { error: e.status ? e.message : 'Upload failed. Try a smaller file.' },
      { status: e.status || 500 },
    );
  }
}
