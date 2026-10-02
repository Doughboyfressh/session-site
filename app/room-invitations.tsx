'use client';
import './room-invitations.css';
import { useEffect, useRef, useState } from 'react';
import { Check, Search, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { action, Avatar } from './helpers';

type Candidate = {
  id: string;
  name: string;
  username: string;
  avatar?: string | null;
  inviteStatus: 'pending' | 'declined' | null;
};
type Candidates = { profiles: Candidate[]; expires: number; expired: boolean };

export default function RoomInvitations({
  roomId,
  memberCount,
  onClose,
  notify,
}: {
  roomId: string;
  memberCount: number;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Candidates | null>(null);
  const [settledSearch, setSettledSearch] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState('');
  const [version, setVersion] = useState(0);
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  const searchKey = JSON.stringify([query, version]);
  const loading = settledSearch !== searchKey;
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    const search = new AbortController();
    const timer = setTimeout(() => {
      setError('');
      action(
        { action: 'roomInviteCandidates', id: roomId, query },
        { signal: search.signal },
      )
        .then((result: Candidates) => {
          if (!search.signal.aborted) setData(result);
        })
        .catch((cause: Error) => {
          if (!search.signal.aborted) setError(cause.message);
        })
        .finally(() => {
          if (!search.signal.aborted)
            setSettledSearch(JSON.stringify([query, version]));
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      search.abort();
    };
  }, [roomId, query, version]);

  async function send(candidate?: Candidate) {
    if (busy.current) return;
    busy.current = true;
    setSending(candidate?.id || 'refresh');
    setError('');
    try {
      await action(
        candidate
          ? { action: 'inviteRoom', id: roomId, recipient: candidate.id }
          : { action: 'rotateInvite', id: roomId },
        { signal: controller.current.signal },
      );
      if (controller.current.signal.aborted) return;
      if (candidate) {
        setData(
          (current) =>
            current && {
              ...current,
              profiles: current.profiles.map((profile) =>
                profile.id === candidate.id
                  ? { ...profile, inviteStatus: 'pending' }
                  : profile,
              ),
            },
        );
        notify(
          `Invitation sent to ${candidate.name}. They can join from Alerts.`,
        );
      } else {
        setVersion((value) => value + 1);
        notify('Invitations refreshed. Earlier invitations no longer work.');
      }
    } catch (cause) {
      if (!controller.current.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not send this invitation. Try again.',
        );
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setSending('');
    }
  }
  const expired = !!data?.expired;
  const full = memberCount >= 4;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="form-dialog room-invitation-dialog">
        <DialogTitle>Invite people to this session</DialogTitle>
        <DialogDescription>
          Choose a SESSION member. Their invitation appears in Alerts, where
          they can accept and join.
        </DialogDescription>
        <p className="subtle">
          {memberCount}/4 seats occupied{full ? ' · This session is full.' : ''}
        </p>
        {expired && (
          <div className="room-invite-expired">
            <p>
              Invitations expired. Refresh them to send a new one. Earlier
              invitations will stop working.
            </p>
            <button
              className="button secondary"
              disabled={!!sending}
              onClick={() => void send()}
            >
              {sending === 'refresh' ? 'Refreshing…' : 'Refresh invitations'}
            </button>
          </div>
        )}
        <label className="field">
          <span>
            <Search size={14} /> Find a member
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            placeholder="Name or @username"
            autoComplete="off"
          />
        </label>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setVersion((value) => value + 1)}>
              Refresh list
            </button>
          </div>
        )}
        {loading ? (
          <output>Finding members…</output>
        ) : error ? null : !data?.profiles.length ? (
          <p className="subtle">
            No matching members. Search a public SESSION profile by name or
            @username.
          </p>
        ) : (
          <ul
            className="room-invite-results"
            aria-label="Members you can invite"
          >
            {data?.profiles.map((candidate) => (
              <li key={candidate.id}>
                <Avatar profile={candidate} size={38} />
                <div>
                  <strong>{candidate.name}</strong>
                  <small>@{candidate.username}</small>
                </div>
                <button
                  className="button secondary"
                  disabled={
                    !!sending || expired || full || !!candidate.inviteStatus
                  }
                  aria-label={`${candidate.inviteStatus === 'pending' ? 'Invitation sent to' : candidate.inviteStatus === 'declined' ? 'Invitation declined by' : 'Invite'} ${candidate.name}`}
                  onClick={() => void send(candidate)}
                >
                  {candidate.inviteStatus === 'pending' ? (
                    <>
                      <Check size={14} /> Invite sent
                    </>
                  ) : candidate.inviteStatus === 'declined' ? (
                    'Declined'
                  ) : sending === candidate.id ? (
                    'Sending…'
                  ) : (
                    <>
                      <UserPlus size={14} /> Invite
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
