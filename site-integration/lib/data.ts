import { unstable_cache } from "next/cache";
import { getPool } from "./db";
import { memCache } from "./mem-cache";
import type { Artist, Song, Article, Playlist, Genre, Page, Album } from "./types";
import { decodeHTMLEntities } from "./text-utils";

const DEV = process.env.NODE_ENV !== "production";

function cache<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  keyParts: string[],
  opts: { revalidate: number }
): (...args: T) => Promise<R> {
  const key = keyParts.join(':');
  // Tag dependencies keep article saves from evicting the song/album catalog.
  const tags = /sitemap/.test(key) ? ['articles','songs','albums','playlists','artists','pages']
    : /discovery/.test(key) ? ['articles','songs']
    : /article|news|blog/.test(key) ? ['articles']
    : /playlist/.test(key) ? ['playlists','songs']
    : /album/.test(key) ? ['albums','songs']
    : /artist/.test(key) ? ['artists','songs','albums']
    : /genre/.test(key) ? ['genres','songs']
    : /page/.test(key) ? ['pages'] : ['songs'];
  return (...args: T) => {
    const cacheKey = `${key}:${JSON.stringify(args)}`;
    const volatile = /search/.test(key) || (key === 'news-page' && !!args[1]);
    const load = DEV || volatile ? () => fn(...args) : () => unstable_cache(fn as any, ['scale-v1',...keyParts,JSON.stringify(args)], {...opts,tags:['site-data',...tags]})(...args) as Promise<R>;
    // Brief production cache coalesces simultaneous misses, while Next keeps the durable cache.
    return memCache(cacheKey, DEV || volatile ? Math.min(opts.revalidate * 1000,30000) : 5000, load, tags);
  };
}

// ── Songs / Lyrics ────────────────────────────────────────────────────────────

const SONG_LIST_SELECT = `
  SELECT
    s.id, s.slug, s.title, s.excerpt,
    s.artist_name, s.artist_slug,
    s.is_trending,
    s.image_url, s.views, s.views_24h, s.published_at,
    s.youtube_url,
    GROUP_CONCAT(DISTINCT sg.genre_slug ORDER BY sg.genre_slug) AS genre_slugs,
    GROUP_CONCAT(DISTINCT g.name        ORDER BY sg.genre_slug) AS genre_names
  FROM songs s
  LEFT JOIN song_genres sg ON sg.song_id = s.id
  LEFT JOIN genres g       ON g.slug = sg.genre_slug`;

const SONG_FULL_SELECT = `
  SELECT
    s.*,
    GROUP_CONCAT(DISTINCT sg.genre_slug ORDER BY sg.genre_slug) AS genre_slugs,
    GROUP_CONCAT(DISTINCT g.name        ORDER BY sg.genre_slug) AS genre_names,
    GROUP_CONCAT(DISTINCT st.tag)                               AS tags
  FROM songs s
  LEFT JOIN song_genres sg ON sg.song_id = s.id
  LEFT JOIN genres g       ON g.slug = sg.genre_slug
  LEFT JOIN song_tags st   ON st.song_id = s.id`;

function rowToSong(row: any): Song {
  const genreNames: string[] = row.genre_names ? row.genre_names.split(",") : [];
  const genreSlugs: string[] = row.genre_slugs ? row.genre_slugs.split(",") : [];
  const tags: string[]       = row.tags         ? row.tags.split(",")        : [];
  const releaseYear = row.published_at
    ? new Date(row.published_at).getFullYear()
    : new Date().getFullYear();

  return {
    slug:        row.slug,
    title:       decodeHTMLEntities(row.title),
    artistSlug:  row.artist_slug ?? "",
    artistName:  decodeHTMLEntities(row.artist_name ?? ""),
    genre:       genreNames[0] ?? "Pop",
    genreSlug:   genreSlugs[0] ?? "pop",
    releaseYear,
    releaseDate: row.published_at
      ? new Date(row.published_at).toISOString().slice(0, 10)
      : "",
    isTrending:  Boolean(row.is_trending),
    views:       Number(row.views ?? 0),
    lyrics:      row.lyrics ?? "",
    image:       row.image_url ?? undefined,
    description: decodeHTMLEntities((row.excerpt ?? "").replace(/<[^>]+>/g, "").trim()),
    youtubeUrl:  row.youtube_url ?? undefined,
    streamUrl:   row.stream_url  ?? undefined,
    tags,
    qa:          [],
  };
}

