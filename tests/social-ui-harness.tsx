import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivityView, CollaborationInbox } from '@/app/social';
import '@/app/globals.css';
import '@/app/advanced.css';

type FixtureRequest = {
  id: string;
  sender: string;
  recipient: string;
  senderName: string;
  recipientName: string;
  senderUsername: string;
  recipientUsername: string;
  role: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'closed';
  created: number;
  updated: number;
  lastMessage?: string;
  lastMessageAt?: number;
};
type FixtureMessage = {
  id: string;
  sender: string;
  senderName: string;
  body: string;
  created: number;
};
const member = 'fixture-member';
const now = Date.now();
const requests: FixtureRequest[] = [
  {
    id: 'fixture-newest',
    sender: 'fixture-newest-peer',
    recipient: member,
    senderName: 'Newest peer',
    recipientName: 'Fixture member',
    senderUsername: 'newest_peer',
    recipientUsername: 'fixture_member',
    role: 'Producer',
    message: 'The newest incoming collaboration request.',
    status: 'accepted',
    created: now - 30000,
    updated: now - 10000,
  },
  {
    id: 'fixture-older',
    sender: 'fixture-older-peer',
    recipient: member,
    senderName: 'Older peer',
    recipientName: 'Fixture member',
    senderUsername: 'older_peer',
    recipientUsername: 'fixture_member',
    role: 'Engineer',
    message: 'An older conversation that has an unread alert.',
    status: 'accepted',
    created: now - 60000,
    updated: now - 20000,
  },
  {
    id: 'fixture-older-outside-page',
    sender: 'fixture-outside-peer',
    recipient: member,
    senderName: 'Older outside page',
    recipientName: 'Fixture member',
    senderUsername: 'outside_peer',
    recipientUsername: 'fixture_member',
    role: 'Engineer',
    message: 'A valid alert target beyond the newest inbox page.',
    status: 'accepted',
    created: now - 120000,
    updated: now - 60000,
  },
  {
    id: 'fixture-sent',
    sender: member,
    recipient: 'fixture-sent-peer',
    senderName: 'Fixture member',
    recipientName: 'Sent peer',
    senderUsername: 'fixture_member',
    recipientUsername: 'sent_peer',
    role: 'Artist',
    message: 'A collaboration request sent by the fixture member.',
    status: 'accepted',
    created: now - 90000,
    updated: now - 30000,
  },
];
const threads: Record<string, FixtureMessage[]> = {
  'fixture-older-outside-page': [
    {
      id: 'fixture-outside-history',
      sender: 'fixture-outside-peer',
      senderName: 'Older outside page',
      body: 'History for the older conversation outside the inbox page.',
      created: now - 60000,
    },
  ],
  'fixture-older': [
    {
      id: 'fixture-initial',
      sender: 'fixture-older-peer',
      senderName: 'Older peer',
      body: 'Older conversation history.',
      created: now - 20000,
    },
  ],
};
const notifications = [
  {
    id: 'alert-older-outside-page',
    kind: 'message',
    actorName: 'Older outside page',
    body: 'replied beyond the newest inbox page.',
    resourceType: 'collaboration',
    resourceId: 'fixture-older-outside-page',
    created: now - 3000,
    readAt: null as number | null,
  },
  {
    id: 'alert-older',
    kind: 'message',
    actorName: 'Older peer',
    body: 'replied to your older conversation.',
    resourceType: 'collaboration',
    resourceId: 'fixture-older',
    created: now - 2000,
    readAt: null as number | null,
  },
  {
    id: 'alert-sent',
    kind: 'message',
    actorName: 'Sent peer',
    body: 'replied to the request you sent.',
    resourceType: 'collaboration',
    resourceId: 'fixture-sent',
    created: now - 1000,
    readAt: null as number | null,
  },
];
const reads: { url: string; method: string; at: number }[] = [];
let replyCount = 0;
let failNextSend = false;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(href, window.location.href);
  if (url.pathname.startsWith('/api/')) {
    reads.push({
      url: url.pathname + url.search,
      method: init?.method || 'GET',
      at: Date.now(),
    });
    if (url.pathname !== '/api/social')
      return Response.json(
        { error: 'Only local social fixtures are available.' },
        { status: 404 },
      );
    if (init?.method === 'POST') {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
      const request = requests.find((item) => item.id === body.id);
      if (body.action === 'notificationRead') {
        for (const item of notifications)
          if (!body.id || item.id === body.id) item.readAt = Date.now();
      } else if (body.action === 'message' && request) {
        if (failNextSend) {
          failNextSend = false;
          return Response.json(
            { error: 'Synthetic send failed. Keep this draft and retry.' },
            { status: 503 },
          );
        }
        (threads[request.id] ||= []).push({
          id: crypto.randomUUID(),
          sender: member,
          senderName: 'Fixture member',
          body: body.message,
          created: Date.now(),
        });
        request.lastMessage = body.message;
        request.lastMessageAt = Date.now();
      } else if (body.action === 'collaborationStatus' && request) {
        peerStatus(request.id, body.status);
      } else {
        return Response.json(
          { error: 'This fixture action is unavailable.' },
          { status: 400 },
        );
      }
      return Response.json({ ok: true });
    }
    if (url.searchParams.get('view') === 'inbox')
      return Response.json({
        requests: requests
          .filter((item) => item.id !== 'fixture-older-outside-page')
          .sort(
            (a, b) =>
              (b.lastMessageAt || b.updated) - (a.lastMessageAt || a.updated),
          ),
        blocks: [],
      });
    if (url.searchParams.get('view') === 'activity')
      return Response.json({
        items: notifications,
        unread: notifications.filter((item) => !item.readAt).length,
      });
    if (url.searchParams.get('view') === 'thread') {
      const id = url.searchParams.get('id') || '';
      const request = requests.find((item) => item.id === id);
      if (!request)
        return Response.json(
          { error: 'This collaboration is unavailable.' },
          { status: 404 },
        );
      return Response.json({ request, messages: threads[id] || [] });
    }
    return Response.json({ error: 'Unknown synthetic view.' }, { status: 400 });
  }
  return nativeFetch(input, init);
};

