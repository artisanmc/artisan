import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import {linkCodes, serverKeys, networks, projects,users} from "../db/schema";
import {adminCookie} from '../testSupport/adminSession';
import {createSession} from '../lib/sessionManager';

async function clearAll() {
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
}

describe("server keys API", () => {
  beforeEach(clearAll);
  test("POST /api/v1/server-keys returns a sk_ key", async () => {
    const res = await app.request("/api/v1/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json",Cookie:await adminCookie() },
      body: JSON.stringify({ label: "my-server" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; id: string };
    expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.id).toBeDefined();
  });

  test("GET /api/v1/server-keys lists keys with masked prefix", async () => {
    await app.request("/api/v1/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json",Cookie:await adminCookie() },
      body: JSON.stringify({ label: "list-test" }),
    });
    const res = await app.request("/api/v1/server-keys",{headers:{Cookie:await adminCookie()}});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; keyPrefix: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].keyPrefix).toMatch(/^[0-9a-f]{8}\.\.\.$/);
  });
});
test('legacy key administration denies anonymous and guest requests without creating networks',async()=>{
 const count=(await db.select().from(networks)).length;
 for(const Cookie of ['', 'artisan_demo_session=unknown'])for(const method of ['GET','POST']){
  const r=await app.request('/api/v1/server-keys',{method,headers:{Cookie,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});expect(r.status).toBe(403);
 }
 expect((await db.select().from(networks)).length).toBe(count);
});
test('ordinary accounts cannot enumerate global keys or create an unrelated Network',async()=>{
 const id=`member-${crypto.randomUUID()}`,now=new Date();await db.insert(users).values({id,name:'Member',email:`${id}@example.invalid`,createdAt:now,updatedAt:now});const Cookie=`artisan_user_session=${(await createSession(id)).id}`;
 for(const method of ['GET','POST'])expect((await app.request('/api/v1/server-keys',{method,headers:{Cookie,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})})).status).toBe(403);
});