export const getAllSongs = cache(
  async (): Promise<Song[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      ${SONG_LIST_SELECT}
      GROUP BY s.id
      ORDER BY s.published_at DESC
    `);
    return rows.map(rowToSong);
  },
  ["all-songs"],
  { revalidate: 600 }
);

export const getSongs = cache(
  async (page = 1, pageSize = 24): Promise<{ songs: Song[]; total: number }> => {
    const offset = (page - 1) * pageSize;
    const pool = await getPool();
    const [[countRows], [rows]] = await Promise.all([
      pool.query<any[]>("SELECT COUNT(*) AS total FROM songs"),
      pool.query<any[]>(`
        ${SONG_LIST_SELECT}
        GROUP BY s.id
        ORDER BY s.published_at DESC
        LIMIT ? OFFSET ?
      `, [pageSize, offset]),
    ]);
    return { songs: rows.map(rowToSong), total: Number(countRows[0]?.total ?? 0) };
  },
  ["paginated-songs"],
  { revalidate: 600 }
);

export const getSong = cache(
  async (slug: string): Promise<Song | null> => {
    const pool = await getPool();
    const [rows] = await pool.query<any[]>(`
      ${SONG_FULL_SELECT}
      WHERE s.slug = ?
      GROUP BY s.id
      LIMIT 1
    `, [slug]);
    if (!rows.length) return null;

    const song = rowToSong(rows[0]);

    const [qaRows] = await pool.query<any[]>(`
      SELECT question, answer
      FROM song_qa
      WHERE song_id = ?
      ORDER BY position ASC
    `, [rows[0].id]);
    song.qa = qaRows.map((r: any) => ({ question: r.question, answer: r.answer }));

    return song;
  },
  ["song"],
  { revalidate: 600 }
);

export const earlyAccessSongs = cache(
  async (page = 1, pageSize = 24): Promise<{ songs: Song[]; total: number }> => {
    const offset = (page - 1) * pageSize;
    const pool = await getPool();
    const [[countRows], [rows]] = await Promise.all([
      pool.query<any[]>(`SELECT COUNT(*) AS total FROM songs WHERE is_early_access = 1`),
      pool.query<any[]>(`
        ${SONG_LIST_SELECT}
        WHERE s.is_early_access = 1
        GROUP BY s.id
        ORDER BY s.published_at DESC
        LIMIT ? OFFSET ?
      `, [pageSize, offset]),
    ]);
    return { songs: rows.map(rowToSong), total: Number(countRows[0]?.total ?? 0) };
  },
  ["early-access-songs"],
  { revalidate: 300 }
);

export const featuredSongs = cache(
  async (): Promise<Song[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      ${SONG_LIST_SELECT}
      WHERE s.is_featured = 1
      GROUP BY s.id
      ORDER BY s.views DESC
      LIMIT 6
    `);
    return rows.map(rowToSong);
  },
  ["featured-songs"],
  { revalidate: 300 }
);

export const popularSongs = cache(
  async (): Promise<Song[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      ${SONG_LIST_SELECT}
      GROUP BY s.id
      ORDER BY s.views DESC
      LIMIT 10
    `);
    return rows.map(rowToSong);
  },
  ["popular-songs"],
  { revalidate: 60 }
);

export const risingSongs = cache(
  async (limit = 20): Promise<Song[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      ${SONG_LIST_SELECT}
      WHERE s.views_24h > 0
      GROUP BY s.id
      ORDER BY s.views_24h DESC, s.views DESC
      LIMIT ?
    `, [limit]);
    return rows.map(rowToSong);
  },
  ["rising-songs"],
  { revalidate: 60 }
);

export const songsByArtist = cache(
  async (artistSlug: string, page = 1, pageSize = 24): Promise<{ songs: Song[]; total: number }> => {
    const offset = (page - 1) * pageSize;
    const pool = await getPool();
    const [[countRes], [songRes]] = await Promise.all([
      pool.query<any[]>(
        "SELECT COUNT(*) AS total FROM songs WHERE artist_slug = ?",
        [artistSlug]
      ),
      pool.query<any[]>(`
        ${SONG_LIST_SELECT}
        WHERE s.artist_slug = ?
        GROUP BY s.id
        ORDER BY s.published_at DESC
        LIMIT ? OFFSET ?
      `, [artistSlug, pageSize, offset]),
    ]);
    return {
      songs: (songRes as any[]).map(rowToSong),
      total: Number((countRes as any[])[0]?.total ?? 0),
    };
  },
  ["songs-by-artist"],
  { revalidate: 1800 }
);

