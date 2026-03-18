import { Schema } from 'koishi';
export interface IConfig {
    enabledEew: boolean;
    enabledScEew: boolean;
    enabledFjEew: boolean;
    enabledCwaEew: boolean;
    enabledJmaEew: boolean;
    enabledJmaEqlist: boolean;
    enabledCencEqlist: boolean;
    showEewLog: boolean;
    eewUrl: string;
    eewTimeout: number;
    eewSendList: any;
    eewBotList: any;
    showEewEmoji: boolean;
    magnitudeThreshold: number;
}
export declare const SConfig: Schema<Schemastery.ObjectS<{}>, {} & import("cosmokit").Dict>;