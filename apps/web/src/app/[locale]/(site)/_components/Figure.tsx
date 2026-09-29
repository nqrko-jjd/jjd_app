'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Image de contenu du site : cadrage cover, coins arrondis, chargement paresseux.
 * Un emplacement soigné (vert + trame) reste visible dessous : si le fichier
 * n'existe pas encore, c'est lui qu'on voit ; sinon la photo apparaît en fondu.
 */
function useLoaded(src?: string) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);
  return { ref, loaded, onLoad: () => setLoaded(true) };
}

export function Figure({
  src,
  alt = '',
  ratio = '4 / 3',
  label,
  eager = false,
  className = '',
  style,
}: {
  src?: string;
  alt?: string;
  ratio?: string;
  label?: string;
  eager?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { ref, loaded, onLoad } = useLoaded(src);

  return (
    <figure
      className={`s-fig ${className}`}
      style={{ ['--fig-ratio' as string]: ratio, ...style }}
      data-empty={loaded ? undefined : ''}
    >
      <span className="s-fig-ph">{label ?? 'Photo'}</span>
      {src && (
        <img
          ref={ref}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={onLoad}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
    </figure>
  );
}

/** Image de fond du hero (sombre, discrète). Reste invisible tant qu'absente. */
export function HeroImage({ src, alt = '' }: { src: string; alt?: string }) {
  const { ref, loaded, onLoad } = useLoaded(src);
  return (
    <div className="s-hero-media" data-empty={loaded ? undefined : ''}>
      <img
        ref={ref}
        src={src}
        alt={alt}
        decoding="async"
        onLoad={onLoad}
        style={{ opacity: loaded ? 0.42 : 0 }}
      />
    </div>
  );
}

/** Bande image pleine largeur entre deux sections. Reste un aplat vert si absente. */
export function Band({ src, alt = '' }: { src: string; alt?: string }) {
  const { ref, loaded, onLoad } = useLoaded(src);
  return (
    <div className="s-band" data-empty={loaded ? undefined : ''}>
      {src && (
        <img ref={ref} src={src} alt={alt} loading="lazy" decoding="async" onLoad={onLoad} style={{ opacity: loaded ? 1 : 0 }} />
      )}
    </div>
  );
}
