'use client';
import './room-invitations.css';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Clock3,
  Handshake,
  Inbox,
  MessageCircle,
  Send,
  ShieldOff,
  UserPlus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { action, Avatar, Pick } from './helpers';

type ActivityItem = {
  id: string;
  kind: string;
  actorName: string;
  actorAvatar?: string | null;
  body: string;
  resourceType: string;
  resourceId: string;
  created: number;
  readAt?: number | null;
  inviteStatus?:
    | 'pending'
    | 'joined'
    | 'declined'
    | 'expired'
    | 'unavailable'
    | 'full';
  inviteExpires?: number | null;
};

type Collaboration = {
  id: string;
  sender: string;
  recipient: string;
  senderName: string;
  senderUsername: string;
  senderAvatar?: string | null;
  recipientName: string;
  recipientUsername: string;
  recipientAvatar?: string | null;
  track?: string | null;
  trackTitle?: string | null;
  role: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'closed';
  created: number;
  updated: number;
  lastMessage?: string | null;
  lastMessageAt?: number | null;
};

type DirectMessage = {
  id: string;
  sender: string;
  senderName: string;
  body: string;
  created: number;
};

type ActivityResponse = { items: ActivityItem[]; unread: number };
type InboxResponse = {
  requests: Collaboration[];
  blocks: BlockedMember[];
};
type ThreadResponse = { messages: DirectMessage[] };

type BlockedMember = {
  target: string;
  name: string;
  username: string;
  avatar?: string | null;
  created: number;
};

export type CollaborationTarget = {
  id: string;
  name: string;
  username?: string;
  roles?: string | string[];
  avatar?: string | null;
};

async function socialFetch<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  const raw: unknown = await response.json();
  const payload =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof payload.error === 'string'
          ? payload.error
          : 'SESSION could not load this connection.',
      ),
      { status: response.status },
    );
  return payload as T;
}

