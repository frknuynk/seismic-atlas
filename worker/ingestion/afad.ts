import {
  AfadSourceError,
  fetchAfadWindowWithDiagnostics,
} from '@/worker/sources/afad';
import {
  IngestionLeaseLostError,
  runSourceSync,
  type RunSourceSyncOptions,
} from '@/worker/ingestion/source';

export { IngestionLeaseLostError };

export function runAfadSync(
  db: D1Database,
  options: RunSourceSyncOptions = {},
) {
  return runSourceSync(
    db,
    {
      source: 'AFAD',
      adapterVersion: 'afad-v3',
      fetchWindow: fetchAfadWindowWithDiagnostics,
      isSourceError: (error): error is AfadSourceError =>
        error instanceof AfadSourceError,
    },
    options,
  );
}
