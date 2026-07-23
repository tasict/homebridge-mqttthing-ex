// Tests for the lightbulb accessory type: OnOff, dimmable (brightness-0-as-
// off), HSV, RGB, RGBW, RGBWW, White and ColorTemperature flavors, adaptive
// lighting wiring, and the F1/F2 upstream fixes (docs/UpstreamIssues.md).
import net from 'node:net';
import os from 'node:os';

import * as hapNodeJs from '@homebridge/hap-nodejs';
import Aedes from 'aedes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeAccessories, makeAccessory, makeMockApi } from './hap-helpers.js';

const { Service, Characteristic, ColorUtils, AdaptiveLightingController } = hapNodeJs;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishedTo(topic: string): string[] {
  return seen.filter((p) => p.topic === topic).map((p) => p.payload);
}

/** Simulate an adaptive-lighting controller write to the ColorTemperature
 *  characteristic, exactly as hap-nodejs's AdaptiveLightingController
 *  (AUTOMATIC mode) does in scheduleNextUpdate(). */
function adaptiveLightingWrite(
  charac: InstanceType<typeof Characteristic>,
  temperature: number,
  controller: unknown,
): Promise<unknown> {
  return charac.handleSetRequest(temperature, undefined, { controller, omitEventUpdate: true });
}

