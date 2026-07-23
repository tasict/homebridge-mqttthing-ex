// Topic table of the editor: one row per characteristic (get/set inputs),
// required rows first, long tail behind "More topics (N)". Each row has a
// gear expander for the extended {topic, apply} form (with browser-side
// apply syntax checking) and a listen button on get topics that probes the
// broker through the server (/mqtt/probe).
import { useMemo, useState } from 'preact/hooks';

import type { ThingConfig, TopicSpec } from '../../../src/config.js';
import { hb, requestErrorMessage } from '../homebridge.js';
import { checkApplySyntax } from '../lib/apply-check.js';
import { probeTopicFor, setTopic, setTopicApply, topicApply, topicString } from '../lib/config-ops.js';
import { buildTopicRows, type TopicRow } from '../lib/topic-rows.js';

interface BrokerSource {
  url?: unknown;
  username?: unknown;
  password?: unknown;
}

interface Props {
  /** The object owning the topics (accessory config or custom sub-service). */
  owner: ThingConfig;
  /** Accessory-level config used as the broker fallback for sub-services. */
  broker: BrokerSource;
  touch: () => void;
}

function brokerPayload(owner: BrokerSource, broker: BrokerSource) {
  const pick = (a: unknown, b: unknown) => (typeof a === 'string' && a !== '' ? a : typeof b === 'string' ? b : undefined);
  return {
    url: pick(owner.url, broker.url),
    username: pick(owner.username, broker.username),
    password: pick(owner.password, broker.password),
  };
}

interface ProbeState {
  active: boolean;
  messages: { topic: string; payload: string }[];
  done: boolean;
}

function ApplyEditor({ owner, keyName, touch }: { owner: ThingConfig; keyName: string; touch: () => void }) {
  const spec = owner.topics?.[keyName];
  const [error, setError] = useState<string | null>(() => checkApplySyntax(topicApply(spec) ?? ''));

  return (
    <div class="mqx-apply-editor mb-2">
      <label class="form-label mb-1">
        <span class="mqx-mono">{keyName}</span> apply <span class="mqx-desc">function(message, state) body</span>
      </label>
      <textarea
        class={`form-control form-control-sm mqx-mono${error ? ' is-invalid' : ''}`}
        value={topicApply(spec) ?? ''}
        placeholder="return message; // transform the message, or return undefined to swallow it"
        onChange={(e) => {
          const body = (e.currentTarget as HTMLTextAreaElement).value;
          setError(checkApplySyntax(body));
          setTopicApply(owner, keyName, body);
          touch();
        }}
      />
      {error && <div class="invalid-feedback d-block">Syntax error: {error}</div>}
    </div>
  );
}

function TopicInput({
  owner,
  keyName,
  touch,
}: {
  owner: ThingConfig;
  keyName: string;
  touch: () => void;
}) {
  const spec = owner.topics?.[keyName];
  return (
    <input
      type="text"
      class="form-control form-control-sm mqx-mono"
      value={topicString(spec)}
      placeholder={keyName}
      onChange={(e) => {
        setTopic(owner, keyName, (e.currentTarget as HTMLInputElement).value);
        touch();
      }}
    />
  );
}

