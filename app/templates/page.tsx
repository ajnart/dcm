import TemplateGalleryClient from "@/components/TemplateGalleryClient"
import { buildCatalog } from "@/lib/catalog"
import { fetchGitHubStars } from "@/lib/docker-tools"

export const dynamic = "force-static"
export const revalidate = 21600

export async function generateStaticParams() {
  await fetchGitHubStars()
  return [{ id: "static" }]
}

export default async function TemplatesPage() {
  const catalog = buildCatalog(await fetchGitHubStars())

  return <TemplateGalleryClient catalog={catalog} />
}
