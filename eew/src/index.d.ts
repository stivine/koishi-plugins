import { Context, Schema } from 'koishi';
import { IConfig } from './config';
export declare const name = "eew";
export declare const Config: Schema<Schemastery.ObjectS<{}>, {} & import("cosmokit").Dict>;
export declare function apply(ctx: Context, config: IConfig): void;