function RowView({ row, owner, broker, touch }: { row: TopicRow } & Props) {
  const [expanded, setExpanded] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ active: false, messages: [], done: false });

  const getSpec: TopicSpec | undefined = row.get ? owner.topics?.[row.get.key] : undefined;
  const setSpec: TopicSpec | undefined = row.set ? owner.topics?.[row.set.key] : undefined;
  const hasApply = topicApply(getSpec) !== undefined || topicApply(setSpec) !== undefined;

  const startProbe = async () => {
    const topic = probeTopicFor(getSpec);
    if (topic === '') {
      hb().toast.error('Configure the get topic first', 'Nothing to listen on');
      return;
    }
    const id = Math.random().toString(36).substring(2);
    const handler = (event: Event) => {
      const data = (event as MessageEvent).data as { id?: string; topic?: string; payload?: string } | undefined;
      if (data && data.id === id) {
        setProbe((p) => ({ ...p, messages: [...p.messages, { topic: String(data.topic ?? ''), payload: String(data.payload ?? '') }].slice(-10) }));
      }
    };
    hb().addEventListener('mqtt-probe', handler);
    setProbe({ active: true, messages: [], done: false });
    try {
      await hb().request('/mqtt/probe', { id, topic, ...brokerPayload(owner, broker) });
      setProbe((p) => ({ ...p, active: false, done: true }));
    } catch (e) {
      setProbe({ active: false, messages: [], done: false });
      hb().toast.error(requestErrorMessage(e), 'MQTT listen failed');
    } finally {
      hb().removeEventListener('mqtt-probe', handler);
    }
  };

  return (
    <>
      <tr>
        <th scope="row">
          {row.label}{' '}
          {row.required && (
            <span class="badge text-bg-danger" title="The accessory does not work without this topic">
              required
            </span>
          )}{' '}
          {hasApply && (
            <span class="badge text-bg-info" title="apply function configured">
              ƒ
            </span>
          )}
          <div class="mqx-key mqx-mono">
            {row.get?.key}
            {row.get && row.set ? ' / ' : ''}
            {row.set?.key}
          </div>
          {row.description && <div class="mqx-desc">{row.description}</div>}
        </th>
        <td>
          {row.get && (
            <div class="d-flex gap-1">
              <TopicInput owner={owner} keyName={row.get.key} touch={touch} />
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                title="Listen on this topic for 5 seconds"
                disabled={probe.active || topicString(getSpec) === ''}
                onClick={startProbe}
              >
                {probe.active ? '…' : '👂'}
              </button>
            </div>
          )}
          {(probe.active || probe.done || probe.messages.length > 0) && (
            <div class="mqx-probe-log mqx-mono">
              {probe.messages.map((m, i) => (
                <div key={i}>
                  <span class="mqx-key">{m.topic}</span> {m.payload}
                </div>
              ))}
              {probe.active && <div class="mqx-desc">listening&hellip;</div>}
              {probe.done && probe.messages.length === 0 && <div class="mqx-desc">no messages received in 5 s</div>}
            </div>
          )}
        </td>
        <td>{row.set && <TopicInput owner={owner} keyName={row.set.key} touch={touch} />}</td>
        <td class="text-end">
          <button
            type="button"
            class={`btn btn-sm ${expanded ? 'btn-secondary' : 'btn-outline-secondary'}`}
            title="Extended topic settings (apply functions)"
            onClick={() => setExpanded(!expanded)}
          >
            ⚙
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4}>
            {row.get && <ApplyEditor owner={owner} keyName={row.get.key} touch={touch} />}
            {row.set && <ApplyEditor owner={owner} keyName={row.set.key} touch={touch} />}
            <div class="mqx-desc">
              An apply function transforms the MQTT message: received messages for get topics, published messages for set
              topics. It is stored as the extended <span class="mqx-mono">{'{ "topic": …, "apply": … }'}</span> form.
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function TopicsTable({ owner, broker, touch }: Props) {
  const [showAll, setShowAll] = useState(false);
  const { rows, globals } = useMemo(() => buildTopicRows(owner.type), [owner.type]);

  const isConfigured = (row: TopicRow) =>
    (row.get && topicString(owner.topics?.[row.get.key]) !== '') ||
    (row.set && topicString(owner.topics?.[row.set.key]) !== '');

  // Decided once per type: required and already-configured rows are shown,
  // the long tail is behind "More topics (N)". Kept stable while editing so
  // rows do not vanish when a value is cleared.
  const initiallyVisible = useMemo(
    () => new Set([...rows.filter((r) => r.required || isConfigured(r)), ...globals.filter((r) => isConfigured(r))].map((r) => r.id)),
    [owner, owner.type],
  );

  const visibleRows = rows.filter((r) => showAll || initiallyVisible.has(r.id));
  const visibleGlobals = globals.filter((r) => showAll || initiallyVisible.has(r.id));
  const hiddenCount = rows.length + globals.length - visibleRows.length - visibleGlobals.length;

  return (
    <div class="table-responsive">
      <table class="table table-sm mqx-topic-table">
        <thead>
          <tr>
            <th style="width: 32%">Characteristic</th>
            <th>Get topic (subscribe)</th>
            <th>Set topic (publish)</th>
            <th style="width: 1%"></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <RowView key={row.id} row={row} owner={owner} broker={broker} touch={touch} />
          ))}
          {visibleGlobals.map((row) => (
            <RowView key={`g-${row.id}`} row={row} owner={owner} broker={broker} touch={touch} />
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button type="button" class="btn btn-link btn-sm p-0" onClick={() => setShowAll(true)}>
          More topics ({hiddenCount})
        </button>
      )}
    </div>
  );
}
