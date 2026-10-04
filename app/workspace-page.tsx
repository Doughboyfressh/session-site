import SessionApp from './session-app';
import { getChatGPTUser } from './chatgpt-auth';
import { developerAllowed } from '@/lib/developer-server';

export default async function WorkspacePage() {
  const user = await getChatGPTUser();
  return (
    <SessionApp
      key={user?.userId || 'guest'}
      user={
        user
          ? {
              id: user.userId,
              name: user.fullName || 'New creator',
              developer: developerAllowed(user.userId),
            }
          : null
      }
    />
  );
}
