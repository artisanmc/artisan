import {readFile,writeFile} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
const path=new URL('../.phase5-local-state.json',import.meta.url),s=JSON.parse(await readFile(path,'utf8'));
const api=async(path:string,body?:unknown)=>{const r=await fetch(`http://localhost:3001/api/v1${path}`,{method:body?'POST':'GET',headers:{Cookie:`artisan_user_session=${s.session}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();assert(r.ok,JSON.stringify(j));return j as any};
const t=await api(`/user/projects/${s.source.id}/copy-targets`);assert(t.targets.some((t:any)=>t.serverKeyId===s.isolated.serverId&&t.compatible));
const copy=await api(`/user/projects/${s.source.id}/copies`,{operationId:`${s.id}_runtime`,targetServerKeyId:s.isolated.serverId,folderName:`${s.id}_runtime`,sourceRevision:t.sourceRevision});
assert.equal(copy.state,'completed');assert.equal(copy.error,null);s.runtimeCopy=copy;await writeFile(path,JSON.stringify(s),{mode:0o600});console.log(JSON.stringify(copy));
