// Tests for the accessory types ported in this milestone: contactSensor,
// smokeSensor, leakSensor, doorbell, statelessProgrammableSwitch, microphone,
// speaker, lockMechanism, garageDoorOpener, window, door, windowCovering,
// securitySystem and valve.
import net from 'node:net';
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// register the ported service types (services/index.ts does not import them yet)
import '../src/services/sensors-extra.js';
import '../src/services/audio.js';
import '../src/services/buttons.js';
import '../src/services/doors.js';
import '../src/services/security.js';
import '../src/services/valve.js';

import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';

const { Service, Characteristic } = hapNodeJs;

let broker: InstanceType<typeof Aedes>;
let server: net.Server;
let port: number;
let url: string;
const api = makeMockApi(os.tmpdir());

const seen: Array<{ topic: string; payload: string }> = [];

beforeAll(async () => {
  broker = new Aedes();
  broker.on('publish', (packet) => {
    if (!packet.topic.startsWith('$SYS')) {
      seen.push({ topic: packet.topic, payload: String(packet.payload) });
    }
  });
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as net.AddressInfo).port;
  url = 'mqtt://localhost:' + port;
});

afterAll(async () => {
  closeAccessories();
  await new Promise<void>((resolve) => broker.close(resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitForSubscription(topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timeout for ' + topic)), 5000);
    const listener = (subscriptions: Array<{ topic: string }>) => {
      if (subscriptions.some((s) => s.topic === topic)) {
        clearTimeout(timer);
        broker.removeListener('subscribe', listener as never);
        resolve();
      }
    };
    broker.on('subscribe', listener as never);
  });
}

function brokerPublish(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) =>
    broker.publish(
      { cmd: 'publish', topic, payload: Buffer.from(payload), qos: 0, retain: false, dup: false },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (cond()) {
        return resolve();
      }
      if (Date.now() - start > ms) {
        return reject(new Error('waitFor timeout'));
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe('contactSensor', () => {
  it('creates the service and maps ContactSensorState with inverted polarity', async () => {
    const sub = waitForSubscription('t/cs1/get');
    const { accessory } = makeAccessory(
      {
        type: 'contactSensor',
        name: 'CS1',
        url,
        integerValue: true,
        topics: { getContactSensorState: 't/cs1/get', getStatusTampered: 't/cs1/tamper' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.ContactSensor)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.ContactSensorState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.StatusTampered)).toBe(true);
    const charac = svc.getCharacteristic(Characteristic.ContactSensorState);
    await sub;
    // upstream quirk: an "on" value means CONTACT_NOT_DETECTED
    await brokerPublish('t/cs1/get', '1');
    await waitFor(() => charac.value === Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    await brokerPublish('t/cs1/get', '0');
    await waitFor(() => charac.value === Characteristic.ContactSensorState.CONTACT_DETECTED);
  });
});

describe('smokeSensor', () => {
  it('creates the service and maps SmokeDetected', async () => {
    const sub = waitForSubscription('t/smoke1/get');
    const { accessory } = makeAccessory(
      { type: 'smokeSensor', name: 'Smoke1', url, integerValue: true, topics: { getSmokeDetected: 't/smoke1/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.SmokeSensor)!;
    expect(svc).toBeDefined();
    const charac = svc.getCharacteristic(Characteristic.SmokeDetected);
    await sub;
    await brokerPublish('t/smoke1/get', '1');
    await waitFor(() => charac.value === Characteristic.SmokeDetected.SMOKE_DETECTED);
  });
});

describe('leakSensor', () => {
  it('creates the service with WaterLevel and maps LeakDetected', async () => {
    const subLeak = waitForSubscription('t/leak1/get');
    const subLevel = waitForSubscription('t/leak1/level');
    const { accessory } = makeAccessory(
      {
        type: 'leakSensor',
        name: 'Leak1',
        url,
        integerValue: true,
        topics: { getLeakDetected: 't/leak1/get', getWaterLevel: 't/leak1/level' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.LeakSensor)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.WaterLevel)).toBe(true);
    const leak = svc.getCharacteristic(Characteristic.LeakDetected);
    const level = svc.getCharacteristic(Characteristic.WaterLevel);
    await Promise.all([subLeak, subLevel]);
    await brokerPublish('t/leak1/get', '1');
    await waitFor(() => leak.value === Characteristic.LeakDetected.LEAK_DETECTED);
    await brokerPublish('t/leak1/level', '55');
    await waitFor(() => level.value === 55);
  });
});

describe('doorbell', () => {
  it('creates doorbell + motion services and fires event-only switch events repeatedly', async () => {
    const sub = waitForSubscription('t/db1/switch');
    const { accessory } = makeAccessory(
      { type: 'doorbell', name: 'DB1', url, topics: { getSwitch: 't/db1/switch', getMotionDetected: 't/db1/motion' } },
      api,
    );
    const services = accessory.getServices();
    const dbSvc = services.find((s) => s instanceof Service.Doorbell)!;
    expect(dbSvc).toBeDefined();
    const motionSvc = services.find((s) => s instanceof Service.MotionSensor)!;
    expect(motionSvc).toBeDefined();
    expect(motionSvc.displayName).toBe('DB1-motion');
    const evChar = dbSvc.getCharacteristic(Characteristic.ProgrammableSwitchEvent);
    let changes = 0;
    evChar.on('change', () => {
      changes++;
    });
    await sub;
    // default switchValues are [ '1', '2', 'L' ]
    await brokerPublish('t/db1/switch', '1');
    await waitFor(() => changes === 1 && evChar.value === Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
    // event-only characteristic must fire again for the same value
    await brokerPublish('t/db1/switch', '1');
    await waitFor(() => changes === 2);
  });
});

describe('statelessProgrammableSwitch', () => {
  it('supports a single getSwitch topic with default switchValues', async () => {
    const sub = waitForSubscription('t/sps1/get');
    const { accessory } = makeAccessory(
      { type: 'statelessProgrammableSwitch', name: 'SPS1', url, topics: { getSwitch: 't/sps1/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.StatelessProgrammableSwitch)!;
    expect(svc).toBeDefined();
    const charac = svc.getCharacteristic(Characteristic.ProgrammableSwitchEvent);
    await sub;
    await brokerPublish('t/sps1/get', 'L');
    await waitFor(() => charac.value === Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
  });

  it('supports an array getSwitch with per-button switchValues and restrictSwitchValues', async () => {
    const sub0 = waitForSubscription('t/spsm/b0');
    const sub1 = waitForSubscription('t/spsm/b1');
    const { accessory } = makeAccessory(
      {
        type: 'statelessProgrammableSwitch',
        name: 'SPSM',
        url,
        labelType: 'numerals',
        topics: { getSwitch: ['t/spsm/b0', 't/spsm/b1'] as never },
        switchValues: [
          ['a', 'b', 'c'],
          ['d', 'e', 'f'],
        ],
        restrictSwitchValues: [[0], [0, 2]],
      },
      api,
    );
    const services = accessory.getServices();
    const labelSvc = services.find((s) => s instanceof Service.ServiceLabel)!;
    expect(labelSvc).toBeDefined();
    expect(labelSvc.getCharacteristic(Characteristic.ServiceLabelNamespace).value).toBe(
      Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
    );
    const buttons = services.filter((s) => s instanceof Service.StatelessProgrammableSwitch);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].displayName).toBe('SPSM 0');
    expect(buttons[0].subtype).toBe('1');
    expect(buttons[1].subtype).toBe('2');
    expect(buttons[0].getCharacteristic(Characteristic.ServiceLabelIndex).value).toBe(1);
    expect(buttons[1].getCharacteristic(Characteristic.ServiceLabelIndex).value).toBe(2);
    expect(buttons[0].getCharacteristic(Characteristic.ProgrammableSwitchEvent).props.validValues).toEqual([0]);
    expect(buttons[1].getCharacteristic(Characteristic.ProgrammableSwitchEvent).props.validValues).toEqual([0, 2]);
    const charac = buttons[1].getCharacteristic(Characteristic.ProgrammableSwitchEvent);
    await Promise.all([sub0, sub1]);
    // 'f' is index 2 of the second button's value array
    await brokerPublish('t/spsm/b1', 'f');
    await waitFor(() => charac.value === Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
  });

  it('applies a single (non-nested) switchValues array to every button', async () => {
    const sub0 = waitForSubscription('t/spss/b0');
    const sub1 = waitForSubscription('t/spss/b1');
    const { accessory } = makeAccessory(
      {
        type: 'statelessProgrammableSwitch',
        name: 'SPSS',
        url,
        topics: { getSwitch: ['t/spss/b0', 't/spss/b1'] as never },
        switchValues: ['x', 'y', 'z'],
      },
      api,
    );
    const buttons = accessory.getServices().filter((s) => s instanceof Service.StatelessProgrammableSwitch);
    expect(buttons).toHaveLength(2);
    const charac = buttons[0].getCharacteristic(Characteristic.ProgrammableSwitchEvent);
    await Promise.all([sub0, sub1]);
    await brokerPublish('t/spss/b0', 'z');
    await waitFor(() => charac.value === Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
  });
});

describe('microphone / speaker', () => {
  it('creates a microphone with Mute and Volume', async () => {
    const sub = waitForSubscription('t/mic1/getVolume');
    const { accessory } = makeAccessory(
      {
        type: 'microphone',
        name: 'Mic1',
        url,
        topics: { setMute: 't/mic1/setMute', getMute: 't/mic1/getMute', setVolume: 't/mic1/setVolume', getVolume: 't/mic1/getVolume' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Microphone)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.Mute)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Volume)).toBe(true);
    await svc.getCharacteristic(Characteristic.Mute).setValue(true);
    await waitFor(() => seen.some((p) => p.topic === 't/mic1/setMute' && p.payload === 'true'));
    const volume = svc.getCharacteristic(Characteristic.Volume);
    await sub;
    await brokerPublish('t/mic1/getVolume', '40');
    await waitFor(() => volume.value === 40);
  });

  it('creates a speaker and updates Mute from MQTT', async () => {
    const sub = waitForSubscription('t/spk1/getMute');
    const { accessory } = makeAccessory(
      { type: 'speaker', name: 'Spk1', url, topics: { setMute: 't/spk1/setMute', getMute: 't/spk1/getMute' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Speaker)!;
    expect(svc).toBeDefined();
    const mute = svc.getCharacteristic(Characteristic.Mute);
    await sub;
    await brokerPublish('t/spk1/getMute', 'true');
    await waitFor(() => mute.value === true);
  });
});

describe('lockMechanism', () => {
  it('maps lock target/current states with default lockValues', async () => {
    const sub = waitForSubscription('t/lock1/getCurrent');
    const { accessory } = makeAccessory(
      {
        type: 'lockMechanism',
        name: 'Lock1',
        url,
        topics: { setLockTargetState: 't/lock1/setTarget', getLockTargetState: 't/lock1/getTarget', getLockCurrentState: 't/lock1/getCurrent' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.LockMechanism)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.LockTargetState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.LockCurrentState)).toBe(true);
    // outbound: SECURED publishes 'S' (default lockValues [ 'U', 'S' ])
    await svc.getCharacteristic(Characteristic.LockTargetState).setValue(Characteristic.LockTargetState.SECURED);
    await waitFor(() => seen.some((p) => p.topic === 't/lock1/setTarget' && p.payload === 'S'));
    // inbound: 'J' maps to JAMMED (default lockValues [ 'U', 'S', 'J', '?' ])
    const current = svc.getCharacteristic(Characteristic.LockCurrentState);
    await sub;
    await brokerPublish('t/lock1/getCurrent', 'J');
    await waitFor(() => current.value === Characteristic.LockCurrentState.JAMMED);
  });
});

describe('garageDoorOpener', () => {
  it('creates door state and obstruction characteristics with default doorValues', async () => {
    const sub = waitForSubscription('t/gd1/getCurrent');
    const { accessory } = makeAccessory(
      {
        type: 'garageDoorOpener',
        name: 'GD1',
        url,
        topics: { setTargetDoorState: 't/gd1/setTarget', getCurrentDoorState: 't/gd1/getCurrent' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.GarageDoorOpener)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.TargetDoorState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.CurrentDoorState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.ObstructionDetected)).toBe(true);
    // outbound: CLOSED publishes 'C' (default target doorValues [ 'O', 'C' ])
    await svc.getCharacteristic(Characteristic.TargetDoorState).setValue(Characteristic.TargetDoorState.CLOSED);
    await waitFor(() => seen.some((p) => p.topic === 't/gd1/setTarget' && p.payload === 'C'));
    // inbound: 'o' maps to OPENING (default current doorValues [ 'O', 'C', 'o', 'c', 'S' ])
    const current = svc.getCharacteristic(Characteristic.CurrentDoorState);
    await sub;
    await brokerPublish('t/gd1/getCurrent', 'o');
    await waitFor(() => current.value === Characteristic.CurrentDoorState.OPENING);
  });

  it('simulates current door state from getDoorMoving', async () => {
    const sub = waitForSubscription('t/gd2/moving');
    const { accessory } = makeAccessory(
      {
        type: 'garageDoorOpener',
        name: 'GD2',
        url,
        integerValue: true,
        topics: { setTargetDoorState: 't/gd2/setTarget', getDoorMoving: 't/gd2/moving' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.GarageDoorOpener)!;
    const current = svc.getCharacteristic(Characteristic.CurrentDoorState);
    await sub;
    // target defaults to OPEN, so moving means OPENING (after the 1s upstream delay)
    await brokerPublish('t/gd2/moving', '1');
    await waitFor(() => current.value === Characteristic.CurrentDoorState.OPENING);
    // and not moving means OPEN
    await brokerPublish('t/gd2/moving', '0');
    await waitFor(() => current.value === Characteristic.CurrentDoorState.OPEN);
  });
});

describe('windowCovering / window / door', () => {
  it('creates a windowCovering with positions, tilt, hold and obstruction', async () => {
    const subPos = waitForSubscription('t/wc1/getPos');
    const subState = waitForSubscription('t/wc1/getState');
    const { accessory } = makeAccessory(
      {
        type: 'windowCovering',
        name: 'WC1',
        url,
        topics: {
          getCurrentPosition: 't/wc1/getPos',
          setTargetPosition: 't/wc1/setPos',
          getPositionState: 't/wc1/getState',
          setHoldPosition: 't/wc1/hold',
          setTargetHorizontalTiltAngle: 't/wc1/setHTilt',
          getObstructionDetected: 't/wc1/obstruction',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.WindowCovering)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.CurrentPosition)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.TargetPosition)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.PositionState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.HoldPosition)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.TargetHorizontalTiltAngle)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.ObstructionDetected)).toBe(true);
    // outbound
    await svc.getCharacteristic(Characteristic.TargetPosition).setValue(80);
    await waitFor(() => seen.some((p) => p.topic === 't/wc1/setPos' && p.payload === '80'));
    await svc.getCharacteristic(Characteristic.HoldPosition).setValue(true);
    await waitFor(() => seen.some((p) => p.topic === 't/wc1/hold' && p.payload === 'true'));
    await svc.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).setValue(-45);
    await waitFor(() => seen.some((p) => p.topic === 't/wc1/setHTilt' && p.payload === '-45'));
    // inbound
    const currentPos = svc.getCharacteristic(Characteristic.CurrentPosition);
    const positionState = svc.getCharacteristic(Characteristic.PositionState);
    await Promise.all([subPos, subState]);
    await brokerPublish('t/wc1/getPos', '25');
    await waitFor(() => currentPos.value === 25);
    // default positionStateValues [ 'DECREASING', 'INCREASING', 'STOPPED' ]
    await brokerPublish('t/wc1/getState', 'INCREASING');
    await waitFor(() => positionState.value === Characteristic.PositionState.INCREASING);
  });

  it('creates a window and updates current position from MQTT', async () => {
    const sub = waitForSubscription('t/win1/getPos');
    const { accessory } = makeAccessory(
      { type: 'window', name: 'Win1', url, topics: { getCurrentPosition: 't/win1/getPos', setTargetPosition: 't/win1/setPos' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Window)!;
    expect(svc).toBeDefined();
    await svc.getCharacteristic(Characteristic.TargetPosition).setValue(10);
    await waitFor(() => seen.some((p) => p.topic === 't/win1/setPos' && p.payload === '10'));
    const currentPos = svc.getCharacteristic(Characteristic.CurrentPosition);
    await sub;
    await brokerPublish('t/win1/getPos', '40');
    await waitFor(() => currentPos.value === 40);
  });

  it('creates a door and updates current position from MQTT', async () => {
    const sub = waitForSubscription('t/door1/getPos');
    const { accessory } = makeAccessory(
      { type: 'door', name: 'Door1', url, topics: { getCurrentPosition: 't/door1/getPos', setTargetPosition: 't/door1/setPos' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Door)!;
    expect(svc).toBeDefined();
    await svc.getCharacteristic(Characteristic.TargetPosition).setValue(65);
    await waitFor(() => seen.some((p) => p.topic === 't/door1/setPos' && p.payload === '65'));
    const currentPos = svc.getCharacteristic(Characteristic.CurrentPosition);
    await sub;
    await brokerPublish('t/door1/getPos', '40');
    await waitFor(() => currentPos.value === 40);
  });
});

describe('securitySystem', () => {
  it('maps states with the default SA/AA/NA/D value arrays', async () => {
    const subCurrent = waitForSubscription('t/ss1/getCurrent');
    const subAlt = waitForSubscription('t/ss1/alt');
    const { accessory } = makeAccessory(
      {
        type: 'securitySystem',
        name: 'SS1',
        url,
        topics: {
          setTargetState: 't/ss1/setTarget',
          getTargetState: 't/ss1/getTarget',
          getCurrentState: 't/ss1/getCurrent',
          getAltSensorState: 't/ss1/alt',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.SecuritySystem)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.SecuritySystemTargetState)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.SecuritySystemCurrentState)).toBe(true);
    // getAltSensorState is wired up as a plain subscription
    await subAlt;
    // outbound: AWAY_ARM (1) publishes 'AA' (default targetStateValues)
    await svc.getCharacteristic(Characteristic.SecuritySystemTargetState).setValue(Characteristic.SecuritySystemTargetState.AWAY_ARM);
    await waitFor(() => seen.some((p) => p.topic === 't/ss1/setTarget' && p.payload === 'AA'));
    // inbound: 'SA' maps to STAY_ARM (default currentStateValues)
    const current = svc.getCharacteristic(Characteristic.SecuritySystemCurrentState);
    await subCurrent;
    await brokerPublish('t/ss1/getCurrent', 'SA');
    await waitFor(() => current.value === Characteristic.SecuritySystemCurrentState.STAY_ARM);
  });

  it('supports custom value arrays and restrictTargetState', async () => {
    const { accessory } = makeAccessory(
      {
        type: 'securitySystem',
        name: 'SS2',
        url,
        targetStateValues: ['home', 'away', 'night', 'off'],
        restrictTargetState: [1, 3],
        topics: { setTargetState: 't/ss2/setTarget' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.SecuritySystem)!;
    const target = svc.getCharacteristic(Characteristic.SecuritySystemTargetState);
    expect(target.props.validValues).toEqual([1, 3]);
    await target.setValue(3);
    await waitFor(() => seen.some((p) => p.topic === 't/ss2/setTarget' && p.payload === 'off'));
  });
});

describe('valve', () => {
  it('maps valveType config to the ValveType characteristic', () => {
    const showerAcc = makeAccessory({ type: 'valve', name: 'VShower', url, valveType: 'shower', topics: {} }, api).accessory;
    const showerSvc = showerAcc.getServices().find((s) => s instanceof Service.Valve)!;
    expect(showerSvc.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.SHOWER_HEAD);

    const sprinklerAcc = makeAccessory({ type: 'valve', name: 'VSprinkler', url, valveType: 'sprinkler', topics: {} }, api).accessory;
    const sprinklerSvc = sprinklerAcc.getServices().find((s) => s instanceof Service.Valve)!;
    expect(sprinklerSvc.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.IRRIGATION);

    const faucetAcc = makeAccessory({ type: 'valve', name: 'VFaucet', url, valveType: 'faucet', topics: {} }, api).accessory;
    const faucetSvc = faucetAcc.getServices().find((s) => s instanceof Service.Valve)!;
    expect(faucetSvc.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.WATER_FAUCET);

    const genericAcc = makeAccessory({ type: 'valve', name: 'VGeneric', url, topics: {} }, api).accessory;
    const genericSvc = genericAcc.getServices().find((s) => s instanceof Service.Valve)!;
    expect(genericSvc.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.GENERIC_VALVE);
    expect(genericSvc.testCharacteristic(Characteristic.Active)).toBe(true);
    expect(genericSvc.testCharacteristic(Characteristic.InUse)).toBe(true);
  });

  it('publishes Active and SetDuration, and derives RemainingDuration from InUse', async () => {
    const sub = waitForSubscription('t/v1/getInUse');
    const { accessory } = makeAccessory(
      {
        type: 'valve',
        name: 'V1',
        url,
        integerValue: true,
        topics: {
          setActive: 't/v1/setActive',
          getActive: 't/v1/getActive',
          getInUse: 't/v1/getInUse',
          setDuration: 't/v1/setDuration',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Valve)!;
    expect(svc.testCharacteristic(Characteristic.SetDuration)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.RemainingDuration)).toBe(true);
    // outbound: Active ACTIVE publishes 1 (integerValue)
    await svc.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.ACTIVE);
    await waitFor(() => seen.some((p) => p.topic === 't/v1/setActive' && p.payload === '1'));
    // outbound: SetDuration publishes the duration
    await svc.getCharacteristic(Characteristic.SetDuration).setValue(300);
    await waitFor(() => seen.some((p) => p.topic === 't/v1/setDuration' && p.payload === '300'));
    // inbound: InUse starts the remaining-duration countdown at SetDuration
    const inUse = svc.getCharacteristic(Characteristic.InUse);
    const remaining = svc.getCharacteristic(Characteristic.RemainingDuration);
    await sub;
    await brokerPublish('t/v1/getInUse', '1');
    await waitFor(() => inUse.value === Characteristic.InUse.IN_USE);
    await waitFor(() => (remaining.value as number) >= 299 && (remaining.value as number) <= 300);
  });

  it('turns the valve inactive when the internal durationTimer expires', async () => {
    const sub = waitForSubscription('t/v2/getInUse');
    const { accessory } = makeAccessory(
      {
        type: 'valve',
        name: 'V2',
        url,
        integerValue: true,
        durationTimer: true,
        topics: { setActive: 't/v2/setActive', getActive: 't/v2/getActive', getInUse: 't/v2/getInUse' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Valve)!;
    // internal SetDuration characteristic (no topic)
    expect(svc.testCharacteristic(Characteristic.SetDuration)).toBe(true);
    await svc.getCharacteristic(Characteristic.SetDuration).setValue(1);
    await sub;
    await brokerPublish('t/v2/getInUse', '1');
    // after 1 second the timer must publish Active INACTIVE (0)
    await waitFor(() => seen.some((p) => p.topic === 't/v2/setActive' && p.payload === '0'));
    expect(svc.getCharacteristic(Characteristic.Active).value).toBe(Characteristic.Active.INACTIVE);
  });

  it('updates RemainingDuration from the getRemainingDuration topic', async () => {
    const sub = waitForSubscription('t/v3/rd');
    const { accessory } = makeAccessory(
      {
        type: 'valve',
        name: 'V3',
        url,
        topics: { setActive: 't/v3/setActive', getActive: 't/v3/getActive', getInUse: 't/v3/getInUse', getRemainingDuration: 't/v3/rd' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Valve)!;
    expect(svc.testCharacteristic(Characteristic.SetDuration)).toBe(false);
    const remaining = svc.getCharacteristic(Characteristic.RemainingDuration);
    await sub;
    await brokerPublish('t/v3/rd', '60');
    await waitFor(() => remaining.value === 60);
  });
});
