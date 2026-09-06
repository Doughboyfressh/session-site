'use client';
import { useState } from 'react';
import { ArrowUpRight, Music2, Plus } from 'lucide-react';
import { action, Pick } from './helpers';

export default function RoomStudio({
  room,
  projectInfo,
  userId,
  projects,
  onChanged,
  notify,
}: {
  room: { id: string; owner: string; project: string | null };
  projectInfo: { title: string } | null;
  userId: string;
  projects: { id: string; title: string }[];
  onChanged: () => unknown;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false);
  const host = room.owner === userId;
  async function update(mode: 'create' | 'attach' | 'detach') {
    if (busy) return;
    setBusy(true);
    try {
      await action({
        action: 'roomProject',
        id: room.id,
        mode,
        expectedProject: room.project,
        project: selected,
      });
      setEditing(false);
      setSelected('');
      notify(
        mode === 'detach'
          ? 'Project removed from the room. The owner’s saved project is kept.'
          : 'Room studio ready. Open it below; your call stays in this tab.',
      );
      await onChanged();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="room-studio" aria-label="Room studio">
      <div className="room-studio-heading">
        <Music2 size={24} />
        <div>
          <h2>Room studio</h2>
          <p>
            {room.project
              ? projectInfo?.title || 'Shared studio project'
              : 'Connect a project to this session.'}
          </p>
        </div>
        <div className="actions">
          {room.project && (
            <a
              className="button primary"
              href={'/?project=' + encodeURIComponent(room.project)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open room studio <ArrowUpRight size={16} />
            </a>
          )}
          <a
            className="button secondary"
            href="/?view=Studio"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open personal studio <ArrowUpRight size={16} />
          </a>
          {host && room.project && (
            <button
              className="button secondary"
              onClick={() => setEditing(!editing)}
              disabled={busy}
            >
              {editing ? 'Cancel' : 'Change room project'}
            </button>
          )}
        </div>
      </div>
      <p className="room-studio-note">
        The studio opens in a new tab. Keep this room tab open for your call.{' '}
        Use Share screen &amp; audio and select the studio tab with tab audio
        enabled so everyone can hear your work.
        {room.project &&
          ' Room members can open the project; only its owner can save changes. Reopen it to load the latest save.'}
        {!room.project &&
          !host &&
          ' The host can create or attach the room’s shared project.'}
      </p>
      {host && (editing || !room.project) && (
        <div className="room-studio-setup">
          {!room.project && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => update('create')}
            >
              <Plus size={16} /> {busy ? 'Updating…' : 'Create room project'}
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update('attach');
            }}
          >
            <Pick
              label="Choose one of your saved projects"
              value={selected}
              onChange={setSelected}
              options={[
                { value: '', label: 'Select a project' },
                ...projects.map((p) => ({ value: p.id, label: p.title })),
              ]}
            />
            <p className="room-studio-note">
              Sharing a project gives everyone in this private room access to
              its saved arrangement and private audio files.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                disabled={busy || !selected || selected === room.project}
              >
                {busy ? 'Updating…' : 'Share project with room'}
              </button>
              {room.project && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => update('detach')}
                >
                  Remove project from room
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
