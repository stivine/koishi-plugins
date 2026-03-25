import { Context, Schema } from 'koishi';
export declare const name = "agent-gateway";
export declare const inject: readonly ["http"];
export interface AgentRequestBody {
    traceId: string;
    sessionKey: string;
    timestamp: number;
    event: 'message';
    message: {
        id?: string;
        content: string;
        quote?: string;
    };
    user: {
        id?: string;
        name?: string;
    };
    channel: {
        id?: string;
        guildId?: string;
        isDirect: boolean;
    };
    platform: {
        name: string;
        selfId?: string;
    };
    metadata?: Record<string, unknown>;
}
export interface AgentReplyAction {
    type: 'reply';
    content: string;
}
export interface AgentStopAction {
    type: 'stop';
}
export type AgentAction = AgentReplyAction | AgentStopAction;
export interface AgentResponseBody {
    actions?: AgentAction[];
    reply?: string;
    segments?: string[];
}
export interface Config {
    endpoint: string;
    apiKey?: string;
    timeout: number;
    triggerMode: 'mention-or-private' | 'always' | 'private-only';
    captureGroupContext: boolean;
    commandName: string;
    commandBypassSilence: boolean;
    passthroughMetadata: boolean;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
