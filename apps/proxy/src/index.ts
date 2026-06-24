import { env } from "./env";
import { endpointCache } from "./endpointCache";
import { createServer } from "./server";

async function main() {
  await endpointCache.start();
  const app = createServer();
  app.listen(env.port, () => {
    console.log(`Stent proxy listening on :${env.port}`);
    console.log(`  facilitator: ${env.facilitatorUrl}`);
    console.log(`  network    : ${env.network}`);
  });
}

main().catch((err) => {
  console.error("[proxy] fatal:", err);
  process.exit(1);
});
