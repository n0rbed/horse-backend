import { MqttClient } from "mqtt";
import type { DeviceEventHandler, CommandPayload } from "../types/globalTypes.js";
export declare function getAwsMqttClient(): MqttClient;
/**
 * Initialize AWS IoT Core (FEEDERS + CAMERAS)
 */
export declare function initAwsIot(onDeviceEvent: DeviceEventHandler): void;
/**
 * Send command to ANY device (FEEDER or CAMERA)
 */
export declare function publishCommand(thingName: string, command: CommandPayload): Promise<void>;
/**
 * Send FEED_COMMAND to feeder (backwards compatible)
 */
export declare function publishFeedCommand(thingName: string, command: Omit<CommandPayload, "type"> & {
    type: "FEED_COMMAND";
}): Promise<void>;
/**
 * Send STREAM_COMMAND to camera
 */
export declare function publishStreamCommand(thingName: string, command: Omit<CommandPayload, "type"> & {
    type: "STREAM_COMMAND";
}): Promise<void>;
export declare function disconnect(): Promise<void>;
/**
 * Tell many feeders to START publishing weight (device firmware must support this)
 * Publishes to: feeders/{thingName}/commands
 */
export declare function publishWeightStreamStartMany(thingNames: string[]): Promise<void>;
/**
 * Tell many feeders to STOP publishing weight (device firmware must support this)
 * Publishes to: feeders/{thingName}/commands
 */
export declare function publishWeightStreamStopMany(thingNames: string[]): Promise<void>;
//# sourceMappingURL=initAwsIot.d.ts.map