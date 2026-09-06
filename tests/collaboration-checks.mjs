import assert from 'node:assert/strict';

// Synthetic local-worker verification only. There is deliberately no URL override.
const BASE = 'http://127.0.0.1:8787';
const tag = Date.now().toString(36) + crypto.randomUUID().slice(0, 5);
const owner = 'qa_collab_owner_' + tag;
const editor = 'qa_collab_editor_' + tag;
const listener = 'qa_collab_listener_' + tag;
const outsider = 'qa_collab_outsider_' + tag;
let assertions = 0;
let requests = 0;
const rooms = new Set();
const projects = new Set();
const files = [];

function check(condition, message) {
  assert.ok(condition, message);
  assertions++;
}
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function auth(user) {
  return user
    ? {
        'oai-authenticated-user-id': user,
        'oai-authenticated-user-email': user + '@example.test',
      }
    : {};
}
async function request(user, path, body) {
  const url = new URL(path, BASE);
  assert.equal(url.origin, BASE, 'Tests must never contact another origin');
  assert.ok(
    url.pathname.startsWith('/api/'),
    'Only local application APIs are allowed',
  );
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...auth(user),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  requests++;
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json')
    ? await response.json()
    : (await response.arrayBuffer()).byteLength;
  return { status: response.status, value };
}
async function call(user, path, body, status = 200) {
  const result = await request(user, path, body);
  equal(result.status, status, path + ': ' + JSON.stringify(result.value));
  return result.value;
}
const action = (user, body, status = 200) =>
  call(user, '/api/action', body, status);
const read = (user, id, status = 200) =>
  action(user, { action: 'projectRead', id }, status);
const exportData = (user) => action(user, { action: 'exportData' });
const roomState = (user, id, status = 200) =>
  call(user, '/api/room/' + id, undefined, status);
const versions = (id, status = 200, user = owner) =>
  action(user, { action: 'projectVersions', id }, status);
const fileAccess = (user, id, status = 200) =>
  call(user, '/api/file/' + id, undefined, status);
const grant = (
  room,
  project,
  user = editor,
  editable = true,
  actor = owner,
  status = 200,
) =>
  action(
    actor,
    { action: 'roomEditor', id: room, project, user, editable },
    status,
  );
const attach = (room, expectedProject, project) =>
  action(owner, {
    action: 'roomProject',
    id: room,
    mode: project ? 'attach' : 'detach',
    expectedProject,
    project,
  });
const save = (user, project, revision, title, data, status = 200) =>
  action(
    user,
    {
      action: 'project',
      id: project,
      baseRevision: revision,
      title,
      data,
    },
    status,
  );