export const songsByGenre = cache(
  async (genreSlug: string, page = 1, pageSize = 24): Promise<{ songs: Song[]; total: number }> => {
    const offset = (page - 1) * pageSize;
    const pool = await getPool();
    const [[countRes], [songRes]] = await Promise.all([
      pool.query<any[]>(
        "SELECT COUNT(*) AS total FROM song_genres WHERE genre_slug = ?",
        [genreSlug]
      ),
      pool.query<any[]>(`
        ${SONG_LIST_SELECT}
        JOIN song_genres sg2 ON sg2.song_id = s.id AND sg2.genre_slug = ?
        GROUP BY s.id
        ORDER BY s.published_at DESC
        LIMIT ? OFFSET ?
      `, [genreSlug, pageSize, offset]),
    ]);
    return {
      songs: (songRes as any[]).map(rowToSong),
      total: Number((countRes as any[])[0]?.total ?? 0),
    };
  },
  ["songs-by-genre"],
  { revalidate: 600 }
);

export const searchSongs = cache(
  async (query: string): Promise<Song[]> => {
    const pool = await getPool();
    const terms = query.trim().split(/\s+/).filter(w => w.length >= 3);
    if (terms.length > 0) {
      // FULLTEXT boolean mode with prefix wildcard — uses ft_title_artist index
      const boolQuery = terms.map(w => `+${w}*`).join(" ");
      const [rows] = await pool.query<any[]>(`
        ${SONG_LIST_SELECT}
        WHERE MATCH(s.title, s.artist_name) AGAINST (? IN BOOLEAN MODE)
        GROUP BY s.id
        ORDER BY s.published_at DESC
        LIMIT 50
      `, [boolQuery]);
      if ((rows as any[]).length > 0) return (rows as any[]).map(rowToSong);
    }
    // Fallback for short terms or zero FULLTEXT hits
    const like = `%${query}%`;
    const [rows] = await pool.query<any[]>(`
      ${SONG_LIST_SELECT}
      WHERE s.title LIKE ? OR s.artist_name LIKE ?
      GROUP BY s.id
      ORDER BY s.published_at DESC
      LIMIT 50
    `, [like, like]);
    return (rows as any[]).map(rowToSong);
  },
  ["search-songs"],
  { revalidate: 120 }
);

// ── Artists ───────────────────────────────────────────────────────────────────

function rowToArtist(row: any): Artist {
  const genres: string[] = row.genre_names ? row.genre_names.split(",") : [];
  return {
    slug:   row.slug,
    name:   decodeHTMLEntities(row.name),
    bio:    decodeHTMLEntities(row.bio || `${row.name} is an artist on LyricalSource.`),
    genres,
    image:  row.image_url ?? undefined,
  };
}

export const topArtists = cache(
  async (limit = 10): Promise<Artist[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.name, a.bio, a.image_url,
             GROUP_CONCAT(DISTINCT g.name ORDER BY g.name) AS genre_names,
             COUNT(DISTINCT s.id)  AS song_count,
             COALESCE(SUM(s.views), 0) AS total_views
      FROM artists a
      LEFT JOIN artist_genres ag ON ag.artist_id = a.id
      LEFT JOIN genres g         ON g.slug = ag.genre_slug
      LEFT JOIN songs s          ON s.artist_slug = a.slug
      GROUP BY a.id
      ORDER BY total_views DESC
      LIMIT ?
    `, [limit]);
    return rows.map(row => ({
      ...rowToArtist(row),
      totalViews: Number(row.total_views ?? 0),
      songCount:  Number(row.song_count  ?? 0),
    }));
  },
  ["top-artists"],
  { revalidate: 120 }
);

export const getAllArtists = cache(
  async (): Promise<Artist[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.name, a.bio, a.image_url,
             GROUP_CONCAT(DISTINCT g.name ORDER BY g.name) AS genre_names
      FROM artists a
      LEFT JOIN artist_genres ag ON ag.artist_id = a.id
      LEFT JOIN genres g         ON g.slug = ag.genre_slug
      GROUP BY a.id
      ORDER BY a.name ASC
    `);
    return rows.map(rowToArtist);
  },
  ["all-artists"],
  { revalidate: 7200 }
);

export const getArtist = cache(
  async (slug: string): Promise<Artist | null> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.name, a.bio, a.image_url,
             GROUP_CONCAT(DISTINCT g.name ORDER BY g.name) AS genre_names
      FROM artists a
      LEFT JOIN artist_genres ag ON ag.artist_id = a.id
      LEFT JOIN genres g         ON g.slug = ag.genre_slug
      WHERE a.slug = ?
      GROUP BY a.id
      LIMIT 1
    `, [slug]);
    return rows.length ? rowToArtist(rows[0]) : null;
  },
  ["artist"],
  { revalidate: 7200 }
);

// ── Genres ────────────────────────────────────────────────────────────────────

export const getAllGenres = cache(
  async (): Promise<Genre[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT slug, name, description, song_count, icon, color
      FROM genres
      WHERE song_count > 0
      ORDER BY song_count DESC
    `);
    return rows.map((r: any) => ({
      slug:        r.slug,
      name:        decodeHTMLEntities(r.name),
      description: decodeHTMLEntities(r.description || `${r.name} lyrics and songs.`),
      icon:        r.icon,
      color:       r.color || "#27272a",
      songCount:   Number(r.song_count ?? 0),
    }));
  },
  ["all-genres"],
  { revalidate: 7200 }
);