async function socialAction(body: Record<string, unknown>) {
  return socialFetch('/api/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function when(value: number) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'SESSION could not complete this request.';
}

function isAbortError(cause: unknown) {
  return cause instanceof Error && cause.name === 'AbortError';
}

function activityIcon(kind: string) {
  if (kind === 'follow') return UserPlus;
  if (kind === 'comment' || kind === 'message') return MessageCircle;
  return Handshake;
}

export function ActivityView({
  onOpen,
  onUnreadChange,
}: {
  onOpen: (item: ActivityItem) => void;
  onUnreadChange: (count: number) => void;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joiningInvite, setJoiningInvite] = useState('');
  const inviteBusy = useRef(false);
  const activityRequest = useRef(0);
  const activityController = useRef<AbortController | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++activityRequest.current;
      try {
        const data = await socialFetch<ActivityResponse>(
          '/api/social?view=activity',
          { signal },
        );
        if (signal?.aborted || request !== activityRequest.current) return;
        setItems(data.items);
        setError('');
        onUnreadChange(data.unread);
      } catch (cause: unknown) {
        if (!isAbortError(cause) && request === activityRequest.current)
          setError(errorMessage(cause));
      } finally {
        if (request === activityRequest.current) setLoading(false);
      }
    },
    [onUnreadChange],
  );

  useEffect(() => {
    const controller = new AbortController();
    activityController.current = controller;
    void Promise.resolve().then(() => load(controller.signal));
    const timer = setInterval(() => void load(controller.signal), 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [load]);

  async function markRead(id?: string) {
    try {
      await socialAction({ action: 'notificationRead', id });
      setItems((current) =>
        current.map((item) =>
          !id || item.id === id ? { ...item, readAt: Date.now() } : item,
        ),
      );
      const remaining = id
        ? items.filter((item) => !item.readAt && item.id !== id).length
        : 0;
      onUnreadChange(remaining);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  }

  async function respondInvite(
    item: ActivityItem,
    response: 'accepted' | 'declined',
  ) {
    if (inviteBusy.current) return;
    inviteBusy.current = true;
    setJoiningInvite(item.id);
    setError('');
    try {
      const signal = activityController.current?.signal;
      const result = await action(
        { action: 'respondRoomInvite', id: item.id, response },
        { signal },
      );
      await load(signal);
      if (!signal?.aborted && response === 'accepted')
        onOpen({ ...item, resourceType: 'room', resourceId: result.id });
    } catch (cause) {
      if (!isAbortError(cause)) setError(errorMessage(cause));
    } finally {
      inviteBusy.current = false;
      setJoiningInvite('');
    }
  }

  if (loading) return <p className="social-loading">Loading activity…</p>;
  return (
    <section className="social-panel" aria-labelledby="activity-title">
      <div className="social-panel-heading">
        <div>
          <span className="eyebrow">WHAT’S HAPPENING</span>
          <h2 id="activity-title">Activity</h2>
        </div>
        {items.some((item) => !item.readAt) && (
          <button className="button secondary" onClick={() => markRead()}>
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error} <button onClick={() => load()}>Try again</button>
        </div>
      )}
      {items.length ? (
        <div className="activity-list">
          {items.map((item) => {
            const Icon = activityIcon(item.kind);
            return (
              <article
                className={'activity-item' + (!item.readAt ? ' unread' : '')}
                key={item.id}
              >
                <span className="activity-icon">
                  <Icon size={18} />
                </span>
                <Avatar
                  profile={{ name: item.actorName, avatar: item.actorAvatar }}
                  size={42}
                />
                {item.resourceType === 'room_invite' ? (
                  <div className="activity-copy">
                    <strong>{item.actorName}</strong> {item.body}
                    <small>{when(item.created)}</small>
                    <div className="actions room-invite-actions">
                      {item.inviteStatus === 'joined' ? (
                        <button
                          className="button secondary"
                          onClick={() => {
                            void markRead(item.id);
                            onOpen({ ...item, resourceType: 'room' });
                          }}
                        >
                          Open session
                        </button>
                      ) : item.inviteStatus === 'pending' ||
                        item.inviteStatus === 'full' ? (
                        <>
                          <button
                            className="button primary"
                            disabled={
                              !!joiningInvite || item.inviteStatus === 'full'
                            }
                            onClick={() => void respondInvite(item, 'accepted')}
                          >
                            {joiningInvite === item.id
                              ? 'Working…'
                              : item.inviteStatus === 'full'
                                ? 'Session full'
                                : 'Join session'}
                          </button>
                          <button
                            className="button secondary"
                            disabled={!!joiningInvite}
                            onClick={() => void respondInvite(item, 'declined')}
                          >
                            Decline
                          </button>
                          {item.inviteExpires && (
                            <small>Expires {when(item.inviteExpires)}</small>
                          )}
                        </>
                      ) : (
                        <small>
                          {item.inviteStatus === 'declined'
                            ? 'Invitation declined'
                            : item.inviteStatus === 'expired'
                              ? 'Invitation expired or replaced'
                              : 'Session unavailable'}
                        </small>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    className="activity-copy"
                    onClick={() => {
                      if (!item.readAt) void markRead(item.id);
                      onOpen(item);
                    }}
                  >
                    <strong>{item.actorName}</strong> {item.body}
                    <small>{when(item.created)}</small>
                  </button>
                )}
                {!item.readAt && (
                  <button
                    className="activity-read"
                    aria-label="Mark activity read"
                    onClick={() => markRead(item.id)}
                  >
                    <Check size={15} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="social-empty">
          <Bell size={32} />
          <h3>Your activity starts with a connection.</h3>
          <p>Follows, comments, requests, and messages will appear here.</p>
        </div>
      )}
    </section>
  );
}

export function CollaborationInbox({
  userId,
  notify,
  onChanged,
}: {
  userId: string;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [requests, setRequests] = useState<Collaboration[]>([]);
  const [blocks, setBlocks] = useState<BlockedMember[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [threads, setThreads] = useState<Record<string, DirectMessage[]>>({});
  const [folder, setFolder] = useState<'incoming' | 'sent'>('incoming');
  const [drafts, setDrafts] = useState<
    Record<string, { message: string; clientId: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const visible = useMemo(
    () =>
      requests.filter((request) =>
        folder === 'incoming'
          ? request.recipient === userId
          : request.sender === userId,
      ),
    [folder, requests, userId],
  );
  const selected = requests.find((request) => request.id === selectedId);
  const messages = threads[selectedId] || [];
  const draft = drafts[selectedId] || { message: '', clientId: '' };

  async function loadInbox(signal?: AbortSignal) {
    try {
      const data = await socialFetch<InboxResponse>('/api/social?view=inbox', {
        signal,
      });
      setRequests(data.requests);
      setBlocks(data.blocks || []);
      setSelectedId((current) =>
        data.requests.some((request: Collaboration) => request.id === current)
          ? current
          : data.requests.find(
              (request: Collaboration) => request.recipient === userId,
            )?.id ||
            data.requests[0]?.id ||
            '',
      );
      setError('');
    } catch (cause: unknown) {
      if (!isAbortError(cause)) setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function loadThread(id: string, signal?: AbortSignal) {
    try {
      const data = await socialFetch<ThreadResponse>(
        '/api/social?view=thread&id=' + encodeURIComponent(id),
        { signal },
      );
      setThreads((current) => ({ ...current, [id]: data.messages }));
    } catch (cause: unknown) {
      if (!isAbortError(cause)) setError(errorMessage(cause));
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void socialFetch<InboxResponse>('/api/social?view=inbox', {
      signal: controller.signal,
    })
      .then((data) => {
        setRequests(data.requests);
        setBlocks(data.blocks || []);
        setSelectedId(
          data.requests.find((request) => request.recipient === userId)?.id ||
            data.requests[0]?.id ||
            '',
        );
        setError('');
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(errorMessage(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void socialFetch<ThreadResponse>(
      '/api/social?view=thread&id=' + encodeURIComponent(selectedId),
      { signal: controller.signal },
    )
      .then((data) =>
        setThreads((current) => ({
          ...current,
          [selectedId]: data.messages,
        })),
      )
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [selectedId]);

  async function changeStatus(status: 'accepted' | 'declined' | 'closed') {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await socialAction({
        action: 'collaborationStatus',
        id: selected.id,
        status,
      });
      await loadInbox();
      onChanged();
      notify(
        status === 'accepted'
          ? 'Request accepted. Your private conversation is open.'
          : status === 'declined'
            ? 'Request declined.'
            : 'Conversation closed.',
      );
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft.message.trim() || !draft.clientId || busy) return;
    const requestId = selected.id;
    const outgoing = draft;
    setBusy(true);
    try {
      await socialAction({
        action: 'message',
        id: requestId,
        message: outgoing.message,
        clientId: outgoing.clientId,
      });
      setDrafts((current) => {
        if (current[requestId]?.clientId !== outgoing.clientId) return current;
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await Promise.all([loadThread(requestId), loadInbox()]);
      onChanged();
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function blockMember() {
    if (!selected || busy) return;
    const target =
      selected.sender === userId ? selected.recipient : selected.sender;
    if (!window.confirm('Block this member and close active conversations?'))
      return;
    setBusy(true);
    try {
      await socialAction({ action: 'block', target, value: true });
      await loadInbox();
      onChanged();
      notify('Member blocked. They cannot send you new requests or messages.');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function unblockMember(target: string) {
    if (busy) return;
    setBusy(true);
    try {
      await socialAction({ action: 'block', target, value: false });
      await loadInbox();
      notify('Member unblocked. New requests are available again.');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="social-loading">Loading collaborations…</p>;
  return (
    <section className="social-panel" aria-labelledby="collaboration-title">
      <div className="social-panel-heading">
        <div>
          <span className="eyebrow">PRIVATE WORKING CONNECTIONS</span>
          <h2 id="collaboration-title">Collaborations</h2>
        </div>
        <div className="social-folders" aria-label="Collaboration folders">
          <button
            className={folder === 'incoming' ? 'active' : ''}
            onClick={() => {
              setFolder('incoming');
              setSelectedId(
                requests.find((request) => request.recipient === userId)?.id ||
                  '',
              );
            }}
          >
            <Inbox size={15} /> Incoming
          </button>
          <button
            className={folder === 'sent' ? 'active' : ''}
            onClick={() => {
              setFolder('sent');
              setSelectedId(
                requests.find((request) => request.sender === userId)?.id || '',
              );
            }}
          >
            <Send size={15} /> Sent
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error} <button onClick={() => loadInbox()}>Try again</button>
        </div>
      )}
      {requests.length ? (
        <div className="collaboration-layout">
          <div className="request-list" aria-label={`${folder} requests`}>
            {visible.map((request) => {
              const incoming = request.recipient === userId;
              const person = incoming
                ? request.senderName
                : request.recipientName;
              return (
                <button
                  className={
                    'request-card' +
                    (request.id === selectedId ? ' selected' : '')
                  }
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                >
                  <span className={`request-status ${request.status}`}>
                    {request.status}
                  </span>
                  <strong>{person}</strong>
                  <span>
                    {request.trackTitle || 'Creator connection'} ·{' '}
                    {request.role}
                  </span>
                  <small>
                    {request.lastMessage || request.message} ·{' '}
                    {when(request.lastMessageAt || request.updated)}
                  </small>
                </button>
              );
            })}
            {!visible.length && (
              <div className="request-list-empty">
                No {folder} requests yet.
              </div>
            )}
            {!!blocks.length && (
              <div className="blocked-members">
                <span>Blocked members</span>
                {blocks.map((member) => (
                  <div key={member.target}>
                    <span>
                      <strong>{member.name}</strong>
                      <small>@{member.username}</small>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => unblockMember(member.target)}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="conversation-panel">
            {selected ? (
              <>
                <div className="conversation-heading">
                  <div>
                    <span className={`request-status ${selected.status}`}>
                      {selected.status}
                    </span>
                    <h3>
                      {selected.sender === userId
                        ? selected.recipientName
                        : selected.senderName}
                    </h3>
                    <p>
                      {selected.trackTitle || 'Direct creator request'} ·{' '}
                      {selected.role}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Block member"
                    title="Block member"
                    disabled={busy}
                    onClick={blockMember}
                  >
                    <ShieldOff size={17} />
                  </button>
                </div>
                <div className="request-intro">
                  <span>Request note</span>
                  <p>{selected.message}</p>
                </div>
                {selected.status === 'pending' &&
                  selected.recipient === userId && (
                    <div className="actions">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => changeStatus('accepted')}
                      >
                        Accept request
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => changeStatus('declined')}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                {selected.status === 'pending' &&
                  selected.sender === userId && (
                    <div className="conversation-state">
                      <p>
                        <Clock3 size={15} /> Waiting for a response
                      </p>
                      <button
                        className="button tertiary"
                        disabled={busy}
                        onClick={() => changeStatus('closed')}
                      >
                        Withdraw request
                      </button>
                    </div>
                  )}
                {selected.status === 'accepted' && (
                  <>
                    <div className="direct-messages" aria-live="polite">
                      {messages.map((message) => (
                        <div
                          className={message.sender === userId ? 'mine' : ''}
                          key={message.id}
                        >
                          <strong>{message.senderName}</strong>
                          <p>{message.body}</p>
                          <small>{when(message.created)}</small>
                        </div>
                      ))}
                      {!messages.length && (
                        <p className="conversation-state">
                          The request is accepted. Send the first message.
                        </p>
                      )}
                    </div>
                    <form className="direct-compose" onSubmit={sendMessage}>
                      <label htmlFor="collaboration-message">Message</label>
                      <textarea
                        id="collaboration-message"
                        value={draft.message}
                        maxLength={2000}
                        rows={3}
                        disabled={busy}
                        placeholder="Share the next step, schedule, or creative direction…"
                        onChange={(event) => {
                          const message = event.target.value;
                          setDrafts((current) => ({
                            ...current,
                            [selectedId]: {
                              message,
                              clientId: crypto.randomUUID(),
                            },
                          }));
                        }}
                      />
                      <div className="actions">
                        <button
                          className="button primary"
                          disabled={
                            busy || !draft.message.trim() || !draft.clientId
                          }
                        >
                          <Send size={15} /> Send privately
                        </button>
                        <button
                          className="button tertiary"
                          type="button"
                          disabled={busy}
                          onClick={() => changeStatus('closed')}
                        >
                          Close conversation
                        </button>
                      </div>
                    </form>
                  </>
                )}
                {['declined', 'closed'].includes(selected.status) && (
                  <p className="conversation-state">
                    This conversation is {selected.status}. Its history remains
                    private to both participants.
                  </p>
                )}
              </>
            ) : (
              <div className="social-empty">
                <Handshake size={32} />
                <h3>Select a request.</h3>
                <p>Its context and private conversation will appear here.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="social-empty">
          <Handshake size={32} />
          <h3>Make the first move.</h3>
          <p>
            Open a public creator profile or collaboration-ready track to send a
            focused request.
          </p>
        </div>
      )}
    </section>
  );
}

export function CollaborationRequestDialog({
  open,
  target,
  track,
  onOpenChange,
  onSent,
  notify,
}: {
  open: boolean;
  target: CollaborationTarget | null;
  track?: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
  notify: (message: string) => void;
}) {
  const targetRoles = useMemo(() => {
    if (!target?.roles)
      return ['Artist', 'Producer', 'Engineer', 'Videographer'];
    if (Array.isArray(target.roles)) return target.roles;
    try {
      const parsed: unknown = JSON.parse(target.roles);
      const allowed = ['Artist', 'Producer', 'Engineer', 'Videographer'];
      return Array.isArray(parsed)
        ? parsed.filter(
            (value): value is string =>
              typeof value === 'string' && allowed.includes(value),
          )
        : allowed;
    } catch {
      return ['Artist', 'Producer', 'Engineer', 'Videographer'];
    }
  }, [target]);
  const [role, setRole] = useState(targetRoles[0] || 'Artist');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="form-dialog collaboration-request-dialog">
        <DialogTitle>Start a focused collaboration.</DialogTitle>
        <DialogDescription>
          {target
            ? `Invite ${target.name}${track ? ` to work on “${track.title}”` : ''}. They choose whether to open a private conversation.`
            : 'Choose a SESSION creator first.'}
        </DialogDescription>
        {target && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await socialAction({
                  action: 'collaborationRequest',
                  recipient: target.id,
                  track: track?.id || null,
                  role,
                  message,
                });
                notify('Collaboration request sent privately.');
                onOpenChange(false);
                onSent();
              } catch (cause: unknown) {
                setError(errorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="request-person">
              <Avatar profile={target} size={48} />
              <div>
                <strong>{target.name}</strong>
                <small>@{target.username || 'member'}</small>
              </div>
            </div>
            <Pick
              label="Invite them as"
              value={role}
              onChange={setRole}
              options={
                targetRoles.length
                  ? targetRoles
                  : ['Artist', 'Producer', 'Engineer', 'Videographer']
              }
            />
            <label className="field">
              <span>Request note</span>
              <textarea
                required
                minLength={10}
                maxLength={1200}
                rows={5}
                value={message}
                placeholder="Describe the sound, the contribution you need, and the next step."
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <p className="small-note">
              This note is private to the recipient. Free messaging opens only
              after they accept.
            </p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <button
              className="button primary wide"
              disabled={busy || message.trim().length < 10}
            >
              {busy ? 'Sending request…' : 'Send private request'}
              <Send size={16} />
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
