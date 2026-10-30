import { CopyLabel } from "@/components/copy-label"
import { Button } from "@/components/ui/button"
import { Copy, Download } from "lucide-react"

interface ActionButtonsProps {
  onCopy: (event: React.MouseEvent<HTMLButtonElement>) => void
  onDownload: () => void
  copied: boolean
}

export default function ActionButtons({
  onCopy,
  onDownload,
  copied,
}: ActionButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button
        aria-label="Download file"
        className="ml-2 rounded-md"
        onClick={onDownload}
        size="icon"
        variant="outline"
      >
        <span className="sr-only">Download</span>
        <Download className="h-4 w-4" />
      </Button>

      <Button
        className="ml-2 rounded-md px-3"
        onClick={onCopy}
        variant="outline"
      >
        <CopyLabel copied={copied} icon={<Copy />} label="Copy" />
      </Button>
    </div>
  )
}