export const getGenre = cache(
  async (slug: string): Promise<Genre | null> => {
    const [rows] = await (await getPool()).query<any[]>(
      "SELECT slug, name, description, song_count, icon, color FROM genres WHERE slug = ? LIMIT 1",
      [slug]
    );
    if (!rows.length) return null;
    const r = rows[0] as any;
    return {
      slug:        r.slug,
      name:        decodeHTMLEntities(r.name),
      description: decodeHTMLEntities(r.description || `${r.name} lyrics and songs.`),
      icon:        r.icon,
      color:       r.color || "#27272a",
      songCount:   Number(r.song_count ?? 0),
    };
  },
  ["genre"],
  { revalidate: 7200 }
);

// ── Articles ──────────────────────────────────────────────────────────────────

function rowToArticle(row: any): Article {
  const tags: string[] = row.tags ? row.tags.split(",") : [];
  return {
    slug:        row.slug,
    title:       decodeHTMLEntities(row.title),
    excerpt:     decodeHTMLEntities(row.excerpt ?? ""),
    body:        row.body ?? "",
    author:      row.author ?? "Editorial",
    publishedAt: new Date(row.published_at).toISOString().slice(0, 10),
    tags,
    image:       row.image_url ?? undefined,
    postType:    (["news", "blog", "album", "playlist"].includes(row.post_type) ? row.post_type : "blog") as Article["postType"],
  };
}

export const getAllArticles = cache(
  async (limit?: number): Promise<Article[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.title, a.excerpt, a.author, a.image_url, a.published_at, a.post_type,
             GROUP_CONCAT(DISTINCT at.tag) AS tags
      FROM articles a
      LEFT JOIN article_tags at ON at.article_id = a.id
      WHERE a.status = 'published'
      GROUP BY a.id
      ORDER BY a.published_at DESC
      LIMIT ?
    `, [Math.min(100, Math.max(1, Math.floor(limit || 100)))]);
    const articles = rows.map(rowToArticle);
    return limit ? articles.slice(0, limit) : articles;
  },
  ["all-articles-summary-v4"],
  { revalidate: 300 }
);

export const getAllNews = cache(
  async (limit?: number): Promise<Article[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.title, a.excerpt, a.author, a.image_url, a.published_at, a.post_type,
             GROUP_CONCAT(DISTINCT at.tag) AS tags
      FROM articles a
      LEFT JOIN article_tags at ON at.article_id = a.id
      WHERE a.post_type = 'news' AND a.status = 'published'
      GROUP BY a.id
      ORDER BY a.published_at DESC
      LIMIT ?
    `, [Math.min(100, Math.max(1, Math.floor(limit || 100)))]);
    const articles = rows.map(rowToArticle);
    return limit ? articles.slice(0, limit) : articles;
  },
  ["all-news-summary-v4"],
  { revalidate: 300 }
);

export const getAllBlogPosts = cache(
  async (limit?: number): Promise<Article[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.title, a.excerpt, a.author, a.image_url, a.published_at, a.post_type,
             GROUP_CONCAT(DISTINCT at.tag) AS tags
      FROM articles a
      LEFT JOIN article_tags at ON at.article_id = a.id
      WHERE a.post_type = 'blog' AND a.status = 'published'
      GROUP BY a.id
      ORDER BY a.published_at DESC
      LIMIT ?
    `, [Math.min(100, Math.max(1, Math.floor(limit || 100)))]);
    const articles = rows.map(rowToArticle);
    return limit ? articles.slice(0, limit) : articles;
  },
  ["all-blog-posts-summary-v4"],
  { revalidate: 3600 }
);

export const getArticle = cache(
  async (slug: string): Promise<Article | null> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.title, a.body, a.excerpt, a.author, a.image_url, a.published_at, a.post_type,
             GROUP_CONCAT(DISTINCT at.tag) AS tags
      FROM articles a
      LEFT JOIN article_tags at ON at.article_id = a.id
      WHERE a.slug = ? AND a.status = 'published'
      GROUP BY a.id
      LIMIT 1
    `, [slug]);
    return rows.length ? rowToArticle(rows[0]) : null;
  },
  ["article-news-images-v2"],
  { revalidate: 300 }
);

