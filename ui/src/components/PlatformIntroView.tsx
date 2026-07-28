// Explains platform mode to someone who has only ever used accessory blocks.
//
// It is a page the user chooses to open, never something pushed in front of
// them: accessory mode is a first-class, permanently supported choice.
import { PenLine, Share2, Zap } from 'lucide-preact';
import { useEffect } from 'preact/hooks';

import { markIntroSeen } from '../lib/prefs.js';
import { childBridgeAccessories, connectionEstimate, type DeviceStore } from '../lib/store-ops.js';

interface Props {
  store: DeviceStore;
  onBack: () => void;
  onMigrate: () => void;
}

export function PlatformIntroView({ store, onBack, onMigrate }: Props) {
  useEffect(() => markIntroSeen(), []);

  const estimate = connectionEstimate(store.legacy);
  const blocked = childBridgeAccessories(store);

  return (
    <div>
      <div class="mb-3">
        <button type="button" class="btn btn-link btn-sm p-0" onClick={onBack}>
          ← All accessories
        </button>
        <h5 class="m-0 mt-1">Platform mode</h5>
        <div class="mqx-desc mt-1">
          An optional second way to configure the same devices. Accessory mode is fully supported and is not going
          away — you never have to change anything.
        </div>
      </div>

      <div class="row row-cols-1 row-cols-md-3 g-2 mb-3">
        <div class="col">
          <div class="card h-100">
            <div class="card-body">
              <div class="mqx-benefit-icon mb-2">
                <Share2 size={20} />
              </div>
              <div class="fw-semibold">Fewer MQTT connections</div>
              <div class="mqx-desc mt-1">
                {estimate.before > estimate.after ? (
                  <>
                    Each accessory block opens its own connection to the broker. In platform mode, devices using the
                    same broker share one: {estimate.before} connections today, {estimate.after} after moving.
                  </>
                ) : (
                  <>Devices that use the same broker share a single MQTT connection instead of opening one each.</>
                )}
              </div>
            </div>
          </div>
        </div>
        <div class="col">
          <div class="card h-100">
            <div class="card-body">
              <div class="mqx-benefit-icon mb-2">
                <Zap size={20} />
              </div>
              <div class="fw-semibold">Devices appear straight away</div>
              <div class="mqx-desc mt-1">
                Homebridge remembers platform devices, so they show up in HomeKit as soon as Homebridge starts, even
                before the broker answers. Accessory blocks only appear once the connection is up.
              </div>
            </div>
          </div>
        </div>
        <div class="col">
          <div class="card h-100">
            <div class="card-body">
              <div class="mqx-benefit-icon mb-2">
                <PenLine size={20} />
              </div>
              <div class="fw-semibold">Renaming is safe</div>
              <div class="mqx-desc mt-1">
                Today HomeKit identifies an accessory by its name, so renaming one creates a new accessory and loses
                its room, scenes and automations. Platform devices get a stable id, which makes the name just a label.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-body">
          <div class="fw-semibold mb-2">What stays the same</div>
          <ul class="m-0 ps-3">
            <li>Accessory mode keeps working, is not deprecated, and mixing both is fine.</li>
            <li>
              Moving a device keeps its HomeKit identity: rooms, scenes and automations are preserved and nothing has
              to be paired again.
            </li>
            <li>Nothing is written to config.json until you save. Closing this window throws the changes away.</li>
          </ul>
        </div>
      </div>

      {blocked.length > 0 && (
        <div class="alert alert-secondary py-2">
          {blocked.length} of your accessories {blocked.length === 1 ? 'runs' : 'run'} in their own child bridge (
          {blocked.map((config) => String(config.name ?? '')).join(', ')}). Homebridge supports child bridges for whole
          blocks, not for individual platform devices, so these cannot be moved without pairing their bridge again.
          They are left in accessory mode.
        </div>
      )}

      <div class="d-flex flex-wrap align-items-center gap-2">
        <button type="button" class="btn btn-primary" onClick={onMigrate}>
          Move accessories to platform mode
        </button>
        <button type="button" class="btn btn-outline-secondary" onClick={onBack}>
          Not now
        </button>
        <a
          class="btn btn-link btn-sm"
          href="https://github.com/tasict/homebridge-mqttthing-ex#platform-mode"
          target="_blank"
          rel="noreferrer"
        >
          Read the documentation
        </a>
      </div>
    </div>
  );
}
