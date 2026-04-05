import type { MessagesBody, ProxyConfig, ToolDef } from "./types";
import { stripAdaptiveThinkingIfListed } from "./stripAdaptive";

export function transformMessagesBody(
  body: MessagesBody,
  cfg: ProxyConfig,
): MessagesBody {
  const passthrough = cfg.passthrough !== false;

  if (passthrough) {
    return { ...body };
  }

  const model = cfg.model ?? "";
  const allow = new Set(cfg.toolAllowlist ?? []);

  const next: MessagesBody = { ...body, model };

  if (Array.isArray(body.tools)) {
    next.tools = body.tools.filter(
      (t): t is ToolDef =>
        t != null &&
        typeof t === "object" &&
        typeof (t as ToolDef).name === "string" &&
        allow.has((t as ToolDef).name),
    );
  }

  return stripAdaptiveThinkingIfListed(
    next,
    model,
    cfg.stripAdaptiveThinkingForModels,
  );
}
