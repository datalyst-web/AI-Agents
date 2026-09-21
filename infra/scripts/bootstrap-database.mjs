// One-time setup of a brand-new PostgreSQL database for this app: the
// `chat` schema, pgvector inside it, and the least-privilege runtime role.
// Idempotent — safe to re-run. Mirrors CI's bootstrap step in ci.yml.
//
// Replaces bootstrap-db.sh for current hosting: that script needs psql and
// passes :'pw' into a DO $$...$$ block, where psql never substitutes
// variables, so it can't create the role on a fresh database.
//
// Run as the database OWNER, with the new runtime role's password in env:
//   OWNER_DATABASE_URL=postgresql://... CHAT_APP_USER_PASSWORD=... \
//     node infra/scripts/bootstrap-database.mjs
// Then: prisma db push (as owner), then apply rls_policies.sql and
// vector_index.sql — the deploy pipeline re-applies both on every release.
// Prints no connection strings or passwords.
import { createRequire } from "node:module";

const requireDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { PrismaClient } = requireDb("@prisma/client");

const ownerUrl = process.env.OWNER_DATABASE_URL;
const appPassword = process.env.CHAT_APP_USER_PASSWORD;
if (!ownerUrl) throw new Error("OWNER_DATABASE_URL is required.");
if (!appPassword || appPassword.length < 24) throw new Error("CHAT_APP_USER_PASSWORD is required (24+ characters).");

const prisma = new PrismaClient({ datasources: { db: { url: ownerUrl } }, log: [] });

// Quote as a SQL string literal. The password is generated, not user input,
// but the role statement can't take a bind parameter, so escape it anyway.
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

try {
  await prisma.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS chat");
  // Must exist before `prisma db push`: the chunk embedding column's
  // Unsupported("vector(...)") type has to already resolve, and the app
  // casts to chat.vector explicitly.
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector SCHEMA chat");

  const [{ exists }] = await prisma.$queryRawUnsafe(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chat_app_user') AS exists",
  );
  // NOBYPASSRLS is the whole point of this role: tenant isolation is
  // enforced by row-level security, which a bypassing role would ignore.
  await prisma.$executeRawUnsafe(
    exists
      ? `ALTER ROLE chat_app_user WITH LOGIN NOBYPASSRLS PASSWORD ${literal(appPassword)}`
      : `CREATE ROLE chat_app_user WITH LOGIN NOBYPASSRLS PASSWORD ${literal(appPassword)}`,
  );
  await prisma.$executeRawUnsafe("GRANT USAGE ON SCHEMA chat TO chat_app_user");
  // pgvector lives in `chat`, so unqualified vector operators (<=> etc.)
  // only resolve for the app's sessions with this search path.
  await prisma.$executeRawUnsafe("ALTER ROLE chat_app_user SET search_path = chat, public");

  const [role] = await prisma.$queryRawUnsafe(
    "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'chat_app_user'",
  );
  const [ext] = await prisma.$queryRawUnsafe(
    "SELECT n.nspname AS schema, e.extversion AS version FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'",
  );
  if (role.rolsuper || role.rolbypassrls || !role.rolcanlogin) throw new Error("chat_app_user has unsafe or unusable privileges");
  if (!ext || ext.schema !== "chat") throw new Error("pgvector is not installed in the chat schema");
  console.log(JSON.stringify({ schema: "chat", role: "chat_app_user", created: !exists, rolbypassrls: false, pgvector: ext.version }));
} finally {
  await prisma.$disconnect();
}
