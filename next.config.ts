import type { NextConfig } from 'next';
import path from 'node:path';

const deploymentTarget = process.env.SESSION_RUNTIME === 'vercel' || process.env.VERCEL === '1'
  ? 'vercel' : 'sites';
const nextConfig: NextConfig = {
  ...(deploymentTarget === 'vercel' ? { distDir: '.vercel-next' } : {}),
  env: { NEXT_PUBLIC_DEPLOYMENT_TARGET: deploymentTarget, DEPLOYMENT_TARGET: deploymentTarget },
  outputFileTracingRoot: process.cwd(),
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/,
      path.resolve('lib/deployment/cloudflare-runtime.ts')));
    return config;
  },
};

export default nextConfig;
