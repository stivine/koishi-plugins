import { Bot, Context } from 'koishi';
export declare class EewAdapter {
    private socket;
    private sendList;
    private botsList;
    private showEewLogs;
    private showEewEmoji;
    private ctx;
    private eewAllows;
    constructor(ctx: Context, bot_list: string[], send_list: any[], eew_log: boolean, eew_emoji: boolean);
    sendMessageToFriend(user_id: string, message: string): Promise<void>;
    sendMessageToGroup(guild_id: string, message: string): Promise<void>;
    sendEew(data_object: any): Promise<void>;
    getSenderBotList(): Bot[];
    setup(ws_url: string, time_out: number): void;
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
    isEnable(): boolean;
    status(show_emoji?: boolean): string;
    info(show_emoji?: boolean): string;
    setEewSwAllows(sc_eew_sw: boolean, fj_eew_sw: boolean, cwa_eew_sw: boolean, jma_eew_sw: boolean, jma_eqlist_sw: boolean, cenc_eqlist_sw: boolean): void;
    test2(): Promise<void>;
}
export declare class Eew {
    report_time: string;
    num: string;
    latitude: string;
    longitude: string;
    region: string;
    mag: string;
    origin_time: string;
    depth: string;
    intensity: string;
    type: string;
    ctx: Context;
    constructor(ctx: Context);
    showEewInfo(show_log: boolean, show_emoji: boolean): string;
    eewExecute(json_data: any): void;
    static test(ctx: Context, show_emoji?: boolean): string;
}