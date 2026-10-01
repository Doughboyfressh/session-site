'use client';
import { AuthView, NeonAuthUIProvider } from '@neondatabase/auth-ui';
import { createAuthClient } from '@neondatabase/auth/next';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { safeReturnPath } from '@/lib/deployment/return-path';
const authClient = createAuthClient();
export default function AuthPage() {
  const { path } = useParams<{ path: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const destination = safeReturnPath(search.get('redirectTo') || search.get('return_to'));
  return <NeonAuthUIProvider authClient={authClient} navigate={url => router.push(safeReturnPath(url))}
    replace={url => router.replace(safeReturnPath(url))}
    onSessionChange={() => router.refresh()} redirectTo={destination} Link={Link}>
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 28, padding: 24 }}>
      <Link href="/" className="brand">SESSION<span className="brand-dot">.</span></Link>
      <AuthView path={path} redirectTo={destination} />
      <Link href="/">Back to SESSION</Link>
    </main>
  </NeonAuthUIProvider>;
}
