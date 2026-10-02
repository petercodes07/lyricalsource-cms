import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/Link";
import { getNewsPage } from "@/lib/data";
import NewsCard from "@/components/NewsCard";
import Pagination from "@/components/Pagination";

export const revalidate = 1800;
const NEWS_PAGE_SIZE = 12;

export const metadata: Metadata = {
  title: "Music News",
  description: "Latest music news and breaking stories on LyricalSource.",
};

export default async function NewsPage({ searchParams }: { searchParams: { page?: string; tag?: string } }) {
  const tag = searchParams.tag?.trim().slice(0,200);
  const { articles: latest, featured, total, totalPages, page } = await getNewsPage(Number(searchParams.page) || 1, tag || '');

  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-white">Music News</h1>
        <p className="mt-2 text-zinc-400">
          {tag ? <><span>News tagged #{tag}</span>{" · "}<Link href="/news" className="text-violet-300 hover:text-white">Clear filter</Link></> : "Breaking stories and updates from the music world."}
        </p>
      </div>

      {/* Featured story */}
      {featured && (
        <Link
          href={`/articles/${featured.slug}`}
          className="group relative flex flex-col overflow-hidden transition md:flex-row"
        >
          {featured.image && (
            <div className="relative aspect-video shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 md:aspect-[16/9] md:w-1/2">
              <Image
                src={featured.image}
                alt={featured.title}
                fill
                className="object-cover transition duration-500 group-hover:scale-105"
                unoptimized
                priority
              />
            </div>
          )}
          <div className="flex flex-col justify-center gap-4 py-6 md:px-10">
            <h2 className="text-2xl font-bold leading-tight text-white md:text-3xl">
              {featured.title}
            </h2>
            <p className="line-clamp-3 text-sm leading-relaxed text-zinc-400 md:text-base">
              {featured.excerpt}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
              {featured.publishedAt} · {featured.author}
            </p>
          </div>
        </Link>
      )}

      {/* News feed */}
      {latest.length > 0 && (
        <div>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold text-white">Latest News</h2>
            <p className="text-sm text-zinc-400">{total} stories · Page {page} of {totalPages}</p>
          </div>
          <div className="song-results-grid song-results-grid--six">
            {latest.map(a => <NewsCard key={a.slug} article={a} />)}
          </div>
          <Pagination page={page} total={Math.max(0,total-1)} pageSize={NEWS_PAGE_SIZE} basePath="/news" query={tag ? { tag } : undefined} />
        </div>
      )}

      {total === 0 && (
        <p className="text-center text-zinc-500">{tag ? "No news stories match this tag." : "No news stories yet."}</p>
      )}
    </div>
  );
}
