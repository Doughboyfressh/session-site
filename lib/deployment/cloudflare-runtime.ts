// Next.js aliases cloudflare:workers here; vinext keeps its original bindings.
import { postgresDatabase } from './postgres';
import { privateBucket } from './storage';
export const env = new Proxy({ DB: postgresDatabase, FILES: privateBucket }, {
  get(target, key: string) { return key in target ? target[key as keyof typeof target] : process.env[key]; },
});
