import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function makePrefixedToolName(
  serverId: string,
  originalName: string,
  separator: string,
): string {
  return `${serverId}${separator}${originalName}`;
}

/** Longest server id wins so ids like `a` and `a-b` do not collide ambiguously. */
export function parsePrefixedToolName(
  prefixed: string,
  separator: string,
  knownServerIds: Iterable<string>,
): { serverId: string; originalName: string } | null {
  const ids = [...knownServerIds].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const p = `${id}${separator}`;
    if (prefixed.startsWith(p)) {
      return { serverId: id, originalName: prefixed.slice(p.length) };
    }
  }
  return null;
}

export function prefixToolList(
  serverId: string,
  tools: Tool[],
  separator: string,
  usedNames: Set<string>,
): Tool[] {
  const out: Tool[] = [];
  for (const t of tools) {
    let name = makePrefixedToolName(serverId, t.name, separator);
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}__dup${n}`)) n += 1;
      name = `${name}__dup${n}`;
    }
    usedNames.add(name);
    out.push({
      ...t,
      name,
      title: t.title ? `[${serverId}] ${t.title}` : `[${serverId}] ${t.name}`,
      description: t.description
        ? `(from ${serverId}) ${t.description}`
        : `Tool from backend ${serverId}`,
    });
  }
  return out;
}
