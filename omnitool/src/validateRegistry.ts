import { z } from "zod";

import type { BackendServerEntry, OmnitoolRegistry } from "./types";

const listenSchema = z.object({
  hostname: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});

const stdioDefSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const httpDefSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const serverEntrySchema = z.discriminatedUnion("type", [
  z.object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "id: alphanumeric, underscore, hyphen only"),
    type: z.literal("stdio"),
    stdio: stdioDefSchema,
  }),
  z.object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "id: alphanumeric, underscore, hyphen only"),
    type: z.literal("http"),
    http: httpDefSchema,
  }),
]);

export const omnitoolRegistrySchema = z.object({
  listen: listenSchema,
  mcpPath: z.string().min(1).startsWith("/"),
  toolPrefixSeparator: z.string().min(1).default("__"),
  servers: z.array(serverEntrySchema),
});

export type OmnitoolRegistryInput = z.input<typeof omnitoolRegistrySchema>;

export function validateServerEntry(data: unknown): BackendServerEntry {
  return serverEntrySchema.parse(data) as BackendServerEntry;
}

export function validateOmnitoolRegistry(data: unknown): OmnitoolRegistry {
  const parsed = omnitoolRegistrySchema.parse(data);
  const ids = parsed.servers.map(s => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) {
    throw new Error(`Duplicate backend id: ${JSON.stringify(dup)}`);
  }
  return parsed as OmnitoolRegistry;
}

export function mergeRegistryPartial(
  base: OmnitoolRegistry,
  partial: Partial<OmnitoolRegistry>,
): OmnitoolRegistry {
  const next: OmnitoolRegistry = {
    ...base,
    ...partial,
    listen: partial.listen ? { ...base.listen, ...partial.listen } : base.listen,
    servers: partial.servers !== undefined ? partial.servers : base.servers,
    toolPrefixSeparator:
      partial.toolPrefixSeparator !== undefined
        ? partial.toolPrefixSeparator
        : base.toolPrefixSeparator,
    mcpPath: partial.mcpPath !== undefined ? partial.mcpPath : base.mcpPath,
  };
  return validateOmnitoolRegistry(next);
}
