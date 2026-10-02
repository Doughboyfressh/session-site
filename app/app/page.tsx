import type { Metadata } from 'next';
import WorkspacePage from '../workspace-page';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'SESSION — Make music together',
  robots: { index: false, follow: true },
};

export default WorkspacePage;
