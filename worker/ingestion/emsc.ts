import {
  EmscSourceError,
  fetchEmscWindowWithDiagnostics,
} from '@/worker/sources/emsc';
import {
  runSourceSync,
  type RunSourceSyncOptions,
} from '@/worker/ingestion/source';
import { associateSourceEvents } from '@/worker/ingestion/association';

export function runEmscSync(
  db: D1Database,
  options: RunSourceSyncOptions = {},
) {
  return runSourceSync(
    db,
    {
      source: 'EMSC',
      adapterVersion: 'emsc-fdsn-v1',
      fetchWindow: fetchEmscWindowWithDiagnostics,
      isSourceError: (error): error is EmscSourceError =>
        error instanceof EmscSourceError && error.source === 'EMSC',
      afterPersist: associateSourceEvents,
    },
    options,
  );
}
