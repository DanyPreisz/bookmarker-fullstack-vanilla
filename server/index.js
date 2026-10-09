import { URL } from "node:url";
import { connect, isReady, users, bookmarks, toId, mapBookmark } from "./db.js";
import { createApp, readJson, sendEmpty, sendJson, serveStatic } from "./http.js";
import { getUserFromRequest, hashPassword, signToken, verifyPassword } from "./middleware/auth.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function usernameQuery(username) { return new RegExp("^" + username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"); }
function requireUser(req, res) { const user = getUserFromRequest(req); if (!user) { sendJson(res, 401, { error: "No autenticado" }); return null; } return user; }
function urlOf(value) { const url = String(value || "").trim().slice(0, 300); return /^https?:\/\//i.test(url) ? url : ""; }
function tagsOf(value) { return [...new Set(String(value || "").split(/[, ]+/).map((tag) => tag.trim().toLowerCase().slice(0, 20)).filter(Boolean))].slice(0, 6); }

const server = createApp(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname, searchParams } = url;
  const method = req.method || "GET";
  if (pathname === "/health") return sendJson(res, 200, { ok: true, db: isReady() });
  if (pathname.startsWith("/api/") && !isReady()) return sendJson(res, 503, { error: "Base no lista" });
  if (!pathname.startsWith("/api/")) return serveStatic(req, res);

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: "Usuario: 3-20 caracteres, letras, numeros y _" });
    if (password.length < 6) return sendJson(res, 400, { error: "La contrasena debe tener al menos 6 caracteres" });
    if (await users().findOne({ username: usernameQuery(username) })) return sendJson(res, 409, { error: "Ese usuario ya existe" });
    const result = await users().insertOne({ username, passwordHash: hashPassword(password), createdAt: new Date() });
    const user = { id: String(result.insertedId), username };
    return sendJson(res, 201, { user, token: signToken(user) });
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const row = await users().findOne({ username: usernameQuery(username) });
    if (!row || !verifyPassword(String(body.password || ""), row.passwordHash)) return sendJson(res, 401, { error: "Usuario o contrasena incorrectos" });
    const user = { id: String(row._id), username: row.username };
    return sendJson(res, 200, { user, token: signToken(user) });
  }
  if (method === "GET" && pathname === "/api/auth/me") {
    const user = requireUser(req, res);
    if (!user) return;
    const row = await users().findOne({ _id: toId(user.id) });
    if (!row) return sendJson(res, 401, { error: "Usuario no encontrado" });
    return sendJson(res, 200, { user: { id: String(row._id), username: row.username } });
  }

  const user = requireUser(req, res);
  if (!user) return;
  const userId = user.id;

  if (method === "GET" && pathname === "/api/bookmarks") {
    const q = String(searchParams.get("q") || "").trim();
    const tag = String(searchParams.get("tag") || "").trim().toLowerCase();
    const query = { userId };
    if (tag) query.tags = tag;
    if (q) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      query.$or = [{ title: rx }, { url: rx }];
    }
    const rows = await bookmarks().find(query).sort({ createdAt: -1 }).limit(200).toArray();
    const tags = [...new Set(rows.flatMap((row) => row.tags || []))].sort();
    return sendJson(res, 200, { bookmarks: rows.map(mapBookmark), tags });
  }
  if (method === "POST" && pathname === "/api/bookmarks") {
    const body = await readJson(req);
    const title = String(body.title || "").trim();
    const urlValue = urlOf(body.url);
    if (!title || !urlValue) return sendJson(res, 400, { error: "Titulo y URL http o https son obligatorios" });
    const result = await bookmarks().insertOne({ userId, title: title.slice(0, 80), url: urlValue, tags: tagsOf(body.tags), createdAt: new Date() });
    return sendJson(res, 201, { bookmark: mapBookmark(await bookmarks().findOne({ _id: result.insertedId })) });
  }
  const match = pathname.match(/^\/api\/bookmarks\/([a-fA-F0-9]{24})$/);
  if (match && method === "DELETE") {
    const result = await bookmarks().deleteOne({ _id: toId(match[1]), userId });
    if (!result.deletedCount) return sendJson(res, 404, { error: "Marcador no encontrado" });
    return sendEmpty(res, 204);
  }
  sendJson(res, 404, { error: "Ruta no encontrada" });
});

server.listen(PORT, HOST, () => console.log(`Bookmarker en http://${HOST}:${PORT}`));
async function bootDb() { for (;;) { try { await connect(); return; } catch (err) { console.error("Mongo no disponible:", err.message); await new Promise((resolve) => setTimeout(resolve, 5000)); } } }
bootDb();
