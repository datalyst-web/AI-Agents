// Read-only production diagnostics. Run with service environment variables:
// railway run --service api --environment production --no-local -- node infra/scripts/check-connections.mjs
// Does not read client records, send email, write objects, or print secrets.
import { createRequire } from "node:module";

const requireDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const requireQueue = createRequire(new URL("../../packages/queue/package.json", import.meta.url));
const requireStorage = createRequire(new URL("../../packages/storage/package.json", import.meta.url));
const requireEmail = createRequire(new URL("../../packages/email/package.json", import.meta.url));
const env = process.env;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const databaseHost = process.argv.find((arg) => arg.startsWith("--database-host="))?.slice(16);
let failed = false;
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ check: "deadline", status: "failed" }));
  process.exit(1);
}, 60_000);

async function check(name, action) {
  if (only && !name.startsWith(only)) return;
  try {
    const detail = await action();
    console.log(JSON.stringify({ check: name, status: "passed", ...detail }));
  } catch (error) {
    failed = true;
    // Error messages from SDKs can contain connection strings; omit them.
    const rawCode = error?.code ?? error?.errorCode ?? error?.cause?.code;
    const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined;
    const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined;
    const message = String(error?.message ?? "");
    const category = /quota|compute time|compute.*disabled|compute.*limit/i.test(message) ? "database_compute_limit"
      : /suspended|endpoint.*disabled/i.test(message) ? "database_suspended"
      : /Can't reach database server|ENOTFOUND|ECONNREFUSED/i.test(message) ? "connection_unreachable"
      : /Authentication failed|authentication failed|Invalid login/i.test(message) ? "authentication_rejected"
      : /Query Engine|query engine|libssl|openssl/i.test(message) ? "local_database_engine"
      : /TLS|certificate|SSL/i.test(message) ? "tls"
      : undefined;
    console.log(JSON.stringify({ check: name, status: "failed", errorType: error?.name ?? "Error", code, responseCode, category }));
  }
}

await Promise.all([
  check("database and tenant security metadata", async () => {
    if (!env.DATABASE_URL) throw new Error("Missing configuration");
    const { PrismaClient } = requireDb("@prisma/client");
    const databaseUrl = new URL(env.DATABASE_URL);
    if (databaseHost) databaseUrl.hostname = databaseHost;
    databaseUrl.searchParams.set("connect_timeout", "20");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } }, log: [] });
    try {
      const roles = await prisma.$queryRaw`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      if (!roles.length || roles.some((r) => r.rolsuper || r.rolbypassrls)) throw new Error("Unsafe application role");
      const tables = await prisma.$queryRaw`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
          EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'chat' AND c.relkind = 'r'
          AND (c.relname = 'tenants' OR EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
          ))
      `;
      const unprotected = tables.filter((t) => !t.relrowsecurity || !t.relforcerowsecurity || !t.has_policy);
      if (!tables.length || unprotected.length) throw new Error("Missing tenant security policies");
      const extensions = await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
      if (!extensions.length) throw new Error("Missing vector extension");
      return { protectedTables: tables.length, pgvector: true, roleBypassesRls: false };
    } finally {
      await prisma.$disconnect();
    }
  }),
  check("redis and queue counts", async () => {
    if (!env.REDIS_URL) throw new Error("Missing configuration");
    const Redis = requireQueue("ioredis");
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 10_000, retryStrategy: () => null, maxRetriesPerRequest: 0 });
    redis.on("error", () => {});
    try {
      await redis.connect();
      if (await redis.ping() !== "PONG") throw new Error("Redis unavailable");
      const queues = {};
      for (const name of ["chat-knowledge-ingest", "chat-workflow-run", "chat-followup"]) {
        const key = `${env.REDIS_KEY_PREFIX ?? "chat:"}queue:${name}`;
        queues[name] = { pending: await redis.llen(key), processing: await redis.llen(`${key}:processing`), dead: await redis.llen(`${key}:dead`) };
      }
      return { queues };
    } finally {
      redis.disconnect();
    }
  }),
  check("object storage access", async () => {
    if (!env.S3_BUCKET) throw new Error("Missing configuration");
    const { S3Client, HeadBucketCommand } = requireStorage("@aws-sdk/client-s3");
    const client = new S3Client({
      region: env.S3_ENDPOINT ? "auto" : (env.AWS_REGION ?? "us-east-1"),
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
      maxAttempts: 1,
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), { abortSignal: AbortSignal.timeout(15_000) });
    } finally {
      client.destroy();
    }
  }),
  check("smtp authentication (no message sent)", async () => {
    if (![env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASSWORD, env.SMTP_FROM_ADDRESS].every(Boolean)) throw new Error("Missing configuration");
    const nodemailer = requireEmail("nodemailer");
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), secure: env.SMTP_SECURE === "true",
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000,
    });
    try {
      await transporter.verify();
    } finally {
      transporter.close();
    }
  }),
]);

clearTimeout(watchdog);
process.exitCode = failed ? 1 : 0;
