import { api } from '@/worker/app';

export function GET(request: Request) {
  return api.fetch(request);
}
