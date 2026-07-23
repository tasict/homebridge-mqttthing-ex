// Importing this module registers all accessory type builders.
import './basic.js';
import './sensors-extra.js';
import './audio.js';
import './buttons.js';
import './doors.js';
import './security.js';
import './valve.js';

export { buildServicesForConfig } from './registry.js';
