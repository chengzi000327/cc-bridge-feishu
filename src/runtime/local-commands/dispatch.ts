import { handleEngineLocalCommand, isEngineCommand } from "./engine.js";
import { handleProviderLocalCommand, isProviderCommand } from "./provider.js";
import type { LocalCommandHandlers, LocalCommandState } from "./types.js";

export async function dispatchLocalCommand(
  text: string,
  state: LocalCommandState,
  handlers: LocalCommandHandlers,
): Promise<boolean> {
  if (isEngineCommand(text)) {
    return handleEngineLocalCommand(text, state, handlers);
  }
  if (isProviderCommand(text)) {
    return handleProviderLocalCommand(text, state, handlers);
  }
  return false;
}

export { handleEngineLocalCommand, isEngineCommand } from "./engine.js";
export { handleProviderLocalCommand, isProviderCommand } from "./provider.js";
export type { LocalCommandHandlers, LocalCommandState } from "./types.js";
