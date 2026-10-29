import test from 'node:test';
import assert from 'node:assert/strict';
import { callP1 } from '../lib/p1-client.js';

test('timeout identifies the operation, period, cutoff, exact elapsed time and original error without extra SDK options', async t => {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock);
  const original = Object.assign(new Error('MCP error -32001: Request timed out'), {
    code: -32001, data: { token: 'DO_NOT_LOG_SECRET', response: { customer: 'DO_NOT_LOG_PERSON' } },
  });
  const args = { run_id: 'DO_NOT_LOG_RUN', period: '2026-10', cutoff: '2026-10-29',
    filters: { store_id: 'DO_NOT_LOG_STORE', customer: 'DO_NOT_LOG_PERSON' } };
  let calls = 0;
  const client = { callTool: async (...parameters) => {
    calls++;
    assert.deepEqual(parameters, [{ name: 'sales_observe_many', arguments: args }]);
    clock = 61234;
    throw original;
  } };
  await assert.rejects(callP1(client, 'sales_observe_many', args), error => {
    assert.equal(error.message, 'P1 operation=sales_observe_many period=2026-10 cutoff=2026-10-29 duration_ms=60234: MCP error -32001: Request timed out');
    assert.equal(error.code, -32001);
    assert.ok(!error.message.includes('DO_NOT_LOG'));
    assert.equal(error.data, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test('tool errors keep the original code text and omit absent temporal fields', async t => {
  const times = [50, 75]; t.mock.method(Date, 'now', () => times.shift());
  const client = { callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'TARGET_REFERENCE_NOT_FOUND' }] }) };
  await assert.rejects(callP1(client, 'data_observe', { period: '2026-10' }), {
    message: 'P1 operation=data_observe period=2026-10 duration_ms=25: TARGET_REFERENCE_NOT_FOUND',
  });
});

test('only safe period/cutoff values are included, including FETCH date_to', async t => {
  t.mock.method(Date, 'now', () => 100);
  const client = { callTool: async () => { throw new Error('simulated failure'); } };
  await assert.rejects(callP1(client, 'data_fetch', { filters: { month: '2026-10', date_to: '2026-10-29', token: 'DO_NOT_LOG' } }), {
    message: 'P1 operation=data_fetch period=2026-10 cutoff=2026-10-29 duration_ms=0: simulated failure',
  });
  await assert.rejects(callP1(client, 'data_observe', { period: 'DO_NOT_LOG', cutoff: 'DO_NOT_LOG' }), {
    message: 'P1 operation=data_observe duration_ms=0: simulated failure',
  });
});

test('successful structured and text results stay unchanged; invalid evidence is never copied into the error', async () => {
  const evidence = { evidence_id: 'original-p1', payload: { value: 12 } };
  assert.equal(await callP1({ callTool: async () => ({ structuredContent: evidence }) }, 'data_observe', {}), evidence);
  assert.deepEqual(await callP1({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify(evidence) }] }) }, 'data_observe', {}), evidence);
  for (const result of [{ content: [] }, { content: [{ type: 'text', text: 'DO_NOT_LOG_RAW_RESPONSE{' }] }]) {
    await assert.rejects(callP1({ callTool: async () => result }, 'data_observe', {}), error => {
      assert.match(error.message, /operation=data_observe duration_ms=\d+: P1 data_observe returned (no|invalid) evidence/);
      assert.ok(!error.message.includes('DO_NOT_LOG'));
      return true;
    });
  }
});
