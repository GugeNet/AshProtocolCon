import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { defineConfig } from "vite";
import { logFileName, mergeJournal, personFileName, PLAYER_ID } from "./src/game/journal.ts";

const ollamaProxy = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    rewrite: (path: string) => path.replace(/^\/ollama/, ""),
  },
};

const ollamaOrigin = "http://127.0.0.1:11434";

type HttpReq = {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
};

type HttpRes = {
  headersSent: boolean;
  writableEnded: boolean;
  statusCode: number;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string | Uint8Array): void;
  on(event: "close", listener: () => void): void;
};

function readBody(req: HttpReq): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    });
    req.on("error", reject);
  });
}

function textOf(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function formatTool(entry: unknown): string {
  const fn = asRecord(asRecord(entry)?.function);
  const name = typeof fn?.name === "string" ? fn.name : "?";
  const params = asRecord(asRecord(fn?.parameters)?.properties) ?? {};
  const args = Object.entries(params).map(([key, value]) => {
    const values = asRecord(value)?.enum;
    return Array.isArray(values) ? `${key}: ${values.join(" | ")}` : key;
  });
  return `  ${name}(${args.join(", ")})`;
}

function formatCalls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const fn = asRecord(asRecord(entry)?.function);
    const name = typeof fn?.name === "string" ? fn.name : "?";
    return `→ ${name}(${JSON.stringify(fn?.arguments ?? {})})`;
  });
}

function formatRequest(body: Uint8Array): string {
  const raw = textOf(body);
  try {
    const row = asRecord(JSON.parse(raw));
    if (!row) return raw;
    const lines = [`model ${typeof row.model === "string" ? row.model : "?"}`];
    if (row.think != null) lines.push(`think ${String(row.think)}`);
    if (row.options) lines.push(`options ${JSON.stringify(row.options)}`);
    if (row.format) lines.push(`format ${JSON.stringify(row.format)}`);
    const tools = Array.isArray(row.tools) ? row.tools : [];
    if (tools.length) lines.push("tools", ...tools.map(formatTool));
    const messages = Array.isArray(row.messages) ? row.messages : [];
    for (const entry of messages) {
      const message = asRecord(entry);
      const role = typeof message?.role === "string" ? message.role : "message";
      const content = typeof message?.content === "string" ? message.content : "";
      const named = typeof message?.tool_name === "string" ? ` ${message.tool_name}` : "";
      lines.push("", `--- ${role}${named} ---`, content);
      lines.push(...formatCalls(message?.tool_calls));
    }
    if (!messages.length) lines.push("", raw);
    return lines.join("\n");
  } catch {
    return raw;
  }
}

function formatReply(raw: string): string {
  try {
    const row = asRecord(JSON.parse(raw));
    if (!row) return raw;
    const message = asRecord(row.message);
    const parts: string[] = [];
    const thinking =
      (typeof message?.thinking === "string" && message.thinking) ||
      (typeof row.thinking === "string" && row.thinking) ||
      "";
    if (thinking) parts.push(`--- thinking ---\n${thinking}`);
    if (typeof message?.content === "string" && message.content) {
      parts.push(`--- reply ---\n${message.content}`);
    }
    const calls = formatCalls(message?.tool_calls);
    if (calls.length) parts.push(`--- tool calls ---\n${calls.join("\n")}`);
    if (typeof row.error === "string") parts.push(`--- error ---\n${row.error}`);
    return parts.length ? parts.join("\n\n") : raw;
  } catch {
    return raw;
  }
}

function forwardHeaders(headers: HttpReq["headers"]): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length" || lower === "connection") continue;
    if (Array.isArray(value)) {
      for (const item of value) out.append(key, item);
    } else {
      out.set(key, value);
    }
  }
  return out;
}

let inference = 0;

async function forwardOllama(req: HttpReq, res: HttpRes) {
  const id = ++inference;
  const path = (req.url ?? "/").replace(/^\/ollama/, "") || "/";
  const chat = path.startsWith("/api/chat") || path.startsWith("/api/generate");
  const body = await readBody(req);
  if (chat && body.byteLength) console.log(`\n[qwen #${id}] →\n${formatRequest(body)}\n`);

  const controller = new AbortController();
  let done = false;
  res.on("close", () => {
    if (!done) controller.abort();
  });

  let response: Response;
  try {
    response = await fetch(`${ollamaOrigin}${path}`, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: body.byteLength ? textOf(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (chat && !aborted) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[qwen #${id}] ← failed\n${message}\n`);
    }
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(aborted ? "" : "Ollama unreachable");
    }
    done = true;
    return;
  }

  const raw = textOf(new Uint8Array(await response.arrayBuffer()));
  if (chat) console.log(`[qwen #${id}] ← ${response.status}\n${formatReply(raw)}\n`);
  if (!res.writableEnded) {
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key === "transfer-encoding" || key === "content-encoding") return;
      responseHeaders[key] = value;
    });
    responseHeaders["content-length"] = String(new TextEncoder().encode(raw).byteLength);
    res.writeHead(response.status, responseHeaders);
    res.end(raw);
  }
  done = true;
}

