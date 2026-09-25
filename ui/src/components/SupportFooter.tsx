// A quiet support note below the device list: never on the editing screens,
// never in the way of a task. The same two links as package.json `funding`,
// .github/FUNDING.yml, the README's Support section and the project site.
import { BOBA_ICON } from '../lib/boba-icon.js';

const BOBA = 'https://tasict.bobaboba.me';
const PAYPAL = 'https://paypal.me/tasict';
const SITE = 'https://tasict.github.io/homebridge-mqttthing-ex/';

export function SupportFooter() {
  return (
    <div class="mqx-support">
      <p class="mqx-support-text">
        MQTT Thing EX is free and open source. If it keeps your devices talking to Apple Home, you can buy me a boba
        or send a tip with PayPal.
      </p>
      <div class="d-flex flex-wrap gap-2">
        <a class="mqx-tip" href={BOBA} target="_blank" rel="noopener noreferrer">
          <img src={BOBA_ICON} alt="" width={20} height={20} />
          Buy me a boba
        </a>
        <a class="mqx-tip" href={PAYPAL} target="_blank" rel="noopener noreferrer">
          Tip with PayPal
        </a>
      </div>
      <p class="mqx-support-note">
        Boba is paid by card, no PayPal account needed. ·{' '}
        <a href={SITE} target="_blank" rel="noopener noreferrer">
          Project website
        </a>
      </p>
    </div>
  );
}
