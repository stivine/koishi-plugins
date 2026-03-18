import { Context } from 'koishi';
export declare function delay(ms: number): Promise<void>;
export declare function custLog(ctx: Context, type: 'debug' | 'warn' | 'error' | 'info' | 'success', value: string): void;
export declare function showEewInConsole(ctx: Context, title: string, subtitle: string, broadcast: string): void;
export declare function showTargets(value: Array<{
    target: string;
    id: string;
}>, show_emoji?: boolean): string;
export declare function showPlatforms(value: string[], show_emoji?: boolean): string;
export declare function getFormatTime(timestamp?: number): string;