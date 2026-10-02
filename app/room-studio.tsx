'use client';
import { useState } from 'react';
import { ArrowUpRight, Music2, Plus } from 'lucide-react';
import { action, Pick } from './helpers';
import { Switch } from '@/components/ui/switch';

export default function RoomStudio({
  room,
  projectInfo,
  userId,
  projects,
  members,
  editors,
  onChanged,
  notify,
  onOpen,
  opened,
  opening,
  available,
}: {
  room: { id: string; owner: string; project: string | null };
  projectInfo: { title: string } | null;
  userId: string;
  projects: { id: string; title: string }[];
  members: { user: string; name: string }[];
  editors: string[];
  onChanged: () => unknown;
  notify: (message: string) => void;
  onOpen: () => void;
  opened: boolean;
  opening: boolean;
  available: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false);
  const host = room.owner === userId;
  async function allowEditing(user: string, editable: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await action({
        action: 'roomEditor',
        id: room.id,
        project: room.project,
        user,
        editable,
      });
      notify(
        editable
          ? 'Editing enabled for this room project.'
          : 'Editing access removed.',
      );
      await onChanged();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
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
            <button
              className="button primary"
              onClick={onOpen}
              disabled={!available || opening}
            >
              {opening
                ? 'Opening studio…'
                : opened
                  ? 'Go to room studio'
                  : 'Open room studio'}{' '}
              <Music2 size={16} />
            </button>
          )}
          <a
            className="button secondary"
            href="/app?view=Studio"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open personal studio <ArrowUpRight size={16} />
          </a>
          {host && room.project && (
            <button
              className="button secondary"
              onClick={() => setEditing(!editing)}
              disabled={busy || !available}
            >
              {editing ? 'Cancel' : 'Change room project'}
            </button>
          )}
        </div>
      </div>
      <p className="room-studio-note">
        Open the room studio here to keep your call and music together. Use
        Share studio audio to let the room hear your arrangement and backing
        tracks.
        {room.project &&
          ' Room members can open the project. Saved changes arrive automatically when studio playback or recording stops.'}
        {!room.project &&
          !host &&
          ' The host can create or attach the room’s shared project.'}
      </p>
      {room.project && (
        <div className="room-editor-access">
          <h3>
            {host
              ? 'Who can edit this project'
              : editors.includes(userId)
                ? 'You can edit this project'
                : 'You have listening access'}
          </h3>
          <p className="room-studio-note">
            {host
              ? 'Allow trusted room members to save arrangements and add audio. New audio becomes available to members of every room connected to this project. Editing access ends when they leave this room or you change its project.'
              : 'The project owner controls editing access. Members with editing access can save changes and add recordings.'}
          </p>
          {host &&
            members
              .filter((member) => member.user !== room.owner)
              .map((member) => (
                <label className="room-editor-row" key={member.user}>
                  <span>{member.name}</span>
                  <span className="inline-switch">
                    <Switch
                      checked={editors.includes(member.user)}
                      disabled={busy || !available}
                      onCheckedChange={(value) =>
                        allowEditing(member.user, value)
                      }
                      aria-label={'Allow editing for ' + member.name}
                    />{' '}
                    Allow editing
                  </span>
                </label>
              ))}
          {host && members.length < 2 && (
            <p className="room-studio-note">
              Editing controls appear here when another member enters the room.
            </p>
          )}
        </div>
      )}
      {host && available && (editing || !room.project) && (
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
