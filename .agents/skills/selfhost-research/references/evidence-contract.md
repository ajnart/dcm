# Evidence input contracts

## Link result envelope

Wrap the ephemeral `agent-browser read --json` result before validation:

```json
{
  "checkedAt": "2026-08-28T12:00:00Z",
  "sourceUrl": "https://project.example/docs/install/",
  "canonicalUrl": "https://project.example/docs/install/",
  "httpStatus": 200,
  "wait": {"completed": true, "kind": "networkidle"},
  "evidence": {
    "titleCaptured": true,
    "contentMarkerCaptured": true,
    "soft404Checked": true,
    "title": "Install"
  },
  "redirects": [],
  "markdownFallback": {"used": false, "recorded": false},
  "read": {"success": true, "data": {"url": "https://project.example/docs/install/"}}
}
```

When a redirect occurs, list each public URL in `redirects`. When Markdown negotiation adds `.md`, set `markdownFallback.used` and `recorded`, and keep its `canonicalUrl`. The validator emits booleans and reason codes, not title or content.

## Lifecycle record

The validator accepts a catalog app record or a focused record:

```json
{
  "id": "example",
  "upstream": {"url": "https://project.example/"},
  "sources": ["https://project.example/releases"],
  "lifecycle": {
    "status": "transitioning",
    "checkedAt": "2026-08-28",
    "replacement": {
      "available": true,
      "id": "example-next",
      "url": "https://project.example/migration"
    }
  },
  "image": {
    "reference": "ghcr.io/example/project:1.2.3",
    "source": "upstream",
    "status": "known",
    "provenanceUrl": "https://project.example/container"
  }
}
```

For a retirement with no direct successor, use `replacement.available: false` and provide a non-empty reason plus primary lifecycle evidence. Warnings do not invalidate a record unless `--strict` is selected.
