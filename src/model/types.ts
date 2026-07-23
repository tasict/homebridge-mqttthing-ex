// Declarative accessory-type data: every supported accessory type with its
// topics and type-specific options, defaults and value arrays as documented
// in docs/Accessories.md and implemented in src/services/*.ts. THE CODE IS
// AUTHORITATIVE where the two disagree; such cases carry a note.
import type { AccessoryTypeModel, OptionModel, TopicModel } from './model-types.js';

function topic(key: string, label: string, extra?: Partial<TopicModel>): TopicModel {
  return {
    key,
    direction: key.startsWith('set') ? 'set' : 'get',
    label,
    ...extra,
  };
}

function opt(
  key: string,
  type: OptionModel['type'],
  label: string,
  extra?: Partial<OptionModel>,
): OptionModel {
  return { key, type, label, ...extra };
}

/** getStatusActive/Fault/Tampered/LowBattery for sensor-style services. */
function sensorStatusTopics(): TopicModel[] {
  return [
    topic('getStatusActive', 'Status Active'),
    topic('getStatusFault', 'Status Fault'),
    topic('getStatusTampered', 'Status Tampered'),
    topic('getStatusLowBattery', 'Status Low Battery'),
  ];
}

function turnOffAfterOption(): OptionModel {
  return opt('turnOffAfterms', 'integer', 'Turn Off After [ms]', {
    description: 'Turn off automatically the given number of milliseconds after being turned on by HomeKit.',
  });
}

function resetStateAfterOption(): OptionModel {
  return opt('resetStateAfterms', 'integer', 'Reset State After [ms]', {
    description: 'Reset the reported state automatically after the given number of milliseconds.',
  });
}

function minMaxRotationSpeedOptions(): OptionModel[] {
  return [
    opt('minRotationSpeed', 'integer', 'Minimum Rotation Speed'),
    opt('maxRotationSpeed', 'integer', 'Maximum Rotation Speed'),
  ];
}

function swingAndLockOptions(): OptionModel[] {
  return [
    opt('swingModeValues', 'stringArray', 'Swing Mode Values', {
      default: ['DISABLED', 'ENABLED'],
      description: 'Values representing swing mode DISABLED and ENABLED respectively.',
    }),
    opt('lockPhysicalControlsValues', 'stringArray', 'Lock Physical Controls Values', {
      default: ['DISABLED', 'ENABLED'],
      description: 'Values representing physical controls lock DISABLED and ENABLED respectively.',
    }),
  ];
}

function positionOptions(): OptionModel[] {
  return [
    opt('positionStateValues', 'stringArray', 'Position State Values', {
      default: ['DECREASING', 'INCREASING', 'STOPPED'],
      description: 'Values representing decreasing, increasing and stopped respectively.',
    }),
    opt('minPosition', 'integer', 'Minimum Position', { default: 0 }),
    opt('maxPosition', 'integer', 'Maximum Position', { default: 100 }),
  ];
}

function positionTopics(): TopicModel[] {
  return [
    topic('getCurrentPosition', 'Current Position'),
    topic('setTargetPosition', 'Set Target Position', { required: true }),
    topic('getTargetPosition', 'Target Position'),
    topic('getPositionState', 'Position State'),
    topic('setHoldPosition', 'Set Hold Position'),
    topic('getObstructionDetected', 'Obstruction Detected'),
  ];
}

function durationTopics(): TopicModel[] {
  return [
    topic('setDuration', 'Set Default Duration', { description: 'Default run duration in seconds (with external timer).' }),
    topic('getDuration', 'Default Duration', { description: 'Default run duration in seconds (with external timer).' }),
    topic('getRemainingDuration', 'Remaining Duration', { description: 'Remaining run duration in seconds.' }),
  ];
}

function durationOptions(): OptionModel[] {
  return [
    opt('durationTimer', 'boolean', 'Duration Timer', {
      default: false,
      description: 'Let the plugin time the run duration and turn off automatically.',
    }),
    opt('minDuration', 'integer', 'Minimum Duration [s]'),
    opt('maxDuration', 'integer', 'Maximum Duration [s]'),
  ];
}

