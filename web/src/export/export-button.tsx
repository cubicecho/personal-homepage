import { sessionHeaders } from '@/auth/session';
import { DownloadButton } from '@/components/ui/download-button';
import { useToast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

/**
 * Fetches the zip with this browser's session: once sign-in is set up, the server zips only what the
 * signed-in person may see, and a link the browser follows on its own would carry no session.
 *
 * @returns The zip.
 * @throws When the server refuses or fails.
 */
async function fetchExport(): Promise<Blob> {
  const response = await fetch(EXPORT_URL, { headers: sessionHeaders() });
  if (response.ok === false) {
    throw new Error(`The server answered ${response.status}.`);
  }
  return response.blob();
}

const LABEL = 'Download as zip';
const MIME_TYPE = 'application/zip';

interface ExportButtonProps {
  /** Draw the icon alone, named and tooltipped by its label: for the folded sidebar. */
  compact?: boolean | undefined;
}

/**
 * Downloads every page this browser may see, and the site settings, as one zip of YAML files.
 *
 * @param props - How much room it has.
 * @param props.compact - Draw the icon alone, with the label as its name and tooltip.
 * @returns The button.
 */
export function ExportButton({ compact = false }: ExportButtonProps) {
  const toast = useToast();
  const filename = exportFilename(new Date());
  const onError = () => toast('The zip was not downloaded. Try again.');
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DownloadButton
              variant="ghost"
              size="icon-sm"
              label={LABEL}
              filename={filename}
              mimeType={MIME_TYPE}
              source={fetchExport}
              onError={onError}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{LABEL}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <DownloadButton
      size="sm"
      label={LABEL}
      filename={filename}
      mimeType={MIME_TYPE}
      source={fetchExport}
      onError={onError}
      className="w-full"
    />
  );
}