export const getNewsPage = cache(
  async (requestedPage = 1, tag = '') => {
    const pool = await getPool();
    const where = "a.status='published' AND a.post_type='news'" + (tag ? ' AND EXISTS (SELECT 1 FROM article_tags t WHERE t.article_id=a.id AND t.tag=?)' : '');
    const values = tag ? [tag.slice(0,200)] : [];
    const [counts] = await pool.query<any[]>(`SELECT COUNT(*) AS total FROM articles a WHERE ${where}`,values);
    const total = Number(counts[0].total);
    const totalPages = Math.max(1,Math.ceil(Math.max(0,total-1)/12));
    const page = Math.min(totalPages,Math.max(1,Math.floor(requestedPage)||1));
    const select = `SELECT a.id,a.slug,a.title,a.excerpt,a.author,a.image_url,a.published_at,a.post_type,(SELECT GROUP_CONCAT(tag) FROM article_tags WHERE article_id=a.id) AS tags FROM articles a WHERE ${where} ORDER BY a.published_at DESC,a.id DESC`;
    const [rows] = await pool.query<any[]>(select + ' LIMIT 12 OFFSET ?', [...values,1+(page-1)*12]);
    let featured: Article | null = null;
    if(page===1 && total) { const [first]=await pool.query<any[]>(select+' LIMIT 1',values);featured=rowToArticle(first[0]); }
    return {articles:rows.map(rowToArticle),featured,total,totalPages,page};
  }, ['news-page'], {revalidate:300}
);

// ── Playlists ─────────────────────────────────────────────────────────────────

