import type { Server } from "http";
import { createApp } from "./app.js";
import { validateEnv } from "./startup/validateEnv.js";
import { startLicenseeRefresh, loadedLicensee } from "./licensee/brand.js";

export async function startServer() {
  const envStatus = validateEnv();
  const { app, dependencies } = createApp({ envStatus });

  await dependencies.initAll();

  // KS_AGENT_v1_LICENSEE - the licensee's names and contacts, from GET {SERVER_URL}/api/licensee, now and every
  // 5 minutes. Startup waits at most a few seconds for the first load; until it succeeds the KS_* settings apply.
  const licensee = startLicenseeRefresh();
  await licensee.ready;
  const brand = loadedLicensee();
  console.log(JSON.stringify({ event: "licensee_loaded", ok: Boolean(brand), company: brand?.company_name ?? null, assistant: brand?.assistant_name ?? null }));

  const [db, redis, externalApi, openai, twilio] = await Promise.all([
    dependencies.db.status(),
    dependencies.redis.status(),
    dependencies.externalApi.status(),
    dependencies.openai.status(),
    dependencies.twilio.status(),
  ]);

  console.log(
    JSON.stringify({
      event: "startup_summary",
      envMode: envStatus.mode,
      port: envStatus.values.port,
      dependencies: { db, redis, externalApi, openai, twilio },
    }),
  );

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(envStatus.values.port, "0.0.0.0", () => {
      console.log(`Server running on ${envStatus.values.port}`);
      resolve(listeningServer);
    });
  });

  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  const closeServer = async () => {
    if (!server.listening) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  const shutdown = async () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shuttingDown = true;

    shutdownPromise = (async () => {
      licensee.stop();
      try {
        await dependencies.closeAll();
      } catch {
        // Teardown errors must not affect shutdown completion.
      }

      await closeServer();
    })();

    return shutdownPromise;
  };

  const handleSignal = async (_signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await shutdown();
    return;
  };

  if (process.env.NODE_ENV !== "test") {
    process.on("SIGINT", () => {
      void handleSignal("SIGINT");
    });
    process.on("SIGTERM", () => {
      void handleSignal("SIGTERM");
    });
  }

  return { server, envStatus, dependencies, shutdown };
}
