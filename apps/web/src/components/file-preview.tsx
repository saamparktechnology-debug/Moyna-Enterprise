//apps/web/src/components/file-preview.tsx
import { useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

/**
 * Loads a file the signed-in user may read and gives a temporary address for it that an image or a frame can show. The
 * address is let go when the file changes or the component goes away. `load` must be stable (wrap it in `useCallback`);
 * a different `load` or `version` means a different file. Pass `null` to load nothing.
 */
export function useBlobUrl(
  load: (() => Promise<Blob>) | null,
  version = '',
): {
  url: string | null;
  failed: boolean;
  loading: boolean;
} {
  const [state, setState] = useState<{
    source: unknown;
    version: string;
    url: string | null;
    failed: boolean;
  }>({ source: null, version: '', url: null, failed: false });
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    let created: string | null = null;
    load().then(
      (blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setState({ source: load, version, url: created, failed: false });
      },
      () => {
        if (!cancelled) setState({ source: load, version, url: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [load, version]);
  const current = load !== null && state.source === load && state.version === version;
  return {
    url: current ? state.url : null,
    failed: current && state.failed,
    loading: load !== null && !current,
  };
}

/** A file fetched when asked for (a button press) and shown with `FilePreview`. Lets go of it when it is closed or the screen goes. */
export function useFilePreview(): {
  preview: { url: string; mimeType: string; title: string } | null;
  show: (blob: Blob, mimeType: string, title: string) => void;
  close: () => void;
} {
  const [preview, setPreview] = useState<{ url: string; mimeType: string; title: string } | null>(
    null,
  );
  const current = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );
  const close = () => {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = null;
    setPreview(null);
  };
  const show = (blob: Blob, mimeType: string, title: string) => {
    if (current.current) URL.revokeObjectURL(current.current);
    const url = URL.createObjectURL(blob);
    current.current = url;
    setPreview({ url, mimeType, title });
  };
  return { preview, show, close };
}

interface FilePreviewProps {
  url: string;
  mimeType: string;
  title: string;
  onClose: () => void;
}

/** Shows a picture or a PDF where the person is already working, with a real link to open it in a new tab. */
export function FilePreview({ url, mimeType, title, onClose }: FilePreviewProps) {
  return (
    <section aria-label="Document preview" className="mt-4 space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Open in new tab
          </a>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close preview
          </Button>
        </div>
      </div>
      {mimeType.startsWith('image/') ? (
        <img src={url} alt={title} className="max-h-[60vh] w-full rounded object-contain" />
      ) : (
        <iframe src={url} title={title} className="h-[60vh] w-full rounded border" />
      )}
    </section>
  );
}
