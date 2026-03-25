# Agent Gateway API Skill

用于实现 `koishi-plugin-agent-gateway` 对接的 LangGraph 服务端。

## 目标

实现一个 HTTP 接口，接收 Koishi 网关请求并返回动作列表。  
所有“像真人”的行为（记忆、情感、分段、不回复策略）都应在服务端完成，而不是 Koishi 插件里。

## 端点契约

- 方法：`POST`
- 路径：由 Koishi 配置 `endpoint` 指定（例如 `/chat`）
- Header：
  - `content-type: application/json`
  - `x-trace-id: <traceId>`
  - 可选：`authorization: Bearer <apiKey>`

## 请求体（AgentRequestBody）

```json
{
  "traceId": "onebot-123-456-1710000000000",
  "sessionKey": "onebot:123456:987654",
  "timestamp": 1710000000000,
  "event": "message",
  "message": {
    "id": "msg-id",
    "content": "今天有点累",
    "quote": "你还好吗"
  },
  "user": {
    "id": "987654",
    "name": "Alice"
  },
  "channel": {
    "id": "123456",
    "guildId": "778899",
    "isDirect": false
  },
  "platform": {
    "name": "onebot",
    "selfId": "114514"
  },
  "metadata": {
    "locale": "zh-CN",
    "sid": "onebot:123456",
    "uid": "onebot:987654",
    "gid": "onebot:778899"
  }
}
```

## 响应体（AgentResponseBody）

插件支持 3 种返回方式，优先级从高到低：

1. `actions`
2. `segments`
3. `reply`

### 推荐：actions

```json
{
  "actions": [
    { "type": "reply", "content": "我看到了。" },
    { "type": "reply", "content": "你想先休息一下，还是继续聊？" }
  ]
}
```

动作定义：
- `reply`：发送一条消息
- `stop`：本次不回复（网关收到后停止发送）

示例（不回复）：

```json
{
  "actions": [
    { "type": "stop" }
  ]
}
```

### 兼容写法：segments

```json
{
  "segments": ["第一句", "第二句"]
}
```

### 最简写法：reply

```json
{
  "reply": "单条回复"
}
```

## 错误语义

- 服务端建议返回：
  - `400`：请求参数错误
  - `401/403`：鉴权失败
  - `429`：限流
  - `5xx`：内部错误
- 网关在非 2xx 或超时时不会发消息。

## LangGraph 实现建议

建议节点顺序：

1. `ingest`：解析请求体，校验字段
2. `policy`：规则层（是否回应、长度控制、语气）
3. `memory`：读取/写入外部记忆库（按 `sessionKey` / `user.id`）
4. `emotion`：情感/关系状态更新
5. `planner`：决定 `reply*` 还是 `stop`
6. `surface`：输出标准 `actions` 结构

## 最小验收清单

- 能处理 `message.content` 空字符串并返回 `stop`
- 能稳定返回 `actions`，不混乱结构
- 支持 trace 日志：`traceId` 全链路透传
- 幂等处理：同一 `message.id` 重放不重复写副作用
- 对超时设置保护（建议小于 Koishi 的 `timeout`）

## 调试样例（curl）

```bash
curl -X POST http://127.0.0.1:8000/chat \
  -H 'content-type: application/json' \
  -H 'x-trace-id: demo-trace' \
  -d '{
    "traceId":"demo-trace",
    "sessionKey":"onebot:1001:2002",
    "timestamp":1710000000000,
    "event":"message",
    "message":{"content":"你好"},
    "user":{"id":"2002","name":"tester"},
    "channel":{"id":"1001","isDirect":false},
    "platform":{"name":"onebot","selfId":"3003"}
  }'
```
