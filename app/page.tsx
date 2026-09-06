import { AtlasShell } from '@/components/atlas/atlas-shell';

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  return <AtlasShell initialSearch={await searchParams} />;
}
