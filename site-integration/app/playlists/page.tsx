import PlaylistGrid from "@/components/PlaylistGrid";
import Pagination from "@/components/Pagination";
import { getPlaylistsPage } from "@/lib/data";

export const revalidate = 3600;

export const metadata = { title: "Playlists" };

export default async function PlaylistsPage({ searchParams }: { searchParams: { page?: string } }) {
  const {playlists,total,page} = await getPlaylistsPage(Number(searchParams.page) || 1);

  return (
    <div>
      <h1 className="text-3xl font-bold">Playlists</h1>
      <p className="mt-2 text-zinc-400">Curated collections of lyrics.</p>
      <PlaylistGrid playlists={playlists} />
      <Pagination page={page} total={total} pageSize={18} basePath="/playlists" />
    </div>
  );
}
