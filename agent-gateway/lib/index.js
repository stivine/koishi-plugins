var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
const logger = new import_koishi.Logger("agent-gateway");
const name = "agent-gateway";
const inject = ["http"];
const Config = import_koishi.Schema.object({
  endpoint: import_koishi.Schema.string().required().description("Agent \u670D\u52A1\u63A5\u53E3\u5730\u5740\uFF0C\u4F8B\u5982 http://127.0.0.1:8000/chat"),
  apiKey: import_koishi.Schema.string().role("secret").description("\u53EF\u9009\uFF1AAgent \u670D\u52A1\u9274\u6743 key\u3002"),
  timeout: import_koishi.Schema.number().default(import_koishi.Time.second * 20).description("\u8BF7\u6C42 Agent \u7684\u8D85\u65F6\u6BEB\u79D2\u6570\u3002"),
  replyProbability: import_koishi.Schema.number().min(0).max(0.2).step(0.01).default(0.1).description("\u975E\u5F3A\u5236\u89E6\u53D1\u65F6\u7684\u56DE\u590D\u6982\u7387 p\uFF080~0.2\uFF09\u3002"),
  enabledGroupIds: import_koishi.Schema.array(String).default([]).description("\u53EF\u9009\uFF1A\u4EC5\u8FD9\u4E9B\u7FA4\u53F7\u542F\u7528\u7F51\u5173\u5904\u7406\uFF1B\u7559\u7A7A\u8868\u793A\u6240\u6709\u7FA4\u90FD\u542F\u7528\u3002"),
  triggerMode: import_koishi.Schema.union([
    import_koishi.Schema.const("mention-or-private").description("\u4EC5\u5728 @\u673A\u5668\u4EBA \u6216\u79C1\u804A\u65F6\u81EA\u52A8\u89E6\u53D1\u3002"),
    import_koishi.Schema.const("always").description("\u6240\u6709\u6D88\u606F\u90FD\u89E6\u53D1\u3002"),
    import_koishi.Schema.const("private-only").description("\u4EC5\u79C1\u804A\u89E6\u53D1\u3002")
  ]).default("mention-or-private").description("\u81EA\u52A8\u89E6\u53D1\u6761\u4EF6\u3002"),
  captureGroupContext: import_koishi.Schema.boolean().default(true).description("\u662F\u5426\u91C7\u96C6\u7FA4\u804A\u4E2D\u672A\u89E6\u53D1\u81EA\u52A8\u56DE\u590D\u7684\u6D88\u606F\uFF0C\u7528\u4E8E\u5171\u4EAB\u4E0A\u4E0B\u6587\u8BB0\u5FC6\u3002"),
  commandName: import_koishi.Schema.string().default("agent.chat").description("\u624B\u52A8\u89E6\u53D1\u547D\u4EE4\u540D\u3002"),
  commandBypassSilence: import_koishi.Schema.boolean().default(true).description("\u624B\u52A8\u547D\u4EE4\u662F\u5426\u7ED5\u8FC7 Agent \u7684 stop \u884C\u4E3A\u3002"),
  passthroughMetadata: import_koishi.Schema.boolean().default(true).description("\u662F\u5426\u5C06 session \u989D\u5916\u5B57\u6BB5\u900F\u4F20\u7ED9 Agent\u3002"),
  adminNotifyUserId: import_koishi.Schema.string().description("\u53EF\u9009\uFF1AAgent \u5F02\u5E38\u65F6\u901A\u77E5\u7684\u7BA1\u7406\u5458\u7528\u6237 ID\uFF0C\u4E0D\u586B\u5219\u4E0D\u901A\u77E5\u3002"),
  adminNotifyPlatform: import_koishi.Schema.string().description("\u53EF\u9009\uFF1A\u7BA1\u7406\u5458\u6240\u5728\u5E73\u53F0\uFF08\u5982 onebot\uFF09\uFF0C\u4E0D\u586B\u5219\u4F7F\u7528\u5F53\u524D\u4F1A\u8BDD\u5E73\u53F0\u3002")
});
function normalizeText(input) {
  return String(input || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function extractImages(input) {
  const images = [];
  try {
    for (const element of import_koishi.h.parse(String(input || ""))) {
      if (element.type !== "img" && element.type !== "image") continue;
      const attrs = element.attrs || {};
      const url = String(attrs.url || attrs.src || attrs.href || "").trim();
      const file = String(attrs.file || attrs.path || "").trim();
      const mime = String(attrs.mime || attrs.type || "").trim();
      const name2 = String(attrs.name || attrs.filename || "").trim();
      if (!url && !file) continue;
      images.push({
        ...url ? { url } : {},
        ...file ? { file } : {},
        ...mime ? { mime } : {},
        ...name2 ? { name: name2 } : {}
      });
    }
  } catch (error) {
    logger.warn(`image parse failed: ${toErrorMessage(error)}`);
  }
  return images.slice(0, 3);
}
function sessionMeta(session) {
  return `platform=${session.platform || "unknown"} channel=${session.channelId || "private"} guild=${session.guildId || "none"} user=${session.userId || "unknown"} subtype=${session.subtype || "unknown"}`;
}
function shortText(text, max = 80) {
  const s = normalizeText(text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}
function hasNameMention(content) {
  return normalizeText(content).includes("\u767D\u69FF");
}
function hasAppel(session) {
  return Boolean(
    session.stripped?.appel || session.stripped?.hasAt || session.parsed?.appel || session.parsed?.hasAt
  );
}
function isPrivateSession(session) {
  const channelId = String(session.channelId || "");
  return session.subtype === "private" || Boolean(session.isDirect) || channelId.startsWith("@");
}
function shouldTrigger(session, config) {
  const isPrivate = isPrivateSession(session);
  const appel = hasAppel(session);
  const nameMention = hasNameMention(session.content || "");
  let triggered = false;
  if (config.triggerMode === "always") triggered = true;
  else if (config.triggerMode === "private-only") triggered = isPrivate;
  else triggered = isPrivate || appel || nameMention;
  logger.info(`trigger check: mode=${config.triggerMode} isPrivate=${isPrivate} appel=${appel} nameMention=${nameMention} triggered=${triggered} ${sessionMeta(session)}`);
  return triggered;
}
function isLikelyCommand(content) {
  return /^([/.#]|agent\.)/.test(content.trim());
}
function isGroupMessage(session) {
  return !isPrivateSession(session) && Boolean(session.channelId);
}
function isGroupEnabled(session, config) {
  if (!isGroupMessage(session)) return true;
  const allowed = (config.enabledGroupIds || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!allowed.length) return true;
  return allowed.includes(String(session.channelId || "").trim());
}
function makeTraceId(session) {
  const channelPart = session.channelId || "private";
  const userPart = session.userId || "unknown";
  return `${session.platform}-${channelPart}-${userPart}-${Date.now()}`;
}
function buildSessionKey(session) {
  const channelPart = session.channelId ? `${session.platform}:${session.channelId}` : `${session.platform}:private`;
  return `${channelPart}:${session.userId || "unknown"}`;
}
function buildRequestBody(session, text, traceId, config) {
  const isDirect = isPrivateSession(session);
  const images = extractImages(session.content || "");
  return {
    traceId,
    sessionKey: buildSessionKey(session),
    timestamp: Date.now(),
    event: "message",
    message: {
      id: session.messageId,
      content: text,
      quote: session.quote?.content,
      images
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
function responseToMessages(data, bypassStop = false) {
  if (Array.isArray(data.actions) && data.actions.length) {
    const messages = [];
    let stopped = false;
    for (const action of data.actions) {
      if (action.type === "stop" && !bypassStop) {
        stopped = true;
        return { messages: [], stopped };
      }
      if (action.type === "reply") {
        const msg = normalizeText(action.content);
        if (msg) messages.push(msg);
      }
    }
    return { messages, stopped };
  }
  if (Array.isArray(data.segments) && data.segments.length) {
    return { messages: data.segments.map(normalizeText).filter(Boolean), stopped: false };
  }
  const single = normalizeText(data.reply || "");
  return { messages: single ? [single] : [], stopped: false };
}
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
function toErrorMessage(error) {
  const msg = error?.message || String(error);
  return normalizeText(msg).slice(0, 500);
}
async function notifyAdmin(ctx, config, session, title, detail) {
  const adminUserId = config.adminNotifyUserId?.trim();
  if (!adminUserId) return;
  const platform = config.adminNotifyPlatform?.trim() || session.platform;
  const bot = ctx.bots.find((x) => x.platform === platform);
  if (!bot || typeof bot.sendPrivateMessage !== "function") {
    logger.warn(`admin notify skipped: no bot/sendPrivateMessage for platform=${platform}`);
    return;
  }
  const text = `[agent-gateway] ${title}
platform=${session.platform}
channel=${session.channelId || "private"}
user=${session.userId || "unknown"}
detail=${detail}`;
  try {
    await bot.sendPrivateMessage(adminUserId, text);
  } catch (error) {
    logger.warn(`admin notify failed: ${toErrorMessage(error)}`);
  }
}
async function runGateway(ctx, session, text, config, bypassStop = false, manual = false, observeOnly = false) {
  const traceId = makeTraceId(session);
  const replyProbability = Math.min(Math.max(Number(config.replyProbability ?? 0.1), 0), 0.2);
  const body = buildRequestBody(session, text, traceId, config);
  body.metadata = {
    ...body.metadata || {},
    manual,
    observeOnly,
    mentioned: hasAppel(session),
    replyProbability
  };
  logger.info(
    `gateway dispatch: traceId=${traceId} manual=${manual} observeOnly=${observeOnly} bypassStop=${bypassStop} imageCount=${body.message.images?.length || 0} endpoint=${config.endpoint} sessionKey=${body.sessionKey} text="${shortText(text)}" ${sessionMeta(session)}`
  );
  let data;
  try {
    data = await callAgent(ctx, config, body);
  } catch (error) {
    const detail = `traceId=${traceId} reason=request_failed error=${toErrorMessage(error)}`;
    logger.warn(`agent request failed: ${detail}`);
    await notifyAdmin(ctx, config, session, "agent request failed", detail);
    return { messages: [], stopped: false };
  }
  const parsed = responseToMessages(data, bypassStop);
  if (!parsed.messages.length && !parsed.stopped) {
    const raw = normalizeText(JSON.stringify(data)).slice(0, 700);
    const detail = `traceId=${traceId} reason=empty_response body=${raw || "{}"}`.slice(0, 1e3);
    logger.warn(`agent returned no sendable content: ${detail}`);
    await notifyAdmin(ctx, config, session, "agent empty response", detail);
  }
  return parsed;
}
function apply(ctx, config) {
  ctx.middleware(async (session, next) => {
    const eventType = String(session.type || "");
    const isMessageEvent = eventType === "message" || eventType.startsWith("message-");
    if (!isMessageEvent) {
      logger.info(`skip: non-message event, type=${session.type || "unknown"}`);
      return next();
    }
    if (!session.platform) {
      logger.warn(`skip: missing platform, ${sessionMeta(session)}`);
      return next();
    }
    if (session.userId === session.selfId || session.author?.isBot) {
      return next();
    }
    if (!isGroupEnabled(session, config)) {
      logger.debug(`skip: group not enabled, channel=${session.channelId || "unknown"} enabledGroups=${(config.enabledGroupIds || []).join(",") || "(all)"}`);
      return next();
    }
    const autoTriggered = shouldTrigger(session, config);
    const captureGroupContext = config.captureGroupContext !== false;
    if (!autoTriggered) {
      const isGroup = isGroupMessage(session);
      if (captureGroupContext && isGroup) {
        const text2 = normalizeText(session.content);
        const images = extractImages(session.content || "");
        if ((text2 || images.length) && !isLikelyCommand(text2)) {
          logger.debug(`observeOnly capture: channel=${session.channelId || "unknown"} user=${session.userId || "unknown"}`);
          await runGateway(ctx, session, text2, config, true, false, true);
        } else {
          logger.debug(`observeOnly skip: emptyTextOrCommand text="${shortText(text2)}"`);
        }
      }
      return next();
    }
    const text = normalizeText(session.content);
    const images = extractImages(session.content || "");
    if (!text && !images.length) {
      logger.info(`auto trigger skip: empty normalized text ${sessionMeta(session)}`);
      return next();
    }
    if (isLikelyCommand(text)) {
      logger.info(`auto trigger skip: detected command text="${shortText(text)}"`);
      return next();
    }
    const result = await runGateway(ctx, session, text, config, false, false, false);
    if (!result.messages.length) {
      logger.info(`auto trigger no output: stopped=${result.stopped} ${sessionMeta(session)}`);
      return next();
    }
    for (const message of result.messages) {
      logger.info(`auto send: message="${shortText(message)}" ${sessionMeta(session)}`);
      await session.send(message);
    }
  });
  const commandName = config.commandName?.trim() || "agent.chat";
  ctx.command(`${commandName} <text:text>`, "\u624B\u52A8\u89E6\u53D1 Agent \u7F51\u5173").action(async ({ session }, text) => {
    if (!text?.trim()) return "\u8BF7\u8F93\u5165\u5185\u5BB9\u3002";
    if (!isGroupEnabled(session, config)) return "\u5F53\u524D\u7FA4\u672A\u542F\u7528 Agent \u7F51\u5173\u3002";
    logger.info(`manual command invoke: command=${commandName} text="${shortText(text)}" ${sessionMeta(session)}`);
    const result = await runGateway(ctx, session, text, config, config.commandBypassSilence, true, false);
    if (!result.messages.length) return "";
    for (const message of result.messages) {
      logger.info(`manual send: message="${shortText(message)}" ${sessionMeta(session)}`);
      await session.send(message);
    }
    return "";
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
