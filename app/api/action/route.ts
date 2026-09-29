import { saveProject, resolveProjectCreation } from '@/lib/project-save';
import { takeBankAction } from '@/lib/take-bank-server';
import { setRoomEditor } from '@/lib/room-editors';
import { privacyAction } from '@/lib/privacy';
import { prepareNotification } from '@/lib/social-server';
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
  readProject,
  readJSON,
  limit,
} from '@/lib/server';
import { normalizeRates, normalizeTrackPrice } from '@/lib/orders';
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
      ['takeBanks', 'takeBankRead', 'takeBankSave', 'takeBankDelete'].includes(
        b.action,
      )
    )
      return Response.json(await takeBankAction(b, uid), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
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
        const rates = normalizeRates(b.rates ?? '[]', roles);
        try {
          await run(
            'INSERT INTO profiles (id,username,name,roles,bio,location,visibility,avatar,rates,created) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,roles=excluded.roles,bio=excluded.bio,location=excluded.location,visibility=excluded.visibility,avatar=excluded.avatar,rates=excluded.rates',
            uid,
            username,
            str(b.name, 60),
            JSON.stringify(roles),
            String(b.bio || '').slice(0, 600),
            String(b.location || '').slice(0, 80),
            choice(b.visibility, ['private', 'public']),
            avatar,
            rates,
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
        const price = normalizeTrackPrice(b.price ?? null);
        const id = crypto.randomUUID();
        await run(
          'INSERT INTO tracks (id,owner,title,kind,genre,bpm,musicalKey,visibility,permission,fileId,price,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
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
          price,
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
      case 'trackPrice': {
        const price = normalizeTrackPrice(b.price ?? null);
        await run(
          'UPDATE tracks SET price=? WHERE id=? AND owner=?',
          price,
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
        if (b.id === uid) fail('Choose another SESSION member.');
        if (
          !(await one(
            "SELECT id FROM profiles WHERE id=? AND visibility='public'",
            b.id,
          ))
        )
          fail('Profile unavailable.');
        if (b.value) {
          const eventId = crypto.randomUUID();
          await database().batch([
            prepareNotification(
              {
                user: b.id,
                actor: uid,
                kind: 'follow',
                resourceType: 'profile',
                resourceId: uid,
                body: 'started following you',
                uniqueKey: `follow:${uid}:${b.id}:${eventId}`,
                created: now,
              },
              'NOT EXISTS (SELECT 1 FROM follows WHERE user=? AND target=?)',
              uid,
              b.id,
            ),
            database()
              .prepare(
                'INSERT OR IGNORE INTO follows (user,target) VALUES (?,?)',
              )
              .bind(uid, b.id),
          ]);
        } else
          await run('DELETE FROM follows WHERE user=? AND target=?', uid, b.id);
        break;
      }
      case 'comments': {
        const commentedTrack = String(b.id).startsWith('demo-')
          ? null
          : await one(
              "SELECT id,owner FROM tracks WHERE id=? AND (visibility='public' OR owner=?)",
              b.id,
              uid,
            );
        if (!commentedTrack && !String(b.id).startsWith('demo-'))
          fail('Track unavailable.');
        if (b.body) {
          const commentId = crypto.randomUUID();
          const comment = database()
            .prepare(
              'INSERT INTO comments (id,track,user,body,created) VALUES (?,?,?,?,?)',
            )
            .bind(commentId, b.id, uid, str(b.body, 1000), now);
          if (commentedTrack)
            await database().batch([
              comment,
              prepareNotification(
                {
                  user: commentedTrack.owner,
                  actor: uid,
                  kind: 'comment',
                  resourceType: 'track',
                  resourceId: b.id,
                  body: 'commented on your track',
                  uniqueKey: `comment:${commentId}`,
                  created: now,
                },
                'EXISTS (SELECT 1 FROM comments WHERE id=?)',
                commentId,
              ),
            ]);
          else await comment.run();
        }
        result = await all(
          "SELECT c.*,COALESCE(p.name,'Creator') AS name FROM comments c LEFT JOIN profiles p ON p.id=c.user WHERE c.track=? ORDER BY c.created DESC LIMIT 50",
          b.id,
        );
        break;
      }
      case 'project': {
        result = await saveProject(b, uid, now);
        break;
      }
      case 'remix': {
        const src = await one(
          "SELECT * FROM tracks WHERE id=? AND visibility='public'",
          str(b.id),
        );
        if (!src) fail('This beat is no longer available to remix.', 404);
        if (src.permission !== 'collaborate')
          fail(
            'This beat is listen-only. Ask the producer for collaboration access before remixing.',
            403,
          );
        const arrangement = {
          bpm: src.bpm,
          tracks: [
            {
              id: crypto.randomUUID(),
              name: (src.title + ' (beat)').slice(0, 100),
              fileId: src.fileId,
              volume: 0.8,
              pan: 0,
              muted: false,
              solo: false,
              offset: 0,
              trimStart: 0,
              trimEnd: 0,
              low: 0,
              mid: 0,
              high: 0,
            },
          ],
        };
        result = await saveProject(
          {
            data: arrangement,
            title: (src.title + ' — remix').slice(0, 120),
            forkedFrom: src.id,
          },
          uid,
          now,
        );
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
            .prepare(
              'UPDATE project_creations SET deletedAt=? WHERE project=? AND owner=?',
            )
            .bind(now, b.id, uid),
          database()
            .prepare('DELETE FROM room_editors WHERE project=?')
            .bind(b.id),
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
              'INSERT INTO rooms (id,owner,title,project,invite,expires,created,visibility) VALUES (?,?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              uid,
              str(b.title),
              project,
              invite,
              now + 86400000,
              now,
              choice(b.visibility, ['invite', 'public']),
            ),
          database()
            .prepare('INSERT INTO members (room,user,seen) VALUES (?,?,?)')
            .bind(id, uid, now),
        ]);
        result = { id };
        break;
      }
      case 'roomProject': {
        const room = await roomAccess(b.id, uid);
        if (room.owner !== uid)
          fail('Only the room host can choose its studio project.', 403);
        const mode = choice(b.mode, ['create', 'attach', 'detach']);
        if (b.expectedProject !== null && typeof b.expectedProject !== 'string')
          fail('Reload the room before choosing a project.');
        if (room.project !== b.expectedProject)
          fail('The room project changed in another tab. Try again.', 409);
        let project: string | null = null;
        if (mode === 'create') {
          if (room.project)
            fail(
              'Remove the current room project before creating another.',
              409,
            );
          project = crypto.randomUUID();
          // The conditional insert and attachment are one transaction so two
          // host tabs cannot create an orphan or replace each other's project.
          await database().batch([
            database()
              .prepare(
                'INSERT INTO projects (id,owner,title,data,updated,revision) SELECT ?,?,?,?,?,1 WHERE EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=? AND project IS NULL)',
              )
              .bind(
                project,
                uid,
                (room.title + ' — studio').slice(0, 120),
                JSON.stringify({ bpm: 92, tracks: [] }),
                now,
                room.id,
                uid,
              ),
            database()
              .prepare(
                'UPDATE rooms SET project=? WHERE id=? AND owner=? AND project IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=?)',
              )
              .bind(project, room.id, uid, project, uid),
          ]);
          const current = await roomAccess(room.id, uid);
          if (current.project !== project)
            fail('The room project changed in another tab. Try again.', 409);
        } else {
          if (mode === 'attach') {
            project = str(b.project);
            if (
              !(await one(
                'SELECT id FROM projects WHERE id=? AND owner=?',
                project,
                uid,
              ))
            )
              fail('Choose a saved project you own.', 403);
          }
          const changed = await database().batch([
            database()
              .prepare(
                'UPDATE rooms SET project=? WHERE id=? AND owner=? AND project IS ? AND (? IS NULL OR EXISTS (SELECT 1 FROM projects WHERE id=? AND owner=?)) RETURNING id',
              )
              .bind(
                project,
                room.id,
                uid,
                b.expectedProject,
                project,
                project,
                uid,
              ),
            database()
              .prepare(
                'DELETE FROM room_editors WHERE room=? AND project IS NOT ? AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND owner=? AND project IS ?)',
              )
              .bind(room.id, project, room.id, uid, project),
          ]);
          if (!changed[0].results?.length)
            fail(
              'The room or selected project changed. Reload and try again.',
              409,
            );
        }
        result = { project };
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
          'INSERT OR IGNORE INTO members (room,user,seen) SELECT id,?,? FROM rooms WHERE id=? AND invite=? AND expires>? AND (SELECT COUNT(*) FROM members WHERE room=?)<4',
          uid,
          now,
          r.id,
          b.invite,
          now,
          r.id,
        );
        await roomAccess(r.id, uid);
        result = { id: r.id };
        break;
      }
      case 'play': {
        // count one play of a public track (rate-limited per user per minute)
        await run(
          "UPDATE tracks SET plays=plays+1 WHERE id=? AND visibility='public'",
          str(b.id),
        );
        break;
      }
      case 'joinPublicRoom': {
        const r = await one(
          "SELECT * FROM rooms WHERE id=? AND visibility='public'",
          b.id,
        );
        if (!r) fail('This room is invite-only.', 403);
        const inserted = await run(
          `INSERT OR IGNORE INTO members (room,user,seen)
           SELECT id,?,? FROM rooms WHERE id=? AND visibility='public'
             AND (SELECT COUNT(*) FROM members WHERE room=?)<4`,
          uid,
          now,
          r.id,
          r.id,
        );
        if (
          !Number((inserted as { meta?: { changes?: number } })?.meta?.changes)
        )
          fail('This room is full right now. Try another one.', 409);
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
            .prepare('DELETE FROM room_editors WHERE room=? AND user=?')
            .bind(b.id, b.user),
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
            'DELETE FROM room_editors WHERE room=? AND user=?',
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
            'DELETE FROM room_editors WHERE room=?',
            'DELETE FROM media_sessions WHERE room=?',
            'DELETE FROM events WHERE room=?',
            'DELETE FROM members WHERE room=?',
            'DELETE FROM rooms WHERE id=?',
          ].map((sql) => database().prepare(sql).bind(b.id)),
        );
        break;
      }
      case 'projectRead': {
        result = await readProject(b.id, uid);
        break;
      }
      case 'projectCreation': {
        result = await resolveProjectCreation(b.key, uid);
        break;
      }
      case 'roomEditor': {
        result = await setRoomEditor(b, uid);
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
      {
        status: e.status || 500,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  }
}
