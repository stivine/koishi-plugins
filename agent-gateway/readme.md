# koishi-plugin-agent-gateway

Koishi 插件：纯网关模式，把消息转发到外部 Agent（例如 LangGraph）。

职责边界：
- 插件仅做触发判断、请求封装、API 调用、动作渲染。
- 回复策略、记忆、情感、拟人行为全部在 Agent 服务端实现。
- 支持 `captureGroupContext`：未触发自动回复的群消息也可旁路上报（`observeOnly=true`），用于共享上下文记忆。

异常处理：
- 当 Agent 请求失败或返回“无可发送内容”（且非 `stop`）时，插件不再向普通用户回显报错文案。
- 可通过配置 `adminNotifyUserId`（可选 `adminNotifyPlatform`）将错误摘要私发给管理员。
- 若未配置管理员通知，插件仅写日志，不打扰用户。
