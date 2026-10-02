export type Artist = {
  slug: string;
  name: string;
  bio: string;
  image?: string;
  genres: string[];
  totalViews?: number;
  songCount?: number;
};

export type Song = {
  slug: string;
  title: string;
  artistSlug: string;
  artistName: string;
  genre: string;
  genreSlug: string;
  releaseYear: number;
  releaseDate: string;
  isTrending: boolean;
  views: number;
  lyrics: string;
  image?: string;
  description?: string;
  youtubeUrl?: string;
  streamUrl?: string;
  tags: string[];
  qa: { question: string; answer: string }[];
};

export type Article = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  author: string;
  publishedAt: string;
  tags: string[];
  image?: string;
  postType: 'news' | 'blog' | 'album' | 'playlist';
};

export type Playlist = {
  slug: string;
  name: string;
  description: string;
  songSlugs: string[];
  songCount?: number;
  image?: string;
  trackImage?: string;
};

export type Genre = {
  slug: string;
  name: string;
  description: string;
  image?: string;
  icon?: string;
  color?: string;
  songCount?: number;
};

export type Album = {
  slug: string;
  title: string;
  artistSlug: string;
  artistName: string;
  image?: string;
  releaseDate?: string;
  releaseYear?: number;
  description?: string;
  tracks: { trackNumber: number; song: Song }[];
  qa: { question: string; answer: string }[];
};

export type Page = {
  slug: string;
  title: string;
  content: string;
};
