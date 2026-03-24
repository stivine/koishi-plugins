import { Context, Schema } from 'koishi';
export declare const name = "rich-push";
export interface Config {
    defaultPlatform: string;
    defaultGroupId?: string;
    defaultForward: boolean;
    senderNickname: string;
    senderUserId: string;
    commandName: string;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
