/** Pull the 11-character video id out of any common YouTube link (watch, youtu.be, shorts, embed, live). */
const ok = (s: string) => (/^[\w-]{11}$/.test(s) ? s : null);
export function parseYouTubeId(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return ok(u.pathname.slice(1, 12));
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return ok(v.slice(0, 11));
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

