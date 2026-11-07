import { useState } from "react";

/** A photographed object with its background removed (web/public/img/<name>.webp). Decorative: if the file is not
 * there yet, nothing renders and the layout stays the same. */
export function Cutout({ name, className }: { name: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return <img className={`cutout ${className ?? ""}`} src={`/img/${name}.webp`} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMissing(true)} />;
}
