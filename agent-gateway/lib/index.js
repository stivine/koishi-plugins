var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var logger = new import_koishi.Logger("agent-gateway");
var name = "agent-gateway";
var inject = ["http"];
var Config = import_koishi.Schema.object({
  endpoint: import_koishi.Schema.string().required().description("Agent 服务接口地址，例如 http://127.0.0.1:8000/chat"),
  apiKey: import_koishi.Schema.string().role("secret").description("可选：Agent 服务鉴权 key。"),
  timeout: import_koishi.Schema.number().default(import_koishi.Time.second * 20).description("请求 Agent 的超时毫秒数。"),
  triggerMode: import_koishi.Schema.union([
    import_koishi.Schema.const("mention-or-private").description("仅在 @机器人 或私聊时自动触发。"),
    import_koishi.Schema.const("always").description("所有消息都触发。"),
    import_koishi.Schema.const("private-only").description("仅私聊触发。")
  ]).default("mention-or-private").description("自动触发条件。"),
  captureGroupContext: import_koishi.Schema.boolean().default(true).description("是否采集群聊中未触发自动回复的消息，用于共享上下文记忆。"),
  commandName: import_koishi.Schema.string().default("agent.chat").description("手动触发命令名。"),
  commandBypassSilence: import_koishi.Schema.boolean().default(true).description("手动命令是否绕过 Agent 的 stop 行为。"),
  passthroughMetadata: import_koishi.Schema.boolean().default(true).description("是否将 session 额外字段透传给 Agent。")
});
function normalizeText(input) {
  return String(input || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
__name(normalizeText, "normalizeText");
function shouldTrigger(session, config) {
  const isPrivate = session.subtype === "private" || !session.guildId;
  const appel = Boolean(session.stripped?.appel);
  if (config.triggerMode === "always") return true;
  if (config.triggerMode === "private-only") return isPrivate;
  return isPrivate || appel;
}
__name(shouldTrigger, "shouldTrigger");
function isLikelyCommand(content) {
  return /^([/.#]|agent\.)/.test(content.trim());
}
__name(isLikelyCommand, "isLikelyCommand");
function makeTraceId(session) {
  const channelPart = session.channelId || "private";
  const userPart = session.userId || "unknown";
  return `${session.platform}-${channelPart}-${userPart}-${Date.now()}`;
}
__name(makeTraceId, "makeTraceId");
function buildSessionKey(session) {
  const channelPart = session.channelId ? `${session.platform}:${session.channelId}` : `${session.platform}:private`;
  return `${channelPart}:${session.userId || "unknown"}`;
}
__name(buildSessionKey, "buildSessionKey");
function buildRequestBody(session, text, traceId, config) {
  const isDirect = session.subtype === "private" || !session.guildId;
  return {
    traceId,
    sessionKey: buildSessionKey(session),
    timestamp: Date.now(),
    event: "message",
    message: {
      id: session.messageId,
      content: text,
      quote: session.quote?.content
    },
    user: {
      id: session.userId,
      name: session.username || session.author?.name || session.author?.nick
    },
    channel: {
      id: session.channelId,
      guildId: session.guildId,
      isDirect
    },
    platform: {
      name: session.platform,
      selfId: session.selfId
    },
    metadata: config.passthroughMetadata ? {
      locales: session.locales,
      sid: session.sid,
      uid: session.uid,
      gid: session.gid
    } : void 0
  };
}
__name(buildRequestBody, "buildRequestBody");
function responseToMessages(data, bypassStop = false) {
  if (Array.isArray(data.actions) && data.actions.length) {
    const messages = [];
    for (const action of data.actions) {
      if (action.type === "stop" && !bypassStop) return [];
      if (action.type === "reply") {
        const msg = normalizeText(action.content);
        if (msg) messages.push(msg);
      }
    }
    return messages;
  }
  if (Array.isArray(data.segments) && data.segments.length) {
    return data.segments.map(normalizeText).filter(Boolean);
  }
  const single = normalizeText(data.reply || "");
  return single ? [single] : [];
}
__name(responseToMessages, "responseToMessages");
async function callAgent(ctx, config, body) {
  const headers = {
    "content-type": "application/json",
    "x-trace-id": body.traceId
  };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  return ctx.http.post(config.endpoint, body, {
    timeout: config.timeout,
    headers
  });
}
__name(callAgent, "callAgent");
async function runGateway(ctx, session, text, config, bypassStop = false, manual = false, observeOnly = false) {
  const traceId = makeTraceId(session);
  const body = buildRequestBody(session, text, traceId, config);
  body.metadata = {
    ...body.metadata || {},
    manual,
    observeOnly
  };
  let data;
  try {
    data = await callAgent(ctx, config, body);
  } catch (error) {
    logger.warn(`agent request failed: ${error.message || String(error)}`);
    return [];
  }
  return responseToMessages(data, bypassStop);
}
__name(runGateway, "runGateway");
function apply(ctx, config) {
  ctx.middleware(async (session, next) => {
    if (session.type !== "message") return next();
    if (!session.platform) return next();
    if (session.userId === session.selfId || session.author?.isBot) return next();
    const autoTriggered = shouldTrigger(session, config);
    if (!autoTriggered) {
      const isGroup = !!session.guildId && session.subtype !== "private";
      if (config.captureGroupContext && isGroup) {
        const text2 = normalizeText(session.content);
        if (text2 && !isLikelyCommand(text2)) {
          await runGateway(ctx, session, text2, config, true, false, true);
        }
      }
      return next();
    }
    const text = normalizeText(session.content);
    if (!text) return next();
    if (isLikelyCommand(text)) return next();
    const messages = await runGateway(ctx, session, text, config, false, false, false);
    if (!messages.length) return next();
    for (const message of messages) {
      await session.send(message);
    }
  });
  const commandName = config.commandName?.trim() || "agent.chat";
  ctx.command(`${commandName} <text:text>`, "手动触发 Agent 网关").action(async ({ session }, text) => {
    if (!text?.trim()) return "请输入内容。";
    const messages = await runGateway(ctx, session, text, config, config.commandBypassSilence, true, false);
    if (!messages.length) return "Agent 未返回可发送内容。";
    for (const message of messages) {
      await session.send(message);
    }
    return "";
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
