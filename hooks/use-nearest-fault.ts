'use client';

import { useEffect, useState } from 'react';
import {
  findNearestFault,
  type FaultFeatureCollection,
  type NearbyFault,
} from '@/lib/geo/nearest-fault';

const FAULTS_URL = '/data/faults/gem-active-faults-turkiye.geojson';
let faultDatasetPromise: Promise<FaultFeatureCollection> | null = null;

function loadFaultDataset() {
  faultDatasetPromise ??= fetch(FAULTS_URL).then((response) => {
    if (!response.ok) throw new Error('Fault context is unavailable.');
    return response.json() as Promise<FaultFeatureCollection>;
  });
  return faultDatasetPromise;
}

export function useNearestFault(
  point: { longitude: number; latitude: number } | null,
) {
  const [fault, setFault] = useState<NearbyFault | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!point) {
      setFault(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void loadFaultDataset()
      .then((dataset) => {
        if (!cancelled) {
          setFault(findNearestFault(dataset, point.longitude, point.latitude));
        }
      })
      .catch(() => {
        if (!cancelled) setFault(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [point?.latitude, point?.longitude]);

  return { fault, loading };
}
