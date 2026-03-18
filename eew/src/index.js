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

// src/config.ts
var import_koishi = require("koishi");
var SConfig = import_koishi.Schema.intersect([
  // SConfig: Schema<IConfig> 
  import_koishi.Schema.object({
    eewUrl: import_koishi.Schema.string().role("link").required().description("地震预警的WebSocket地址"),
    eewTimeout: import_koishi.Schema.number().min(0).max(9999).default(1500).description("通信超时时间（单位：ms）")
  }).description("网络设置"),
  import_koishi.Schema.object({
    enabledEew: import_koishi.Schema.boolean().default(false).description("是否启用 `EEW` 命令")
  }).description("基本设置"),
  import_koishi.Schema.union([
    import_koishi.Schema.object({
      enabledEew: import_koishi.Schema.const(true).required().description("是否启用 `EEW` 命令"),
      showEewLog: import_koishi.Schema.boolean().default(true).description("推送预警时是否同时在终端中显示预警信息"),
      showEewEmoji: import_koishi.Schema.boolean().default(true).description("输出信息中是否用表情强调")
    }),
    import_koishi.Schema.object({})
  ]),
  import_koishi.Schema.object({
    eewSendList: import_koishi.Schema.array(import_koishi.Schema.object({
      target: import_koishi.Schema.union(["Group", "Friend"]).required().role(""),
      id: import_koishi.Schema.string().required()
    })).role("table").description("预警推送群聊 / 私聊白名单（种类 和 ID）"),
    eewBotList: import_koishi.Schema.array(String).role("table").description("预警机器人白名单（ID）")
  }).description("名单设置"),
  import_koishi.Schema.object({
    enabledScEew: import_koishi.Schema.boolean().default(false).description("是否启用四川地震预警推送"),
    enabledFjEew: import_koishi.Schema.boolean().default(false).description("是否启用福建局地震预警推送"),
    enabledCwaEew: import_koishi.Schema.boolean().default(false).description("是否启用台湾地震预警推送"),
    enabledJmaEew: import_koishi.Schema.boolean().default(false).description("是否启用日本地震预警推送"),
    enabledJmaEqlist: import_koishi.Schema.boolean().default(false).description("是否启用日本地震报告推送（仅解析**No1**消息）"),
    enabledCencEqlist: import_koishi.Schema.boolean().default(false).description("是否启用中国地震台网地震报告推送（仅解析**No1**消息）"),
    magnitudeThreshold: import_koishi.Schema.number().min(0).max(10).default(0).description("震级阈值（单位：级）")

  }).description("推送设置")
]);

// src/tools.ts
var import_koishi2 = require("koishi");
function custLog(ctx, type, value) {
  switch (type) {
    case "debug":
      ctx.logger("eew").debug(value);
      break;
    case "warn":
      ctx.logger("eew").warn(value);
      break;
    case "error":
      ctx.logger("eew").error(value);
      break;
    case "info":
      ctx.logger("eew").info(value);
      break;
    case "success":
      ctx.logger("eew").success(value);
      break;
  }
}
__name(custLog, "custLog");
function showEewInConsole(ctx, title, subtitle, broadcast) {
  custLog(ctx, "warn", `${title}
${subtitle}
${broadcast}`);
}
__name(showEewInConsole, "showEewInConsole");
function showTargets(value, show_emoji = true) {
  var result = show_emoji ? `⚠️地震预警推送目标⚠️
` : `地震预警推送目标
`;
  if (value != void 0 && value.length > 0) {
    for (var item of value) {
      if (item == void 0 || item.id == void 0 || item.id.trim() == "" || item.target == void 0 || item.target.trim() == "")
        return `设置内列表出现非法项 ${show_emoji ? "❌" : ""}`;
      result += `目标：${item.id} [${item.target == "Group" ? "群聊" : "私聊"}] ${show_emoji ? "🧑" : ""}
`;
    }
  } else {
    result = `设置内列表为空 ${show_emoji ? "❌" : ""}`;
  }
  return result;
}
__name(showTargets, "showTargets");
function showPlatforms(value, show_emoji = true) {
  var result = show_emoji ? `⚠️地震预警推送平台⚠️
` : "地震预警推送平台\n";
  if (value != void 0 && value.length > 0)
    for (var item of value)
      result += `平台：${item} [机器人] ${show_emoji ? "🤖" : ""}
`;
  else
    result = `设置内列表为空 ${show_emoji ? "❌" : ""}`;
  return result;
}
__name(showPlatforms, "showPlatforms");
function getFormatTime(timestamp) {
  if (timestamp == void 0)
    return import_koishi2.Time.template("yyyy-MM-dd hh:mm:ss", /* @__PURE__ */ new Date());
  return import_koishi2.Time.template("yyyy-MM-dd hh:mm:ss", new Date(timestamp));
}
__name(getFormatTime, "getFormatTime");

