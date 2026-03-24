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
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var logger = new import_koishi.Logger("rich-push");
var name = "rich-push";
var Config = import_koishi.Schema.object({
  defaultPlatform: import_koishi.Schema.string().default("onebot").description("目标平台，默认 onebot。"),
  defaultGroupId: import_koishi.Schema.string().description("默认目标群号，不填则每次用 -g 指定。"),
  defaultForward: import_koishi.Schema.boolean().default(true).description("默认使用折叠转发消息。"),
  senderNickname: import_koishi.Schema.string().default("图文推送").description("折叠转发消息的显示昵称。"),
  senderUserId: import_koishi.Schema.string().default("0").description("折叠转发消息的显示发送者 ID。"),
  commandName: import_koishi.Schema.string().default("richpush").description("注册的指令名。")
});
var IMAGE_TAG_RE = /\[image\]([\s\S]*?)\[\/image\]/gi;
function stripOuterBrackets(input) {
  const text = input.trim();
  if (text.startsWith("【") && text.endsWith("】") && text.length >= 2) {
    return text.slice(1, -1).trim();
  }
  return text;
}
__name(stripOuterBrackets, "stripOuterBrackets");
function parseSegments(input) {
  const source = stripOuterBrackets(input);
  const segments = [];
  let lastIndex = 0;
  source.replace(IMAGE_TAG_RE, (full, url, offset) => {
    const plain = source.slice(lastIndex, offset);
    if (plain) segments.push({ type: "text", value: plain });
    const normalizedUrl = String(url || "").trim();
    if (normalizedUrl) segments.push({ type: "image", value: normalizedUrl });
    lastIndex = offset + full.length;
    return full;
  });
  const trailing = source.slice(lastIndex);
  if (trailing) segments.push({ type: "text", value: trailing });
  if (!segments.length && source) {
    segments.push({ type: "text", value: source });
  }
  return segments;
}
__name(parseSegments, "parseSegments");
function buildRichMessage(segments) {
  return segments.map((segment) => {
    if (segment.type === "image") return import_koishi.h.image(segment.value);
    return segment.value;
  }).join("");
}
__name(buildRichMessage, "buildRichMessage");
function buildForwardMessage(content, nickname, userId) {
  const safeNickname = import_koishi.h.escape(nickname || "");
  const safeUserId = import_koishi.h.escape(userId || "0");
  return `<message forward><author id="${safeUserId}" name="${safeNickname}"/>${content}</message>`;
}
__name(buildForwardMessage, "buildForwardMessage");
function apply(ctx, config) {
  const commandName = config.commandName?.trim() || "richpush";
  ctx.command(`${commandName} <content:text>`, "把 [image]url[/image] 格式文本推送到指定群聊").option("group", "-g <group:string> 指定目标群号").option("platform", "-p <platform:string> 指定目标平台").option("forward", "-f 使用折叠转发消息").option("plain", "-P 使用普通消息（覆盖 -f）").option("nickname", "-n <nickname:string> 覆盖转发显示昵称").option("userId", "-u <userId:string> 覆盖转发显示发送者 ID").example(`${commandName} -g 561410928 "【标题：[image]https://example.com/a.jpg[/image]】"`).action(async ({ session, options }, content) => {
    if (!content?.trim()) return "请输入要发送的内容。";
    const groupId = String(options.group || config.defaultGroupId || "").trim();
    if (!groupId) return "缺少目标群号，请使用 -g 指定或在配置中设置 defaultGroupId。";
    const platform = String(options.platform || config.defaultPlatform || session.platform || "").trim();
    if (!platform) return "缺少目标平台，请使用 -p 指定或在配置中设置 defaultPlatform。";
    const nickname = String(options.nickname || config.senderNickname || "图文推送");
    const userId = String(options.userId || config.senderUserId || "0");
    const segments = parseSegments(content);
    if (!segments.length) return "内容为空，未发送。";
    const richMessage = buildRichMessage(segments);
    const useForward = options.plain ? false : options.forward || config.defaultForward;
    const finalMessage = useForward ? buildForwardMessage(richMessage, nickname, userId) : richMessage;
    const guildId = `${platform}:${groupId}`;
    try {
      await ctx.broadcast([guildId], finalMessage);
    } catch (error) {
      logger.error(error);
      return `发送失败：${error.message || String(error)}`;
    }
    const mode = useForward ? "折叠转发" : "普通消息";
    return `发送成功：${platform} 平台群 ${groupId}（${mode}）`;
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  name
});
