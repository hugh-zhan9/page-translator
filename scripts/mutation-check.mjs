import { mkdtemp, cp, symlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const copy = await mkdtemp(path.join(tmpdir(), 'page-translator-mutations-'));
const mutants = [
  { name: 'allow foreign extension sender', file: 'src/config.ts', from: 'if (sender.id !== id) return false;', to: 'if (false) return false;', test: 'tests/config.test.ts' },
  { name: 'accept mismatched translation count', file: 'src/provider.ts', from: 'list.length !== count', to: 'false', test: 'tests/provider.test.ts' },
  { name: 'translate protected content', file: 'src/page.ts', from: 'parent.closest(SKIP)', to: 'false', test: 'tests/page.test.ts' },
  { name: 'disable paragraph batching', file: 'src/page.ts', from: '.slice(0, 16)', to: '.slice(0, 1)', test: 'tests/page.test.ts' },
  { name: 'split inline link wrappers', file: 'src/page.ts', from: 'const block = blockOf(parent);', to: 'const block = parent.closest("div,p,section,body") ?? parent;', test: 'tests/page.test.ts' },
  { name: 'preserve source indentation in normal text', file: 'src/page.ts', from: '/^(normal|nowrap)$/.test(whiteSpace)', to: 'false', test: 'tests/page.test.ts' },
  { name: 'force titles and short labels onto new lines', file: 'src/page.ts', from: 'output.style.cssText = inline', to: 'output.style.cssText = false', test: 'tests/page.test.ts' },
  { name: 'duplicate unchanged translations', file: 'src/page.ts', from: 'translation === source', to: 'false', test: 'tests/page.test.ts' },
  { name: 'merge standalone inline metadata', file: 'src/page.ts', from: '&& !standaloneItem', to: '', test: 'tests/page.test.ts' },
  { name: 'turn footer list labels into blocks', file: 'src/page.ts', from: "(record.block.matches('li') && navigationItem)", to: 'false', test: 'tests/page.test.ts' },
];
try {
  for (const item of ['src', 'tests', 'package.json', 'tsconfig.json']) await cp(path.join(root, item), path.join(copy, item), { recursive: true });
  await symlink(path.join(root, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  const run = test => spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...(test ? [test] : [])], { cwd: copy, encoding: 'utf8' });
  const baseline = run(); assert.equal(baseline.status, 0, 'Unmutated isolated baseline must pass');
  let killed = 0;
  for (const mutant of mutants) {
    const file = path.join(copy, mutant.file), source = await readFile(file, 'utf8');
    assert.ok(source.includes(mutant.from), `Mutation target missing: ${mutant.name}`);
    await writeFile(file, source.replace(mutant.from, mutant.to));
    const result = run(mutant.test);
    await writeFile(file, source);
    const testFailure = result.status !== 0 && /AssertionError|Test Files\s+\d+ failed/.test(result.stdout + result.stderr);
    console.log(`${testFailure ? 'KILLED' : 'SURVIVED/INVALID'}: ${mutant.name}`);
    if (testFailure) killed++;
  }
  assert.equal(killed, mutants.length, 'All targeted mutations must cause test failures');
  for (const file of ['src/config.ts', 'src/provider.ts', 'src/page.ts']) assert.equal(await readFile(path.join(copy, file), 'utf8'), await readFile(path.join(root, file), 'utf8'));
  console.log(`Targeted mutation checks: ${killed} killed, 0 survived, 0 invalid. Delivery source untouched.`);
} finally { await rm(copy, { recursive: true, force: true }); }
