import SessionApp from './session-app';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <SessionApp
      key={user?.userId || 'guest'}
      user={
        user ? { id: user.userId, name: user.fullName || 'New creator' } : null
      }
    />
  );
}
