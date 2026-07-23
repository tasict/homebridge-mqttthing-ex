// Entry point of the custom config UI. Rendered inside the config-ui-x
// settings iframe; window.homebridge is provided by the wrapper document
// before this module executes.
import { render } from 'preact';

import { App } from './app.js';
import './style.css';

const root = document.getElementById('mqttthing-ui');

if (root) {
  if (window.homebridge) {
    render(<App />, root);
  } else {
    root.textContent = 'This page only works inside the Homebridge UI plugin settings screen.';
  }
}
