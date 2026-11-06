// Boot only. Preflight is the first import: it exits with a sentence when the configuration is unusable.
import './core/preflight.ts';
import { dataDir, port, version } from './core/config.ts';
import { createApp, WEB_DIST } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { createYamlPageStore } from './pages/yaml-page-store.ts';

const LISTEN_HOST = '0.0.0.0';

const pages = await createYamlPageStore({ dataDir: dataDir() });

const server = createApp({ pages, dist: WEB_DIST }).listen(port(), LISTEN_HOST, () => {
  console.log(`[boot] personal-homepage ${version()} on http://localhost:${port()}, pages in ${dataDir()}`);
  stopOnSignals(server);
});
