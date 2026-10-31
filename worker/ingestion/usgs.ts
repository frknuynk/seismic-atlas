import {
  UsgsSourceError,
  fetchUsgsWindowWithDiagnostics,
} from '@/worker/sources/usgs';
import {
  runSourceSync,
  type RunSourceSyncOptions,
} from '@/worker/ingestion/source';
import { associateSourceEvents } from '@/worker/ingestion/association';

export function runUsgsSync(
  db: D1Database,
  options: RunSourceSyncOptions = {},
) {
  return runSourceSync(
    db,
    {
      source: 'USGS',
      adapterVersion: 'usgs-fdsn-v1',
      fetchWindow: fetchUsgsWindowWithDiagnostics,
      isSourceError: (error): error is UsgsSourceError =>
        error instanceof UsgsSourceError && error.source === 'USGS',
      afterPersist: associateSourceEvents,
    },
    options,
  );
}
