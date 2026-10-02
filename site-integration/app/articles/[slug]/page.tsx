import { getPreviewArticle } from "@/lib/article-preview";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/Link";
import { getAllArticles, getArticle } from "@/lib/data";
import { siteConfig } from "@/lib/site-config";
import ShareButtons from "@/components/ShareButtons";

function processWordPressContent(body: string): string {
  return body
    // Convert [caption ...]<img ...> text[/caption] to <figure>
    .replace(
      /\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/g,
      (_, inner) => {
        const imgMatch = inner.match(/(<img[^>]*>)/i);
        const img = imgMatch ? imgMatch[1] : "";
        const caption = inner.replace(/<img[^>]*>/i, "").trim();
        return `<figure class="wp-caption">${img}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
      }
    )
    // Strip data-start / data-end editor attributes
    .replace(/\s*data-(?:start|end)="\d+"/g, "")
    // Fix lyricalsource image URLs to load from wp-content
    .replace(/src="https:\/\/lyricalsource\.com\//g, 'src="https://lyricalsource.com/')
    // Normalise line endings
    .replace(/\r\n/g, "\n");
}

export const dynamic = "force-dynamic";
type PreviewQuery = { preview?: string; signature?: string };

export async function generateMetadata({
  params, searchParams,
}: {
  params: { slug: string };
  searchParams: PreviewQuery;
}): Promise<Metadata> {
  const preview = await getPreviewArticle(params.slug, searchParams);
  const article = preview || await getArticle(params.slug);
  if (!article) return { title: "Article not found" };
  return {
    ...(preview ? { robots: { index: false, follow: false }, referrer: "no-referrer" as const } : {}),
    title: article.title,
    description: article.excerpt,
    alternates: { canonical: `${siteConfig.url}/articles/${params.slug}` },
    openGraph: {
      title: article.title,
      description: article.excerpt,
      type: "article",
      publishedTime: article.publishedAt,
      authors: [article.author],
      tags: article.tags,
      siteName: siteConfig.name,
      ...(article.image ? { images: [{ url: article.image, alt: article.title }] } : {}),
    },
  };
}

export default async function ArticlePage({ params, searchParams }: { params: { slug: string }; searchParams: PreviewQuery }) {
  const preview = await getPreviewArticle(params.slug, searchParams);
  const article = preview || await getArticle(params.slug);
  if (!article) notFound();
  const related = (await getAllArticles().catch(() => []))
    .filter((candidate) => candidate.slug !== article.slug)
    .map((candidate) => ({
      article: candidate,
      score: candidate.tags.filter((tag) => article.tags.includes(tag)).length * 2 + Number(candidate.postType === article.postType),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ article: candidate }) => candidate);

  const articleLd = {
    "@context": "https://schema.org",
    "@type": article.postType === "news" ? "NewsArticle" : "BlogPosting",
    headline: article.title,
    description: article.excerpt,
    ...(article.image ? { image: article.image } : {}),
    author: { "@type": "Person", name: article.author },
    datePublished: article.publishedAt,
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    url: `${siteConfig.url}/articles/${params.slug}`,
    mainEntityOfPage: `${siteConfig.url}/articles/${params.slug}`,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
      {
        "@type": "ListItem", position: 2,
        name: article.postType === "news" ? "News" : "Blog",
        item: `${siteConfig.url}/${article.postType === "news" ? "news" : "blog"}`,
      },
      { "@type": "ListItem", position: 3, name: article.title, item: `${siteConfig.url}/articles/${params.slug}` },
    ],
  };

  return (
    <article className="mx-auto max-w-3xl">
      {preview && <p className="mb-6 rounded-lg border border-amber-400/30 p-4 text-amber-200">Private preview of the saved draft. This article has not been published.</p>}
      {!preview && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <p className="text-sm text-zinc-500">
        {article.publishedAt} · {article.author}
      </p>
      <h1 className="mt-2 text-4xl font-bold">{article.title}</h1>
      <p className="mt-3 text-lg text-zinc-300">{article.excerpt}</p>
      {article.image && (
        <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
          <Image
            src={article.image}
            alt={article.title}
            fill
            priority
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 768px"
            unoptimized={article.image.startsWith("/")}
          />
        </div>
      )}
      <div
        className="mt-8 prose prose-invert prose-zinc max-w-none leading-relaxed
          prose-headings:font-bold prose-headings:text-white
          prose-a:text-brand prose-a:no-underline hover:prose-a:underline
          prose-img:rounded-xl prose-img:w-full
          [&_figure.wp-caption]:my-6 [&_figure.wp-caption]:rounded-xl [&_figure.wp-caption]:overflow-hidden
          [&_figcaption]:text-xs [&_figcaption]:text-zinc-500 [&_figcaption]:px-3 [&_figcaption]:py-2 [&_figcaption]:bg-white/5"
        dangerouslySetInnerHTML={{ __html: processWordPressContent(article.body) }}
      />
      <div className="mt-10 flex flex-wrap gap-2">
        {article.tags.map((t) => (
          <Link
            key={t}
            href={`/news?tag=${encodeURIComponent(t)}`}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-white"
          >
            #{t}
          </Link>
        ))}
      </div>
      <div className="mt-8">
        {!preview && <ShareButtons title={article.title} url={`${siteConfig.url}/articles/${params.slug}`} />}
      </div>
      {related.length > 0 && (
        <section className="mt-14 border-t border-white/10 pt-8" aria-labelledby="related-stories">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 id="related-stories" className="text-xl font-semibold text-white">Related stories</h2>
            <Link href={article.postType === "news" ? "/news" : "/blog"} className="text-sm text-violet-300 hover:text-white">
              More {article.postType === "news" ? "news" : "posts"} →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link key={item.slug} href={`/articles/${item.slug}`} className="min-w-0 rounded-xl border border-white/10 bg-zinc-900/50 p-4 transition hover:border-violet-500/50">
                <span className="line-clamp-3 break-words text-sm font-semibold text-zinc-100">{item.title}</span>
                <span className="mt-3 block text-xs text-zinc-500">{item.publishedAt}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
