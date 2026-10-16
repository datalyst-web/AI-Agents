import "./instrument.js";
import { buildApp } from "./app.js";
import { buildAppContext } from "./lib/context.js";
import { startChannelReplyConsumer } from "./engine/replyPacing.js";
import { env } from "./env.js";

async function main() {
  const ctx = buildAppContext();
  const app = await buildApp(ctx);
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  // Messaging replies held back by an agent's reply delay.
  startChannelReplyConsumer(ctx, app.log);
  app.log.info(`chat-api listening on :${env.API_PORT} (${env.NODE_ENV})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
