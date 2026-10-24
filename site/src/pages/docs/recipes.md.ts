import type { APIRoute } from "astro";
import { markdownResponse, recipeIndexMarkdown } from "../../lib/recipe-md";

export const GET: APIRoute = () => markdownResponse(recipeIndexMarkdown());