// src/model.ts
var EewAdapter = class {
  static {
    __name(this, "EewAdapter");
  }
  //  extends Adapter 
  socket;
  sendList;
  botsList;
  showEewLogs;
  showEewEmoji;
  magnitudeThreshold;
  ctx;
  eew_addr;
  eewAllows = {
    "sc_eew": false,
    "fj_eew": false,
    "cwa_eew": false,
    "jma_eew": false,
    "cenc_eqlist": true,
    "jma_eqlist": true
  };
  constructor(ctx, bot_list, send_list, eew_log, eew_emoji, magnitudeThreshold, eew_addr) {
    this.ctx = ctx;
    this.botsList = bot_list;
    this.sendList = send_list;
    this.showEewLogs = eew_log;
    this.showEewEmoji = eew_emoji;
    this.magnitudeThreshold = magnitudeThreshold;
    this.eew_addr = eew_addr;
  }
  async sendMessageToFriend(user_id, message) {
    for (var bot of this.getSenderBotList())
      await bot.sendPrivateMessage(user_id, message);
  }
  async sendMessageToGroup(guild_id, message) {
    for (var bot of this.getSenderBotList()) {
      await bot.sendMessage(guild_id, message);
    }
  }
  async sendEew(data_object) {
    var eew;
    if (!this.eewAllows[data_object.type])
      return;
    switch (data_object.type) {
      case "sc_eew":
        eew = new ScEew(this.ctx);
        break;
      case "fj_eew":
        eew = new FjEew(this.ctx);
        break;
      case "cwa_eew":
        eew = new CwaEew(this.ctx);
        break;
      case "jma_eew":
        eew = new JmaEew(this.ctx);
        break;
      case "jma_eqlist":
        eew = new JmaEew(this.ctx);
        break;
      case "cenc_eqlist":
        eew = new ScEew(this.ctx);
        break;
    }
    if (data_object.type.includes("eqlist"))
      eew.eewExecute(data_object["No1"]);
    else
      eew.eewExecute(data_object);
    const result = eew.showEewInfo(this.showEewLogs, this.showEewEmoji);
    // 保证mag是number
    var mag = Number(eew.mag);
    custLog(`mag是${mag}，阈值是${this.magnitudeThreshold}`);
    if(mag < this.magnitudeThreshold) {
      custLog(this.ctx, "info", `地震预警震级 ${mag} 低于阈值 ${this.magnitudeThreshold}，不进行推送`);
      eew = void 0;
    }
    else {
      for (var item of this.sendList) {
        switch (item["target"]) {
          case "Friend":
            await this.sendMessageToFriend(item["id"], result);
            break;
          case "Group":
            await this.sendMessageToGroup(item["id"], result);
            break;
          default:
            break;
        }
      }
      eew = void 0;
    }

  }
  // 获取所有可被允许发送消息的平台
  getSenderBotList() {
    var cur_bot_list = [];
    for (var bot_id of this.botsList) {
      for (var active_bot of this.ctx.bots) {
        if (bot_id == active_bot["user"].id) {
          cur_bot_list.push(active_bot);
        }
      }
    }
    return cur_bot_list;
  }
  setup(ws_url, time_out) {
    this.socket = this.socket ?? this.ctx.http.ws(ws_url, { timeout: time_out });
  }
  start() {
    console.log("ws starting...");
    this.socket.onopen = () => {
      custLog(this.ctx, "success", "ws opened");
    };
    this.socket.onmessage = async (event) => {
      console.log("ws received:", event.data.toString());
      var data_object = JSON.parse(event.data.toString());
      switch (data_object.type) {
        case "sc_eew":
          await this.sendEew(data_object);
          break;
        case "fj_eew":
          await this.sendEew(data_object);
          break;
        case "cwa_eew":
          await this.sendEew(data_object);
          break;
        case "jma_eew":
          await this.sendEew(data_object);
          break;
        case "jma_eqlist":
          await this.sendEew(data_object);
          break;
        case "cenc_eqlist":
          await this.sendEew(data_object);
          break;
        case "heartbeat":
          custLog(this.ctx, "info", `ws received: heartbeat.alive [${getFormatTime(data_object.timestamp)}]`);
          break;
        default:
          custLog(this.ctx, "info", `ws received: unknowntype.msg ${event.data.toString()}`);
          break;
      }
    };
    this.socket.onclose = () => {
      custLog(this.ctx, "success", "ws closed");
      this.socket = void 0;
      this.setup(this.eew_addr, this.ctx.config.eewTimeout);
      this.start();
    };
    this.socket.onerror = (error) => {
      custLog(this.ctx, "error", `ws error: ${error}`);
    };
    custLog(this.ctx, "success", "ws started");
  }
  stop() {
    console.log("ws closing...");
    this.socket.close();
    this.socket = void 0;
  }
  pause() {
    console.log("ws pausing...");
    this.socket.pause();
    custLog(this.ctx, "success", "ws paused");
  }
  resume() {
    console.log("ws resuming...");
    this.socket.resume();
    custLog(this.ctx, "success", "ws resumed");
  }
  isEnable() {
    return this.socket != void 0;
  }
  status(show_emoji = true) {
    if (!this.isEnable())
      return show_emoji ? "无连接 ❌" : "无连接";
    switch (this.socket.readyState) {
      case 0:
        return show_emoji ? "正在连接 ⏳️" : "正在连接...";
      case 1:
        return show_emoji ? "已连接 ✅️" : "已连接";
      case 2:
        return show_emoji ? "正在关闭 ⏳️" : "正在关闭...";
      case 3:
        return show_emoji ? "无连接 ❌ (socket ng)" : "无连接 (socket ng)";
    }
  }
  info(show_emoji = true) {
    var result = show_emoji ? "⚠️地震预警状态信息⚠️\n" : "地震预警状态信息\n";
    result += "预警开关：" + (this.isEnable() ? show_emoji ? "已开启 ✅️" : "已开启" : show_emoji ? "已关闭 ❌" : "已关闭") + "\n";
    result += "通信状态：" + this.status(show_emoji) + "\n";
    result += `平台数量：共 ${this.botsList ? this.botsList.length : 0} 个 ${show_emoji ? "🤖" : ""}
`;
    result += `目标数量：共 ${this.sendList ? this.sendList.length : 0} 个 ${show_emoji ? "🧑" : ""}
`;
    result += `阈值：${this.magnitudeThreshold} 级\n`;
    return result;
  }
  setEewSwAllows(sc_eew_sw, fj_eew_sw, cwa_eew_sw, jma_eew_sw, jma_eqlist_sw, cenc_eqlist_sw, magnitudeThreshold) {
    this.eewAllows["sc_eew"] = sc_eew_sw;
    this.eewAllows["fj_eew"] = fj_eew_sw;
    this.eewAllows["cwa_eew"] = cwa_eew_sw;
    this.eewAllows["jma_eew"] = jma_eew_sw;
    this.eewAllows["jma_eqlist"] = jma_eqlist_sw;
    this.eewAllows["cenc_eqlist"] = cenc_eqlist_sw;
    this.magnitudeThreshold = magnitudeThreshold;
  }
  async test2() {
    const test_str = `{"type": "jma_eew", "Title": "緊急地震速報（予報）", "CodeType": "Ｍ、最大予測震度及び主要動到達予測時刻の緊急地震速報", "Issue": {"Source": "大阪", "Status": "通常"}, "EventID": "20240719211116", "Serial": 1, "AnnouncedTime": "2024/07/19 21:11:29", "OriginTime": "2024/07/19 21:11:05", "Hypocenter": "千葉県北西部", "Latitude": 35.7, "Longitude": 140.1, "Magunitude": 3.5, "Depth": 70, "MaxIntensity": "2", "Accuracy": {"Epicenter": "IPF 法（5 点以上）", "Depth": "IPF 法（5 点以上）", "Magnitude": "防災科研システム"}, "MaxIntChange": {"String": "不明、未設定時、キャンセル時", "Reason": "不明、未設定時、キャンセル時"}, "WarnArea": [], "isSea": false, "isTraining": false, "isAssumption": false, "isWarn": false, "isFinal": false, "isCancel": false, "OriginalText": "37 04 00 240719211129 C11 240719211105 ND20240719211116 NCN001 JD/'/'/'/'/'/'/'/'/'/'/'/'/'/' JN/'/'/' 341 N357 E1401 070 35 02 RK44204 RT00/'/'/' RC/'/'/'/'/' 9999=", "Pond": "144"}`;
    await this.sendEew(JSON.parse(test_str));
  }
};
var Eew = class {
  static {
    __name(this, "Eew");
  }
  report_time;
  num;
  latitude;
  longitude;
  region;
  mag;
  origin_time;
  depth;
  intensity;
  type;
  ctx;
  constructor(ctx) {
    this.ctx = ctx;
  }
  showEewInfo(show_log, show_emoji) {
    return "It is a show eew info function template";
  }
  eewExecute(json_data) {
    this.report_time = json_data["ReportTime"] ?? json_data["AnnouncedTime"] ?? getFormatTime();
    this.region = json_data["HypoCenter"] ?? json_data["Hypocenter"] ?? json_data["location"];
    this.origin_time = json_data["OriginTime"] ?? json_data["time_full"] ?? json_data["time"];
    this.latitude = json_data["Latitude"] ?? json_data["latitude"];
    this.longitude = json_data["Longitude"] ?? json_data["longitude"];
    this.mag = json_data["Magunitude"] ?? json_data["magnitude"];
    this.num = json_data["ReportNum"] ?? json_data["Serial"];
  }
  static test(ctx, show_emoji = true) {
    var report_time = "2024-04-03 07:58:27";
    var origin_time_str = "2024-04-03 07:58:10";
    var num = "2", lat = "23.89", lon = "121.56", mag = "6.8";
    var depth = "20 km", shindo = "6弱", region = "花蓮縣壽豐鄉";
    var title = `${show_emoji ? "⚠️" : ""}台湾地震预警${show_emoji ? "⚠️" : ""}`;
    var subtitle = `${region}发生芮氏规模${mag}地震`;
    var broadcast = `${title} | 第 ${num} 报
${origin_time_str} 发生
震央: ${region} 
(北纬: ${lat}度 东经: ${lon}度)
规模: ${mag}
深度: ${depth}
最大震度: ${shindo}
更新時間: ${report_time}`;
    showEewInConsole(ctx, `以下是测试信息：
${title}`, subtitle, broadcast);
    return broadcast;
  }
};
var ScEew = class extends Eew {
  static {
    __name(this, "ScEew");
  }
  title = "四川地震预警";
  eewExecute(scEewData) {
    super.eewExecute(scEewData);
    this.intensity = scEewData["MaxIntensity"] ?? scEewData["intensity"];
    this.depth = scEewData["Depth"] ?? scEewData["depth"] ?? "10";
    this.depth += " km";
    if (scEewData["intensity"] != void 0 || scEewData["depth"] != void 0)
      this.title = "中国地震台网";
  }
  showEewInfo(show_log = true, show_emoji = true) {
    const title = `${show_emoji ? "⚠️" : ""}${this.title}${show_emoji ? "⚠️" : ""}`;
    const subtitle = `${this.region}发生烈度${this.intensity}的地震`;
    const broadcast = `${title} | ${this.num != void 0 ? "第 " + this.num + " 报" : "最近报"}
${this.origin_time} 发生
震中: ${this.region} 
(北纬: ${this.latitude}度 东经: ${this.longitude}度)
震级: ${this.mag}
深度: ${this.depth}
最大烈度: ${this.intensity}
更新时间: ${this.report_time}`;
    if (show_log)
      showEewInConsole(this.ctx, title, subtitle, broadcast);
    return broadcast;
  }
};
var FjEew = class extends Eew {
  static {
    __name(this, "FjEew");
  }
  // 示例：处理福建地震预警数据
  eewExecute(fjEewData) {
    super.eewExecute(fjEewData);
    this.type = fjEewData["isFinal"] ? "[终]" : "";
  }
  showEewInfo(show_log = true, show_emoji = true) {
    const title = `${show_emoji ? "⚠️" : ""}福建局地震预警${show_emoji ? "⚠️" : ""}`;
    const subtitle = `${this.region}发生芮氏规模${this.mag}地震`;
    const broadcast = `${title} | 第 ${this.num} 报 ${this.type}
${this.origin_time} 发生
震央: ${this.region} 
(北纬: ${this.latitude}度 东经: ${this.longitude}度)
规模: ${this.mag}
更新时间: ${this.report_time}`;
    if (show_log)
      showEewInConsole(this.ctx, title, subtitle, broadcast);
    return broadcast;
  }
};
var CwaEew = class extends Eew {
  static {
    __name(this, "CwaEew");
  }
  shindo;
  title;
  // 示例：处理湾湾地震预警数据
  eewExecute(cwaEewData) {
    super.eewExecute(cwaEewData);
    this.depth = cwaEewData["Depth"] + " km";
    this.shindo = cwaEewData["MaxIntensity"];
  }
  showEewInfo(show_log = true, show_emoji = true) {
    const title = `${show_emoji ? "⚠️" : ""}台湾地震预警${show_emoji ? "⚠️" : ""}`;
    const subtitle = `${this.region}发生芮氏规模${this.mag}地震`;
    const broadcast = `${title} | 第 ${this.num} 报
${this.origin_time} 发生
震央: ${this.region} 
(北纬: ${this.latitude}度 东经: ${this.longitude}度)
规模: ${this.mag}
深度: ${this.depth}
最大震度: ${this.shindo}
更新时间: ${this.report_time}`;
    if (show_log)
      showEewInConsole(this.ctx, title, subtitle, broadcast);
    return broadcast;
  }
};
var JmaEew = class extends Eew {
  static {
    __name(this, "JmaEew");
  }
  shindo;
  // 日本地震强度单位
  title;
  // 日本地震标题信息
  info;
  // 日本地震列表信息
  // type:string;    // 日本地震最终报标识
  eewExecute(jmaEewData) {
    super.eewExecute(jmaEewData);
    this.depth = jmaEewData["Depth"] != void 0 ? jmaEewData["Depth"] + " km" : jmaEewData["depth"];
    this.shindo = jmaEewData["MaxIntensity"] ?? jmaEewData["shindo"];
    this.type = jmaEewData["isFinal"] ? "[终]" : "";
    this.title = jmaEewData["Title"];
    this.info = jmaEewData["info"];
  }
  showEewInfo(show_log = true, show_emoji = true) {
    const title = `${show_emoji ? "⚠️" + this.title + "⚠️" : this.title}`;
    const subtitle = `${this.region}で震度${this.mag}の地震`;
    const broadcast = `${title} | ${this.num != void 0 ? "第 " + this.num + " 报" : "最近报"} ${this.type}
${this.origin_time} 发生
震央: ${this.region} 
(北纬: ${this.latitude}度 东经: ${this.longitude}度)
规模: ${this.mag}
深度: ${this.depth}
最大震度: ${this.shindo}
更新时间: ${this.report_time}`;
    if (show_log)
      showEewInConsole(this.ctx, title, subtitle, broadcast);
    return broadcast;
  }
};

