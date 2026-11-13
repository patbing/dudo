import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { verify } from '../server/src/fair.js';

const dir = new URL('../recordings/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));

test('every recording is listed and passes verify', async () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  assert.deepEqual(files.sort(), index.map((r) => r.file).sort());
  for (const f of files) {
    const r = await verify(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    assert.equal(r.ok, true, `${f}: ${JSON.stringify(r.steps.at(-1))}`);
  }
});
