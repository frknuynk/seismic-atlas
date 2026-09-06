import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const EXTENT = [22, 33, 47, 44];
const SOURCE_REVISION = '56816508ad92fd6846dad1163b1c8c01376a2cd1';
const PROCESSED_AT = '2026-09-06T00:00:00.000Z';
const inputPath = resolve(
  process.argv[2] ?? 'data/raw/gem_active_faults.geojson',
);
const outputPath = resolve(
  process.argv[3] ?? 'public/data/faults/gem-active-faults-turkiye.geojson',
);
const tilesPath = resolve(
  process.argv[4] ?? outputPath.replace(/\.geojson$/i, '.pmtiles'),
);
const execFileAsync = promisify(execFile);

function regionCode([x, y]) {
  let code = 0;
  if (x < EXTENT[0]) code |= 1;
  if (x > EXTENT[2]) code |= 2;
  if (y < EXTENT[1]) code |= 4;
  if (y > EXTENT[3]) code |= 8;
  return code;
}

function clipSegment(start, end) {
  let [x0, y0] = start;
  let [x1, y1] = end;
  let code0 = regionCode(start);
  let code1 = regionCode(end);

  while (true) {
    if (!(code0 | code1))
      return [
        [x0, y0],
        [x1, y1],
      ];
    if (code0 & code1) return null;

    const outside = code0 || code1;
    let x;
    let y;
    if (outside & 8) {
      x = x0 + ((x1 - x0) * (EXTENT[3] - y0)) / (y1 - y0);
      y = EXTENT[3];
    } else if (outside & 4) {
      x = x0 + ((x1 - x0) * (EXTENT[1] - y0)) / (y1 - y0);
      y = EXTENT[1];
    } else if (outside & 2) {
      y = y0 + ((y1 - y0) * (EXTENT[2] - x0)) / (x1 - x0);
      x = EXTENT[2];
    } else {
      y = y0 + ((y1 - y0) * (EXTENT[0] - x0)) / (x1 - x0);
      x = EXTENT[0];
    }

    if (outside === code0) {
      x0 = x;
      y0 = y;
      code0 = regionCode([x0, y0]);
    } else {
      x1 = x;
      y1 = y;
      code1 = regionCode([x1, y1]);
    }
  }
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function compactPoint(point) {
  return point.map((value) => Number(value.toFixed(5)));
}

function clipLine(coordinates) {
  const parts = [];
  let current = [];

  for (let index = 1; index < coordinates.length; index += 1) {
    const segment = clipSegment(coordinates[index - 1], coordinates[index]);
    if (!segment) {
      if (current.length > 1) parts.push(current);
      current = [];
      continue;
    }

    const [start, end] = segment.map(compactPoint);
    if (!current.length) current.push(start, end);
    else if (samePoint(current.at(-1), start)) current.push(end);
    else {
      if (current.length > 1) parts.push(current);
      current = [start, end];
    }
  }

  if (current.length > 1) parts.push(current);
  return parts;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const source = JSON.parse(await readFile(inputPath, 'utf8'));
const features = [];

for (const [index, feature] of source.features.entries()) {
  if (feature.geometry?.type !== 'LineString') continue;
  const parts = clipLine(feature.geometry.coordinates);
  if (!parts.length) continue;

  const properties = feature.properties ?? {};
  const catalogId = cleanText(properties.catalog_id) ?? `GEM-${index + 1}`;
  features.push({
    type: 'Feature',
    properties: {
      id: catalogId,
      name: cleanText(properties.name),
      slip_type: cleanText(properties.slip_type),
      catalog_name: cleanText(properties.catalog_name),
      catalog_id: cleanText(properties.catalog_id),
      average_dip: cleanText(properties.average_dip),
      dip_dir: cleanText(properties.dip_dir),
      net_slip_rate: cleanText(properties.net_slip_rate),
    },
    geometry:
      parts.length === 1
        ? { type: 'LineString', coordinates: parts[0] }
        : { type: 'MultiLineString', coordinates: parts },
  });
}

const output = {
  type: 'FeatureCollection',
  name: 'GEM active faults — Türkiye processing extent',
  attribution: '© GEM Foundation contributors',
  license: 'CC BY-SA 4.0',
  source: 'https://github.com/GEMScienceTools/gem-global-active-faults',
  sourceRevision: SOURCE_REVISION,
  processedAt: PROCESSED_AT,
  bbox: EXTENT,
  features,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`);
await execFileAsync('tippecanoe', [
  '--quiet',
  '--output',
  tilesPath,
  '--layer',
  'active_faults',
  '--minimum-zoom',
  '4',
  '--maximum-zoom',
  '12',
  '--force',
  '--no-feature-limit',
  '--no-tile-size-limit',
  '--simplification=4',
  '--preserve-input-order',
  outputPath,
]);
process.stdout.write(
  `${features.length} clipped fault features written to ${outputPath} and ${tilesPath}\n`,
);
