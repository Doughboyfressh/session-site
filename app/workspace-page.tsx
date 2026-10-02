import SessionApp from './session-app';
import { getChatGPTUser } from './chatgpt-auth';

export default async function WorkspacePage() {
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
