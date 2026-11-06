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

const LABEL = 'Download as zip';

interface ExportButtonProps {
  /** Draw the icon alone, named and tooltipped by its label: for the folded sidebar. */
  compact?: boolean | undefined;
}

/**
 * Downloads every page's YAML file, and site.yaml, as one zip.
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
              href={EXPORT_URL}
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
      href={EXPORT_URL}
      onError={onError}
      className="w-full"
    />
  );
}
