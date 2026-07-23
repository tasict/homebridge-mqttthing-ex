// Eve custom characteristic and service definitions used by mqttthing,
// derived from homebridge-lib's EveHomeKitTypes (Apache-2.0, Erik Baauw) —
// see NOTICE. Only the types actually used by this plugin are defined here,
// removing the homebridge-lib runtime dependency.
import type { HAP } from 'homebridge';

// Long Eve UUID (E863Fxxx range).
function eveUuid(id: string): string {
  return `E863F${id}-079E-48FF-8F27-9C2605A29F52`;
}

export const WEATHER_SERVICE_UUID = 'D92D5391-92AF-4824-AF4A-356F25F25EA1';

/* eslint-disable @typescript-eslint/no-empty-object-type */
export interface EveTypes {
  Characteristics: {
    AirParticulateDensity: CharacteristicClass;
    AirPressure: CharacteristicClass;
    ClosedDuration: CharacteristicClass;
    Condition: CharacteristicClass;
    CurrentConsumption: CharacteristicClass;
    DewPoint: CharacteristicClass;
    ElectricCurrent: CharacteristicClass;
    Elevation: CharacteristicClass;
    LastActivation: CharacteristicClass;
    MaximumWindSpeed: CharacteristicClass;
    OpenDuration: CharacteristicClass;
    Rain1h: CharacteristicClass;
    Rain24h: CharacteristicClass;
    ResetTotal: CharacteristicClass;
    TimesOpened: CharacteristicClass;
    TotalConsumption: CharacteristicClass;
    UvIndex: CharacteristicClass;
    Visibility: CharacteristicClass;
    Voltage: CharacteristicClass;
    WindDirection: CharacteristicClass;
    WindSpeed: CharacteristicClass;
  };
  Services: {
    AirPressureSensor: ServiceClass;
  };
}
/* eslint-enable @typescript-eslint/no-empty-object-type */

type CharacteristicClass = { new (): InstanceType<HAP['Characteristic']>; UUID: string };
type ServiceClass = { new (displayName?: string, subtype?: string): InstanceType<HAP['Service']>; UUID: string };

const cache = new WeakMap<HAP, EveTypes>();