describe('lightbulb structure', () => {
  it('creates a plain On/Off lightbulb', () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB1', url, topics: { setOn: 't/lb1/setOn', getOn: 't/lb1/getOn' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(svc).toBeDefined();
    expect(svc.testCharacteristic(Characteristic.On)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Brightness)).toBe(false);
    expect(svc.testCharacteristic(Characteristic.Hue)).toBe(false);
    expect(svc.testCharacteristic(Characteristic.ColorTemperature)).toBe(false);
    expect(accessory.getControllers()).toHaveLength(0);
  });

  it('creates a dimmable lightbulb in brightness-0-as-off mode when there is no setOn topic', () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB2', url, topics: { setBrightness: 't/lb2/setBri' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    // characteristic_Brightness creates both On and Brightness itself
    expect(svc.testCharacteristic(Characteristic.On)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Brightness)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.ColorTemperature)).toBe(false);
  });

  it('creates an HSV lightbulb (adaptive lighting disabled)', () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB3', url, adaptiveLighting: false, topics: { setHSV: 't/lb3/set', getHSV: 't/lb3/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(svc.testCharacteristic(Characteristic.On)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Hue)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Saturation)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.Brightness)).toBe(true);
    expect(svc.testCharacteristic(Characteristic.ColorTemperature)).toBe(false);
    expect(accessory.getControllers()).toHaveLength(0);
  });

  it('creates RGB, RGBW and White lightbulbs', () => {
    const rgb = makeAccessory(
      { type: 'lightbulb', name: 'LB4', url, adaptiveLighting: false, topics: { setRGB: 't/lb4/set' } },
      api,
    ).accessory;
    const rgbSvc = rgb.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(rgbSvc.testCharacteristic(Characteristic.Hue)).toBe(true);
    expect(rgbSvc.testCharacteristic(Characteristic.Saturation)).toBe(true);
    expect(rgbSvc.testCharacteristic(Characteristic.Brightness)).toBe(true);

    const rgbw = makeAccessory(
      { type: 'lightbulb', name: 'LB5', url, adaptiveLighting: false, topics: { setRGBW: 't/lb5/set' } },
      api,
    ).accessory;
    const rgbwSvc = rgbw.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(rgbwSvc.testCharacteristic(Characteristic.Hue)).toBe(true);

    const white = makeAccessory({ type: 'lightbulb', name: 'LB6', url, topics: { setWhite: 't/lb6/set' } }, api).accessory;
    const whiteSvc = white.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(whiteSvc.testCharacteristic(Characteristic.On)).toBe(true);
    expect(whiteSvc.testCharacteristic(Characteristic.Brightness)).toBe(true);
    expect(whiteSvc.testCharacteristic(Characteristic.Hue)).toBe(false);
    expect(white.getControllers()).toHaveLength(0);
  });

  it('creates a color-temperature lightbulb with configured range and an adaptive lighting controller', () => {
    const { accessory } = makeAccessory(
      {
        type: 'lightbulb',
        name: 'LB7',
        url,
        minColorTemperature: 150,
        maxColorTemperature: 400,
        topics: { setOn: 't/lb7/setOn', setBrightness: 't/lb7/setBri', setColorTemperature: 't/lb7/setCT', getColorTemperature: 't/lb7/getCT' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    const ct = svc.getCharacteristic(Characteristic.ColorTemperature);
    expect(ct.props.minValue).toBe(150);
    expect(ct.props.maxValue).toBe(400);
    expect(ct.value).toBe(150); // initialValue = minColorTemperature || 140
    const controllers = accessory.getControllers();
    expect(controllers).toHaveLength(1);
    expect(controllers[0]).toBeInstanceOf(AdaptiveLightingController);
  });

  it('adds an internal ColorTemperature and adaptive lighting controller to an HSV lightbulb', () => {
    const { accessory } = makeAccessory({ type: 'lightbulb', name: 'LB8', url, topics: { setHSV: 't/lb8/set' } }, api);
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    expect(svc.testCharacteristic(Characteristic.ColorTemperature)).toBe(true);
    expect(svc.getCharacteristic(Characteristic.ColorTemperature).value).toBe(140);
    const controllers = accessory.getControllers();
    expect(controllers).toHaveLength(1);
    expect(controllers[0]).toBeInstanceOf(AdaptiveLightingController);
  });
});

describe('lightbulb inbound', () => {
  it('updates Hue/Saturation/Brightness from an HSV state message', async () => {
    const sub = waitForSubscription('t/lb9/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB9', url, adaptiveLighting: false, topics: { setHSV: 't/lb9/set', getHSV: 't/lb9/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb9/get', '120,50,60');
    await waitFor(
      () =>
        svc.getCharacteristic(Characteristic.Hue).value === 120 &&
        svc.getCharacteristic(Characteristic.Saturation).value === 50 &&
        svc.getCharacteristic(Characteristic.Brightness).value === 60,
    );
  });

  it('updates from a comma-separated decimal RGB state message', async () => {
    const sub = waitForSubscription('t/lb10/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB10', url, adaptiveLighting: false, topics: { setRGB: 't/lb10/set', getRGB: 't/lb10/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb10/get', '0,255,0');
    await waitFor(
      () =>
        svc.getCharacteristic(Characteristic.Hue).value === 120 &&
        svc.getCharacteristic(Characteristic.Saturation).value === 100 &&
        svc.getCharacteristic(Characteristic.Brightness).value === 100,
    );
  });

  it('updates from a hex RGB state message with hexPrefix', async () => {
    const sub = waitForSubscription('t/lb11/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB11', url, adaptiveLighting: false, hexPrefix: '#', topics: { setRGB: 't/lb11/set', getRGB: 't/lb11/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb11/get', '#0000ff');
    await waitFor(
      () =>
        svc.getCharacteristic(Characteristic.Hue).value === 240 &&
        svc.getCharacteristic(Characteristic.Saturation).value === 100,
    );
  });

  it('updates from a bare hex RGB state message with hex: true', async () => {
    const sub = waitForSubscription('t/lb12/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB12', url, adaptiveLighting: false, hex: true, topics: { setRGB: 't/lb12/set', getRGB: 't/lb12/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb12/get', '00ff00');
    await waitFor(() => svc.getCharacteristic(Characteristic.Hue).value === 120);
  });

  it('folds the RGBW white channel back into brightness on receive', async () => {
    const sub = waitForSubscription('t/lb13/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB13', url, adaptiveLighting: false, topics: { setRGBW: 't/lb13/set', getRGBW: 't/lb13/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb13/get', '0,0,0,255');
    await waitFor(
      () =>
        svc.getCharacteristic(Characteristic.Brightness).value === 100 &&
        svc.getCharacteristic(Characteristic.Saturation).value === 0,
    );
  });

  it('updates On and Brightness from a White state message', async () => {
    const sub = waitForSubscription('t/lb14/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB14', url, topics: { setWhite: 't/lb14/set', getWhite: 't/lb14/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb14/get', '128');
    await waitFor(
      () =>
        svc.getCharacteristic(Characteristic.On).value === true &&
        svc.getCharacteristic(Characteristic.Brightness).value === 50,
    );
  });

  it('updates ColorTemperature from its get topic', async () => {
    const sub = waitForSubscription('t/lb15/getCT');
    const { accessory } = makeAccessory(
      {
        type: 'lightbulb',
        name: 'LB15',
        url,
        adaptiveLighting: false,
        topics: { setOn: 't/lb15/setOn', setBrightness: 't/lb15/setBri', setColorTemperature: 't/lb15/setCT', getColorTemperature: 't/lb15/getCT' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await sub;
    await brokerPublish('t/lb15/getCT', '350');
    await waitFor(() => svc.getCharacteristic(Characteristic.ColorTemperature).value === 350);
  });
});

describe('lightbulb outbound', () => {
  it('publishes ONE throttled combined HSV message for hue+saturation+brightness writes', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB16', url, adaptiveLighting: false, topics: { setHSV: 't/lb16/set' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Hue).setValue(120);
    await svc.getCharacteristic(Characteristic.Saturation).setValue(50);
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb16/set').length > 0);
    await delay(50);
    expect(publishedTo('t/lb16/set')).toEqual(['120,50,100']);
  });

  it('publishes comma-separated decimal RGB', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB17', url, adaptiveLighting: false, topics: { setRGB: 't/lb17/set' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Saturation).setValue(100);
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb17/set').length > 0);
    await delay(50);
    expect(publishedTo('t/lb17/set')).toEqual(['255,0,0']);
  });

  it('publishes hex RGB with the configured hexPrefix', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB18', url, adaptiveLighting: false, hexPrefix: '#', topics: { setRGB: 't/lb18/set' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb18/set').length > 0);
    expect(publishedTo('t/lb18/set')).toEqual(['#ffffff']);
  });

  it('splits the white channel out of RGBW', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB19', url, adaptiveLighting: false, topics: { setRGBW: 't/lb19/set' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb19/set').length > 0);
    expect(publishedTo('t/lb19/set')).toEqual(['0,0,0,255']);
  });

  it('splits warm and cold white channels out of RGBWW with the default white points', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB20', url, adaptiveLighting: false, topics: { setRGBWW: 't/lb20/set' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb20/set').length > 0);
    // white 255,255,255 decomposes to ww=cw=127 with the default white points
    expect(publishedTo('t/lb20/set')).toEqual(['0,0,0,127,127']);
  });

  it('publishes the separate white topic for RGB + setWhite', async () => {
    const { accessory } = makeAccessory(
      {
        type: 'lightbulb',
        name: 'LB21',
        url,
        adaptiveLighting: false,
        topics: { setRGB: 't/lb21/set', setWhite: 't/lb21/white', getWhite: 't/lb21/getWhite' },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(100);
    await waitFor(() => publishedTo('t/lb21/set').length > 0 && publishedTo('t/lb21/white').length > 0);
    expect(publishedTo('t/lb21/set')).toEqual(['0,0,0']);
    expect(publishedTo('t/lb21/white')).toEqual(['255']);
  });

  it('publishes the white value scaled from brightness, rounding up', async () => {
    const { accessory } = makeAccessory({ type: 'lightbulb', name: 'LB22', url, topics: { setWhite: 't/lb22/set' } }, api);
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(50);
    // ceil( 50 * 2.55 ) = 128
    await waitFor(() => publishedTo('t/lb22/set').includes('128'));
    await svc.getCharacteristic(Characteristic.On).setValue(false);
    await waitFor(() => publishedTo('t/lb22/set').includes('0'));
    expect(publishedTo('t/lb22/set')).toEqual(['128', '0']);
  });

  it('publishes brightness 0 when turned off without a setOn topic (combined on/brightness quirk)', async () => {
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'LB23', url, topics: { setBrightness: 't/lb23/setBri' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    await svc.getCharacteristic(Characteristic.Brightness).setValue(70);
    await waitFor(() => publishedTo('t/lb23/setBri').includes('70'));
    await svc.getCharacteristic(Characteristic.On).setValue(false);
    await waitFor(() => publishedTo('t/lb23/setBri').includes('0'));
    expect(publishedTo('t/lb23/setBri')).toEqual(['70', '0']);
  });
});

describe('F1: no publishes during construction (#567 #552 #617 #686)', () => {
  it('publishes nothing after constructing an HSV lightbulb with adaptive lighting enabled', async () => {
    const sub = waitForSubscription('t/f1/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'F1HSV', url, topics: { setHSV: 't/f1/set', getHSV: 't/f1/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    // adaptive lighting really is wired up (internal ColorTemperature at 140)
    expect(svc.getCharacteristic(Characteristic.ColorTemperature).value).toBe(140);
    expect(accessory.getControllers()).toHaveLength(1);
    await sub; // MQTT client connected
    await delay(100);
    // upstream published the uninitialized colour '237,6,100' here
    expect(seen.filter((p) => p.topic.startsWith('t/f1'))).toEqual([]);
  });
});

describe('F2: adaptive lighting must not publish while the light is off (#431)', () => {
  it('suppresses HSV publishes from adaptive lighting while off, resumes when on', async () => {
    const sub = waitForSubscription('t/f2a/get');
    const { accessory } = makeAccessory(
      { type: 'lightbulb', name: 'F2HSV', url, topics: { setHSV: 't/f2a/set', getHSV: 't/f2a/get' } },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    const ct = svc.getCharacteristic(Characteristic.ColorTemperature);
    const controller = accessory.getControllers()[0];
    await sub;

    // light is off - an adaptive lighting write must not publish
    await adaptiveLightingWrite(ct, 300, controller);
    await delay(60);
    expect(publishedTo('t/f2a/set')).toEqual([]);

    // turning on publishes the current (adaptive-lighting-set) colour
    const calc300 = ColorUtils.colorTemperatureToHueAndSaturation(300);
    await svc.getCharacteristic(Characteristic.On).setValue(true);
    await waitFor(() => publishedTo('t/f2a/set').length === 1);
    expect(publishedTo('t/f2a/set')).toEqual([`${calc300.hue},${calc300.saturation},100`]);

    // light is on - adaptive lighting publishes again
    const calc250 = ColorUtils.colorTemperatureToHueAndSaturation(250);
    await adaptiveLightingWrite(ct, 250, controller);
    await waitFor(() => publishedTo('t/f2a/set').length === 2);
    expect(publishedTo('t/f2a/set')[1]).toBe(`${calc250.hue},${calc250.saturation},100`);
  });

  it('suppresses setHue/setSaturation publishes from adaptive lighting while off', async () => {
    const sub = waitForSubscription('t/f2b/getOn');
    const { accessory } = makeAccessory(
      {
        type: 'lightbulb',
        name: 'F2HueSat',
        url,
        topics: {
          setOn: 't/f2b/setOn',
          getOn: 't/f2b/getOn',
          setBrightness: 't/f2b/setBri',
          setHue: 't/f2b/setHue',
          setSaturation: 't/f2b/setSat',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    // internal ColorTemperature is added because there is no setColorTemperature
    const ct = svc.getCharacteristic(Characteristic.ColorTemperature);
    const controller = accessory.getControllers()[0];
    expect(controller).toBeInstanceOf(AdaptiveLightingController);
    await sub;

    // light is off - nothing may reach the hue/saturation topics
    await adaptiveLightingWrite(ct, 300, controller);
    await delay(60);
    expect(publishedTo('t/f2b/setHue')).toEqual([]);
    expect(publishedTo('t/f2b/setSat')).toEqual([]);

    // turn on, then adaptive lighting publishes hue and saturation
    await svc.getCharacteristic(Characteristic.On).setValue(true);
    await waitFor(() => publishedTo('t/f2b/setOn').includes('true'));
    const calc250 = ColorUtils.colorTemperatureToHueAndSaturation(250);
    await adaptiveLightingWrite(ct, 250, controller);
    await waitFor(() => publishedTo('t/f2b/setHue').length > 0 && publishedTo('t/f2b/setSat').length > 0);
    expect(publishedTo('t/f2b/setHue')).toEqual([String(calc250.hue)]);
    expect(publishedTo('t/f2b/setSat')).toEqual([String(calc250.saturation)]);
  });

  it('suppresses setColorTemperature publishes from adaptive lighting while off, but not user writes', async () => {
    const sub = waitForSubscription('t/f2c/getCT');
    const { accessory } = makeAccessory(
      {
        type: 'lightbulb',
        name: 'F2CT',
        url,
        topics: {
          setOn: 't/f2c/setOn',
          setBrightness: 't/f2c/setBri',
          setColorTemperature: 't/f2c/setCT',
          getColorTemperature: 't/f2c/getCT',
        },
      },
      api,
    );
    const svc = accessory.getServices().find((s) => s instanceof Service.Lightbulb)!;
    const ct = svc.getCharacteristic(Characteristic.ColorTemperature);
    const controller = accessory.getControllers()[0];
    await sub;

    // light is off - an adaptive lighting write must not publish
    await adaptiveLightingWrite(ct, 300, controller);
    await delay(60);
    expect(publishedTo('t/f2c/setCT')).toEqual([]);

    // ...but a direct HomeKit write publishes even while off (upstream behavior)
    await ct.setValue(280);
    await waitFor(() => publishedTo('t/f2c/setCT').includes('280'));

    // light on - adaptive lighting publishes again
    await svc.getCharacteristic(Characteristic.On).setValue(true);
    await adaptiveLightingWrite(ct, 320, controller);
    await waitFor(() => publishedTo('t/f2c/setCT').includes('320'));
    expect(publishedTo('t/f2c/setCT')).toEqual(['280', '320']);
  });
});
