import type { APIRoute, GetStaticPaths } from "astro";
import { recipes } from "../../../lib/catalog";
import { markdownResponse, recipeMarkdown } from "../../../lib/recipe-md";

export const getStaticPaths = (() => recipes.map((recipe) => ({ params: { id: recipe.id }, props: { recipe } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => markdownResponse(recipeMarkdown(props.recipe));
