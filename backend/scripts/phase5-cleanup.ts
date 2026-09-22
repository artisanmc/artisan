import {readFile,writeFile,unlink} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {eq} from 'drizzle-orm';
import {db} from '../src/db';
import {users,networks,projects,projectCopies} from '../src/db/schema';
const path=new URL('../.phase5-local-state.json',import.meta.url),s=JSON.parse(await readFile(path,'utf8'));
const ids=[s.source.id,s.copy.projectId,s.runtimeCopy.projectId,'copy_a29caeeba058cb9b8c6f91f8e06fd957'];
const results=[];
for(const id of ids){
 const r=await fetch(`http://localhost:3001/api/v1/user/projects/${id}`,{method:'DELETE',headers:{Cookie:`artisan_user_session=${s.session}`}});
 const body=await r.text();assert(r.ok||r.status===404,`${id}: ${r.status} ${body}`);results.push({id,status:r.status});
}
const rebuild=await fetch(`http://localhost:3001/api/v1/networks/${s.server.networkId}/servers/${s.server.id}/resource-pack/rebuild`,{method:'POST',headers:{Cookie:`artisan_user_session=${s.session}`}});assert(rebuild.ok,await rebuild.text());
await db.delete(projectCopies).where(eq(projectCopies.ownerId,s.id));
await db.delete(networks).where(eq(networks.id,s.isolated.networkId));
await db.delete(users).where(eq(users.id,s.id));
await writeFile('../.scratch/phase5-integration-20260913/cleanup.json',JSON.stringify({deletedProjects:results,deletedUser:s.id,deletedNetwork:s.isolated.networkId,primaryResourcePackRebuilt:true},null,2));
await unlink(path);
await unlink('../.scratch/phase5-integration-20260913/minecraft/plugins/Artisan/config.yml');
console.log('Only the four fixture projects, fixture user/session/memberships and isolated Network were removed. Primary resource pack rebuilt.');process.exit(0);
