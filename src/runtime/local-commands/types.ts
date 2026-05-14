import type { Locale } from "../message-renderer.js";
import type { ProviderConfig } from "../../provider/provider-config.js";
import type { EngineName } from "../../provider/provider-presets.js";

export interface LocalCommandHandlers {
  sendReply: (text: string) => Promise<unknown>;
  updateInstanceConfig: (updater: (config: Record<string, unknown>) => void) => Promise<void>;
  clearSessions?: () => Promise<{ ok: boolean; error?: unknown }>;
}

export interface LocalCommandState {
  locale: Locale;
  currentEngine: EngineName;
  currentProvider: Partial<ProviderConfig>;
}