function peerReply(id: string) {
  const request = requests.find((item) => item.id === id)!;
  const incoming = request.recipient === member;
  const body = `Peer update ${++replyCount} for ${incoming ? request.senderName : request.recipientName}.`;
  (threads[id] ||= []).push({
    id: crypto.randomUUID(),
    sender: incoming ? request.sender : request.recipient,
    senderName: incoming ? request.senderName : request.recipientName,
    body,
    created: Date.now(),
  });
  request.lastMessage = body;
  request.lastMessageAt = Date.now();
  return body;
}
function peerStatus(id: string, status: FixtureRequest['status']) {
  const request = requests.find((item) => item.id === id)!;
  request.status = status;
  request.updated = Math.max(Date.now(), request.updated + 1);
}
Object.assign(window, {
  sessionSocialFixture: { reads, requests, threads, peerReply },
});

function Fixture() {
  const [target, setTarget] = useState<string>();
  const [notice, setNotice] = useState('');
  const [unread, setUnread] = useState(notifications.length);
  return (
    <main style={{ maxWidth: 1152, margin: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <h1>Local collaboration verification</h1>
        <p>
          All alerts, peer updates, and sends stay in this page’s synthetic API.
          The inbox refreshes every ten seconds while visible.
        </p>
        <div
          className="actions"
          aria-label="Synthetic peer controls"
          style={{ flexWrap: 'wrap' }}
        >
          <button
            className="button secondary"
            onClick={() => setNotice(peerReply('fixture-older-outside-page'))}
          >
            Peer reply outside page
          </button>
          <button
            className="button secondary"
            onClick={() => {
              peerStatus('fixture-older-outside-page', 'closed');
              setNotice('Peer closed the conversation outside the inbox page.');
            }}
          >
            Peer closes outside page
          </button>
          <button
            className="button secondary"
            onClick={() => {
              peerStatus('fixture-older-outside-page', 'accepted');
              setNotice(
                'The conversation outside the inbox page is accepted again.',
              );
            }}
          >
            Peer reopens outside page
          </button>
          <button
            className="button secondary"
            onClick={() => setNotice(peerReply('fixture-older'))}
          >
            Peer reply to Older
          </button>
          <button
            className="button secondary"
            onClick={() => setNotice(peerReply('fixture-sent'))}
          >
            Peer reply to Sent
          </button>
          <button
            className="button secondary"
            onClick={() => {
              peerStatus('fixture-older', 'closed');
              setNotice('Peer closed the older conversation.');
            }}
          >
            Peer closes Older
          </button>
          <button
            className="button secondary"
            onClick={() => {
              peerStatus('fixture-older', 'accepted');
              setNotice('Older conversation is accepted again.');
            }}
          >
            Peer reopens Older
          </button>
          <button
            className="button secondary"
            onClick={() => window.dispatchEvent(new Event('focus'))}
          >
            Refresh inbox now
          </button>
          <button
            className="button secondary"
            onClick={() => {
              failNextSend = true;
              setNotice('The next local send will fail.');
            }}
          >
            Fail next local send
          </button>
          <button
            className="button secondary"
            onClick={() => setTarget('fixture-unavailable')}
          >
            Unavailable alert target
          </button>
        </div>
        <output aria-live="polite">
          {notice || `${unread} synthetic unread alerts`}
        </output>
      </div>
      <div style={{ display: 'grid', gap: 20 }}>
        <ActivityView
          onUnreadChange={setUnread}
          onOpen={(item) => {
            if (item.resourceType === 'collaboration')
              setTarget(item.resourceId);
          }}
        />
        <CollaborationInbox
          userId={member}
          requestedCollaborationId={target}
          notify={setNotice}
          onChanged={() => setNotice('Local collaboration changed.')}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
