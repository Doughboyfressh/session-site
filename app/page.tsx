import type { Metadata } from 'next';
import LandingPage from './landing-page';
import WorkspacePage from './workspace-page';
import { hasWorkspaceIntent, type EntrySearch } from '@/lib/workspace-entry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'SESSION — Your next great track starts here',
  description:
    'Find your sound with SESSION Originals. Record, arrange, and mix in your browser, then bring your people into a private studio room.',
  openGraph: {
    title: 'SESSION — Your next great track starts here',
    description: 'Original beats. A browser studio. Room for your people.',
    type: 'website',
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<EntrySearch>;
}) {
  const search = await searchParams;
  return hasWorkspaceIntent(search) ? <WorkspacePage /> : <LandingPage />;
}