const journalsRoot = resolve("journals");
const npcRoot = resolve("public/ash/npcs");

function insideJournals(fileName: string): string | null {
  if (!fileName || fileName !== fileName.replace(/[\\/]/g, "")) return null;
  if (!fileName.endsWith(".log") && !fileName.endsWith(".memory.txt") && !fileName.endsWith(".memory.json")) return null;
  const full = resolve(journalsRoot, fileName);
  const root = journalsRoot.endsWith(sep) ? journalsRoot : journalsRoot + sep;
  if (!full.startsWith(root)) return null;
  return full;
}

function journalFile(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith("/journals/")) return null;
  let fileName = path.slice("/journals/".length);
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    return null;
  }
  return insideJournals(fileName);
}

function writeJournals(body: Uint8Array): void {
  const row = asRecord(JSON.parse(textOf(body)));
  const people = Array.isArray(row?.people) ? row.people : [];
  mkdirSync(journalsRoot, { recursive: true });
  for (const entry of people) {
    const person = asRecord(entry);
    const id = typeof person?.id === "string" ? person.id : "";
    const name = typeof person?.name === "string" ? person.name : "";
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    if (id !== PLAYER_ID && !existsSync(join(npcRoot, id))) continue;
    if (!name || personFileName(name) === "unnamed") continue;
    const lines = Array.isArray(person?.log)
      ? person.log.filter((item): item is string => typeof item === "string")
      : [];
    const target = insideJournals(logFileName(name));
    if (!target) continue;
    const previous = existsSync(target) ? readFileSync(target, "utf8") : "";
    writeFileSync(target, mergeJournal(previous, lines), "utf8");
  }
}

function serveJournal(req: HttpReq, res: HttpRes): void {
  if (req.method === "GET") {
    const file = journalFile(req.url ?? "");
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end("");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
    return;
  }
  if (req.method === "POST" && (req.url ?? "").split("?")[0] === "/journals") {
    void readBody(req)
      .then((body) => {
        writeJournals(body);
        if (!res.writableEnded) {
          res.statusCode = 204;
          res.end();
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "The journal was not written.";
        console.log(`[journal] ${message}`);
        if (!res.headersSent) {
          res.statusCode = 400;
          res.end(message);
        }
      });
    return;
  }
  res.statusCode = 404;
  res.end("");
}

function npcJournal(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const incoming = req as HttpReq;
      const url = incoming.url ?? "";
      if (url !== "/journals" && !url.startsWith("/journals/") && !url.startsWith("/journals?")) {
        next();
        return;
      }
      serveJournal(incoming, res as HttpRes);
    });
  };
  return {
    name: "npc-journal",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

function hypnosRead(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const incoming = req as HttpReq;
      const outgoing = res as HttpRes;
      const url = incoming.url ?? "";
      if ((url.split("?")[0] ?? "") !== "/hypnos/read") {
        next();
        return;
      }
      if (incoming.method !== "GET") {
        outgoing.statusCode = 405;
        outgoing.end("");
        return;
      }
      const npc = new URL(url, "http://localhost").searchParams.get("npc") ?? "";
      if (!/^[a-z0-9-]+$/.test(npc)) {
        outgoing.statusCode = 400;
        outgoing.end("Unknown person.");
        return;
      }
      const result = spawnSync("python", ["hypnos.py", "--read-only", "--npc", npc], {
        cwd: resolve("."),
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      if (result.error || result.status !== 0) {
        const message = (
          result.stderr ||
          result.stdout ||
          result.error?.message ||
          "Hypnos did not answer."
        ).trim();
        console.log(`[hypnos] read ${npc} failed\n${message}`);
        outgoing.statusCode = 502;
        outgoing.end(message);
        return;
      }
      console.log(`[hypnos] read ${npc}`);
      outgoing.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      outgoing.end(result.stdout);
    });
  };
  return {
    name: "hypnos-read",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

function ollamaConsole(): Plugin {
  return {
    name: "ollama-console",
    configureServer(server) {
      console.log("Qwen3 inference will print in this console.");
      server.middlewares.use((req, res, next) => {
        const incoming = req as HttpReq;
        const outgoing = res as HttpRes;
        const url = incoming.url ?? "";
        if (url !== "/ollama" && !url.startsWith("/ollama/")) {
          next();
          return;
        }
        void forwardOllama(incoming, outgoing).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[qwen] ← failed\n${message}\n`);
          if (!outgoing.headersSent) {
            outgoing.statusCode = 502;
            outgoing.end(message);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), npcJournal(), hypnosRead(), ollamaConsole()],
  server: { proxy: ollamaProxy },
  preview: { proxy: ollamaProxy },
});
