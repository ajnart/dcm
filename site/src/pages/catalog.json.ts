import type { APIRoute } from "astro";
import catalog from "../data/catalog.json";

export const GET: APIRoute = () => new Response(JSON.stringify(catalog, null, 1) + "\n", { headers: { "Content-Type": "application/json" } });
