import { DownloadButton } from '@/components/ui/download-button';
import { useToast } from '@/components/ui/toast';

/** Where the server serves the zip (server/export/zip-export.ts). */
const EXPORT_URL = '/export.zip';
/** Digits in a month or day of the file's date. */
const DATE_PART_DIGITS = 2;

/**
 * Names the zip after today, as the server does.
 *
 * @param date - Today.
 * @returns `homepage-YYYY-MM-DD.zip`.
 */
function exportFilename(date: Date): string {
  const pad = (value: number): string => String(value).padStart(DATE_PART_DIGITS, '0');
  return `homepage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/** Downloads every page's YAML file, and site.yaml, as one zip. */
export function ExportButton() {
  const toast = useToast();
  return (
    <DownloadButton
      size="sm"
      label="Download as zip"
      filename={exportFilename(new Date())}
      href={EXPORT_URL}
      onError={() => toast('The zip was not downloaded. Try again.')}
      className="w-full"
    />
  );
}
