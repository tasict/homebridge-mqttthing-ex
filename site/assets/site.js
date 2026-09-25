// Project site: language choice and the hero's MQTT demo.

// Remember an explicit language choice so the English root page stops redirecting to the browser language.
for (const a of document.querySelectorAll('a[hreflang]')) {
  a.addEventListener('click', () => {
    try { localStorage.setItem('lang', a.hreflang); } catch { /* storage blocked: the choice just isn't remembered */ }
  });
}

// Close the language menu when clicking elsewhere.
const langMenu = document.querySelector('.lang');
document.addEventListener('click', e => {
  if (langMenu?.open && !langMenu.contains(e.target)) langMenu.open = false;
});

// MQTT demo: every change in the tile is published to the lamp's set topic, and the lamp answers on its get topic,
// as with the plugin's default Boolean payloads ("true"/"false"). With the publish queue on, messages are paced by
// publishMinIntervalms and a pending message for the same topic is replaced by the newer value, so a slider drag sends
// only a few values; the first message after a quiet period goes out at once, as in the plugin's PublishQueue.
const stage = document.querySelector('[data-demo]');
if (stage) {
  const text = JSON.parse(stage.dataset.t);
  const { topics, queueMs } = text;
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const power = stage.querySelector('[data-power]');
  const slider = stage.querySelector('[data-bright]');
  const queueBox = stage.querySelector('[data-queue]');
  const log = stage.querySelector('[data-log]');
  const MAX_LINES = 7;
  const DEVICE_DELAY_MS = 160;

  let on = true, brightness = Number(slider.value), changes = 0, sent = 0;
  let pending = [], timer = null, lastSend = -Infinity;

  function line(dir, topic, payload) {
    const li = document.createElement('li');
    li.className = dir;
    const arrow = document.createElement('span');
    arrow.className = 'dir';
    arrow.textContent = dir === 'out' ? '→' : '←';
    arrow.title = dir === 'out' ? text.out : text.in;
    const t = document.createElement('span');
    t.className = 'topic';
    t.textContent = topic;
    const p = document.createElement('span');
    p.className = 'payload';
    p.textContent = payload;
    li.append(arrow, t, p);
    log.append(li);
    while (log.children.length > MAX_LINES) log.firstElementChild.remove();
  }

  function send({ topic, payload }) {
    sent++;
    lastSend = performance.now();
    line('out', topic, payload);
    // the lamp confirms on the matching get topic
    const reply = topic === topics.setOn ? topics.getOn : topics.getBrightness;
    setTimeout(() => line('in', reply, payload), DEVICE_DELAY_MS);
    render();
  }

  function drain() {
    if (timer !== null || pending.length === 0) return;
    const wait = Math.max(0, lastSend + queueMs - performance.now());
    if (wait === 0) {
      send(pending.shift());
      drain();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (pending.length) send(pending.shift());
      drain();
    }, wait);
  }

  function publish(topic, payload) {
    if (!queueBox.checked) {
      send({ topic, payload });
      return;
    }
    const waiting = pending.find(m => m.topic === topic);
    if (waiting) waiting.payload = payload;
    else pending.push({ topic, payload });
    drain();
  }

  function render() {
    stage.toggleAttribute('data-off', !on);
    stage.style.setProperty('--glow', String(0.15 + brightness / 115));
    power.setAttribute('aria-checked', String(on));
    stage.querySelector('[data-status]').textContent = on ? fill(text.on, { b: brightness }) : text.off;
    stage.querySelector('[data-tally]').textContent = changes ? fill(text.tally, { changes, sent }) : '';
  }

  power.addEventListener('click', () => {
    on = !on;
    changes++;
    publish(topics.setOn, String(on));
    render();
  });

  slider.addEventListener('input', () => {
    // the Home app turns a light on when its brightness is changed
    if (!on) {
      on = true;
      changes++;
      publish(topics.setOn, 'true');
    }
    brightness = Number(slider.value);
    changes++;
    publish(topics.setBrightness, String(brightness));
    render();
  });

  queueBox.addEventListener('change', () => {
    // switching the queue off sends whatever is still waiting
    if (!queueBox.checked) {
      clearTimeout(timer);
      timer = null;
      for (const m of pending.splice(0)) send(m);
    }
    changes = sent = 0;
    render();
  });

  // the lamp's current state, as it reported it when the plugin subscribed
  line('in', topics.getOn, 'true');
  line('in', topics.getBrightness, String(brightness));
  render();
}