const track = (file, name) => ({
  id: crypto.randomUUID(),
  fileId: file,
  name,
  volume: 0.8,
  pan: 0,
  offset: 0,
  trimStart: 0,
  trimEnd: 0,
  muted: false,
  solo: false,
  low: 0,
  mid: 0,
  high: 0,
});
function wav() {
  const bytes = new Uint8Array(204),
    view = new DataView(bytes.buffer);
  const text = (offset, value) =>
    [...value].forEach((c, i) => {
      bytes[offset + i] = c.charCodeAt(0);
    });
  text(0, 'RIFF');
  view.setUint32(4, 196, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, 160, true);
  return bytes;
}
async function upload(user, name) {
  const data = new FormData();
  data.set('purpose', 'audio');
  data.set('file', new File([wav()], name + '.wav', { type: 'audio/wav' }));
  const response = await fetch(BASE + '/api/upload', {
    method: 'POST',
    headers: auth(user),
    body: data,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  requests++;
  const result = await response.json();
  equal(
    response.status,
    200,
    'Synthetic WAV upload: ' + JSON.stringify(result),
  );
  files.push({ user, id: result.id });
  return result.id;
}
async function createRoom(project, suffix) {
  const result = await action(owner, {
    action: 'room',
    title: 'QA collaboration ' + suffix + ' ' + tag,
    project,
  });
  rooms.add(result.id);
  return result.id;
}
async function join(room, user = editor) {
  const current = await roomState(owner, room);
  await action(user, {
    action: 'joinRoom',
    id: room,
    invite: current.room.invite,
  });
}
async function noGrant(room, project) {
  const data = await exportData(editor);
  check(
    Array.isArray(data.editingPermissions),
    'Export provides editing-permission metadata',
  );
  check(
    !data.editingPermissions.some(
      (p) => p.room === room && p.project === project,
    ),
    'No stale editor grant remains',
  );
}
async function projectCount(file, expected, user = editor) {
  const owned = await action(user, { action: 'myFiles' });
  const entry = owned.find((f) => f.id === file);
  check(entry, "File remains in its uploader's inventory");
  equal(entry.projects, expected, 'Private file project-grant count');
}
async function permission(user, project, editable, revision) {
  const p = await read(user, project);
  equal(p.canEdit, editable, 'Project polling reflects live edit permission');
  equal(p.canManage, user === owner, 'Only the owner can manage the project');
  if (revision !== undefined)
    equal(
      p.revision,
      revision,
      'Permission changes do not alter arrangement revision',
    );
  check(
    !Object.hasOwn(p, 'lastSaveId'),
    'Internal save receipt is omitted from shared project reads',
  );
  return p;
}
async function section(name, fn) {
  await fn();
  console.log('PASS ' + name);
}

let failure;
try {
  for (const [user, prefix, role] of [
    [owner, 'qco', 'Producer'],
    [editor, 'qce', 'Engineer'],
    [listener, 'qcl', 'Artist'],
    [outsider, 'qcx', 'Artist'],
  ]) {
    await action(user, {
      action: 'profile',
      username: prefix + '_' + tag,
      name: 'QA ' + prefix,
      roles: [role],
      visibility: 'private',
    });
  }
  const ownerFile = await upload(owner, 'qa-owner-source');
  const baseData = {
    bpm: 92,
    tracks: [track(ownerFile, 'Owner private source')],
  };
  const created = await action(owner, {
    action: 'project',
    title: 'QA shared arrangement ' + tag,
    data: baseData,
  });
  const project = created.id;
  projects.add(project);
  const room = await createRoom(project, 'main');
  await join(room);
  await join(room, listener);
  let current = await read(owner, project);

  await section(
    'Explicit grants and permission polling at unchanged revision',
    async () => {
      await permission(editor, project, false, current.revision);
      await permission(listener, project, false, current.revision);
      await save(
        editor,
        project,
        current.revision,
        'Forbidden editor save',
        baseData,
        403,
      );
      await read(outsider, project, 403);
      await grant(room, project, editor, true, editor, 403);
      await grant(room, project, editor, true, listener, 403);
      await grant(room, project, outsider, true, owner, 409);
      await grant(room, crypto.randomUUID(), editor, true, owner, 409);
      await action(editor, { action: 'deleteProject', id: project }, 404);
      await grant(room, project);
      await permission(editor, project, true, current.revision);
      await permission(editor, project, true, current.revision);
      await permission(listener, project, false, current.revision);
      const state = await roomState(listener, room);
      check(state.editors.includes(editor), 'Room exposes the current editor');
      check(
        !state.editors.includes(listener),
        'Listener is not silently granted editing',
      );
    },
  );

  const editorFile = await upload(editor, 'qa-editor-recording');
  const outsiderFile = await upload(outsider, 'qa-unshared-outsider-source');
  await section(
    'Editor sources, project ownership, and history/export isolation',
    async () => {
      await fileAccess(owner, editorFile, 404);
      await fileAccess(listener, editorFile, 404);
      const before = await versions(project);
      await save(
        editor,
        project,
        current.revision,
        'Forbidden unrelated source',
        {
          ...baseData,
          tracks: [...baseData.tracks, track(outsiderFile, 'Not shared')],
        },
        403,
      );
      equal(
        (await versions(project)).length,
        before.length,
        'Rejected source creates no checkpoint',
      );
      await projectCount(outsiderFile, 0, outsider);
      const editedData = {
        ...baseData,
        tracks: [...baseData.tracks, track(editorFile, 'Editor recording')],
      };
      const saved = await save(
        editor,
        project,
        current.revision,
        'QA editor contribution',
        editedData,
      );
      equal(saved.owner, owner, 'Editor save preserves project ownership');
      equal(saved.canManage, false, 'Editor save does not gain owner controls');
      equal(
        saved.revision,
        current.revision + 1,
        'Editor save increments revision once',
      );
      current = await read(owner, project);
      equal(
        current.updatedBy,
        editor,
        'Editor attribution is recorded separately',
      );
      equal(
        current.data,
        editedData,
        'Owner receives complete editor arrangement',
      );
      await fileAccess(owner, editorFile);
      await fileAccess(listener, editorFile);
      await fileAccess(outsider, editorFile, 404);
      await projectCount(editorFile, 1);
      const ownersFiles = await action(owner, { action: 'myFiles' });
      check(
        !ownersFiles.some((f) => f.id === editorFile),
        'Editor retains file ownership',
      );
      await action(
        owner,
        { action: 'eraseFile', id: editorFile, confirm: 'ERASE' },
        404,
      );
      await versions(project, 404, editor);
      const history = await versions(project);
      equal(
        history.length,
        before.length + 1,
        'Accepted editor save adds one checkpoint',
      );
      check(
        history.every((v) => v.owner === owner),
        'All project checkpoints retain owner identity',
      );
      check(
        history.some(
          (v) => v.author === editor && v.title === 'QA editor contribution',
        ),
        'Checkpoint author records editor identity',
      );
      const exportedEditor = await exportData(editor);
      check(
        !exportedEditor.projects.some((p) => p.id === project),
        'Editor export excludes foreign project',
      );
      check(
        !exportedEditor.versions.some((v) => v.project === project),
        'Editor export excludes foreign full snapshots',
      );
      check(
        exportedEditor.files.some((f) => f.id === editorFile),
        'Editor export includes their original upload',
      );
      check(
        exportedEditor.editingPermissions.some(
          (g) => g.room === room && g.project === project,
        ),
        'Editor can export their grant metadata',
      );
      const exportedOwner = await exportData(owner);
      check(
        exportedOwner.versions.some(
          (v) => v.project === project && v.author === editor,
        ),
        'Owner export retains collaborator-authored checkpoints',
      );
    },
  );

  const staleFile = await upload(editor, 'qa-stale-attempt-source');
  await section(
    'Stale and competing saves cannot leak source grants or checkpoints',
    async () => {
      const staleRevision = current.revision;
      await save(
        owner,
        project,
        current.revision,
        'QA newer owner save',
        current.data,
      );
      current = await read(owner, project);
      const history = await versions(project);
      await save(
        editor,
        project,
        staleRevision,
        'QA rejected stale draft',
        {
          ...current.data,
          tracks: [
            ...current.data.tracks,
            track(staleFile, 'Rejected stale source'),
          ],
        },
        409,
      );
      await projectCount(staleFile, 0);
      await fileAccess(owner, staleFile, 404);
      await fileAccess(listener, staleFile, 404);
      equal(
        (await versions(project)).length,
        history.length,
        'Stale save leaves no checkpoint',
      );
      equal(
        (await read(owner, project)).title,
        'QA newer owner save',
        'Stale save cannot overwrite current data',
      );

      const raceFiles = await Promise.all([
        upload(editor, 'qa-race-source-a'),
        upload(editor, 'qa-race-source-b'),
      ]);
      const raceTitles = ['QA competing edit A', 'QA competing edit B'];
      const responses = await Promise.all(
        raceFiles.map((file, i) =>
          request(editor, '/api/action', {
            action: 'project',
            id: project,
            baseRevision: current.revision,
            title: raceTitles[i],
            data: {
              ...current.data,
              tracks: [...current.data.tracks, track(file, 'Race source ' + i)],
            },
          }),
        ),
      );
      equal(
        responses.map((r) => r.status).sort(),
        [200, 409],
        'Exactly one equal-revision save succeeds',
      );
      const winner = responses.findIndex((r) => r.status === 200),
        loser = 1 - winner;
      await projectCount(raceFiles[winner], 1);
      await projectCount(raceFiles[loser], 0);
      await fileAccess(owner, raceFiles[winner]);
      await fileAccess(listener, raceFiles[loser], 404);
      await fileAccess(owner, raceFiles[loser], 404);
      const after = await versions(project);
      equal(
        after.length,
        history.length + 1,
        'Competing save creates only winner checkpoint',
      );
      check(
        after.some((v) => v.title === raceTitles[winner]),
        'Winner checkpoint exists',
      );
      check(
        !after.some((v) => v.title === raceTitles[loser]),
        'Losing checkpoint is absent',
      );
      current = await read(owner, project);
      equal(
        current.title,
        raceTitles[winner],
        'Saved arrangement matches the winner',
      );
    },
  );

  await section(
    'Revocation preserves accepted source grants without edit authority',
    async () => {
      const rev = current.revision;
      await grant(room, project, editor, false);
      await permission(editor, project, false, rev);
      await permission(editor, project, false, rev);
      await noGrant(room, project);
      await save(
        editor,
        project,
        rev,
        'QA revoked editor attempt',
        current.data,
        403,
      );
      await fileAccess(editor, ownerFile); // Current room membership still grants listening.
      await fileAccess(owner, editorFile); // Accepted sources survive editor-role revocation.
      await save(
        owner,
        project,
        rev,
        'QA remove source from latest mix',
        baseData,
      );
      current = await read(owner, project);
      await fileAccess(owner, editorFile); // Project history still references the accepted source.
      await fileAccess(listener, editorFile);
      await projectCount(editorFile, 1);
    },
  );

  await section(
    'Detach and reattach require fresh editing consent',
    async () => {
      await grant(room, project);
      await attach(room, project, null);
      await read(editor, project, 403);
      await fileAccess(editor, ownerFile, 404);
      await fileAccess(editor, editorFile); // Their own original is not deleted.
      await noGrant(room, project);
      const detached = await roomState(owner, room);
      equal(detached.editors, [], 'Detached room has no editor list');
      await attach(room, null, project);
      await permission(editor, project, false, current.revision);
      await save(
        editor,
        project,
        current.revision,
        'QA old detached grant',
        current.data,
        403,
      );
    },
  );

  await section(
    'Leaving, removal and rejoining never resurrect old grants',
    async () => {
      await grant(room, project);
      await action(editor, { action: 'leaveRoom', id: room });
      await read(editor, project, 403);
      await noGrant(room, project);
      await join(room);
      await permission(editor, project, false, current.revision);
      await grant(room, project);
      await action(owner, { action: 'removeMember', id: room, user: editor });
      await read(editor, project, 403);
      await fileAccess(editor, ownerFile, 404);
      await noGrant(room, project);
      await join(room); // Fetches the newly rotated invitation from the owner.
      await permission(editor, project, false, current.revision);
      await permission(listener, project, false, current.revision);
    },
  );

  await section(
    'Grants are room-scoped and closing a room removes them',
    async () => {
      const secondRoom = await createRoom(project, 'second');
      await join(secondRoom);
      await grant(secondRoom, project);
      await grant(room, project);
      await attach(room, project, null);
      await noGrant(room, project);
      await permission(editor, project, true, current.revision); // Second room still authorizes editing.
      await action(owner, { action: 'closeRoom', id: secondRoom });
      rooms.delete(secondRoom);
      await roomState(editor, secondRoom, 403);
      await noGrant(secondRoom, project);
      await read(editor, project, 403);
      await save(
        editor,
        project,
        current.revision,
        'QA closed room grant',
        current.data,
        403,
      );
      await attach(room, null, project);
      await permission(editor, project, false, current.revision);
    },
  );

  await section(
    'Project deletion clears grants and history but preserves uploader ownership',
    async () => {
      await grant(room, project);
      await action(owner, { action: 'deleteProject', id: project });
      projects.delete(project);
      const remainingRoom = await roomState(owner, room);
      equal(
        remainingRoom.room.project,
        null,
        'Deleted project is detached from room',
      );
      equal(
        remainingRoom.editors,
        [],
        'Deleted project leaves no room editors',
      );
      await noGrant(room, project);
      await read(editor, project, 403);
      await read(owner, project, 403);
      await versions(project, 404);
      const exported = await exportData(owner);
      check(
        !exported.projects.some((p) => p.id === project),
        'Deleted project absent from owner export',
      );
      check(
        !exported.versions.some((v) => v.project === project),
        'Deleted project history absent from owner export',
      );
      const editorExport = await exportData(editor);
      check(
        !editorExport.versions.some((v) => v.project === project),
        'Editor export still excludes deleted foreign snapshots',
      );
      await projectCount(editorFile, 0);
      await fileAccess(editor, editorFile);
      await fileAccess(owner, editorFile, 404);
      await fileAccess(listener, editorFile, 404);
    },
  );
} catch (error) {
  failure = error;
  console.error('FAIL collaboration API checks:', error.stack || error);
} finally {
  // Cleanup is restricted to IDs returned for this script's synthetic fixtures.
  for (const id of rooms) {
    try {
      await action(owner, { action: 'closeRoom', id });
    } catch (error) {
      console.error('Cleanup room failed:', id, error.message);
      failure ||= error;
    }
  }
  for (const id of projects) {
    try {
      await action(owner, { action: 'deleteProject', id });
    } catch (error) {
      console.error('Cleanup project failed:', id, error.message);
      failure ||= error;
    }
  }
  for (const file of files) {
    try {
      await action(file.user, {
        action: 'eraseFile',
        id: file.id,
        confirm: 'ERASE',
      });
    } catch (error) {
      console.error('Cleanup upload failed:', file.id, error.message);
      failure ||= error;
    }
  }
}
if (failure) process.exitCode = 1;
else
  console.log(
    `PASS ${assertions} assertions across ${requests} local API requests; synthetic rooms, projects and uploads cleaned up.`,
  );
