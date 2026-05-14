import { applyEngineSelection } from "../instance-config.js";
import type { Locale } from "../message-renderer.js";
import type { EngineName } from "../../provider/provider-presets.js";
import type { LocalCommandHandlers, LocalCommandState } from "./types.js";

const VALID_ENGINES: EngineName[] = ["codex", "claude", "deepseek"];

interface EngineCommandParse {
  engine: string;
  invalid: boolean;
}

export function parseEngineCommandText(text: string): EngineCommandParse | null {
  const match = text.trim().match(/^\/engine(?:@\w+)?(?:\s+(.+))?$/i);
  if (!match) return null;
  const rawArgs = match[1]?.trim() ?? "";
  if (!rawArgs) {
    return { engine: "", invalid: false };
  }
  const parts = rawArgs.split(/\s+/).filter(Boolean);
  if (parts.length !== 1) {
    return { engine: "", invalid: true };
  }
  return { engine: parts[0] ?? "", invalid: false };
}

export function isEngineCommand(text: string): boolean {
  return parseEngineCommandText(text) !== null;
}

function renderEngineQueryMessage(locale: Locale, currentEngine: EngineName): string {
  return locale === "zh"
    ? [
        `当前引擎：${currentEngine}`,
        "用 /engine <名称> 选择引擎：",
        "/engine claude",
        "/engine codex",
        "/engine deepseek",
        "切换后重启此实例以生效。",
      ].join("\n")
    : [
        `Current engine: ${currentEngine}`,
        "Choose an engine with /engine <name>:",
        "/engine claude",
        "/engine codex",
        "/engine deepseek",
        "Restart this instance after switching to apply the change.",
      ].join("\n");
}

function renderEngineUsageMessage(locale: Locale): string {
  return locale === "zh"
    ? "用法: /engine [claude|codex|deepseek]"
    : "Usage: /engine [claude|codex|deepseek]";
}

interface EngineSwitchMessageInput {
  locale: Locale;
  previousEngine: EngineName;
  engine: EngineName;
  clearedModel: boolean;
  resetSessionBindings: boolean;
  resetSessionBindingFailed: boolean;
}

export function renderEngineSwitchMessage(input: EngineSwitchMessageInput): string {
  const { locale, previousEngine, engine, clearedModel, resetSessionBindings, resetSessionBindingFailed } = input;
  if (locale === "zh") {
    if (resetSessionBindingFailed) {
      return `未能切换到 ${engine}：该实例的会话绑定未能先清除。当前引擎仍是 ${previousEngine}。`;
    }
    if (clearedModel && resetSessionBindings) {
      return `引擎已设为 ${engine}。已清除先前的模型覆盖，并重置该实例的会话绑定。重启此实例后生效。`;
    }
    if (clearedModel) {
      return `引擎已设为 ${engine}。已清除先前的模型覆盖。重启此实例后生效。`;
    }
    if (resetSessionBindings) {
      return `引擎已设为 ${engine}。已重置该实例的会话绑定。重启此实例后生效。`;
    }
    return `引擎已设为 ${engine}。重启此实例后生效。`;
  }
  if (resetSessionBindingFailed) {
    return `Could not switch to ${engine}: failed to clear this instance's session bindings first. Engine is still ${previousEngine}.`;
  }
  if (clearedModel && resetSessionBindings) {
    return `Engine set to ${engine}. Cleared the previous model override and reset this instance's session bindings. Restart this instance to apply.`;
  }
  if (clearedModel) {
    return `Engine set to ${engine}. Cleared the previous model override. Restart this instance to apply.`;
  }
  if (resetSessionBindings) {
    return `Engine set to ${engine}. Reset this instance's session bindings. Restart this instance to apply.`;
  }
  return `Engine set to ${engine}. Restart this instance to apply.`;
}

export async function handleEngineLocalCommand(
  text: string,
  state: LocalCommandState,
  handlers: LocalCommandHandlers,
): Promise<boolean> {
  const cmd = parseEngineCommandText(text);
  if (!cmd) return false;

  if (!cmd.engine && !cmd.invalid) {
    await handlers.sendReply(renderEngineQueryMessage(state.locale, state.currentEngine));
    return true;
  }

  const target = cmd.engine as EngineName;
  if (cmd.invalid || !VALID_ENGINES.includes(target)) {
    await handlers.sendReply(renderEngineUsageMessage(state.locale));
    return true;
  }

  const engineChanged = state.currentEngine !== target;
  let clearedModel = false;
  let resetSessionBindings = false;
  let resetSessionBindingFailed = false;

  if (engineChanged && handlers.clearSessions) {
    const result = await handlers.clearSessions();
    if (result.ok) {
      resetSessionBindings = true;
    } else {
      resetSessionBindingFailed = true;
      console.error(
        `Failed to clear instance session bindings after switching engine to ${target}:`,
        result.error instanceof Error ? result.error.message : result.error,
      );
    }
  }

  if (!resetSessionBindingFailed) {
    await handlers.updateInstanceConfig((config) => {
      const result = applyEngineSelection(config, target);
      clearedModel = result.clearedModel;
    });
  }

  await handlers.sendReply(renderEngineSwitchMessage({
    locale: state.locale,
    previousEngine: state.currentEngine,
    engine: target,
    clearedModel,
    resetSessionBindings,
    resetSessionBindingFailed,
  }));
  return true;
}
