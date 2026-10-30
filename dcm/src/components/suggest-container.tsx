import { Button } from "@/components/ui/button"
import { PlusCircle } from "lucide-react"
import { Suspense, lazy, useRef, useState } from "react"

const loadDialog = () => import("@/components/container-submission-form")
const ContainerSubmissionDialog = lazy(() =>
  loadDialog().then((mod) => ({ default: mod.ContainerSubmissionDialog })),
)

export function SuggestContainer() {
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleClick = () => {
    setLoaded(true)
    setOpen(true)
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label="Suggest container"
        onClick={handleClick}
        onPointerEnter={loadDialog}
        onFocus={loadDialog}
      >
        <PlusCircle size={16} />
        <span className="max-sm:sr-only">Suggest container</span>
      </Button>
      {loaded && (
        <Suspense fallback={null}>
          <ContainerSubmissionDialog
            open={open}
            onOpenChange={setOpen}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              buttonRef.current?.focus()
            }}
          />
        </Suspense>
      )}
    </>
  )
}
