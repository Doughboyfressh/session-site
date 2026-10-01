import { redirect } from 'next/navigation';
import { safeReturnPath } from '@/lib/deployment/return-path';
export async function GET(req: Request) {
  const destination = safeReturnPath(new URL(req.url).searchParams.get('return_to'));
  redirect('/auth/sign-in?redirectTo=' + encodeURIComponent(destination));
}
