/** YouTube link → embed. Pure, no db — safe in client components, tested directly. */

/**
 * Pulls the video id out of any shape of YouTube link the owner might paste.
 *
 * Accepts watch?v=, youtu.be/, /embed/, /shorts/, /live/, and tolerates extra query
 * params (?t=, ?si=, playlist junk). Returns null for anything that isn't YouTube —
 * a Vimeo or Drive link is a valid video link, it just can't be embedded this way,
 * and the caller falls back to a plain link rather than rendering a broken player.
 *
 * Deliberately strict on the id shape (11 chars of the YouTube alphabet): a loose
 * match would happily build an embed URL out of a typo and show an empty player.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);

export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase();

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = u.pathname.split("/")[1] ?? "";
    return ID.test(id) ? id : null;
  }

  if (!HOSTS.has(host)) return null;

  // watch?v=<id>
  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length >= 2 && ["embed", "shorts", "live", "v"].includes(seg[0])) {
    return ID.test(seg[1]) ? seg[1] : null;
  }
  return null;
}

/**
 * The privacy-preserving embed host: youtube-nocookie doesn't set tracking cookies
 * until the viewer actually hits play. Same player either way.
 */
export const youtubeEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;

/** Whether a lesson's video can play in-app rather than only linking out. */
export const isEmbeddable = (url: string | null | undefined) => youtubeId(url) !== null;
