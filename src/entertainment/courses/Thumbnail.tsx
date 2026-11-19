import { useEffect, useState } from 'react';

/** 16:9 thumbnail; a neutral block until the image is known (never blocks on network). */
export function Thumbnail({ src, done, className = '' }: { src?: string; done?: boolean; className?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return (
    <span className={`cr-thumb ${className}`} aria-hidden>
      {src && !bad && <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />}
      {done && <span className="cr-thumb-done">✓</span>}
    </span>
  );
}