export function makeEve(hap: HAP): EveTypes {
  const cached = cache.get(hap);
  if (cached) {
    return cached;
  }

  const { Characteristic, Service, Formats, Perms, Units, Access } = hap;

  function characteristicClass(
    displayName: string,
    uuid: string,
    props: Record<string, unknown>,
  ): CharacteristicClass {
    const klass = class extends Characteristic {
      static readonly UUID: string = uuid;
      constructor() {
        super(displayName, uuid, props as never);
      }
    };
    return klass as unknown as CharacteristicClass;
  }

  const READ_NOTIFY = [Perms.PAIRED_READ, Perms.NOTIFY];
  const READ_NOTIFY_WRITE = [Perms.PAIRED_READ, Perms.NOTIFY, Perms.PAIRED_WRITE];

  const Characteristics: EveTypes['Characteristics'] = {
    Voltage: characteristicClass('Voltage', eveUuid('10A'), {
      format: Formats.FLOAT,
      unit: 'V',
      minValue: 0,
      maxValue: 380,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
    AirParticulateDensity: characteristicClass('VOC Level', eveUuid('10B'), {
      format: Formats.FLOAT,
      unit: 'ppm',
      minValue: 0,
      maxValue: 5000,
      minStep: 1,
      perms: READ_NOTIFY,
    }),
    TotalConsumption: characteristicClass('Total Consumption', eveUuid('10C'), {
      format: Formats.FLOAT,
      unit: 'kWh',
      minValue: 0,
      maxValue: 1000000,
      minStep: 0.01,
      perms: READ_NOTIFY,
    }),
    CurrentConsumption: characteristicClass('Consumption', eveUuid('10D'), {
      format: Formats.FLOAT,
      unit: 'W',
      minValue: 0,
      maxValue: 12000,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
    AirPressure: characteristicClass('Air Pressure', eveUuid('10F'), {
      format: Formats.FLOAT,
      unit: 'hPa',
      minValue: 700,
      maxValue: 1100,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
    ResetTotal: characteristicClass('Reset Total', eveUuid('112'), {
      format: Formats.UINT32,
      unit: Units.SECONDS, // since 2001/01/01
      perms: READ_NOTIFY_WRITE,
      adminOnlyAccess: [Access.WRITE],
    }),
    OpenDuration: characteristicClass('Open Duration', eveUuid('118'), {
      format: Formats.UINT32,
      unit: Units.SECONDS, // since last reset
      perms: READ_NOTIFY_WRITE,
    }),
    ClosedDuration: characteristicClass('Closed Duration', eveUuid('119'), {
      format: Formats.UINT32,
      unit: Units.SECONDS, // since last reset
      perms: READ_NOTIFY_WRITE,
    }),
    LastActivation: characteristicClass('Last Activation', eveUuid('11A'), {
      format: Formats.UINT32,
      unit: Units.SECONDS, // since last reset
      perms: READ_NOTIFY,
    }),
    ElectricCurrent: characteristicClass('Electric Current', eveUuid('126'), {
      format: Formats.FLOAT,
      unit: 'A',
      minValue: 0,
      maxValue: 48,
      minStep: 0.01,
      perms: READ_NOTIFY,
    }),
    TimesOpened: characteristicClass('Times Opened', eveUuid('129'), {
      format: Formats.UINT32,
      perms: READ_NOTIFY,
    }),
    Elevation: characteristicClass('Elevation', eveUuid('130'), {
      format: Formats.INT,
      unit: 'm',
      minValue: -450,
      maxValue: 9000,
      minStep: 1,
      perms: READ_NOTIFY_WRITE,
      adminOnlyAccess: [Access.WRITE],
    }),
    Condition: characteristicClass('Condition', 'CD65A9AB-85AD-494A-B2BD-2F380084134D', {
      format: Formats.STRING,
      perms: READ_NOTIFY,
    }),
    DewPoint: characteristicClass('Dew Point', '095C46E2-278E-4E3C-B9E7-364622A0F501', {
      format: Formats.FLOAT,
      unit: Units.CELSIUS,
      minValue: -40,
      maxValue: 100,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
    MaximumWindSpeed: characteristicClass('Maximum Wind Speed', '6B8861E5-D6F3-425C-83B6-069945FFD1F1', {
      format: Formats.FLOAT,
      unit: 'm/s',
      minValue: 0,
      maxValue: 150,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
    Rain1h: characteristicClass('Rain Last Hour', '10C88F40-7EC4-478C-8D5A-BD0C3CCE14B7', {
      format: Formats.UINT16,
      unit: 'mm',
      minValue: 0,
      maxValue: 200,
      perms: READ_NOTIFY,
    }),
    Rain24h: characteristicClass('Total Rain', 'CCC04890-565B-4376-B39A-3113341D9E0F', {
      format: Formats.UINT16,
      unit: 'mm',
      minValue: 0,
      maxValue: 2000,
      perms: READ_NOTIFY,
    }),
    UvIndex: characteristicClass('UV Index', '05BA0FE0-B848-4226-906D-5B64272E05CE', {
      format: Formats.UINT8,
      minValue: 0,
      maxValue: 10,
      perms: READ_NOTIFY,
    }),
    Visibility: characteristicClass('Visibility', 'D24ECC1E-6FAD-4FB5-8137-5AF88BD5E857', {
      format: Formats.UINT8,
      unit: 'km',
      minValue: 0,
      maxValue: 100,
      perms: READ_NOTIFY,
    }),
    WindDirection: characteristicClass('Wind Direction', '46F1284C-1912-421B-82F5-EB75008B167E', {
      format: Formats.STRING,
      perms: READ_NOTIFY,
    }),
    WindSpeed: characteristicClass('Wind Speed', '49C8AE5A-A3A5-41AB-BF1F-12D5654F9F41', {
      format: Formats.FLOAT,
      unit: 'm/s',
      minValue: 0,
      maxValue: 150,
      minStep: 0.1,
      perms: READ_NOTIFY,
    }),
  };

  const airPressureSensorUuid = eveUuid('00A');
  const AirPressureSensor = class extends Service {
    static readonly UUID: string = airPressureSensorUuid;
    constructor(displayName?: string, subtype?: string) {
      super(displayName, airPressureSensorUuid, subtype);
      this.addCharacteristic(new Characteristics.AirPressure());
      this.addCharacteristic(new Characteristics.Elevation());
    }
  } as unknown as ServiceClass;

  const eve: EveTypes = { Characteristics, Services: { AirPressureSensor } };
  cache.set(hap, eve);
  return eve;
}
