import { env } from 'cloudflare:workers';
import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import { isDeveloper } from './developer-access';

export function developerAllowed(userId: string | null): boolean {
  return isDeveloper(
    userId,
    (env as unknown as { SESSION_DEVELOPER_IDS?: unknown })
      .SESSION_DEVELOPER_IDS,
  );
}

export async function requireDeveloper(): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (!user)
    throw Object.assign(new Error('Sign in to continue.'), { status: 401 });
  if (!developerAllowed(user.userId))
    throw Object.assign(new Error('Developer access is required.'), {
      status: 403,
    });
  return user;
}
