import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, extract, makeWindow, Machine, N, FS, type Fault } from './iot-sim.ts';

test('FFT puts a pure 500 Hz sine in the right bin', () => {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let n = 0; n < N; n++) re[n] = Math.sin((2 * Math.PI * 500 * n) / FS);
  fft(re, im);
  let best = 0;
  for (let k = 1; k < N / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
  assert.equal(Math.round((best * FS) / N / 10) * 10, 500);
});

test('bearing impacts raise kurtosis well before they move RMS', () => {
  const mean = (f: (e: ReturnType<typeof extract>) => number, s: number) => {
    let acc = 0;
    for (let i = 0; i < 50; i++) acc += f(extract(makeWindow({ bearing: s, imbalance: 0, overheat: 0 }).signal, 52));
    return acc / 50;
  };
  const kurtRatio = mean((e) => e.kurtosis, 0.6) / mean((e) => e.kurtosis, 0);
  const rmsRatio = mean((e) => e.rms, 0.6) / mean((e) => e.rms, 0);
  assert.ok(kurtRatio > 2, `kurtosis x${kurtRatio.toFixed(2)}`);
  assert.ok(rmsRatio < 1.4, `rms x${rmsRatio.toFixed(2)}`);
});

const trained = new Machine();
trained.train();

test('a healthy machine runs 60 days with at most one false alarm', () => {
  const m = new Machine();
  Object.assign(m, { forest: trained.forest, threshold: trained.threshold, baselineRms: trained.baselineRms });
  while (m.day < 60) m.step(0.5);
  assert.ok(m.events.falseAlarms <= 1, `false alarms: ${m.events.falseAlarms}`);
});

for (const fault of ['bearing', 'imbalance', 'overheat'] as Fault[]) {
  test(`${fault}: the Isolation Forest alerts earlier than the classic alarm`, () => {
    let wins = 0;
    for (let run = 0; run < 5; run++) {
      const m = new Machine();
      Object.assign(m, { forest: trained.forest, threshold: trained.threshold, baselineRms: trained.baselineRms, day: 5 });
      m.inject(fault);
      while (!m.failed) m.step(0.5);
      const e = m.events;
      assert.ok(e.alertDay !== null, 'model never alerted');
      if (e.alertDay! < (e.rmsAlarmDay ?? Infinity)) wins++;
    }
    assert.ok(wins >= 4, `model earlier in ${wins}/5 runs`);
  });
}
