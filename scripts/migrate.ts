import { database, closeDatabase } from "../backend/db.ts";
await database();
console.log("Database migrations are current.");
await closeDatabase();
