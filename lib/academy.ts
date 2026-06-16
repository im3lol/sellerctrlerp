/** Academy helpers — YouTube URL parsing for thumbnails + embeds. */

export const ACADEMY_TYPES = [
  { key: "article", labelAr: "مقالات", singularAr: "مقال", icon: "FileText" },
  { key: "video", labelAr: "فيديوهات", singularAr: "فيديو", icon: "MonitorPlay" },
  { key: "tip", labelAr: "نصائح", singularAr: "نصيحة", icon: "Lightbulb" },
] as const;

export type AcademyType = (typeof ACADEMY_TYPES)[number]["key"];

/** Extract the 11-char YouTube video id from common URL shapes. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/live\/)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  // bare id
  if (/^[\w-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

/** hqdefault thumbnail for a YouTube URL/id, or null if not parseable. */
export function youtubeThumb(url: string | null | undefined): string | null {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

/** Canonical watch URL. */
export function youtubeWatchUrl(url: string | null | undefined): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : (url ?? null);
}
