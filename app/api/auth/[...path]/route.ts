import { neonAuth } from '@/lib/deployment/auth';
export const dynamic = 'force-dynamic';
export const GET = (req: Request, context: { params: Promise<{ path: string[] }> }) => neonAuth().handler().GET(req, context);
export const POST = (req: Request, context: { params: Promise<{ path: string[] }> }) => neonAuth().handler().POST(req, context);