export const getAllPlaylists = cache(
  async (): Promise<Playlist[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT p.slug, p.name, p.description, p.image_url, p.song_count,
        (SELECT s.image_url
         FROM playlist_songs ps
         JOIN songs s ON s.id = ps.song_id
         WHERE ps.playlist_slug = p.slug AND s.image_url IS NOT NULL
         ORDER BY s.views DESC
         LIMIT 1) AS track_image
      FROM playlists p
      ORDER BY p.name ASC
    `);
    return rows.map((r: any) => ({
      slug:        r.slug,
      name:        r.name,
      description: r.description || `${r.name} playlist.`,
      songSlugs:   [],
      songCount:   Number(r.song_count ?? 0),
      image:       r.image_url ?? undefined,
      trackImage:  r.track_image ?? undefined,
    }));
  },
  ["all-playlists"],
  { revalidate: 3600 }
);

export const getPlaylistsPage = cache(
  async (requestedPage = 1) => {
    const pool = await getPool();
    const [counts] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM playlists');
    const total = Number(counts[0].total);
    const page = Math.min(Math.max(1,Math.ceil(total/18)),Math.max(1,Math.floor(requestedPage)||1));
    const [rows] = await pool.query<any[]>(`SELECT p.slug,p.name,p.description,p.image_url,p.song_count,(SELECT s.image_url FROM playlist_songs ps JOIN songs s ON s.id=ps.song_id WHERE ps.playlist_slug=p.slug AND s.image_url IS NOT NULL ORDER BY s.views DESC LIMIT 1) AS track_image FROM playlists p ORDER BY p.name,p.slug LIMIT 18 OFFSET ?`,[(page-1)*18]);
    return {playlists:rows.map(r=>({slug:r.slug,name:r.name,description:r.description||'',image:r.image_url||undefined,trackImage:r.track_image||undefined,songSlugs:[],songCount:Number(r.song_count||0)})) as Playlist[],total,page};
  }, ['playlist-page'], {revalidate:3600}
);

export const getPlaylist = cache(
  async (slug: string): Promise<Playlist | null> => {
    const pool = await getPool();
    const [rows] = await pool.query<any[]>(
      "SELECT slug, name, description, image_url FROM playlists WHERE slug = ? LIMIT 1",
      [slug]
    );
    if (!rows.length) return null;
    const r = rows[0] as any;

    const [songRows] = await pool.query<any[]>(`
      SELECT s.slug
      FROM playlist_songs ps
      JOIN songs s ON s.id = ps.song_id
      WHERE ps.playlist_slug = ?
      ORDER BY ps.position ASC
    `, [slug]);

    return {
      slug:        r.slug,
      name:        r.name,
      description: r.description || `${r.name} playlist.`,
      songSlugs:   (songRows as any[]).map((s: any) => s.slug),
      image:       r.image_url ?? undefined,
    };
  },
  ["playlist"],
  { revalidate: 3600 }
);

// ── Pages ─────────────────────────────────────────────────────────────────────

export const getAllPages = cache(
  async (): Promise<Page[]> => {
    const [rows] = await (await getPool()).query<any[]>(
      "SELECT title, slug, content FROM pages ORDER BY title ASC"
    );
    return rows.map((r: any) => ({
      title: decodeHTMLEntities(r.title),
      slug: r.slug,
      content: decodeHTMLEntities(r.content)
    }));
  },
  ["all-pages"],
  { revalidate: 3600 }
);

export const getPage = cache(
  async (slug: string): Promise<Page | null> => {
    const [rows] = await (await getPool()).query<any[]>(
      "SELECT title, slug, content FROM pages WHERE slug = ? LIMIT 1",
      [slug]
    );
    if (!rows.length) return null;
    const r = rows[0] as any;
    return {
      title: decodeHTMLEntities(r.title),
      slug: r.slug,
      content: decodeHTMLEntities(r.content)
    };
  },
  ["page"],
  { revalidate: 3600 }
);

// ── Sitemap ───────────────────────────────────────────────────────────────────

export const getDiscoveryItems = cache(
  async (): Promise<{ songs: { slug: string; title: string; artistName: string }[]; articles: { slug: string; title: string }[] }> => {
    const pool = await getPool();
    const [[songRows], [articleRows]] = await Promise.all([
      pool.query<any[]>("SELECT slug, title, artist_name FROM songs ORDER BY published_at DESC LIMIT 4"),
      pool.query<any[]>("SELECT slug, title FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 3"),
    ]);
    return {
      songs: songRows.map((row) => ({ slug: row.slug, title: decodeHTMLEntities(row.title), artistName: decodeHTMLEntities(row.artist_name) })),
      articles: articleRows.map((row) => ({ slug: row.slug, title: decodeHTMLEntities(row.title) })),
    };
  },
  ["discovery-items-genius-samples-v2"],
  { revalidate: 3600 }
);

export const getSitemapData = cache(
  async () => {
    const pool = await getPool();
    const [[songs], [artists], [genres], [playlists], [articles], [albums], [pages]] = await Promise.all([
      pool.query<any[]>("SELECT slug, published_at AS post_date FROM songs WHERE lyrics IS NOT NULL AND TRIM(lyrics) <> ''"),
      pool.query<any[]>("SELECT slug FROM artists"),
      pool.query<any[]>("SELECT slug FROM genres WHERE song_count > 0"),
      pool.query<any[]>("SELECT slug FROM playlists"),
      pool.query<any[]>("SELECT slug FROM articles WHERE status = 'published'"),
      pool.query<any[]>("SELECT slug FROM albums"),
      pool.query<any[]>("SELECT slug FROM pages"),
    ]);
    return {
      songs:     songs     as { slug: string; post_date: Date }[],
      artists:   artists   as { slug: string }[],
      genres:    genres    as { slug: string }[],
      playlists: playlists as { slug: string }[],
      articles:  articles  as { slug: string }[],
      albums:    albums    as { slug: string }[],
      pages:     pages     as { slug: string }[],
    };
  },
  ["sitemap-data-genius-samples-v2"],
  { revalidate: 3600 }
);

export const getRelatedArticles = (limit = 4) => getAllArticles(limit);

// ── Albums ────────────────────────────────────────────────────────────────────

function rowToAlbum(row: any, tracks: { trackNumber: number; song: Song }[] = [], qa: { question: string; answer: string }[] = []): Album {
  return {
    slug:        row.slug,
    title:       decodeHTMLEntities(row.title),
    artistSlug:  row.artist_slug,
    artistName:  decodeHTMLEntities(row.artist_name),
    image:       row.image_url ?? undefined,
    releaseDate: row.release_date
      ? new Date(row.release_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : undefined,
    releaseYear: row.release_date ? new Date(row.release_date).getFullYear() : undefined,
    description: row.description ? decodeHTMLEntities(row.description) : undefined,
    tracks,
    qa,
  };
}

export const albumsByArtist = cache(
  async (artistSlug: string): Promise<Album[]> => {
    const pool = await getPool();
    const [albumRows] = await pool.query<any[]>(
      `SELECT id, slug, title, artist_slug, artist_name, image_url, release_date, description
       FROM albums WHERE artist_slug = ? ORDER BY release_date DESC`,
      [artistSlug]
    );
    if (!albumRows.length) return [];

    const albumIds = (albumRows as any[]).map(r => r.id);
    const [trackRows] = await pool.query<any[]>(`
      SELECT s.id, s.slug, s.title, s.excerpt,
        s.artist_name, s.artist_slug, s.is_trending,
        s.image_url, s.views, s.views_24h, s.published_at,
        GROUP_CONCAT(DISTINCT sg.genre_slug ORDER BY sg.genre_slug) AS genre_slugs,
        GROUP_CONCAT(DISTINCT g.name        ORDER BY sg.genre_slug) AS genre_names,
        albs.album_id, albs.track_number
      FROM songs s
      LEFT JOIN song_genres sg ON sg.song_id = s.id
      LEFT JOIN genres g       ON g.slug = sg.genre_slug
      JOIN album_songs albs ON albs.song_id = s.id
      WHERE albs.album_id IN (?)
      GROUP BY s.id, albs.album_id, albs.track_number
      ORDER BY albs.album_id, albs.track_number ASC
    `, [albumIds]);

    const tracksByAlbum = new Map<number, { trackNumber: number; song: Song }[]>();
    for (const t of trackRows as any[]) {
      const list = tracksByAlbum.get(t.album_id) ?? [];
      list.push({ trackNumber: t.track_number, song: rowToSong(t) });
      tracksByAlbum.set(t.album_id, list);
    }

    return (albumRows as any[]).map(r => rowToAlbum(r, tracksByAlbum.get(r.id) ?? []));
  },
  ["albums-by-artist"],
  { revalidate: 3600 }
);

export const getAlbums = cache(
  async (page = 1, limit = 24): Promise<{ albums: Album[]; total: number }> => {
    const pool = await getPool();
    const offset = (page - 1) * limit;

    const [countRows] = await pool.query<any[]>("SELECT COUNT(*) as total FROM albums");
    const total = (countRows as any[])[0].total;

    const [rows] = await pool.query<any[]>(
      `SELECT id, slug, title, artist_slug, artist_name, image_url, release_date, description
       FROM albums ORDER BY release_date DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return {
      albums: (rows as any[]).map(r => rowToAlbum(r)),
      total,
    };
  },
  ["albums"],
  { revalidate: 3600 }
);

