import { MongoClient, ObjectId } from "mongodb";
const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "bookmarker";
let db;
export function isReady() { return Boolean(db); }
export async function connect() {
  if (!uri) throw new Error("Falta MONGODB_URI");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(dbName);
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("bookmarks").createIndex({ userId: 1, createdAt: -1 });
  await db.collection("bookmarks").createIndex({ userId: 1, tags: 1 });
  console.log(`MongoDB conectado (${dbName})`);
  return db;
}
export const users = () => db.collection("users");
export const bookmarks = () => db.collection("bookmarks");
export function toId(value) { return ObjectId.isValid(value) ? new ObjectId(String(value)) : null; }
export function mapBookmark(doc) { return { id: String(doc._id), title: doc.title, url: doc.url, tags: doc.tags || [], createdAt: doc.createdAt }; }
