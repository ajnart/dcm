import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
} from "@/components/ui/multi-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  composeContentSchema,
  validateComposeContent,
} from "@/lib/docker-tools"
import { tools } from "@/tools"
import { zodResolver } from "@hookform/resolvers/zod"
import { DialogDescription } from "@radix-ui/react-dialog"
import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  GitPullRequest,
  Info,
  PlusCircle,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"

const CATEGORIES = [
  "Media",
  "Management",
  "Networking",
  "Storage",
  "Database",
  "Monitoring",
  "Home Automation",
  "Security",
  "Development",
]

// Collect all unique tags from existing tools
const ALL_TAGS = Array.from(new Set(tools.flatMap((tool) => tool.tags))).sort()

const formSchema = z.object({
  id: z
    .string()
    .min(1, "Container ID is required")
    .regex(
      /^[a-z0-9-]+$/,
      "ID must contain only lowercase letters, numbers, and hyphens",
    ),
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  tags: z.array(z.string()).min(1, "At least one tag is required"),
  githubUrl: z.string().url("Must be a valid URL").or(z.literal("")),
  icon: z.string().url("Must be a valid URL").or(z.literal("")),
  containerData: composeContentSchema,
})

type FormValues = z.infer<typeof formSchema>

export function ContainerSubmissionForm() {
  const [open, setOpen] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [validationResult, setValidationResult] = useState<ReturnType<
    typeof validateComposeContent
  > | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: "sonarr",
      name: "Sonarr",
      description: "",
      category: "Media",
      tags: ["TV", "PVR", "Monitoring"],
      githubUrl: "https://github.com/sonarr",
      icon: "",
      containerData: `services:
  sonarr:
    container_name: \${CONTAINER_PREFIX}sonarr
    image: ghcr.io/hotio/sonarr:latest
    ports:
      - "8989:8989"
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - UMASK=\${UMASK}
      - TZ=\${TZ}
    volumes:
      - \${CONFIG_PATH}/sonarr:/config
      - \${DATA_PATH}/tv:/data/tv
      - \${DATA_PATH}/downloads:/data/downloads
    restart: \${RESTART_POLICY}`,
    },
  })

  // Update validation result when containerData changes
  useEffect(() => {
    const containerData = form.watch("containerData")
    if (containerData) {
      const result = validateComposeContent(containerData)
      setValidationResult(result)
    }
  }, [form.watch("containerData")])

  function onSubmit(values: FormValues) {
    // Redirect directly to the new form-based issue template
    const repoUrl = "https://github.com/ajnart/self-host"
    const issueUrl = `${repoUrl}/issues/new?template=dcm-container-submission.yml&title=container: ${encodeURIComponent(values.name)}&id=${encodeURIComponent(values.id)}&name=${encodeURIComponent(values.name)}&description=${encodeURIComponent(values.description)}&category=${encodeURIComponent(values.category)}&tags=${encodeURIComponent(values.tags.join(", "))}&githubUrl=${encodeURIComponent(values.githubUrl || "")}&icon=${encodeURIComponent(values.icon || "")}&containerData=${encodeURIComponent(values.containerData)}`

    // Open the GitHub issue form in a new tab
    window.open(issueUrl, "_blank")
    setOpen(false)
  }

  // Function to open GitHub issue template directly
  const openGitHubIssue = () => {
    const issueUrl =
      "https://github.com/ajnart/self-host/issues/new?template=dcm-container-submission.yml"
    window.open(issueUrl, "_blank")
  }

  // Generate unique keys for list items
  const generateUniqueKey = (prefix: string, value: string) =>
    `${prefix}-${value.replace(/\s+/g, "-").toLowerCase()}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PlusCircle size={16} />
          Suggest container
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[95vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Suggest a new container</DialogTitle>
          <DialogDescription>
            Creating a submission will redirect you to creating an issue on
            GitHub, pre-filled with this form. The submission will then be
            reviewed by the maintainers and added to the list of containers if
            accepted.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-2">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <FormField
                control={form.control}
                name="id"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Container ID</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., sonarr, postgres" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Display name (e.g., Sonarr, PostgreSQL)"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Brief description of the container's purpose"
                      className="min-h-[50px] resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Category</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="githubUrl"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>GitHub URL (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://github.com/username/repo"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>Icon URL (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/example.svg"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-muted-foreground text-xs">
                    We recommend using icons from{" "}
                    <a
                      href="https://github.com/homarr-labs/dashboard-icons"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-accent-text underline underline-offset-4"
                    >
                      homarr-labs/dashboard-icons
                    </a>
                    . Format:
                    https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/[name].svg
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>Tags</FormLabel>
                  <FormControl>
                    <MultiSelector
                      values={field.value}
                      onValuesChange={field.onChange}
                    >
                      <MultiSelectorTrigger>
                        <MultiSelectorInput
                          placeholder="Add tags and press Enter"
                          value={tagInput}
                          onValueChange={setTagInput}
                        />
                      </MultiSelectorTrigger>
                      <MultiSelectorContent>
                        <MultiSelectorList>
                          {tagInput.length > 0 &&
                            !ALL_TAGS.includes(tagInput) && (
                              <MultiSelectorItem value={tagInput}>
                                Create tag "{tagInput}"
                              </MultiSelectorItem>
                            )}
                          {ALL_TAGS.filter((tag) =>
                            tag.toLowerCase().includes(tagInput.toLowerCase()),
                          ).map((tag) => (
                            <MultiSelectorItem key={tag} value={tag}>
                              {tag}
                            </MultiSelectorItem>
                          ))}
                        </MultiSelectorList>
                      </MultiSelectorContent>
                    </MultiSelector>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="containerData"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>Docker Compose Service Definition</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter the service definition in YAML format"
                      className="min-h-[280px] resize-none font-mono"
                      {...field}
                    />
                  </FormControl>

                  {/* Validation feedback section */}
                  {validationResult && (
                    <div className="space-y-2">
                      {validationResult.errors.length > 0 && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Validation Errors</AlertTitle>
                          <AlertDescription>
                            <ul className="ml-4 list-disc">
                              {validationResult.errors.map((error) => (
                                <li key={generateUniqueKey("error", error)}>
                                  {error}
                                </li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      {validationResult.warnings.length > 0 && (
                        <Alert variant="warning">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Recommendations</AlertTitle>
                          <AlertDescription>
                            <ul className="ml-4 list-disc">
                              {validationResult.warnings.map((warning) => (
                                <li key={generateUniqueKey("warning", warning)}>
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      {validationResult.isValid &&
                        validationResult.warnings.length === 0 && (
                          <Alert variant="success">
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>Valid Configuration</AlertTitle>
                            <AlertDescription>
                              Your Docker Compose configuration looks good!
                            </AlertDescription>
                          </Alert>
                        )}

                      {validationResult.suggestedEnvVars.length > 0 && (
                        <Alert variant="info">
                          <Info className="h-4 w-4" />
                          <AlertTitle>
                            Suggested Environment Variables
                          </AlertTitle>
                          <AlertDescription>
                            Consider using these environment variables:{" "}
                            {validationResult.suggestedEnvVars.join(", ")}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-between pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={openGitHubIssue}
                className="flex items-center gap-2"
              >
                <GitPullRequest size={18} />
                <span>Open GitHub Issue template directly</span>
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={form.handleSubmit(onSubmit)}
                  className="flex items-center gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <span>Submit Container</span>
                  <ExternalLink size={16} />
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
