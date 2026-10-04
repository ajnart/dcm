export function shellCommand(args: readonly string[]): string {
  return args.map((arg) => {
    if (/^[A-Za-z0-9_./:@+-]+$/.test(arg)) return arg;
    return `'${arg.replaceAll("'", `'"'"'`)}'`;
  }).join(" ");
}