// src/index.ts
var name = "eew";
var Config = SConfig;
function apply(ctx, config) {
  const EEW_SW = config.enabledEew ?? false;
  const EEW_ADDR = config.eewUrl;
  const EEW_TIMEOUT = config.eewTimeout ?? 1500;
  const EEW_SENDLIST = config.eewSendList;
  const EEW_BOTLIST = config.eewBotList;
  const SHOW_EEWEMOJE = config.showEewEmoji ?? true;
  const SHOW_EEWLOG = config.showEewLog ?? true;
  const SC_SW = config.enabledScEew ?? false;
  const FJ_SW = config.enabledFjEew ?? false;
  const CMA_SW = config.enabledCwaEew ?? false;
  const JMA_SW = config.enabledJmaEew ?? false;
  const JEQLST_SW = config.enabledJmaEqlist ?? false;
  const CEQLST_SW = config.enabledCencEqlist ?? false;
  const M_THRESHOLD = config.magnitudeThreshold ?? 0;
  var eewAdaper;
  ctx.on("ready", () => {
    if (eewAdaper == void 0) {
      eewAdaper = new EewAdapter(ctx, EEW_BOTLIST, EEW_SENDLIST, SHOW_EEWLOG, SHOW_EEWEMOJE, M_THRESHOLD, EEW_ADDR);
      eewAdaper.setEewSwAllows(SC_SW, FJ_SW, CMA_SW, JMA_SW, JEQLST_SW, CEQLST_SW, M_THRESHOLD);
    }
    custLog(ctx, "success", "plugin ready");
  });
  ctx.on("exit", async () => {
    try {
      eewAdaper.stop();
      custLog(ctx, "success", "plugin closed");
    } catch {
      custLog(ctx, "error", "plugin already closed");
    }
  });
  ctx.on("dispose", () => {
    try {
      eewAdaper.stop();
      custLog(ctx, "success", "plugin disposed");
    } catch {
      custLog(ctx, "error", "plugin already disposed");
    }
  });
  function previousCheck(param) {
    if (!EEW_SW)
      return `EEW 指令未启用`;
    if (EEW_ADDR == void 0 || EEW_ADDR.trim() == "")
      return "请设置有效的Websocket地址";
  }
  __name(previousCheck, "previousCheck");
  ctx.command("EEW", "地震预警菜单界面", { authority: 1 });
  ctx.command("EEW.开启", "开启地震预警", { authority: 2 }).alias(`EEW 开启`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    if (eewAdaper.isEnable())
      return "请勿重复开启";
    eewAdaper.setup(EEW_ADDR, EEW_TIMEOUT);
    eewAdaper.start();
    return "地震预警开启成功";
  });
  ctx.command("EEW.关闭", "关闭地震预警", { authority: 2 }).alias(`EEW 关闭`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    try {
      eewAdaper.stop();
      return "地震预警关闭成功";
    } catch {
      return "请勿重复关闭";
    }
  });
  ctx.command("EEW.重置", "重置地震预警", { authority: 2 }).alias(`EEW 重置`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    try {
      eewAdaper.stop();
    } catch {
    }
    eewAdaper = new EewAdapter(ctx, EEW_BOTLIST, EEW_SENDLIST, SHOW_EEWLOG, SHOW_EEWEMOJE);
    eewAdaper.setEewSwAllows(SC_SW, FJ_SW, CMA_SW, JMA_SW, JEQLST_SW, CEQLST_SW, M_THRESHOLD);
    custLog(ctx, "success", "ws reset");
    return "地震预警重置成功";
  });
  ctx.command("EEW.状态", "查看地震预警信息", { authority: 2 }).alias(`EEW 状态`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    return eewAdaper.info(SHOW_EEWEMOJE);
  });
  ctx.command("EEW.测试", "发送地震预警测试消息", { authority: 1 }).alias(`EEW 测试`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    return Eew.test(ctx, SHOW_EEWEMOJE);
  });
  ctx.command("EEW.目标", "查看地震预警推送目标列表", { authority: 2 }).alias(`EEW 目标`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    return showTargets(EEW_SENDLIST, SHOW_EEWEMOJE);
  });
  ctx.command("EEW.平台", "查看地震预警推送Bot列表", { authority: 2 }).alias(`EEW 平台`).action(async ({ session }, ...args) => {
    var pcheck_info = previousCheck(args[0]);
    if (pcheck_info != void 0)
      return pcheck_info;
    return showPlatforms(EEW_BOTLIST, SHOW_EEWEMOJE);
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  name
});