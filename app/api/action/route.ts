import { privacyAction, validateArrangement } from '@/lib/privacy';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  all,
  one,
  run,
  database,
  str,
  choice,
  fail,
  roomAccess,
  projectAccess,
  readJSON,
  limit,
} from '@/lib/server';
export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) fail('Sign in to save your work.', 401);
    const uid = user.userId;
    if (
      req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      fail('Request not allowed.', 403);
    if (Number(req.headers.get('content-length')) > 300000)
      fail('This request is too large.', 413);
    await limit(uid, 'action', 120);
    const b = await readJSON(req);
    if (
      ['projectVersions', 'myFiles', 'exportData', 'eraseFile'].includes(
        b.action,
      )
    )
      return Response.json(await privacyAction(b, uid), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    const now = Date.now();
    let result: any = { ok: true };
    switch (b.action) {
      case 'profile': {
        const username = str(b.username, 24).toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username))
          fail('Use 3–24 letters, numbers or underscores for your username.');
        const roles = Array.isArray(b.roles)
          ? b.roles.filter((r: string) =>
              ['Artist', 'Producer', 'Engineer'].includes(r),
            )
          : [];
        if (!roles.length) fail('Choose at least one creative role.');
        const avatar = b.avatar || null;
        if (
          avatar &&
          !(await one(
            "SELECT id FROM files WHERE id=? AND owner=? AND purpose='avatar'",
            avatar,
            uid,
          ))
        )
          fail('Choose your own profile photo.');
        try {
          await run(
            'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,avatar,created) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,roles=excluded.roles,bio=excluded.bio,location=excluded.location,visibility=excluded.visibility,avatar=excluded.avatar',
            uid,
            username,
            str(b.name, 60),
            JSON.stringify(roles),
            String(b.bio || '').slice(0, 600),
            String(b.location || '').slice(0, 80),
            choice(b.visibility, ['private', 'public']),
            avatar,
            now,
          );
        } catch (e: any) {
          if (String(e).includes('UNIQUE'))
            fail('That username is taken. Try another.');
          throw e;
        }
        break;
      }
      case 'track': {
        if (
          !(await one(
            "SELECT id FROM files WHERE id=? AND owner=? AND purpose='audio'",
            b.fileId,
            uid,
          ))
        )
          fail('Upload an audio file first.');
        if (b.rights !== true)
          fail('Confirm you have permission to share this music.');
        const bpm = Number(b.bpm);
        if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)
          fail('Tempo must be between 40 and 240 BPM.');
        const id = crypto.randomUUID();
        await run(
          'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          id,
          uid,
          str(b.title),
          choice(b.kind, ['beat', 'song']),
          str(b.genre, 30),
          Math.round(bpm),
          str(b.musicalKey, 20),
          choice(b.visibility, ['private', 'public']),
          choice(b.permission, ['listen', 'collaborate']),
          b.fileId,
          now,
        );
        result = { id };
        break;
      }
      case 'visibility': {
        await run(
          'UPDATE tracks SET visibility=?,permission=? WHERE id=? AND owner=?',
          choice(b.visibility, ['private', 'public']),
          choice(b.permission, ['listen', 'collaborate']),
          str(b.id),
          uid,
        );
        break;
      }
      case 'deleteTrack': {
        await run('DELETE FROM tracks WHERE id=? AND owner=?', str(b.id), uid);
        break;
      }
      case 'saved': {
        const id = str(b.id);
        if (
          !id.startsWith('demo-') &&
          !(await one(
            "SELECT id FROM tracks WHERE id=? AND (visibility='public' OR owner=?)",
            id,
            uid,
          ))
        )
          fail('Track unavailable.', 404);
        if (b.value)
          await run(
            'INSERT OR IGNORE INTO saved (user,track) VALUES (?,?)',
            uid,
            id,
          );
        else await run('DELETE FROM saved WHERE user=? AND track=?', uid, id);
        break;
      }
      case 'follow': {
        if (
          !(await one(
            "SELECT id FROM profiles WHERE id=? AND visibility='public'",
            b.id,
          ))
        )
          fail('Profile unavailable.');
        if (b.value)
          await run(
            'INSERT OR IGNORE INTO follows (user,target) VALUES (?,?)',
            uid,
            b.id,
          );
        else
          await run('DELETE FROM follows WHERE user=? AND target=?', uid, b.id);
        break;
      }
      case 'comments': {
        if (
          !(await one(
            "SELECT id FROM tracks WHERE id=? AND (visibility='public' OR owner=?)",
            b.id,
            uid,
          )) &&
          !String(b.id).startsWith('demo-')
        )
          fail('Track unavailable.');
        if (b.body)
          await run(
            'INSERT INTO comments (id,track,user,body,created) VALUES (?,?,?,?,?)',
            crypto.randomUUID(),
            b.id,
            uid,
            str(b.body, 1000),
            now,
          );
        result = await all(
          "SELECT c.*,COALESCE(p.name,'Creator') AS name FROM comments c LEFT JOIN profiles p ON p.id=c.user WHERE c.track=? ORDER BY c.created DESC LIMIT 50",
          b.id,
        );
        break;
      }
      case 'project': {
        const id = b.id || crypto.randomUUID(),
          existing = await one('SELECT * FROM projects WHERE id=?', id);
        if (existing && existing.owner !== uid)
          fail('Only the project owner can save this arrangement.', 403);
        const data = b.data;
        validateArrangement(data);
        if (JSON.stringify(data).length > 250000)
          fail('This arrangement is too large.');
        if (
          existing &&
          Number(b.baseRevision ?? existing.revision) !== existing.revision
        )
          fail(
            'A newer version was saved in another tab. Open it before saving, or create a new project.',
            409,
          );
        const fileIds = [
          ...new Set(data.tracks.map((t: any) => t.fileId).filter(Boolean)),
        ] as string[];
        for (const f of fileIds)
          if (
            !(await one(
              "SELECT f.id FROM files f WHERE f.id=? AND (f.owner=? OR EXISTS (SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public' AND t.permission='collaborate') OR EXISTS (SELECT 1 FROM project_files pf WHERE pf.project=? AND pf.file=f.id))",
              f,
              uid,
              id,
            ))
          )
            fail('This track does not allow collaboration.', 403);
        const revision = existing ? existing.revision + 1 : 1;
        const saved = existing
          ? await one(
              'UPDATE projects SET title=?,data=?,updated=?,revision=? WHERE id=? AND owner=? AND revision=? RETURNING id',
              str(b.title),
              JSON.stringify(data),
              now,
              revision,
              id,
              uid,
              existing.revision,
            )
          : await one(
              'INSERT INTO projects (id,owner,title,data,updated,revision) VALUES (?,?,?,?,?,?) RETURNING id',
              id,
              uid,
              str(b.title),
              JSON.stringify(data),
              now,
              revision,
            );
        if (!saved)
          fail(
            'Another save completed first. Reload the project before saving.',
            409,
          );
        // Keep previously authorized sources available to this project's history.
        // Project deletion or explicit file erasure removes these access links.
        if (fileIds.length)
          await database().batch([
            ...fileIds.map((f) =>
              database()
                .prepare(
                  'INSERT OR IGNORE INTO project_files (project,file) SELECT ?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=?) AND EXISTS (SELECT 1 FROM files WHERE id=?)',
                )
                .bind(id, f, id, uid, f),
            ),
          ]);
        if (b.checkpoint !== false) {
          await run(
            'INSERT INTO project_versions (id,project,owner,title,data,created) VALUES (?,?,?,?,?,?)',
            crypto.randomUUID(),
            id,
            uid,
            str(b.title),
            JSON.stringify(data),
            now,
          );
          await run(
            'DELETE FROM project_versions WHERE project=? AND id NOT IN (SELECT id FROM project_versions WHERE project=? ORDER BY created DESC LIMIT 20)',
            id,
            id,
          );
        }
        result = { id, revision };
        break;
      }
      case 'deleteProject': {
        const p = await one(
          'SELECT * FROM projects WHERE id=? AND owner=?',
          b.id,
          uid,
        );
        if (!p) fail('Project unavailable.', 404);
        await database().batch([
          database()
            .prepare('DELETE FROM project_versions WHERE project=?')
            .bind(b.id),
          database()
            .prepare('DELETE FROM project_files WHERE project=?')
            .bind(b.id),
          database()
            .prepare('UPDATE rooms SET project=NULL WHERE project=?')
            .bind(b.id),
          database()
            .prepare('DELETE FROM projects WHERE id=? AND owner=?')
            .bind(b.id, uid),
        ]);
        break;
      }
      case 'room': {
        let project = b.project || null;
        if (
          project &&
          !(await one(
            'SELECT id FROM projects WHERE id=? AND owner=?',
            project,
            uid,
          ))
        )
          fail('Choose a project you own.');
        const id = crypto.randomUUID(),
          invite = crypto.randomUUID() + crypto.randomUUID();
        await database().batch([
          database()
            .prepare(
              'INSERT INTO rooms (id,owner,title,project,invite,expires,created) VALUES (?,?,?,?,?,?,?)',
            )
            .bind(id, uid, str(b.title), project, invite, now + 86400000, now),
          database()
            .prepare('INSERT INTO members (room,user,seen) VALUES (?,?,?)')
            .bind(id, uid, now),
        ]);
        result = { id };
        break;
      }
      case 'joinRoom': {
        const r = await one(
          'SELECT * FROM rooms WHERE id=? AND invite=? AND expires>?',
          b.id,
          b.invite,
          now,
        );
        if (!r)
          fail(
            'This invitation expired or was replaced. Ask for a new link.',
            403,
          );
        await run(
          'INSERT OR IGNORE INTO members (room,user,seen) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM members WHERE room=?)<4',
          r.id,
          uid,
          now,
          r.id,
        );
        await roomAccess(r.id, uid);
        result = { id: r.id };
        break;
      }
      case 'rotateInvite': {
        const r = await roomAccess(b.id, uid);
        if (r.owner !== uid) fail('Only the host can change invitations.', 403);
        await run(
          'UPDATE rooms SET invite=?,expires=? WHERE id=?',
          crypto.randomUUID() + crypto.randomUUID(),
          now + 86400000,
          b.id,
        );
        break;
      }
      case 'removeMember': {
        const r = await roomAccess(b.id, uid);
        if (r.owner !== uid || b.user === uid)
          fail('Only the host can remove collaborators.', 403);
        await database().batch([
          database()
            .prepare('DELETE FROM members WHERE room=? AND user=?')
            .bind(b.id, b.user),
          database()
            .prepare('DELETE FROM media_sessions WHERE room=? AND user=?')
            .bind(b.id, b.user),
          database()
            .prepare('DELETE FROM events WHERE room=? AND sender=?')
            .bind(b.id, b.user),
          database()
            .prepare('UPDATE rooms SET invite=?,expires=? WHERE id=?')
            .bind(
              crypto.randomUUID() + crypto.randomUUID(),
              now + 86400000,
              b.id,
            ),
        ]);
        break;
      }
      case 'leaveRoom': {
        const r = await roomAccess(b.id, uid);
        if (r.owner === uid) fail('The host can close the room instead.');
        await database().batch(
          [
            'DELETE FROM members WHERE room=? AND user=?',
            'DELETE FROM media_sessions WHERE room=? AND user=?',
            'DELETE FROM events WHERE room=? AND sender=?',
          ].map((sql) => database().prepare(sql).bind(b.id, uid)),
        );
        break;
      }
      case 'closeRoom': {
        const r = await roomAccess(b.id, uid);
        if (r.owner !== uid) fail('Only the host can close a room.', 403);
        await database().batch(
          [
            'DELETE FROM media_sessions WHERE room=?',
            'DELETE FROM events WHERE room=?',
            'DELETE FROM members WHERE room=?',
            'DELETE FROM rooms WHERE id=?',
          ].map((sql) => database().prepare(sql).bind(b.id)),
        );
        break;
      }
      case 'projectRead': {
        const p = await projectAccess(b.id, uid);
        if (!p) fail('Project unavailable.', 403);
        result = { ...p, data: JSON.parse(p.data) };
        break;
      }
      case 'report': {
        await run(
          'INSERT INTO reports (id,user,track,body,created) VALUES (?,?,?,?,?)',
          crypto.randomUUID(),
          uid,
          str(b.id),
          str(b.body, 3000),
          now,
        );
        break;
      }
      default:
        fail('Unknown action.');
    }
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (e: any) {
    if (!e.status) console.error('Action failed', e);
    return Response.json(
      {
        error: e.status
          ? e.message
          : 'Could not save this change. Please try again.',
      },
      { status: e.status || 500 },
    );
  }
}
