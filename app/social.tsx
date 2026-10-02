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
type ThreadResponse = { request: Collaboration; messages: DirectMessage[] };

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

async function socialAction(
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return socialFetch('/api/social', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
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

function authorizedThread(data: ThreadResponse, id: string, userId: string) {
  const request = data.request;
  if (
    request?.id !== id ||
    (request.sender !== userId && request.recipient !== userId)
  )
    throw Object.assign(
      new Error('This collaboration is no longer available.'),
      { status: 404 },
    );
  const last = data.messages.at(-1);
  return last
    ? { ...request, lastMessage: last.body, lastMessageAt: last.created }
    : request;
}

function mergeCollaboration(
  previous: Collaboration | null,
  next: Collaboration,
) {
  if (previous?.id !== next.id) return next;
  const metadata =
    Number(previous.updated) > Number(next.updated) ? previous : next;
  const preview =
    Number(previous.lastMessageAt || 0) > Number(next.lastMessageAt || 0)
      ? previous
      : next;
  return {
    ...metadata,
    lastMessage: preview.lastMessage,
    lastMessageAt: preview.lastMessageAt,
  };
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
  ...props
}: {
  userId: string;
  requestedCollaborationId?: string;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  return <CollaborationInboxContent key={userId} userId={userId} {...props} />;
}

function CollaborationInboxContent({
  userId,
  requestedCollaborationId,
  notify,
  onChanged,
}: {
  userId: string;
  requestedCollaborationId?: string;
  notify: (message: string) => void;
  onChanged: () => void;
}) {
  const [requests, setRequests] = useState<Collaboration[]>([]);
  const [hydratedRequest, setHydratedRequest] = useState<Collaboration | null>(
    null,
  );
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
  const session = useRef<AbortController | null>(null);
  const inboxController = useRef<AbortController | null>(null);
  const threadController = useRef<AbortController | null>(null);
  const inboxVersion = useRef(0);
  const threadVersion = useRef(0);
  const busyRef = useRef(false);
  const selection = useRef({
    id: '',
    folder: 'incoming' as 'incoming' | 'sent',
    initialized: false,
  });
  const target = useRef(requestedCollaborationId);
  const pendingTarget = useRef(requestedCollaborationId);
  const targetError = useRef('');
  const retryTarget = useRef<string | undefined>(undefined);
  const retainedRequest = useRef<Collaboration | null>(null);
  const loadedTargetThread = useRef('');

  const availableRequests = useMemo(
    () =>
      hydratedRequest?.id === selectedId &&
      !requests.some((request) => request.id === selectedId)
        ? [...requests, hydratedRequest]
        : requests,
    [hydratedRequest, requests, selectedId],
  );

  const visible = useMemo(
    () =>
      availableRequests.filter((request) =>
        folder === 'incoming'
          ? request.recipient === userId
          : request.sender === userId,
      ),
    [availableRequests, folder, userId],
  );
  const selected = availableRequests.find(
    (request) => request.id === selectedId,
  );
  const messages = threads[selectedId] || [];
  const draft = drafts[selectedId] || { message: '', clientId: '' };

  const cancelThread = useCallback(() => {
    threadVersion.current++;
    threadController.current?.abort();
    threadController.current = null;
  }, []);

  const cancelReads = useCallback(() => {
    inboxVersion.current++;
    inboxController.current?.abort();
    inboxController.current = null;
    cancelThread();
  }, [cancelThread]);

  const loadInbox = useCallback(async () => {
    const scope = session.current;
    if (!scope || scope.signal.aborted) return;
    const version = ++inboxVersion.current;
    inboxController.current?.abort();
    const controller = new AbortController();
    inboxController.current = controller;
    const current = () =>
      session.current === scope &&
      !scope.signal.aborted &&
      !controller.signal.aborted &&
      version === inboxVersion.current;
    try {
      const data = await socialFetch<InboxResponse>('/api/social?view=inbox', {
        signal: controller.signal,
      });
      if (!current()) return;
      const authorized = data.requests.filter(
        (request) => request.sender === userId || request.recipient === userId,
      );
      const requestedId = pendingTarget.current;
      let requested = authorized.find((request) => request.id === requestedId);
      let targetThread: ThreadResponse | undefined;
      let lookupError = '';
      if (requestedId && !requested) {
        try {
          targetThread = await socialFetch<ThreadResponse>(
            '/api/social?view=thread&id=' + encodeURIComponent(requestedId),
            { signal: controller.signal },
          );
          requested = authorizedThread(targetThread, requestedId, userId);
        } catch (cause: unknown) {
          lookupError = errorMessage(cause);
        }
        if (!current()) return;
      }
      const previous = selection.current;
      let next = previous;
      if (requestedId && pendingTarget.current === requestedId) {
        next = {
          id: requested?.id || '',
          folder: requested?.sender === userId ? 'sent' : 'incoming',
          initialized: true,
        };
        targetError.current = requested
          ? ''
          : lookupError || 'This collaboration is no longer available.';
        retryTarget.current = requested ? undefined : requestedId;
        pendingTarget.current = undefined;
        if (requested && targetThread) {
          const requestId = requested.id;
          const targetMessages = targetThread.messages;
          setThreads((current) => ({
            ...current,
            [requestId]: targetMessages,
          }));
          if (next.id !== previous.id) loadedTargetThread.current = next.id;
        }
      } else if (!previous.initialized) {
        const first =
          authorized.find((request) => request.recipient === userId) ||
          authorized[0];
        next = {
          id: first?.id || '',
          folder: first?.sender === userId ? 'sent' : 'incoming',
          initialized: true,
        };
      } else if (
        previous.id &&
        !authorized.some((request) => request.id === previous.id) &&
        retainedRequest.current?.id !== previous.id
      ) {
        next = {
          ...previous,
          id:
            authorized.find((request) =>
              previous.folder === 'incoming'
                ? request.recipient === userId
                : request.sender === userId,
            )?.id || '',
        };
      }
      const nextRecord =
        authorized.find((request) => request.id === next.id) ||
        (requested?.id === next.id ? requested : null) ||
        (retainedRequest.current?.id === next.id
          ? retainedRequest.current
          : null);
      const nextRequest = nextRecord
        ? mergeCollaboration(retainedRequest.current, nextRecord)
        : null;
      retainedRequest.current = nextRequest;
      selection.current = next;
      if (next.id !== previous.id) cancelThread();
      setRequests(
        authorized.map((request) =>
          request.id === nextRequest?.id ? nextRequest : request,
        ),
      );
      setHydratedRequest(nextRequest);
      setBlocks(data.blocks || []);
      setSelectedId(next.id);
      setFolder(next.folder);
      setError(targetError.current);
    } catch (cause: unknown) {
      if (current() && !isAbortError(cause)) setError(errorMessage(cause));
    } finally {
      if (current()) setLoading(false);
      if (inboxController.current === controller)
        inboxController.current = null;
    }
  }, [cancelThread, userId]);

  const loadThread = useCallback(
    async (id: string) => {
      const scope = session.current;
      if (!id || !scope || scope.signal.aborted) return;
      const version = ++threadVersion.current;
      threadController.current?.abort();
      const controller = new AbortController();
      threadController.current = controller;
      const current = () =>
        session.current === scope &&
        !scope.signal.aborted &&
        !controller.signal.aborted &&
        version === threadVersion.current &&
        selection.current.id === id;
      try {
        const data = await socialFetch<ThreadResponse>(
          '/api/social?view=thread&id=' + encodeURIComponent(id),
          { signal: controller.signal },
        );
        if (!current()) return;
        const request = mergeCollaboration(
          retainedRequest.current,
          authorizedThread(data, id, userId),
        );
        retainedRequest.current = request;
        setHydratedRequest(request);
        setRequests((current) =>
          current.map((item) =>
            item.id === id ? mergeCollaboration(item, request) : item,
          ),
        );
        setThreads((current) => ({ ...current, [id]: data.messages }));
      } catch (cause: unknown) {
        if (current() && !isAbortError(cause)) {
          const status = (cause as { status?: number })?.status;
          if (status === 403 || status === 404) {
            retainedRequest.current = null;
            selection.current = { ...selection.current, id: '' };
            setHydratedRequest(null);
            setRequests((current) => current.filter((item) => item.id !== id));
            setSelectedId('');
            targetError.current = errorMessage(cause);
            retryTarget.current = id;
          }
          setError(errorMessage(cause));
        }
      } finally {
        if (threadController.current === controller)
          threadController.current = null;
      }
    },
    [userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || busyRef.current) return;
      // A slow read can finish before the next tick; never queue duplicate polls.
      if (!inboxController.current) void loadInbox();
      if (
        !pendingTarget.current &&
        !threadController.current &&
        selection.current.id
      )
        void loadThread(selection.current.id);
    };
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) void loadInbox();
    });
    const timer = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      cancelReads();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [cancelReads, loadInbox, loadThread]);

  useEffect(() => {
    if (target.current === requestedCollaborationId) return;
    target.current = requestedCollaborationId;
    pendingTarget.current = requestedCollaborationId;
    targetError.current = '';
    retryTarget.current = undefined;
    loadedTargetThread.current = '';
    cancelReads();
    const scope = session.current;
    void Promise.resolve().then(() => {
      if (
        requestedCollaborationId &&
        target.current === requestedCollaborationId &&
        scope &&
        session.current === scope &&
        !scope.signal.aborted
      )
        void loadInbox();
    });
  }, [cancelReads, loadInbox, requestedCollaborationId]);

  useEffect(() => {
    if (loadedTargetThread.current === selectedId) {
      loadedTargetThread.current = '';
      return cancelThread;
    }
    const scope = session.current;
    void Promise.resolve().then(() => {
      if (
        selectedId &&
        selection.current.id === selectedId &&
        scope &&
        session.current === scope &&
        !scope.signal.aborted
      )
        void loadThread(selectedId);
    });
    return cancelThread;
  }, [cancelThread, loadThread, selectedId]);

  function selectRequest(id: string, nextFolder = selection.current.folder) {
    if (pendingTarget.current) {
      inboxVersion.current++;
      inboxController.current?.abort();
      inboxController.current = null;
    }
    retainedRequest.current =
      availableRequests.find((request) => request.id === id) || null;
    setHydratedRequest(retainedRequest.current);
    selection.current = { id, folder: nextFolder, initialized: true };
    pendingTarget.current = undefined;
    targetError.current = '';
    retryTarget.current = undefined;
    loadedTargetThread.current = '';
    setError('');
    setFolder(nextFolder);
    setSelectedId(id);
  }

  function beginAction() {
    const scope = session.current;
    if (busyRef.current || !scope || scope.signal.aborted) return null;
    busyRef.current = true;
    cancelReads();
    setBusy(true);
    return scope;
  }

  function actionCurrent(scope: AbortController) {
    return session.current === scope && !scope.signal.aborted;
  }

  async function refreshAfterAction(scope: AbortController) {
    if (!actionCurrent(scope)) return;
    await loadInbox();
    if (actionCurrent(scope)) await loadThread(selection.current.id);
  }

  function finishAction(scope: AbortController) {
    if (!actionCurrent(scope)) return;
    busyRef.current = false;
    setBusy(false);
  }

  async function changeStatus(status: 'accepted' | 'declined' | 'closed') {
    if (!selected || busy) return;
    const scope = beginAction();
    if (!scope) return;
    try {
      await socialAction(
        {
          action: 'collaborationStatus',
          id: selected.id,
          status,
        },
        scope.signal,
      );
      await refreshAfterAction(scope);
      if (!actionCurrent(scope)) return;
      onChanged();
      notify(
        status === 'accepted'
          ? 'Request accepted. Your private conversation is open.'
          : status === 'declined'
            ? 'Request declined.'
            : 'Conversation closed.',
      );
    } catch (cause: unknown) {
      if (actionCurrent(scope)) setError(errorMessage(cause));
    } finally {
      finishAction(scope);
    }
  }

  async function sendMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft.message.trim() || !draft.clientId || busy) return;
    const requestId = selected.id;
    const outgoing = draft;
    const scope = beginAction();
    if (!scope) return;
    try {
      await socialAction(
        {
          action: 'message',
          id: requestId,
          message: outgoing.message,
          clientId: outgoing.clientId,
        },
        scope.signal,
      );
      if (!actionCurrent(scope)) return;
      setDrafts((current) => {
        if (current[requestId]?.clientId !== outgoing.clientId) return current;
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      await refreshAfterAction(scope);
      if (!actionCurrent(scope)) return;
      onChanged();
    } catch (cause: unknown) {
      if (actionCurrent(scope)) setError(errorMessage(cause));
    } finally {
      finishAction(scope);
    }
  }

  async function blockMember() {
    if (!selected || busy) return;
    const target =
      selected.sender === userId ? selected.recipient : selected.sender;
    if (!window.confirm('Block this member and close active conversations?'))
      return;
    const scope = beginAction();
    if (!scope) return;
    try {
      await socialAction(
        { action: 'block', target, value: true },
        scope.signal,
      );
      await refreshAfterAction(scope);
      if (!actionCurrent(scope)) return;
      onChanged();
      notify('Member blocked. They cannot send you new requests or messages.');
    } catch (cause: unknown) {
      if (actionCurrent(scope)) setError(errorMessage(cause));
    } finally {
      finishAction(scope);
    }
  }

  async function unblockMember(target: string) {
    if (busy) return;
    const scope = beginAction();
    if (!scope) return;
    try {
      await socialAction(
        { action: 'block', target, value: false },
        scope.signal,
      );
      await refreshAfterAction(scope);
      if (!actionCurrent(scope)) return;
      notify('Member unblocked. New requests are available again.');
    } catch (cause: unknown) {
      if (actionCurrent(scope)) setError(errorMessage(cause));
    } finally {
      finishAction(scope);
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
              selectRequest(
                availableRequests.find(
                  (request) => request.recipient === userId,
                )?.id || '',
                'incoming',
              );
            }}
          >
            <Inbox size={15} /> Incoming
          </button>
          <button
            className={folder === 'sent' ? 'active' : ''}
            onClick={() => {
              selectRequest(
                availableRequests.find((request) => request.sender === userId)
                  ?.id || '',
                'sent',
              );
            }}
          >
            <Send size={15} /> Sent
          </button>
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            onClick={() => {
              if (targetError.current)
                pendingTarget.current = retryTarget.current;
              void loadInbox();
              void loadThread(selection.current.id);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {availableRequests.length ? (
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
                  onClick={() => selectRequest(request.id)}
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
