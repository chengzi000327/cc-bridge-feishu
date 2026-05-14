import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createProviderPreset } from "../provider/provider-presets.js";

type RuntimeConfig = Record<string, unknown>;

export interface FeishuRailwayBootstrapInput {
  stateDir: string;
  codexHome?: string;
  claudeConfigDir?: string;
  engine?: string;
  provider?: string;
  allowedChatIds?: string;
  allowedGroupChatIds?: string;
  allowedUserIds?: string;
  hasDeepseekKey: boolean;
}

function toFeishuBridgeNumericId(value: string): number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  let hash = 0;
  for (const char of value) {
    hash = Math.imul(hash, 31) + char.charCodeAt(0);
    hash >>>= 0;
  }
  return hash;
}

function parseFeishuAllowedChatIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(toFeishuBridgeNumericId)
    .filter((entry) => Number.isInteger(entry));
}

async function readJsonFile(pathname: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(pathname, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function readConfigFile(pathname: string): Promise<{ exists: boolean; config: RuntimeConfig | null }> {
  try {
    const parsed = JSON.parse(await readFile(pathname, "utf8"));
    return {
      exists: true,
      config: typeof parsed === "object" && parsed !== null ? parsed as RuntimeConfig : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, config: null };
    }
    return { exists: true, config: null };
  }
}

function normalizeEngine(value: string | undefined): "codex" | "claude" | "deepseek" {
  return value === "claude" || value === "deepseek" ? value : "codex";
}

function createInitialConfig(input: FeishuRailwayBootstrapInput): RuntimeConfig {
  const engine = normalizeEngine(input.engine);
  const config: RuntimeConfig = {
    engine,
    locale: "zh",
    approvalMode: "full-auto",
  };

  if (engine === "codex") {
    config.codexRuntime = "process";
  }

  if (input.provider === "deepseek" && input.hasDeepseekKey) {
    config.provider = createProviderPreset(engine, "deepseek");
  }

  return config;
}

export async function bootstrapFeishuRailwayState(input: FeishuRailwayBootstrapInput): Promise<void> {
  await mkdir(input.stateDir, { recursive: true });
  await mkdir(path.join(input.stateDir, "workspace"), { recursive: true });
  if (input.codexHome) await mkdir(input.codexHome, { recursive: true });
  if (input.claudeConfigDir) await mkdir(input.claudeConfigDir, { recursive: true });

  const allowlist = parseFeishuAllowedChatIds(input.allowedChatIds);
  const allowedUsers = parseFeishuAllowedChatIds(input.allowedUserIds);
  const accessAllowlist = [...new Set([...allowlist, ...allowedUsers])];
  if (accessAllowlist.length > 0) {
    const accessPath = path.join(input.stateDir, "access.json");
    const existing = await readJsonFile(accessPath);
    const existingAllowlist = Array.isArray(existing?.allowlist)
      ? existing.allowlist.filter((entry): entry is number => Number.isInteger(entry))
      : [];
    await writeFile(accessPath, JSON.stringify({
      schemaVersion: 1,
      multiChat: accessAllowlist.length > 1 || existing?.multiChat === true,
      policy: "allowlist",
      pairedUsers: Array.isArray(existing?.pairedUsers) ? existing.pairedUsers : [],
      allowlist: [...new Set([...existingAllowlist, ...accessAllowlist])],
      pendingPairs: Array.isArray(existing?.pendingPairs) ? existing.pendingPairs : [],
    }, null, 2));
  }

  const configPath = path.join(input.stateDir, "config.json");
  const existingConfig = await readConfigFile(configPath);
  const config = existingConfig.exists ? existingConfig.config : createInitialConfig(input);
  if (!config) return;
  let configChanged = !existingConfig.exists;

  const allowedGroups = parseFeishuAllowedChatIds(input.allowedGroupChatIds);
  if (allowedGroups.length > 0) {
    const groupMode = typeof config.groupMode === "object" && config.groupMode !== null
      ? config.groupMode as Record<string, unknown>
      : {};
    const existingAllowedGroups = Array.isArray(groupMode.allowedChatIds)
      ? groupMode.allowedChatIds.filter((entry): entry is number => Number.isInteger(entry))
      : [];
    config.groupMode = {
      enabled: true,
      ...groupMode,
      allowedChatIds: [...new Set([...existingAllowedGroups, ...allowedGroups])],
      listenAllChatIds: Array.isArray(groupMode.listenAllChatIds)
        ? groupMode.listenAllChatIds.filter((entry): entry is number => Number.isInteger(entry))
        : [],
    };
    configChanged = true;
  }

  if (configChanged) {
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
}
