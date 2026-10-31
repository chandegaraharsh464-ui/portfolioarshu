import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
const sec = () => crypto.createHash("sha256").update("k:" + process.env.ADMIN_ID + ":" + process.env.ADMIN_PASS).digest("hex");
const sign = p => crypto.createHmac("sha256", sec()).update(p).digest("hex");
const mkTok = () => { const e = Date.now() + 12 * 3600e3; return e + "." + sign("" + e); };
const ok = req => {
  const t = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const [e, h] = t.split(".");
  if (!e || !h || !(+e > Date.now()) || h.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sign(e)));
};
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export default async (req) => {
  const u = new URL(req.url), p = u.pathname.replace(/^\/api\/?/, "");
  const st = getStore("portfolio");
  if (p === "data" && req.method === "GET") return J((await st.get("data", { type: "json" })) || { content: {}, items: [] });
  if (p === "login" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (process.env.ADMIN_ID && b.id === process.env.ADMIN_ID && b.pass === process.env.ADMIN_PASS) return J({ token: mkTok() });
    return J({ error: "Wrong ID or password" }, 401);
  }
  if (p.startsWith("file/") && req.method === "GET") {
    const id = p.slice(5).replace(/[^\w-]/g, "");
    const r = await st.getWithMetadata("f-" + id, { type: "arrayBuffer" });
    if (!r) return new Response("Not found", { status: 404 });
    return new Response(r.data, { headers: { "content-type": r.metadata?.type || "application/octet-stream", "cache-control": "public,max-age=31536000,immutable", "x-content-type-options": "nosniff" } });
  }
  if (!ok(req)) return J({ error: "Please log in again" }, 401); 
  if (p === "aistatus") return J({ ai: !!process.env.GEMINI_API_KEY });
  if (p === "ai" && req.method === "POST") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return J({ error: "Add GEMINI_API_KEY in Netlify environment variables first." }, 400);
    const b = await req.json().catch(() => ({}));
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ parts: [{ text: String(b.prompt || "").slice(0, 6000) }] }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return J({ error: j.error?.message || "AI request failed (" + r.status + ")" }, 502);
    return J({ text: (j.candidates?.[0]?.content?.parts || []).map(x => x.text).join("") || "No answer" });
  }
  if (p === "save" && req.method === "POST") { const b = await req.json(); await st.setJSON("data", { content: b.content || {}, items: b.items || [] }); return J({ ok: 1 }); }
  if (p === "upload" && req.method === "POST") {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await st.set("f-" + id, await req.arrayBuffer(), { metadata: { type: u.searchParams.get("type") || "application/octet-stream" } });
    return J({ id });
  }
  if (p === "rmfile" && req.method === "POST") { const b = await req.json(); await st.delete("f-" + String(b.id).replace(/[^\w-]/g, "")); return J({ ok: 1 }); }
  return J({ error: "Not found" }, 404);
};
export const config = { path: "/api/*" };
