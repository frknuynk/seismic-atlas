import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const clientRoot = path.resolve('dist/client');
const APP_LIMIT = 500 * 1024;
const MAP_LIMIT = 1_200 * 1024;

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(target) : [target];
      }),
    )
  ).flat();
}

const javascript = (await filesUnder(clientRoot)).filter((file) =>
  /\.(?:js|mjs)$/.test(file),
);
const manifest = JSON.parse(
  await readFile(path.join(clientRoot, '.vite', 'manifest.json'), 'utf8'),
);
const mapVendorFiles = new Set(
  Object.entries(manifest)
    .filter(([key, entry]) =>
      /maplibre|mapbox/i.test(`${key} ${entry.name ?? ''} ${entry.src ?? ''}`),
    )
    .map(([, entry]) => entry.file),
);
const failures = [];

for (const file of javascript) {
  const bytes = (await stat(file)).size;
  const relative = path.relative(clientRoot, file);
  const isMapVendor =
    mapVendorFiles.has(relative) ||
    /maplibre|mapbox|\/workers\//i.test(relative);
  const limit = isMapVendor ? MAP_LIMIT : APP_LIMIT;
  if (bytes > limit) failures.push({ relative, bytes, limit });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `${failure.relative}: ${(failure.bytes / 1024).toFixed(1)} kB exceeds ${(failure.limit / 1024).toFixed(0)} kB`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Bundle budget passed for ${javascript.length} client chunks (app 500 kB; map vendor/worker 1.2 MB).`,
  );
}
