import { emitKeypressEvents, type Key } from "node:readline";

export type CatalogPickerItem = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  installable?: boolean;
};

function terminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
}

function fit(value: string, width: number): string {
  const characters = Array.from(value);
  if (characters.length <= width) return value;
  if (width < 2) return characters.slice(0, width).join("");
  return `${characters.slice(0, width - 1).join("")}…`;
}

/** Only pass catalog entries that have already passed the installability gate. */
export async function pickCatalogApps(items: readonly CatalogPickerItem[]): Promise<string[] | null> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("The catalog picker requires an interactive terminal");
  }

  const chosen = new Set(items.filter((item) => item.selected).map((item) => item.id));
  const wasRaw = input.isRaw;
  let search = "";
  let highlighted = 0;
  let screenOpened = false;

  function matches(): CatalogPickerItem[] {
    const query = search.toLocaleLowerCase();
    return items.filter((item) => item.name.toLocaleLowerCase().includes(query)
      || item.id.toLocaleLowerCase().includes(query));
  }

  function draw(): void {
    const visible = matches();
    const width = Math.max(12, output.columns || 80);
    const rows = Math.max(1, (output.rows || 24) - 5);
    const start = Math.max(0, Math.min(highlighted - rows + 1, visible.length - rows));
    const lines = [
      "Select apps for this project",
      fit(`Search: ${terminalText(search) || "(type a name or ID)"}`, width),
      fit(`${chosen.size} selected · ${visible.length} matching`, width),
    ];
    for (const [index, item] of visible.slice(start, start + rows).entries()) {
      let marker = chosen.has(item.id) ? "[x]" : "[ ]";
      if (item.installable === false) marker = "[·]";
      const focus = start + index === highlighted ? ">" : " ";
      const detail = terminalText(item.description);
      lines.push(fit(`${focus} ${marker} ${terminalText(item.name)} (${terminalText(item.id)}) — ${detail}`, width));
    }
    if (visible.length === 0) lines.push("  No matching apps");
    lines.push(fit("↑/↓ move · Space toggle · Backspace edit · Enter confirm · [·] discovery only · Esc cancel", width));
    output.write(`\x1b[H\x1b[2J${lines.join("\n")}`);
  }

  let onKeypress: (_character: string, key: Key) => void = () => {};
  let onResize: () => void = () => {};
  let onSigint: () => void = () => {};
  try {
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    screenOpened = true;
    output.write("\x1b[?1049h\x1b[?25l");
    draw();
    return await new Promise<string[] | null>((resolve, reject) => {
      let settled = false;
      function finish(result: string[] | null): void {
        if (settled) return;
        settled = true;
        resolve(result);
      }
      onSigint = () => finish(null);
      onResize = () => {
        try { draw(); } catch (error) { reject(error); }
      };
      onKeypress = (character, key) => {
        try {
          if ((key.ctrl && key.name === "c") || key.name === "escape") {
            finish(null);
            return;
          }
          if (key.name === "return" || key.name === "enter") {
            finish(items.filter((item) => chosen.has(item.id)).map((item) => item.id));
            return;
          }
          const visible = matches();
          if (key.name === "up" && visible.length > 0) {
            highlighted = (highlighted + visible.length - 1) % visible.length;
          } else if (key.name === "down" && visible.length > 0) {
            highlighted = (highlighted + 1) % visible.length;
          } else if (key.name === "space" && visible[highlighted]) {
            const item = visible[highlighted];
            if (item.installable === false) return;
            const id = item.id;
            if (chosen.has(id)) chosen.delete(id);
            else chosen.add(id);
          } else if (key.name === "backspace") {
            search = Array.from(search).slice(0, -1).join("");
            highlighted = 0;
          } else if (character && !key.ctrl && !key.meta && !/[\p{Cc}\p{Cf}]/u.test(character)) {
            search += character;
            highlighted = 0;
          } else {
            return;
          }
          draw();
        } catch (error) {
          reject(error);
        }
      };
      input.on("keypress", onKeypress);
      output.on("resize", onResize);
      process.on("SIGINT", onSigint);
    });
  } finally {
    input.off("keypress", onKeypress);
    output.off("resize", onResize);
    process.off("SIGINT", onSigint);
    try {
      input.setRawMode(wasRaw);
      input.pause();
    } finally {
      if (screenOpened) output.write("\x1b[?25h\x1b[?1049l");
    }
  }
}
