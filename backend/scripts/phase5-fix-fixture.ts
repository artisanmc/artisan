import {readFile} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
const s=JSON.parse(await readFile(new URL('../.phase5-local-state.json',import.meta.url),'utf8'));
for(const id of [s.source.id,s.copy.projectId,s.runtimeCopy.projectId,'copy_a29caeeba058cb9b8c6f91f8e06fd957']){
 const url=`http://localhost:3001/api/v1/projects/${id}/files`,headers={Cookie:`artisan_user_session=${s.session}`,'Content-Type':'application/json'};
 const r=await fetch(url,{headers});assert(r.ok);const tree:any=await r.json();const f=tree.files.find((f:any)=>f.path==='menus/copy_check.yaml');assert(f);
 if(f.content==='schema: menu/v1\nsize: 27\ntitle: Copy integration\nelements: []\n') continue;
 const w=await fetch(url,{method:'PUT',headers,body:JSON.stringify({operationId:`${s.id}_valid_fixture`,files:[{path:f.path,base_hash:createHash('sha256').update(f.content).digest('hex'),content:'schema: menu/v1\nsize: 27\ntitle: Copy integration\nelements: []\n'}]})});assert(w.ok,await w.text());
 console.log('Canonical fixture menu corrected',id);
}
