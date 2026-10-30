import { generateComposeContent } from "@/lib/docker-compose/generators"
import { getToolsFromTemplate, templates } from "@/lib/templates"
import { tools } from "@/tools"
import { notFound } from "next/navigation"
import { TemplateClient } from "./template-client"

// Default settings for compose generation
const defaultSettings = {
  configPath: "/path/to/config",
  dataPath: "/path/to/data",
  timezone: "Europe/Paris",
  puid: "1000",
  pgid: "1000",
  umask: "022",
  containerNamePrefix: "",
  restartPolicy: "unless-stopped",
  networkMode: "bridge",
}

export const dynamic = "force-static"
export const revalidate = 21600

export function generateStaticParams() {
  // Generate static pages for all templates
  return templates.map((template) => ({
    id: template.id,
  }))
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Await params as required by Next.js when using generateStaticParams
  const { id } = await params

  // Find the template with the matching ID
  const template = templates.find((t) => t.id === id)

  // If no template is found, return 404
  if (!template) {
    return notFound()
  }

  // Get the Docker tools for this template
  const templateTools = getToolsFromTemplate(template, tools)

  // Find unavailable tools
  const unavailableTools = template.tools
    .filter((toolId) => !templateTools.some((tool) => tool.id === toolId))
    .map((toolId) => ({ id: toolId }))

  // Generate Docker Compose content
  const { content } = generateComposeContent(
    templateTools,
    defaultSettings,
    true,
  )

  // Pass all data as props to the client component
  return (
    <TemplateClient
      template={template}
      templateTools={templateTools}
      unavailableTools={unavailableTools}
      initialContent={content}
    />
  )
}
