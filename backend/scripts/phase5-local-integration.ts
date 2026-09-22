import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { users, memberships, serverKeys } from '../src/db/schema';
import { createSession } from '../src/lib/sessionManager';
import { fontFilesFor } from '../src/lib/fontOnDisk';
import { unzipSync } from 'fflate';

// Deliberate local-development integration fixture. Never invokes a test DB reset.
assert.equal(process.env.PHASE5_LOCAL_INTEGRATION, 'yes');
const statePath = new URL('../.phase5-local-state.json', import.meta.url);
let state: any;
try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch {
  const server = (await db.select({id:serverKeys.id, networkId:serverKeys.networkId}).from(serverKeys))[0];
  assert(server, 'local server required');
  const id = `phase5_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const now = new Date();
  await db.insert(users).values({id, name:'Phase 5 integration', email:`${id}@example.invalid`,createdAt:now,updatedAt:now});
  await db.insert(memberships).values({id, userId:id,networkId:server.networkId,role:'admin',createdAt:now});
  const session = await createSession(id);
  state = {id, server, session:session.id};
  await writeFile(statePath, JSON.stringify(state), {mode:0o600});
}
const api = async (path:string, method='GET', body?:unknown) => {
  const response = await fetch(`http://localhost:3001/api/v1${path}`, {method,headers:{Cookie:`artisan_user_session=${state.session}`,'Content-Type':'application/json',Origin:'http://localhost:5173'},body:body===undefined?undefined:JSON.stringify(body)});
  const value = await response.json();
  assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return value as any;
};
if (!state.source) {
  state.source = (await api(`/networks/${state.server.networkId}/hosted-projects`,'POST',{operationId:state.id,folderName:state.id,name:'Phase 5 copy integration',minecraftVersion:'1.21.11',templateId:'vanilla'})).project;
  await writeFile(statePath,JSON.stringify(state),{mode:0o600});
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
const font=fontFilesFor(`${state.id}_font`,{glyphMap:[{char:'a',texture:'glyphs/a.png',ascent:1,height:1,width:1}],glyphPngs:new Map([['glyphs/a.png',png]]),warnings:[]});
const textFiles=[{path:`assets/glyphs/${state.id}.yaml`,content:'ascent: 1\ncodepoint: 59000\nwidth: 1\nheight: 1\n'},font.descriptor,{path:'menus/copy_check.yaml',content:'schema: menu/v1\nrows: 1\ntitle:\n  - type: text\n    text: Copy integration\nelements: []\n'}];
const binaries=[{path:`assets/glyphs/${state.id}.png`,content:png},...font.binaries.map(f=>({path:f.path,content:f.bytes}))];
if (!state.written) {
  await api(`/projects/${state.source.id}/files`,'PUT',{operationId:`${state.id}_assets`,files:textFiles.map(f=>({...f,base_hash:null})),binaries:binaries.map(f=>({path:f.path,content_base64:Buffer.from(f.content).toString('base64'),base_hash:null}))});
  state.written=true; await writeFile(statePath,JSON.stringify(state),{mode:0o600});
}
const sourceBefore=await api(`/projects/${state.source.id}/files`);
const targets=await api(`/user/projects/${state.source.id}/copy-targets`);
console.log(JSON.stringify({fixture:state.id,source:state.source.id,targets},null,2));
const target=targets.targets.find((t:any)=>t.serverKeyId===state.server.id); assert(target?.compatible,'compatible plugin hello required');
const input={operationId:`${state.id}_copy`,targetServerKeyId:state.server.id,folderName:`${state.id}_copy`,sourceRevision:sourceBefore.hash};
let copy=await api(`/user/projects/${state.source.id}/copies`,'POST',input);
for(let i=0;i<12&&(copy.state!=='completed'||copy.error);i++) { await new Promise(r=>setTimeout(r,1500)); copy=await api(`/user/projects/${state.source.id}/copies/${input.operationId}/resume`,'POST'); }
assert.equal(copy.state,'completed'); assert.equal(copy.error,null);
state.copy=copy; await writeFile(statePath,JSON.stringify(state),{mode:0o600});
const repeated=await api(`/user/projects/${state.source.id}/copies`,'POST',input); assert.equal(repeated.projectId,copy.projectId);
const sourceAfter=await api(`/projects/${state.source.id}/files`); assert.deepEqual(sourceAfter,sourceBefore);
const copied=await api(`/projects/${copy.projectId}/files`);
for(const f of textFiles) assert.equal(copied.files.find((x:any)=>x.path===f.path)?.content,f.content);
for(const f of binaries) {
  const r=await fetch(`http://localhost:3001/api/v1/projects/${copy.projectId}/binary?path=${f.path}`,{headers:{Cookie:`artisan_user_session=${state.session}`}}); assert(r.ok); assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(f.content));
}
const server=(await db.select().from(serverKeys).where(eq(serverKeys.id,state.server.id)))[0]; assert(server.resourcePackHash);
const entries=unzipSync(await readFile(`data/resource-packs/${server.id}/${server.resourcePackHash}.zip`));
const fixtureEntries=Object.keys(entries).filter(p=>p.includes(state.id));
assert(fixtureEntries.some(p=>p.endsWith('.png'))); assert(fixtureEntries.some(p=>p.endsWith('.json')));
const report={fixture:state.id,source:state.source.id,copy,sourceUnchanged:true,idempotentRetry:true,textFiles:textFiles.length,binaryFiles:binaries.length,resourcePackHash:server.resourcePackHash,resourcePackEntries:fixtureEntries};
await writeFile('../.scratch/phase5-integration-20260913/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exit(0);
