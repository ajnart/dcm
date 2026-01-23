"use client"

import { Button } from "@/components/ui/button"
import { CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ExternalLink, Sparkles } from "lucide-react"
import { useState } from "react"

interface DiscoveryPanelProps {
  className?: string
}

// Popular categories from awesome-selfhosted
const AWESOME_CATEGORIES = [
  { name: "Media Streaming", anchor: "#media-streaming" },
  { name: "Backup", anchor: "#backup" },
  { name: "Photo Galleries", anchor: "#photo-galleries" },
  { name: "Analytics", anchor: "#analytics" },
  { name: "Automation", anchor: "#automation" },
  { name: "File Transfer & Sync", anchor: "#file-transfer--synchronization" },
  { name: "Password Managers", anchor: "#password-managers" },
  { name: "Wikis", anchor: "#wikis" },
  { name: "Monitoring", anchor: "#monitoring" },
  {
    name: "Communication",
    anchor: "#communication---custom-communication-systems",
  },
  { name: "Document Management", anchor: "#document-management" },
  { name: "Note-taking & Editors", anchor: "#note-taking--editors" },
]

const AWESOME_SELFHOSTED_BASE =
  "https://github.com/awesome-selfhosted/awesome-selfhosted/blob/master/README.md"

export default function DiscoveryPanel({
  className = "",
}: DiscoveryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={`mb-6 w-full ${className}`}>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow duration-300 hover:shadow-md"
      >
        <div className="flex items-center justify-between bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-lg">
              Discover More Self-Hosted Apps
            </h3>
          </div>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(!isOpen)}
              type="button"
              className="motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:scale-105"
            >
              {isOpen ? "Hide" : "Explore"}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="motion-safe:animate-slide-down">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                Looking for more self-hosted applications? Check out{" "}
                <a
                  href={AWESOME_SELFHOSTED_BASE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:underline"
                >
                  Awesome-Selfhosted
                  <ExternalLink className="h-3 w-3" />
                </a>
                , a curated list of hundreds of open-source applications
                regularly updated by the community.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm">Popular Categories:</h4>
              <div className="flex flex-wrap gap-2">
                {AWESOME_CATEGORIES.map((category) => (
                  <a
                    key={category.anchor}
                    href={`${AWESOME_SELFHOSTED_BASE}${category.anchor}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {category.name}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            </div>

            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-muted-foreground text-xs">
                💡 <strong>Tip:</strong> Found a great app not listed in DCM?
                Consider{" "}
                <a
                  href="https://github.com/ajnart/dcm/blob/main/CONTRIBUTING.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  contributing
                </a>{" "}
                to help others discover it!
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
