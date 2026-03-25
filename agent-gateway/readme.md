# koishi-plugin-agent-gateway

Koishi 插件：纯网关模式，把消息转发到外部 Agent（例如 LangGraph）。

职责边界：
- 插件仅做触发判断、请求封装、API 调用、动作渲染。
- 回复策略、记忆、情感、拟人行为全部在 Agent 服务端实现。
- 支持 `captureGroupContext`：未触发自动回复的群消息也可旁路上报（`observeOnly=true`），用于共享上下文记忆。
