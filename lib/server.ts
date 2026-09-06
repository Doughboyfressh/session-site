import { env } from 'cloudflare:workers';
export function database():D1Database{return (env as unknown as {DB:D1Database}).DB;}
export function bucket():R2Bucket{return (env as unknown as {FILES:R2Bucket}).FILES;}
export async function all(sql:string,...params:any[]){return (await database().prepare(sql).bind(...params).all()).results as any[];}
export async function one(sql:string,...params:any[]){return await database().prepare(sql).bind(...params).first() as any;}
export async function run(sql:string,...params:any[]){return database().prepare(sql).bind(...params).run();}
export function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status});}
export function str(v:unknown,max=120){if(typeof v!=='string'||!v.trim()||v.length>max)fail('Please complete the required fields.');return v.trim();}
export function choice(v:unknown,options:string[]){if(typeof v!=='string'||!options.includes(v))fail('Choose a valid option.');return v as string;}
export async function roomAccess(id:string,user:string){const room=await one('SELECT r.* FROM rooms r JOIN members m ON m.room=r.id WHERE r.id=? AND m.user=?',id,user);if(!room)fail('This room is private. Ask the host for an invitation.',403);return room;}
export async function projectAccess(id:string,user:string){return one('SELECT p.* FROM projects p WHERE p.id=? AND (p.owner=? OR EXISTS (SELECT 1 FROM rooms r JOIN members m ON r.id=m.room WHERE r.project=p.id AND m.user=?))',id,user,user);}
export async function fileAccess(id:string,user:string){return one("SELECT f.* FROM files f WHERE f.id=? AND (f.owner=? OR EXISTS (SELECT 1 FROM tracks t WHERE t.fileId=f.id AND t.visibility='public') OR EXISTS (SELECT 1 FROM profiles p WHERE p.avatar=f.id AND (p.visibility='public' OR p.id=? OR EXISTS (SELECT 1 FROM members self JOIN members other ON self.room=other.room WHERE self.user=? AND other.user=p.id))) OR EXISTS (SELECT 1 FROM project_files pf JOIN projects p ON p.id=pf.project WHERE pf.file=f.id AND (p.owner=? OR EXISTS (SELECT 1 FROM rooms r JOIN members m ON m.room=r.id WHERE r.project=p.id AND m.user=?))))",id,user,user,user,user,user);}

