import { describe, expect, it } from 'vitest';
import {
  findNearestFault,
  type FaultFeatureCollection,
} from '@/lib/geo/nearest-fault';

const collection: FaultFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'far',
        name: 'Far fault',
        slip_type: 'Dextral',
        catalog_name: 'Test',
        catalog_id: 'FAR-1',
        average_dip: null,
        dip_dir: null,
        net_slip_rate: null,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [30, 40],
          [31, 40],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        id: 'near',
        name: null,
        slip_type: 'Normal',
        catalog_name: 'Test',
        catalog_id: 'NEAR-1',
        average_dip: null,
        dip_dir: null,
        net_slip_rate: null,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [35, 38],
          [36, 38],
        ],
      },
    },
  ],
};

describe('findNearestFault', () => {
  it('returns the closest segment with a truthful fallback label', () => {
    const fault = findNearestFault(collection, 35.5, 38.1);

    expect(fault?.id).toBe('near');
    expect(fault?.label).toBe('Normal fault segment');
    expect(fault?.distanceKm).toBeGreaterThan(10);
    expect(fault?.distanceKm).toBeLessThan(12);
  });

  it('returns null for an empty collection', () => {
    expect(
      findNearestFault({ type: 'FeatureCollection', features: [] }, 35, 38),
    ).toBeNull();
  });
});
