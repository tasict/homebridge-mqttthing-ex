// Importing this module registers all accessory type builders.
import './basic.js';
import './sensors-extra.js';
import './audio.js';
import './buttons.js';
import './doors.js';
import './security.js';
import './valve.js';
import './climate.js';
import './fans.js';
import './airquality.js';
import './weather.js';
import './media.js';
import './irrigation.js';
import './lightbulb.js';

export { buildServicesForConfig } from './registry.js';
