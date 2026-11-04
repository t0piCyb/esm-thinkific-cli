import { existsSync, readFileSync, writeFileSync } from "fs";
import { CliError } from "./errors.js";
import { log } from "./logger.js";

/** Read a text file, or stdin when the path is "-". */
export async function readInput(path: string): Promise<string> {
  if (path === "-") {
    const content = await Bun.stdin.text();
    if (!content.trim()) throw new CliError(2, "Nothing received on stdin");
    return content;
  }

  if (!existsSync(path)) {
    throw new CliError(2, `File not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/**
 * Write text content to a file (-o), or print it raw to stdout.
 * Raw stdout keeps HTML pipeable: `esm-thinkific-cli lessons html <id> > lesson.html`.
 */
export function writeOutput(content: string, outFile?: string): void {
  if (outFile) {
    writeFileSync(outFile, content.endsWith("\n") ? content : `${content}\n`);
    log.success(`Saved to ${outFile}`);
    return;
  }
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
}
