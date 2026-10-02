import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const project = JSON.parse(fs.readFileSync('.vercel/project.json','utf8'));
const keys = ['DATABASE_URL','DEPLOYMENT_TARGET','NEON_AUTH_BASE_URL','NEON_AUTH_COOKIE_SECRET',
  'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_ENDPOINT_URL_S3','AWS_REGION','SESSION_FILES_BUCKET',
  'CLOUDFLARE_TURN_KEY_ID','CLOUDFLARE_TURN_API_TOKEN'];
const envs = keys.filter(key=>process.env[key]).map(key=>({key,value:process.env[key],target:['production'],type:'encrypted'}));
envs.push({key:'APP_URL',value:'https://session-site-eosin.vercel.app',target:['production'],type:'encrypted'});
const input = path.resolve('outputs/deployment-secret-env.json');
fs.mkdirSync('outputs',{recursive:true});
try {
  // The CLI serializes object bodies reliably; submit each variable separately.
  for (const env of envs) {
    fs.writeFileSync(input,JSON.stringify(env));
    const output = execFileSync(process.execPath,[process.argv[2],'api',`/v10/projects/${project.projectId}/env?upsert=true&teamId=${project.orgId}`,
      '-X','POST','--header','Content-Type: application/json','--input',input,'--raw'],
      {encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const result = JSON.parse(output);
    if (result.failed?.length) throw new Error('Vercel did not save ' + env.key);
  }
  console.log('Configured encrypted production variables: ' + envs.map(v=>v.key).join(', '));
} catch (error) {
  console.error('Environment setup failed: ' + (error.stderr?.toString() || error.message));
  process.exitCode = 1;
} finally {fs.rmSync(input,{force:true});}
