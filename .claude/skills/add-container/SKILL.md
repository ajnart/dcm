---
name: add-container
description: DCM Container work. Use to add or edit a Container in dcm/src/tools/, including an issue labelled `container` and then `accepted`, and the pull request dcm-add-container.yml opens from it. A Container is a compose snippet DCM offers for a product the Catalog does not install. Catalog Apps go to edit-catalog.
---

# Add or edit a Container

Read `docs/agents/dcm.md` for how DCM merges Containers with Apps, and `docs/agents/generated-data.md` for the collision gap this skill closes by hand. Use `CONTEXT.md`'s words: DCM, Container, App.

## 1. Check for collisions

DCM merges a Container with the App of the same id or alias, and the App's compose wins; it drops a Container named `<app>-...` whose services the App provides. No test reports either. Search for the product under every spelling (`<name>` below):

```bash
jq -r '.apps[].id' dcm/src/data/selfhost.json | grep -i <name>
grep -n -i <name> dcm/src/lib/selfhost.ts
grep -rn 'id: "<id>"' dcm/src/tools
```

**Done:** the first two print nothing, no App id followed by `-` is a prefix of `<id>`, and the third prints nothing. When the first two hit, the Catalog already has the product: change its compose through `edit-catalog`, and here only edit the existing Container's name, tags or icon.

## 2. Cite the image and ports

Fetch the project's own docs or registry page (`curl` or your fetch tool) and take the image, tag, container port and data path from it. Values in the request are claims to confirm against that page.

**Done:** your final message and the PR quote the source URL, and the image, port and data path in the entry match what the page says.

## 3. Add the DockerTool

Pick the category file in `dcm/src/tools/` (`media`, `management`, `database`, `monitoring`, `automation`, `other`). The `DockerTool` type and its compose validation are in `dcm/src/lib/docker-tools.ts`.

**Done:** the entry has a lowercase hyphenated `id`; a `composeContent` that starts with `services:`, names an `image` and uses `${PUID}`, `${PGID}`, `${TZ}`, `${CONFIG_PATH}`, `${DATA_PATH}`, `${CONTAINER_PREFIX}` and `${RESTART_POLICY}` where they apply; a `githubUrl` when the project has one; and no `stars` field (`bun run stars` writes them).

## 4. Run what you touched

```bash
bun test dcm/tests/validate-all-containers.test.ts dcm/tests/templates.test.ts dcm/tests/validate-networks.test.ts
bunx turbo run build lint
```

`dcm/tests/validate-compose.test.ts` runs `docker compose config`, so leave it to CI.

**Done:** both commands exit 0.

## 5. Review an issue's pull request

For a pull request opened by `.github/workflows/dcm-add-container.yml`, check it against steps 1 to 3.

**Done:** the diff touches only a file in `dcm/src/tools/`, and steps 1 and 4 pass on its branch.