export const getAlbum = cache(
  async (slug: string): Promise<Album | null> => {
    const pool = await getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT id, slug, title, artist_slug, artist_name, image_url, release_date, description
       FROM albums WHERE slug = ? LIMIT 1`,
      [slug]
    );
    if (!rows.length) return null;
    const albumRow = (rows as any[])[0];

    const [trackRows] = await pool.query<any[]>(`
      SELECT s.id, s.slug, s.title, s.excerpt,
        s.artist_name, s.artist_slug, s.is_trending,
        s.image_url, s.views, s.views_24h, s.published_at,
        GROUP_CONCAT(DISTINCT sg.genre_slug ORDER BY sg.genre_slug) AS genre_slugs,
        GROUP_CONCAT(DISTINCT g.name        ORDER BY sg.genre_slug) AS genre_names,
        albs.track_number
      FROM songs s
      LEFT JOIN song_genres sg ON sg.song_id = s.id
      LEFT JOIN genres g       ON g.slug = sg.genre_slug
      JOIN album_songs albs ON albs.song_id = s.id
      WHERE albs.album_id = ?
      GROUP BY s.id, albs.track_number
      ORDER BY albs.track_number ASC
    `, [albumRow.id]);

    const [qaRows] = await pool.query<any[]>(
      "SELECT question, answer FROM album_qa WHERE album_id = ? ORDER BY position ASC",
      [albumRow.id]
    );
    const tracks = (trackRows as any[]).map(t => ({ trackNumber: t.track_number, song: rowToSong(t) }));
    const qa = (qaRows as any[]).map((r: any) => ({ question: r.question, answer: r.answer }));
    return rowToAlbum(albumRow, tracks, qa);
  },
  ["album"],
  { revalidate: 3600 }
);

export const relatedArtists = cache(
  async (artistSlug: string, limit = 6): Promise<Artist[]> => {
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.slug, a.name, a.bio, a.image_url,
             GROUP_CONCAT(DISTINCT g.name ORDER BY g.name) AS genre_names
      FROM artists a
      JOIN artist_genres ag  ON ag.artist_id = a.id
      JOIN genres g          ON g.slug = ag.genre_slug
      WHERE ag.genre_slug IN (
        SELECT ag2.genre_slug FROM artists a2
        JOIN artist_genres ag2 ON ag2.artist_id = a2.id
        WHERE a2.slug = ?
      )
      AND a.slug != ?
      GROUP BY a.id
      ORDER BY a.id
      LIMIT ?
    `, [artistSlug, artistSlug, limit]);
    return rows.map(rowToArtist);
  },
  ["related-artists"],
  { revalidate: 3600 }
);

