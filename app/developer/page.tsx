import type { Metadata } from 'next';
import Link from 'next/link';
import { chatGPTSignInPath, getChatGPTUser } from '../chatgpt-auth';
import { developerAllowed } from '@/lib/developer-server';
import DeveloperDashboardClient from './dashboard';
import './developer.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Developer dashboard — SESSION',
  robots: { index: false, follow: false, nocache: true },
};

export default async function DeveloperPage() {
  const user = await getChatGPTUser();
  const signInHref = chatGPTSignInPath('/developer');

  if (!user || !developerAllowed(user.userId)) {
    return (
      <main className="developer-page developer-access">
        <Link className="developer-brand" href="/app">
          session<span>.</span>
        </Link>
        <div className="developer-access-card">
          <span className="developer-eyebrow">PRIVATE WORKSPACE</span>
          <h1>Developer dashboard</h1>
          <p>
            {user
              ? 'This dashboard is available only to the SESSION owner.'
              : 'Sign in with your owner account to access SESSION metrics.'}
          </p>
          <a
            className="developer-button developer-button-primary"
            href={user ? '/app' : signInHref}
            target={user ? undefined : '_top'}
          >
            {user ? 'Return to SESSION' : 'Sign in to SESSION'}
          </a>
        </div>
      </main>
    );
  }

  return <DeveloperDashboardClient signInHref={signInHref} />;
}
