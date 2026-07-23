// Accessory type registry: replaces upstream's if/else dispatch chain
// (index.js:2831-3514) with a builder map, plus the common post-processing
// applied to every built service list (index.js:3516-3552).
import type { Service } from 'homebridge';

import { stateOnline, type ThingContext } from '../hap/binding.js';
import { addBatteryCharacteristics, characteristic_Name } from './shared.js';

/**
 * A service builder returns the primary service plus (optionally) the full
 * service list when the type produces several services. Returning null means
 * the builder could not create anything (matches upstream's null service).
 */
export interface BuiltServices {
  service: Service;
  services?: Service[];
}

export type ServiceBuilder = (thing: ThingContext) => BuiltServices | null;

const registry = new Map<string, ServiceBuilder>();

export function registerServiceType(type: string, builder: ServiceBuilder): void {
  registry.set(type, builder);
}

export function getServiceBuilder(type: string): ServiceBuilder | undefined {
  return registry.get(type);
}

/**
 * Build the services for one (sub-)service config: type dispatch plus the
 * shared post-processing (getName, getOnline, nameOverride, automatic
 * battery service). Returns null when nothing could be built, so the caller
 * logs and skips like upstream.
 */
export function buildServicesForConfig(thing: ThingContext): Service[] | null {
  const { config, log, hap } = thing;

  //  config.type may be 'type-subtype', e.g. 'lightbulb-OnOff'
  const configType = config.type.split('-')[0]; // ignore configuration subtype

  let service: Service | null = null;
  let services: Service[] | null = null;

  const builder = registry.get(configType);
  if (builder) {
    const built = builder(thing);
    if (built) {
      service = built.service;
      services = built.services ?? null;
    }
  } else {
    log('ERROR: Unrecognized type: ' + configType);
  }

  if (service) {
    if (config.topics?.getName) {
      characteristic_Name(thing, service);
    }

    if (config.topics?.getOnline) {
      stateOnline(thing);
    }

    // name override
    if (config.nameOverride) {
      service.setCharacteristic(hap.Characteristic.ConfiguredName, config.nameOverride as string);
    }
  }

  // always use services array
  if (!services) {
    if (service) {
      services = [service];
    } else {
      log('Error: No service(s) created for ' + config.name);
      return null;
    }
  }

  // optional battery service
  if (configType !== 'battery') {
    if (
      config.topics?.getBatteryLevel ||
      config.topics?.getChargingState ||
      (config.topics?.getStatusLowBattery && !service!.testCharacteristic(hap.Characteristic.StatusLowBattery))
    ) {
      // also create battery service
      const batsvc = new hap.Service.Battery(config.name + '-battery');
      addBatteryCharacteristics(thing, batsvc);
      services.push(batsvc);
    }
  }

  return services;
}
