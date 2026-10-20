import { FileText, Upload, X } from 'lucide-react';
import { useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

interface FileUploadProps {
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** For the file picker, such as `application/pdf,image/jpeg,image/png`. The server still checks the content. */
  accept?: string;
  maxBytes?: number;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
  className?: string;
}

/**
 * Choose one file. The size limit is checked here so a person is told at once; the server checks the
 * type and size again because it never trusts the browser.
 */
export function FileUpload({
  label,
  file,
  onFileChange,
  accept,
  maxBytes,
  hint,
  error,
  disabled,
  className,
}: FileUploadProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const tooBig = file !== null && maxBytes !== undefined && file.size > maxBytes;
  const message =
    error ?? (tooBig ? `This file is larger than ${formatBytes(maxBytes ?? 0)}.` : undefined);
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          aria-invalid={message !== undefined}
          aria-describedby={`${id}-info`}
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload />
          {file ? 'Choose a different file' : 'Choose a file'}
        </Button>
        {file ? (
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="break-id min-w-0">{file.name}</span>
            <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                onFileChange(null);
                if (input.current) input.current.value = '';
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No file chosen</span>
        )}
      </div>
      <div id={`${id}-info`} aria-live="polite">
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
      </div>
    </div>
  );
}
