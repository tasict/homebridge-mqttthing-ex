// The only module in this package that reads the process environment.
//
// The three MQTTTHING_* variables mirror homebridge-mqttthing: they act as
// broker-setting fallbacks so credentials can be kept out of config.json.
// They are read at connection time, and no file on disk is involved.
import type { BrokerEnv } from './model/broker-key.js';

export function brokerEnv(): BrokerEnv {
  return {
    MQTTTHING_URL: process.env.MQTTTHING_URL,
    MQTTTHING_USERNAME: process.env.MQTTTHING_USERNAME,
    MQTTTHING_PASSWORD: process.env.MQTTTHING_PASSWORD,
  };
}
