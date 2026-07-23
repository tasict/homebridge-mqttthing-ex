// Accessory-type icon: maps every base type id from the declarative model
// to a Lucide icon (lucide-preact, ISC-licensed, tree-shaken into the
// bundle - no external requests). Icons stroke with currentColor, so they
// follow the Bootstrap theme in both light and dark mode. Subtype aliases
// (e.g. lightbulb-RGB) resolve to their base type via getTypeModel.
import {
  AirVent,
  AlarmSmoke,
  BatteryMedium,
  BellRing,
  Blinds,
  Box,
  CloudAlert,
  CloudFog,
  CloudSun,
  DoorClosed,
  DoorOpen,
  Droplet,
  DropletOff,
  Droplets,
  Fan,
  Gauge,
  Heater,
  Layers,
  Leaf,
  Lightbulb,
  Lock,
  Mic,
  MousePointerClick,
  PanelTop,
  PersonStanding,
  Plug,
  Radar,
  Shield,
  ShowerHead,
  Sprout,
  Sun,
  Thermometer,
  ThermometerSun,
  ToggleRight,
  Tv,
  Volume2,
  Warehouse,
  type LucideIcon,
} from 'lucide-preact';

import { getTypeModel } from '../../../src/model/types.js';

// One entry per base type id in src/model/types.ts (ALL_TYPE_IDS).
const TYPE_ICONS: Record<string, LucideIcon> = {
  lightbulb: Lightbulb,
  switch: ToggleRight,
  outlet: Plug,
  statelessProgrammableSwitch: MousePointerClick,
  motionSensor: Radar,
  occupancySensor: PersonStanding,
  lightSensor: Sun,
  temperatureSensor: Thermometer,
  humiditySensor: Droplets,
  airPressureSensor: Gauge,
  weatherStation: CloudSun,
  contactSensor: DoorClosed,
  smokeSensor: AlarmSmoke,
  leakSensor: Droplet,
  airQualitySensor: Leaf,
  carbonDioxideSensor: CloudFog,
  carbonMonoxideSensor: CloudAlert,
  thermostat: ThermometerSun,
  heaterCooler: Heater,
  dehumidifier: DropletOff,
  fan: Fan,
  fanv2: Fan,
  airPurifier: AirVent,
  securitySystem: Shield,
  doorbell: BellRing,
  garageDoorOpener: Warehouse,
  lockMechanism: Lock,
  windowCovering: Blinds,
  window: PanelTop,
  door: DoorOpen,
  valve: ShowerHead,
  irrigationSystem: Sprout,
  television: Tv,
  microphone: Mic,
  speaker: Volume2,
  battery: BatteryMedium,
  custom: Layers,
};

interface Props {
  /** Accessory type id (base id or subtype alias); unknown types get a fallback icon. */
  type: string | undefined;
  /** Icon size in pixels (width and height). */
  size?: number;
  class?: string;
}

export function TypeIcon({ type, size = 24, class: cls }: Props) {
  const baseId = getTypeModel(type)?.id ?? '';
  const Icon = TYPE_ICONS[baseId] ?? Box;
  return <Icon size={size} class={cls} aria-hidden="true" />;
}