export const ACCESSORY_TYPES: AccessoryTypeModel[] = [
  // ----------------------------------------------------------------- Lights
  {
    id: 'lightbulb',
    label: 'Light bulb',
    category: 'Lights',
    subtypeAliases: [
      'lightbulb-OnOff',
      'lightbulb-Dimmable',
      'lightbulb-White',
      'lightbulb-ColTemp',
      'lightbulb-Colour',
      'lightbulb-HSV',
      'lightbulb-RGB',
      'lightbulb-RGBW',
      'lightbulb-RGBWW',
    ],
    topics: [
      topic('getOn', 'On'),
      topic('setOn', 'Set On'),
      topic('getBrightness', 'Brightness'),
      topic('setBrightness', 'Set Brightness'),
      topic('getHue', 'Hue'),
      topic('setHue', 'Set Hue'),
      topic('getSaturation', 'Saturation'),
      topic('setSaturation', 'Set Saturation'),
      topic('getHSV', 'HSV', { description: 'Combined comma-separated hue,saturation,value.' }),
      topic('setHSV', 'Set HSV', { description: 'Combined comma-separated hue,saturation,value.' }),
      topic('getRGB', 'RGB', { description: 'Combined comma-separated red,green,blue (0-255).' }),
      topic('setRGB', 'Set RGB', { description: 'Combined comma-separated red,green,blue (0-255).' }),
      topic('getRGBW', 'RGBW', { description: 'Combined comma-separated red,green,blue,white (0-255).' }),
      topic('setRGBW', 'Set RGBW', { description: 'Combined comma-separated red,green,blue,white (0-255).' }),
      topic('getRGBWW', 'RGBWW', { description: 'Combined comma-separated red,green,blue,warm_white,cold_white (0-255).' }),
      topic('setRGBWW', 'Set RGBWW', { description: 'Combined comma-separated red,green,blue,warm_white,cold_white (0-255).' }),
      topic('getWhite', 'White Level', { description: 'White level 0-255 (used with RGB, or alone for a dimmable white light).' }),
      topic('setWhite', 'Set White Level', { description: 'White level 0-255 (used with RGB, or alone for a dimmable white light).' }),
      topic('getColorTemperature', 'Color Temperature', { description: 'Color temperature in mireds (140-500 by default).' }),
      topic('setColorTemperature', 'Set Color Temperature', { description: 'Color temperature in mireds (140-500 by default).' }),
    ],
    options: [
      opt('hex', 'boolean', 'Hexadecimal RGB', {
        default: false,
        description: 'Format combined RGB/RGBW values in hexadecimal instead of comma-separated decimals.',
      }),
      opt('hexPrefix', 'string', 'Hexadecimal Prefix', {
        description: "Format combined RGB/RGBW values in hexadecimal with the given prefix (typically '#').",
      }),
      turnOffAfterOption(),
      resetStateAfterOption(),
      opt('warmWhite', 'string', 'Warm White RGB', { description: 'RGBWW mode: RGB value of warm white as red,green,blue.' }),
      opt('coldWhite', 'string', 'Cold White RGB', { description: 'RGBWW mode: RGB value of cold white as red,green,blue.' }),
      opt('noWhiteMix', 'boolean', 'No White Mix', {
        default: false,
        description: 'RGBWW mode: disable extraction of white components from colours.',
      }),
      opt('whiteMix', 'boolean', 'White Mix', {
        default: true,
        description: 'Legacy inverse of noWhiteMix (whiteMix: false behaves like noWhiteMix: true).',
      }),
      opt('redThreshold', 'integer', 'Red Threshold', { default: 15, description: 'RGBWW noWhiteMix: red offset above which RGB is used instead of white channels.' }),
      opt('greenThreshold', 'integer', 'Green Threshold', { default: 15, description: 'RGBWW noWhiteMix: green offset above which RGB is used instead of white channels.' }),
      opt('blueThreshold', 'integer', 'Blue Threshold', { default: 15, description: 'RGBWW noWhiteMix: blue offset above which RGB is used instead of white channels.' }),
      opt('switchWhites', 'boolean', 'Switch White Channels', {
        default: false,
        description: 'RGBWW mode: order combined values as cold_white,warm_white instead of warm_white,cold_white.',
      }),
      opt('minColorTemperature', 'integer', 'Minimum Color Temperature', { default: 140 }),
      opt('maxColorTemperature', 'integer', 'Maximum Color Temperature', { default: 500 }),
      opt('adaptiveLighting', 'boolean', 'Adaptive Lighting', {
        default: true,
        description: 'Set to false to disable adaptive lighting support.',
      }),
    ],
    notes: 'Subtype aliases (lightbulb-OnOff, lightbulb-Dimmable, ...) are UI-only and collapse to lightbulb at runtime.',
  },

  // ----------------------------------------------------- Switches & Outlets
  {
    id: 'switch',
    label: 'Switch',
    category: 'Switches & Outlets',
    topics: [topic('getOn', 'On'), topic('setOn', 'Set On')],
    options: [turnOffAfterOption(), resetStateAfterOption()],
    supportsHistory: true,
  },
  {
    id: 'outlet',
    label: 'Outlet',
    category: 'Switches & Outlets',
    topics: [
      topic('getOn', 'On'),
      topic('setOn', 'Set On'),
      topic('getInUse', 'Outlet In Use'),
      topic('getWatts', 'Current Consumption [W]', { description: 'Eve-only.' }),
      topic('getVolts', 'Voltage [V]', { description: 'Eve-only.' }),
      topic('getAmperes', 'Electric Current [A]', { description: 'Eve-only.' }),
      topic('getTotalConsumption', 'Total Consumption [kWh]', { description: 'Eve-only.' }),
    ],
    options: [
      turnOffAfterOption(),
      resetStateAfterOption(),
      opt('minVolts', 'number', 'Minimum Voltage'),
      opt('maxVolts', 'number', 'Maximum Voltage'),
    ],
    supportsHistory: true,
  },
  {
    id: 'statelessProgrammableSwitch',
    label: 'Stateless Programmable Switch',
    category: 'Switches & Outlets',
    topics: [
      topic('getSwitch', 'Switch', {
        required: true,
        description: 'Switch state topic; may be an array of topics for a multi-button switch.',
      }),
    ],
    options: [
      opt('switchValues', 'stringArray', 'Switch Values', {
        default: ['1', '2', 'L'],
        description: 'Values for single-press, double-press and long-press respectively (array of arrays for multi-button switches).',
      }),
      opt('restrictSwitchValues', 'object', 'Restrict Switch Values', {
        description: 'Array of integers restricting the available events (0 single, 1 double, 2 long press).',
      }),
      opt('labelType', 'enum', 'Label Type', {
        enumValues: ['dots', 'numerals'],
        default: 'dots',
        description: 'Service label namespace used for multi-button switches.',
      }),
    ],
  },

  // ---------------------------------------------------------------- Sensors
  {
    id: 'motionSensor',
    label: 'Motion Sensor',
    category: 'Sensors',
    topics: [topic('getMotionDetected', 'Motion Detected', { required: true }), ...sensorStatusTopics()],
    options: [
      opt('turnOffAfterms', 'integer', 'Turn Off After [ms]', {
        description: 'Reset the motion state automatically, allowing the sensor to just publish its on value.',
      }),
    ],
    supportsHistory: true,
  },
  {
    id: 'occupancySensor',
    label: 'Occupancy Sensor',
    category: 'Sensors',
    topics: [topic('getOccupancyDetected', 'Occupancy Detected', { required: true }), ...sensorStatusTopics()],
    options: [],
  },
  {
    id: 'lightSensor',
    label: 'Light Sensor',
    category: 'Sensors',
    topics: [topic('getCurrentAmbientLightLevel', 'Current Ambient Light Level', { required: true }), ...sensorStatusTopics()],
    options: [],
  },
  {
    id: 'temperatureSensor',
    label: 'Temperature Sensor',
    category: 'Sensors',
    topics: [topic('getCurrentTemperature', 'Current Temperature', { required: true }), ...sensorStatusTopics()],
    options: [
      opt('minTemperature', 'number', 'Minimum Temperature', {
        description: 'Extends the reportable range below -100C (current temperature range may only be widened).',
      }),
      opt('maxTemperature', 'number', 'Maximum Temperature', {
        description: 'Extends the reportable range above 100C (current temperature range may only be widened).',
      }),
    ],
    supportsHistory: true,
  },
  {
    id: 'humiditySensor',
    label: 'Humidity Sensor',
    category: 'Sensors',
    topics: [topic('getCurrentRelativeHumidity', 'Current Relative Humidity', { required: true }), ...sensorStatusTopics()],
    options: [],
    supportsHistory: true,
  },
  {
    id: 'airPressureSensor',
    label: 'Air Pressure Sensor',
    category: 'Sensors',
    topics: [topic('getAirPressure', 'Air Pressure', { required: true, description: '700-1100 hPa; Eve-only.' }), ...sensorStatusTopics()],
    options: [],
    supportsHistory: true,
  },
  {
    id: 'weatherStation',
    label: 'Weather Station',
    category: 'Sensors',
    topics: [
      topic('getCurrentTemperature', 'Current Temperature', { required: true }),
      topic('getCurrentRelativeHumidity', 'Current Relative Humidity'),
      topic('getCurrentAmbientLightLevel', 'Current Ambient Light Level'),
      topic('getAirPressure', 'Air Pressure', { description: 'Eve-only.' }),
      topic('getWeatherCondition', 'Weather Condition', { description: 'Eve-only custom string.' }),
      topic('getRain1h', 'Rain Last 1h [mm]', { description: 'Eve-only.' }),
      topic('getRain24h', 'Rain Last 24h [mm]', { description: 'Eve-only.' }),
      topic('getUVIndex', 'UV Index', { description: 'Eve-only.' }),
      topic('getVisibility', 'Visibility [km]', { description: 'Eve-only.' }),
      topic('getWindDirection', 'Wind Direction', { description: 'Eve-only custom string.' }),
      topic('getWindSpeed', 'Wind Speed [km/h]', { description: 'Eve-only.' }),
      topic('getmaxWind', 'Maximum Wind Speed', { description: 'Eve-only (code-supported; not in docs/Accessories.md).' }),
      topic('getDewPoint', 'Dew Point', { description: 'Eve-only (code-supported; not in docs/Accessories.md).' }),
      ...sensorStatusTopics(),
    ],
    options: [
      opt('serviceNames', 'object', 'Service Names', {
        description: 'Custom names for the temperature, humidity, airPressure, ambientLightLevel and weather services.',
      }),
    ],
    supportsHistory: true,
    notes: 'Code also supports getmaxWind and getDewPoint topics and an ambientLightLevel service name, none of which are documented upstream.',
  },
  {
    id: 'contactSensor',
    label: 'Contact Sensor',
    category: 'Sensors',
    topics: [topic('getContactSensorState', 'Contact Sensor State', { required: true }), ...sensorStatusTopics()],
    options: [resetStateAfterOption()],
    supportsHistory: true,
  },
  {
    id: 'smokeSensor',
    label: 'Smoke Sensor',
    category: 'Sensors',
    topics: [topic('getSmokeDetected', 'Smoke Detected', { required: true }), ...sensorStatusTopics()],
    options: [resetStateAfterOption()],
  },
  {
    id: 'leakSensor',
    label: 'Leak Sensor',
    category: 'Sensors',
    topics: [
      topic('getLeakDetected', 'Leak Detected', { required: true }),
      topic('getWaterLevel', 'Water Level', { description: 'Code-supported; not in docs/Accessories.md.' }),
      topic('setWaterLevel', 'Set Water Level', { description: 'Code-supported; not in docs/Accessories.md.' }),
      ...sensorStatusTopics(),
    ],
    options: [resetStateAfterOption()],
    notes: 'Code also binds a WaterLevel characteristic when getWaterLevel/setWaterLevel are configured (not documented upstream).',
  },
  {
    id: 'airQualitySensor',
    label: 'Air Quality Sensor',
    category: 'Sensors',
    topics: [
      topic('getAirQuality', 'Air Quality', { required: true }),
      topic('getCarbonDioxideLevel', 'Carbon Dioxide Level'),
      topic('getPM10Density', 'PM10 Density'),
      topic('getPM2_5Density', 'PM2.5 Density'),
      topic('getOzoneDensity', 'Ozone Density'),
      topic('getNitrogenDioxideDensity', 'Nitrogen Dioxide Density'),
      topic('getSulphurDioxideDensity', 'Sulphur Dioxide Density'),
      topic('getVOCDensity', 'VOC Density'),
      topic('getCarbonMonoxideLevel', 'Carbon Monoxide Level'),
      topic('getAirQualityPPM', 'Air Quality PPM', { description: 'Eve-only (Eve Room 1 history).' }),
      topic('getCurrentTemperature', 'Current Temperature', { description: 'Adds a temperature sensor service.' }),
      topic('getCurrentRelativeHumidity', 'Current Relative Humidity', { description: 'Adds a humidity sensor service.' }),
      topic('getTemperatureDisplayUnits', 'Temperature Display Units', { description: 'For the temperature sub-service.' }),
      topic('setTemperatureDisplayUnits', 'Set Temperature Display Units', { description: 'For the temperature sub-service.' }),
      ...sensorStatusTopics(),
    ],
    options: [
      opt('airQualityValues', 'stringArray', 'Air Quality Values', {
        default: ['UNKNOWN', 'EXCELLENT', 'GOOD', 'FAIR', 'INFERIOR', 'POOR'],
        description: 'Values representing unknown, excellent, good, fair, inferior and poor respectively.',
      }),
      opt('room2', 'boolean', 'Eve Room 2', { default: false, description: 'Enable Eve Room 2 history support.' }),
      opt('serviceNames', 'object', 'Service Names', { description: 'Custom names for the temperature and humidity services.' }),
      opt('temperatureDisplayUnitsValues', 'stringArray', 'Temperature Display Units Values', {
        default: ['CELSIUS', 'FAHRENHEIT'],
        description: 'Values representing Celsius and Fahrenheit respectively.',
      }),
    ],
    supportsHistory: true,
  },
  {
    id: 'carbonDioxideSensor',
    label: 'Carbon Dioxide Sensor',
    category: 'Sensors',
    topics: [
      topic('getCarbonDioxideDetected', 'Carbon Dioxide Detected', { required: true }),
      topic('getCarbonDioxideLevel', 'Carbon Dioxide Level'),
      topic('getCarbonDioxidePeakLevel', 'Carbon Dioxide Peak Level'),
      ...sensorStatusTopics(),
    ],
    options: [
      opt('carbonDioxideDetectedValues', 'stringArray', 'Carbon Dioxide Detected Values', {
        default: ['NORMAL', 'ABNORMAL'],
        description: 'Values representing normal and abnormal CO2 levels respectively.',
      }),
    ],
  },
  {
    id: 'carbonMonoxideSensor',
    label: 'Carbon Monoxide Sensor',
    category: 'Sensors',
    topics: [
      topic('getCarbonMonoxideDetected', 'Carbon Monoxide Detected', { required: true }),
      topic('getcarbonMonoxideLevel', 'Carbon Monoxide Level', {
        description: "Note the lower-case 'c' (upstream quirk kept for config compatibility).",
      }),
      topic('getcarbonMonoxidePeakLevel', 'Carbon Monoxide Peak Level', {
        description: "Note the lower-case 'c' (upstream quirk kept for config compatibility).",
      }),
      ...sensorStatusTopics(),
    ],
    options: [
      opt('carbonMonoxideDetectedValues', 'stringArray', 'Carbon Monoxide Detected Values', {
        default: ['NORMAL', 'ABNORMAL'],
        description: 'Values representing normal and abnormal CO levels respectively.',
      }),
    ],
    notes: "The level topics are read as getcarbonMonoxideLevel/getcarbonMonoxidePeakLevel (lower-case 'c', upstream quirk); docs/Accessories.md shows CamelCase keys which the code does not read for this type.",
  },

  // ---------------------------------------------------------------- Climate
  {
    id: 'thermostat',
    label: 'Thermostat',
    category: 'Climate',
    topics: [
      topic('getCurrentHeatingCoolingState', 'Current Heating/Cooling State'),
      topic('setTargetHeatingCoolingState', 'Set Target Heating/Cooling State'),
      topic('getTargetHeatingCoolingState', 'Target Heating/Cooling State'),
      topic('getCurrentTemperature', 'Current Temperature', { required: true }),
      topic('setTargetTemperature', 'Set Target Temperature'),
      topic('getTargetTemperature', 'Target Temperature'),
      topic('setTemperatureDisplayUnits', 'Set Temperature Display Units'),
      topic('getTemperatureDisplayUnits', 'Temperature Display Units'),
      topic('getCurrentRelativeHumidity', 'Current Relative Humidity'),
      topic('setTargetRelativeHumidity', 'Set Target Relative Humidity'),
      topic('getTargetRelativeHumidity', 'Target Relative Humidity'),
      topic('setCoolingThresholdTemperature', 'Set Cooling Threshold Temperature'),
      topic('getCoolingThresholdTemperature', 'Cooling Threshold Temperature'),
      topic('setHeatingThresholdTemperature', 'Set Heating Threshold Temperature'),
      topic('getHeatingThresholdTemperature', 'Heating Threshold Temperature'),
      topic('setActive', 'Set Active', { description: 'Code-supported; not in docs/Accessories.md.' }),
      topic('getActive', 'Active', { description: 'Code-supported; not in docs/Accessories.md.' }),
      topic('getStatusFault', 'Status Fault'),
    ],
    options: [
      opt('heatingCoolingStateValues', 'stringArray', 'Heating/Cooling State Values', {
        default: ['OFF', 'HEAT', 'COOL', 'AUTO'],
        description: 'Values representing Off, Heat, Cool and Auto respectively (current state uses the first three).',
      }),
      opt('temperatureDisplayUnitsValues', 'stringArray', 'Temperature Display Units Values', {
        default: ['CELSIUS', 'FAHRENHEIT'],
        description: 'Values representing Celsius and Fahrenheit respectively.',
      }),
      opt('minTemperature', 'number', 'Minimum Target Temperature', { default: 10 }),
      opt('maxTemperature', 'number', 'Maximum Target Temperature', { default: 38 }),
      opt('restrictHeatingCoolingState', 'object', 'Restrict Heating/Cooling State', {
        description: 'Array of integers restricting the target states (0 OFF, 1 HEAT, 2 COOL, 3 AUTO).',
      }),
      turnOffAfterOption(),
    ],
    notes: 'Code also binds an Active characteristic (setActive/getActive), which docs/Accessories.md does not document for thermostat.',
  },
  {
    id: 'heaterCooler',
    label: 'Heater Cooler',
    category: 'Climate',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('getCurrentHeaterCoolerState', 'Current Heater/Cooler State'),
      topic('setTargetHeaterCoolerState', 'Set Target Heater/Cooler State'),
      topic('getTargetHeaterCoolerState', 'Target Heater/Cooler State'),
      topic('getCurrentTemperature', 'Current Temperature'),
      topic('setCoolingThresholdTemperature', 'Set Cooling Threshold Temperature'),
      topic('getCoolingThresholdTemperature', 'Cooling Threshold Temperature'),
      topic('setHeatingThresholdTemperature', 'Set Heating Threshold Temperature'),
      topic('getHeatingThresholdTemperature', 'Heating Threshold Temperature'),
      topic('setTemperatureDisplayUnits', 'Set Temperature Display Units'),
      topic('getTemperatureDisplayUnits', 'Temperature Display Units'),
      topic('setSwingMode', 'Set Swing Mode'),
      topic('getSwingMode', 'Swing Mode'),
      topic('setLockPhysicalControls', 'Set Lock Physical Controls'),
      topic('getLockPhysicalControls', 'Lock Physical Controls'),
      topic('setRotationSpeed', 'Set Rotation Speed'),
      topic('getRotationSpeed', 'Rotation Speed'),
      topic('getStatusFault', 'Status Fault'),
    ],
    options: [
      opt('currentHeaterCoolerValues', 'stringArray', 'Current Heater/Cooler State Values', {
        default: ['INACTIVE', 'IDLE', 'HEATING', 'COOLING'],
        description: 'Values representing INACTIVE, IDLE, HEATING and COOLING respectively.',
      }),
      opt('targetHeaterCoolerValues', 'stringArray', 'Target Heater/Cooler State Values', {
        default: ['AUTO', 'HEAT', 'COOL'],
        description: 'Values representing AUTO, HEAT and COOL respectively.',
      }),
      ...swingAndLockOptions(),
      opt('temperatureDisplayUnitsValues', 'stringArray', 'Temperature Display Units Values', {
        default: ['CELSIUS', 'FAHRENHEIT'],
        description: 'Values representing Celsius and Fahrenheit respectively.',
      }),
      opt('minTemperature', 'number', 'Minimum Target Temperature'),
      opt('maxTemperature', 'number', 'Maximum Target Temperature'),
      opt('restrictHeaterCoolerState', 'object', 'Restrict Heater/Cooler State', {
        description: 'Array of integers restricting the target states (0 AUTO, 1 HEAT, 2 COOL).',
      }),
      turnOffAfterOption(),
      ...minMaxRotationSpeedOptions(),
    ],
    notes: 'docs/Accessories.md lists setRotationMode/getRotationMode topics, which the code does not implement (RotationSpeed and SwingMode are supported instead).',
  },
  {
    id: 'dehumidifier',
    label: 'Dehumidifier',
    category: 'Climate',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('getWaterLevel', 'Water Level'),
      topic('setWaterLevel', 'Set Water Level'),
      topic('getRelativeHumidityDehumidifierThreshold', 'Relative Humidity Dehumidifier Threshold'),
      topic('setRelativeHumidityDehumidifierThreshold', 'Set Relative Humidity Dehumidifier Threshold'),
      topic('getTargetHumidifierDehumidifierState', 'Target Humidifier/Dehumidifier State'),
      topic('setTargetHumidifierDehumidifierState', 'Set Target Humidifier/Dehumidifier State'),
      topic('getCurrentHumidifierDehumidifierState', 'Current Humidifier/Dehumidifier State'),
      topic('getCurrentRelativeHumidity', 'Current Relative Humidity'),
    ],
    options: [
      opt('targetHumidifierDehumidifierState', 'stringArray', 'Target Humidifier/Dehumidifier State Values', {
        default: ['HUMIDIFIER_OR_DEHUMIDIFIER', 'HUMIDIFIER', 'DEHUMIDIFIER'],
        description: 'Values representing HUMIDIFIER_OR_DEHUMIDIFIER, HUMIDIFIER and DEHUMIDIFIER respectively (option name is an upstream quirk).',
      }),
      opt('currentHumidifierDehumidifierState', 'stringArray', 'Current Humidifier/Dehumidifier State Values', {
        default: ['INACTIVE', 'IDLE', 'HUMIDIFYING', 'DEHUMIDIFYING'],
        description: 'Values representing INACTIVE, IDLE, HUMIDIFYING and DEHUMIDIFYING respectively (option name is an upstream quirk).',
      }),
      opt('restrictDehumidifierState', 'object', 'Restrict Dehumidifier State', {
        description: 'Upstream quirk: configuring this throws at construction (references a non-existent characteristic). Avoid.',
      }),
      turnOffAfterOption(),
    ],
    notes: 'Value-array options are named targetHumidifierDehumidifierState/currentHumidifierDehumidifierState (no "Values" suffix), matching the code.',
  },
  {
    id: 'fan',
    label: 'Fan',
    category: 'Climate',
    topics: [
      topic('getOn', 'On'),
      topic('setOn', 'Set On'),
      topic('getRotationDirection', 'Rotation Direction', { description: '0 clockwise, 1 anticlockwise.' }),
      topic('setRotationDirection', 'Set Rotation Direction', { description: '0 clockwise, 1 anticlockwise.' }),
      topic('getRotationSpeed', 'Rotation Speed', { description: '0 (off) to 100 (full speed).' }),
      topic('setRotationSpeed', 'Set Rotation Speed', { description: '0 (off) to 100 (full speed).' }),
    ],
    options: [turnOffAfterOption(), resetStateAfterOption(), ...minMaxRotationSpeedOptions()],
  },
  {
    id: 'fanv2',
    label: 'Fan v2',
    category: 'Climate',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('getCurrentFanState', 'Current Fan State'),
      topic('setTargetFanState', 'Set Target Fan State'),
      topic('getTargetFanState', 'Target Fan State'),
      topic('setRotationSpeed', 'Set Rotation Speed'),
      topic('getRotationSpeed', 'Rotation Speed'),
      topic('getRotationDirection', 'Rotation Direction'),
      topic('setRotationDirection', 'Set Rotation Direction'),
      topic('setSwingMode', 'Set Swing Mode'),
      topic('getSwingMode', 'Swing Mode'),
      topic('setLockPhysicalControls', 'Set Lock Physical Controls'),
      topic('getLockPhysicalControls', 'Lock Physical Controls'),
    ],
    options: [
      opt('targetFanStateValues', 'stringArray', 'Target Fan State Values', {
        default: ['MANUAL', 'AUTO'],
        description: 'Values representing MANUAL and AUTO respectively.',
      }),
      opt('currentFanValues', 'stringArray', 'Current Fan State Values', {
        default: ['INACTIVE', 'IDLE', 'BLOWING_AIR'],
        description: 'Values representing INACTIVE, IDLE and BLOWING_AIR respectively (docs call this currentFanStateValues, but the code reads currentFanValues).',
      }),
      ...swingAndLockOptions(),
      opt('getCurrentFanState', 'string', 'Current Fan State Topic (legacy)', {
        description: 'Legacy upstream location of the getCurrentFanState topic as a top-level key; prefer topics.getCurrentFanState.',
      }),
      turnOffAfterOption(),
      ...minMaxRotationSpeedOptions(),
    ],
    notes: 'The current-fan-state value array is read from currentFanValues (docs say currentFanStateValues). The legacy top-level getCurrentFanState key is still honored (upstream #78 / F15).',
  },
  {
    id: 'airPurifier',
    label: 'Air Purifier',
    category: 'Climate',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('getCurrentAirPurifierState', 'Current Air Purifier State'),
      topic('setTargetAirPurifierState', 'Set Target Air Purifier State'),
      topic('getTargetAirPurifierState', 'Target Air Purifier State'),
      topic('setRotationSpeed', 'Set Rotation Speed'),
      topic('getRotationSpeed', 'Rotation Speed'),
      topic('setSwingMode', 'Set Swing Mode'),
      topic('getSwingMode', 'Swing Mode'),
      topic('setLockPhysicalControls', 'Set Lock Physical Controls'),
      topic('getLockPhysicalControls', 'Lock Physical Controls'),
      topic('getFilterChangeIndication', 'Filter Change Indication'),
      topic('getFilterLifeLevel', 'Filter Life Level'),
      topic('setResetFilterIndication', 'Reset Filter Indication'),
    ],
    options: [
      opt('targetAirPurifierStateValues', 'stringArray', 'Target Air Purifier State Values', {
        default: ['MANUAL', 'AUTO'],
        description: 'Values representing MANUAL and AUTO respectively.',
      }),
      opt('currentAirPurifierStateValues', 'stringArray', 'Current Air Purifier State Values', {
        default: ['INACTIVE', 'IDLE', 'PURIFYING'],
        description: 'Values representing INACTIVE, IDLE and PURIFYING respectively.',
      }),
      ...swingAndLockOptions(),
      opt('serviceNames', 'object', 'Service Names', { description: 'Custom name for the filter maintenance service.' }),
      turnOffAfterOption(),
      ...minMaxRotationSpeedOptions(),
    ],
  },

  // ------------------------------------------------------ Security & Access
  {
    id: 'securitySystem',
    label: 'Security System',
    category: 'Security & Access',
    topics: [
      topic('setTargetState', 'Set Target State', { required: true }),
      topic('getTargetState', 'Target State'),
      topic('getCurrentState', 'Current State', { required: true }),
      topic('getStatusFault', 'Status Fault'),
      topic('getStatusTampered', 'Status Tampered'),
      topic('getAltSensorState', 'Alternate Sensor State', { description: 'Auxiliary sensor topic for use with codecs.' }),
    ],
    options: [
      opt('targetStateValues', 'stringArray', 'Target State Values', {
        default: ['SA', 'AA', 'NA', 'D'],
        description: 'Values representing STAY_ARM, AWAY_ARM, NIGHT_ARM and DISARM respectively.',
      }),
      opt('currentStateValues', 'stringArray', 'Current State Values', {
        default: ['SA', 'AA', 'NA', 'D', 'T'],
        description: 'Values representing STAY_ARM, AWAY_ARM, NIGHT_ARM, DISARMED and ALARM_TRIGGERED respectively.',
      }),
      opt('restrictTargetState', 'object', 'Restrict Target State', {
        description: 'Array of integers restricting the target states (0 STAY_ARM, 1 AWAY_ARM, 2 NIGHT_ARM, 3 DISARM).',
      }),
    ],
  },
  {
    id: 'doorbell',
    label: 'Doorbell',
    category: 'Security & Access',
    topics: [
      topic('getSwitch', 'Doorbell Switch', { required: true }),
      topic('getBrightness', 'Brightness'),
      topic('setBrightness', 'Set Brightness'),
      topic('getVolume', 'Volume'),
      topic('setVolume', 'Set Volume'),
      topic('getMotionDetected', 'Motion Detected', { description: 'Adds a motion sensor service.' }),
    ],
    options: [
      opt('switchValues', 'stringArray', 'Switch Values', {
        default: ['1', '2', 'L'],
        description: 'Values for single-press, double-press and long-press respectively.',
      }),
      opt('restrictSwitchValues', 'object', 'Restrict Switch Values', {
        description: 'Array of integers restricting the available events (0 single, 1 double, 2 long press).',
      }),
      opt('serviceNames', 'object', 'Service Names', { description: 'Custom name for the motion sensor service.' }),
    ],
  },
  {
    id: 'garageDoorOpener',
    label: 'Garage Door Opener',
    category: 'Security & Access',
    topics: [
      topic('setTargetDoorState', 'Set Target Door State', { required: true }),
      topic('getTargetDoorState', 'Target Door State'),
      topic('getCurrentDoorState', 'Current Door State'),
      topic('getDoorMoving', 'Door Moving', { description: 'Boolean alternative to getCurrentDoorState.' }),
      topic('setLockTargetState', 'Set Lock Target State'),
      topic('getLockTargetState', 'Lock Target State'),
      topic('getLockCurrentState', 'Lock Current State'),
      topic('getObstructionDetected', 'Obstruction Detected'),
    ],
    options: [
      opt('doorValues', 'stringArray', 'Door Values', {
        default: ['O', 'C', 'o', 'c', 'S'],
        description: 'Values for open, closed, opening, closing and stopped (used for both current and target when the specific options are unset).',
      }),
      opt('doorCurrentValues', 'stringArray', 'Current Door State Values', {
        default: ['O', 'C', 'o', 'c', 'S'],
        description: 'Values for open, closed, opening, closing and stopped respectively.',
      }),
      opt('doorTargetValues', 'stringArray', 'Target Door State Values', {
        default: ['O', 'C'],
        description: 'Values for target open and closed respectively.',
      }),
      opt('lockValues', 'stringArray', 'Lock Values', {
        default: ['U', 'S', 'J', '?'],
        description: 'Values for unsecured, secured, jammed and unknown respectively (target state uses the first two).',
      }),
    ],
  },
  {
    id: 'lockMechanism',
    label: 'Lock Mechanism',
    category: 'Security & Access',
    topics: [
      topic('setLockTargetState', 'Set Lock Target State'),
      topic('getLockTargetState', 'Lock Target State'),
      topic('getLockCurrentState', 'Lock Current State'),
    ],
    options: [
      opt('lockValues', 'stringArray', 'Lock Values', {
        default: ['U', 'S', 'J', '?'],
        description: 'Values for unsecured, secured, jammed and unknown respectively (target state uses the first two).',
      }),
    ],
    notes: 'At least one of setLockTargetState or getLockCurrentState must be configured for the service to expose any characteristic.',
  },
  {
    id: 'windowCovering',
    label: 'Window Covering',
    category: 'Security & Access',
    topics: [
      ...positionTopics(),
      topic('setTargetHorizontalTiltAngle', 'Set Target Horizontal Tilt Angle', { description: '-90 to 90.' }),
      topic('getTargetHorizontalTiltAngle', 'Target Horizontal Tilt Angle'),
      topic('getCurrentHorizontalTiltAngle', 'Current Horizontal Tilt Angle'),
      topic('setTargetVerticalTiltAngle', 'Set Target Vertical Tilt Angle', { description: '-90 to 90.' }),
      topic('getTargetVerticalTiltAngle', 'Target Vertical Tilt Angle'),
      topic('getCurrentVerticalTiltAngle', 'Current Vertical Tilt Angle'),
    ],
    options: positionOptions(),
  },
  {
    id: 'window',
    label: 'Window',
    category: 'Security & Access',
    topics: positionTopics(),
    options: positionOptions(),
  },
  {
    id: 'door',
    label: 'Door',
    category: 'Security & Access',
    topics: positionTopics(),
    options: positionOptions(),
  },

  // ------------------------------------------------------------------ Water
  {
    id: 'valve',
    label: 'Valve',
    category: 'Water',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('getInUse', 'In Use'),
      ...durationTopics(),
      ...sensorStatusTopics(),
    ],
    options: [
      opt('valveType', 'enum', 'Valve Type', {
        enumValues: ['sprinkler', 'shower', 'faucet'],
        description: 'Valve type shown in HomeKit; any other value gives a generic valve.',
      }),
      ...durationOptions(),
      opt('turnOffAfterms', 'integer', 'Turn Off After [ms]', {
        description: 'Turn off automatically after a fixed number of milliseconds (alternative to durationTimer/setDuration).',
      }),
    ],
  },
  {
    id: 'irrigationSystem',
    label: 'Irrigation System',
    category: 'Water',
    topics: [
      topic('getActive', 'Active', { description: 'Optional system-level state (usually derived from the zones).' }),
      topic('setActive', 'Set Active', { description: 'Optional system-level control (usually derived from the zones).' }),
      topic('getStatusFault', 'Status Fault'),
    ],
    options: [
      opt('zones', 'object', 'Zones', {
        description: 'Array of zones, each with a name and topics: getActive, setActive, getInUse, setDuration, getDuration, getRemainingDuration, getStatusFault.',
      }),
      ...durationOptions(),
      opt('noAutoInactive', 'boolean', 'No Automatic Deactivation', {
        default: false,
        description: 'Keep the main service active even when all zones are inactive.',
      }),
      turnOffAfterOption(),
    ],
    topicsOptional: true,
    notes: 'The top-level topics object may be empty or omitted; per-zone topics live in the zones array. Subtyped irrigationSystem-* types are rejected by the runtime (upstream quirk).',
  },

  // ------------------------------------------------------------------ Media
  {
    id: 'television',
    label: 'Television',
    category: 'Media',
    topics: [
      topic('setActive', 'Set Active', { required: true }),
      topic('getActive', 'Active'),
      topic('setActiveInput', 'Set Active Input'),
      topic('getActiveInput', 'Active Input'),
      topic('setRemoteKey', 'Remote Key'),
    ],
    options: [
      opt('inputs', 'object', 'Input Sources', {
        description: 'Array of { name, value } input sources selectable through setActiveInput/getActiveInput.',
      }),
      opt('remoteKeyValues', 'stringArray', 'Remote Key Values', {
        default: [
          'VOLUME_UP', 'VOLUME_DOWN', 'NEXT_TRACK', 'PREVIOUS_TRACK', 'UP', 'DOWN', 'LEFT', 'RIGHT',
          'SELECT', 'BACK', 'EXIT', 'PLAY_PAUSE', '12', '13', '14', 'INFO',
        ],
        description: 'Values published for remote key presses (code-supported; not in docs/Accessories.md).',
      }),
      turnOffAfterOption(),
    ],
  },
  {
    id: 'microphone',
    label: 'Microphone',
    category: 'Media',
    topics: [
      topic('getMute', 'Mute'),
      topic('setMute', 'Set Mute'),
      topic('getVolume', 'Volume'),
      topic('setVolume', 'Set Volume'),
    ],
    options: [],
  },
  {
    id: 'speaker',
    label: 'Speaker',
    category: 'Media',
    topics: [
      topic('getMute', 'Mute'),
      topic('setMute', 'Set Mute'),
      topic('getVolume', 'Volume'),
      topic('setVolume', 'Set Volume'),
    ],
    options: [],
  },

  // ------------------------------------------------------------------ Other
  {
    id: 'battery',
    label: 'Battery',
    category: 'Other',
    topics: [
      topic('getBatteryLevel', 'Battery Level'),
      topic('getChargingState', 'Charging State'),
      topic('getStatusLowBattery', 'Status Low Battery'),
    ],
    options: [],
    notes: 'Standalone battery service; the same topics also add a battery service automatically to any other type.',
  },
  {
    id: 'custom',
    label: 'Custom (Grouped Services)',
    category: 'Other',
    topics: [],
    options: [
      opt('services', 'object', 'Services', {
        description: 'Array of service configurations (each with type, name, topics and type-specific options) grouped into one accessory.',
      }),
    ],
    topicsOptional: true,
    notes: 'Settings on the custom accessory act as defaults for all services. Only simple (single-service) types should be grouped.',
  },
];

/** All supported type ids (base ids only; subtype aliases excluded). */
export const ALL_TYPE_IDS: string[] = ACCESSORY_TYPES.map((t) => t.id);

/**
 * Look up the model for a config "type" value. Handles 'type-subtype' strings
 * (e.g. 'lightbulb-OnOff') exactly like the runtime dispatch, which ignores
 * everything after the first '-'.
 */
export function getTypeModel(id: string | undefined | null): AccessoryTypeModel | undefined {
  if (!id) {
    return undefined;
  }
  const baseId = id.split('-')[0];
  return ACCESSORY_TYPES.find((t) => t.id === baseId);
}
