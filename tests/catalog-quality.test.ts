import { describe, expect, it } from 'vitest';
import { CatalogQualityResponseSchema } from '@/shared/schemas';
import { getCatalogQuality } from '@/worker/catalog-quality';

function qualityDatabase() {
  const resultFor = (sql: string) => {
    if (sql.includes('MIN(origin_time)')) {
      return {
        total: 100,
        first_event_time: Date.parse('2026-08-01T00:00:00.000Z'),
        last_event_time: Date.parse('2026-09-01T00:00:00.000Z'),
        missing_magnitude: 2,
        missing_depth: 5,
        missing_magnitude_type: 2,
        missing_place: 1,
        invalid_coordinates: 1,
        negative_depth: 0,
        extreme_depth: 1,
        unusual_magnitude: 0,
      };
    }
    if (
      sql.includes('HAVING COUNT(*) > 1') &&
      sql.includes('source_event_id')
    ) {
      return { count: 0 };
    }
    if (sql.includes('FROM ingestion_runs')) {
      return {
        runs: 4,
        fetched: 500,
        accepted: 493,
        rejected: 3,
        duplicates_dropped: 4,
      };
    }
    return { count: 12 };
  };

  return {
    prepare(sql: string) {
      const statement = {
        async first<T>() {
          return resultFor(sql) as T;
        },
        bind() {
          return statement;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

describe('catalog quality audit', () => {
  it('reports coverage, revisions, and hard integrity failures', async () => {
    const quality = CatalogQualityResponseSchema.parse(
      await getCatalogQuality(
        qualityDatabase(),
        Date.parse('2026-09-09T00:00:00.000Z'),
      ),
    );

    expect(quality).toMatchObject({
      source: 'AFAD',
      status: 'critical',
      counts: {
        total: 100,
        revisedEvents: 12,
        missingMagnitude: 2,
        missingDepth: 5,
        invalidCoordinates: 1,
        duplicateSourceIds: 0,
      },
      coveragePercent: { magnitude: 98, depth: 95 },
      ingestionLast7Days: {
        runs: 4,
        fetched: 500,
        accepted: 493,
        rejected: 3,
        duplicatesDropped: 4,
      },
    });
    expect(
      quality.checks.find((check) => check.code === 'coordinates-valid'),
    ).toMatchObject({ status: 'fail', affected: 1 });
  });
});