export const articlesByArtist = cache(
  async (artistName: string, limit = 4): Promise<Article[]> => {
    const like = `%${artistName}%`;
    const [rows] = await (await getPool()).query<any[]>(`
      SELECT a.id, a.slug, a.title, a.body, a.excerpt, a.author, a.image_url, a.published_at, a.post_type,
             GROUP_CONCAT(DISTINCT at.tag) AS tags
      FROM articles a
      LEFT JOIN article_tags at ON at.article_id = a.id
      WHERE a.status = 'published' AND (a.title LIKE ? OR EXISTS (
        SELECT 1 FROM article_tags at2 WHERE at2.article_id = a.id AND at2.tag LIKE ?
      ))
      GROUP BY a.id
      ORDER BY a.published_at DESC
      LIMIT ?
    `, [like, like, limit]);
    const matched = rows.map(rowToArticle);
    if (matched.length >= limit) return matched;
    // top up with recent articles if not enough matches
    const recent = await getAllArticles(limit);
    const seen = new Set(matched.map(a => a.slug));
    for (const a of recent) {
      if (!seen.has(a.slug)) { matched.push(a); seen.add(a.slug); }
      if (matched.length >= limit) break;
    }
    return matched.slice(0, limit);
  },
  ["articles-by-artist"],
  { revalidate: 3600 }
);

export const relatedSongs = cache(
  async (songSlug: string, limit = 6): Promise<Song[]> => {
    const pool = await getPool();
    const [rows] = await pool.query<any[]>(`
      ${SONG_LIST_SELECT}
      JOIN song_genres sg2 ON sg2.song_id = s.id
      WHERE sg2.genre_slug IN (
        SELECT sg3.genre_slug FROM song_genres sg3
        JOIN songs s2 ON s2.id = sg3.song_id
        WHERE s2.slug = ?
      )
      AND s.slug != ?
      GROUP BY s.id
      ORDER BY s.views DESC
      LIMIT ?
    `, [songSlug, songSlug, limit]);
    return rows.map(rowToSong);
  },
  ["related-songs"],
  { revalidate: 3600 }
);

export const relatedPlaylists = cache(
  async (songSlug: string, limit = 4): Promise<Playlist[]> => {
    const pool = await getPool();
    const [rows] = await pool.query<any[]>(`
      SELECT p.slug, p.name, p.description, p.image_url, p.song_count,
        (SELECT s.image_url
         FROM playlist_songs ps2
         JOIN songs s ON s.id = ps2.song_id
         WHERE ps2.playlist_slug = p.slug AND s.image_url IS NOT NULL
         ORDER BY s.views DESC
         LIMIT 1) AS track_image
      FROM playlists p
      WHERE EXISTS (
        SELECT 1 FROM playlist_songs ps
        JOIN song_genres sg ON sg.song_id = ps.song_id
        WHERE ps.playlist_slug = p.slug
        AND sg.genre_slug IN (
          SELECT sg2.genre_slug FROM song_genres sg2
          JOIN songs s2 ON s2.id = sg2.song_id
          WHERE s2.slug = ?
        )
      )
      LIMIT ?
    `, [songSlug, limit]);

    return rows.map((r: any) => ({
      slug:        r.slug,
      name:        r.name,
      description: r.description || `${r.name} playlist.`,
      songSlugs:   [],
      songCount:   Number(r.song_count ?? 0),
      image:       r.image_url ?? undefined,
      trackImage:  r.track_image ?? undefined,
    }));
  },
  ["related-playlists"],
  { revalidate: 3600 }
);

// ── Charts ────────────────────────────────────────────────────────────────────

export const chartSongs = cache(
  async (mode: "alltime" | "trending" = "alltime", limit = 100): Promise<Song[]> => {
    const orderBy = mode === "trending"
      ? "s.views_24h DESC, s.views DESC"
      : "s.views DESC";
    const [rows] = await (await getPool()).query<any[]>(`
      ${SONG_LIST_SELECT}
      ${mode === "trending" ? "WHERE s.views_24h > 0" : ""}
      GROUP BY s.id
      ORDER BY ${orderBy}
      LIMIT ?
    `, [limit]);
    return rows.map(rowToSong);
  },
  ["chart-songs"],
  { revalidate: 120 }
);

export const chartSongsPage = cache(
  async (mode: "alltime" | "trending", page: number, pageSize: number): Promise<{ songs: Song[]; total: number }> => {
    const pool = await getPool();
    const where = mode === "trending" ? "WHERE s.views_24h > 0" : "";
    const orderBy = mode === "trending" ? "s.views_24h DESC, s.views DESC" : "s.views DESC";
    const [[countRows], [songRows]] = await Promise.all([
      pool.query<any[]>(`SELECT COUNT(*) AS total FROM songs s ${where}`),
      pool.query<any[]>(`${SONG_LIST_SELECT} ${where} GROUP BY s.id ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]),
    ]);
    return { songs: (songRows as any[]).map(rowToSong), total: Number((countRows as any[])[0]?.total ?? 0) };
  },
  ["chart-songs-page"],
  { revalidate: 120 }
);

// Re-export convenience aliases
export const genres    = getAllGenres;
export const articles  = getAllArticles;
export const artists   = getAllArtists;
export const songs     = getAllSongs;
export const playlists = getAllPlaylists;
export const pages     = getAllPages;
