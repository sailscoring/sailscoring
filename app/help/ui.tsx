/**
 * The presentational pieces every help section is built from. Deliberately
 * free of server-only imports: the same components render inside the
 * `/help/*` routes and inside the help panel, which is client-side.
 */

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 bg-card border rounded-lg p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

/** A screenshot inside a help section — the same captures the marketing
 *  site uses (scripts/feature-shots.ts writes both), with an instructional
 *  caption. Click opens the image full size. */
export function HelpShot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="my-4 space-y-2">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border"
      >
        {/* Plain img: static asset of known quality; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="w-full" />
      </a>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
