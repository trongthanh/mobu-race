import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual reconciliation function without requiring a WebGL context.
const source = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderWatchers() {');
const end = source.indexOf('\nfunction placeWatcher(', start);
assert.ok(start >= 0 && end > start);
const state = { users: [], watchers: new Map() };
const attached = new Set();
const disposed = new Set();
const context = vm.createContext({
  state,
  scene: { add: group => attached.add(group), remove: group => attached.delete(group) },
  disposeRig: group => disposed.add(group),
  costumeSeedFromText: text => text,
  createWatcher: ({ seed }) => ({ group: { seed, children: [], add(sprite) { this.children.push(sprite); } } }),
  makeNameSprite: text => ({ text, position: {} }),
  placeWatcher: () => {},
});
vm.runInContext(source.slice(start, end), context);
const refresh = () => vm.runInContext('renderWatchers()', context);
const watcher = id => state.watchers.get(id);

state.users = [{ id: 'host', name: 'Watcher#01', isHost: true }];
refresh();
const placeholder = watcher('host');
state.users[0].name = 'Alice';
refresh();
assert.equal(watcher('host').sprite.text, 'Alice 👑');
assert.equal(watcher('host').group.seed, 'host|Alice');
assert.ok(disposed.has(placeholder.group));
assert.ok(!attached.has(placeholder.group));
assert.ok(attached.has(watcher('host').group));
assert.ok(watcher('host').group.children.includes(watcher('host').sprite));
const unchanged = watcher('host');
refresh();
assert.equal(watcher('host'), unchanged, 'unchanged avatar is reused');

state.users.push({ id: 'visitor', name: 'Watcher#02', isHost: false });
refresh();
const visitorPlaceholder = watcher('visitor');
state.users[1].name = 'Bob';
refresh();
assert.equal(watcher('visitor').sprite.text, 'Bob');
assert.ok(disposed.has(visitorPlaceholder.group));
assert.ok(!attached.has(visitorPlaceholder.group));

const oldHost = watcher('host');
const oldVisitor = watcher('visitor');
state.users[0].isHost = false;
state.users[1].isHost = true;
refresh();
assert.equal(watcher('host').sprite.text, 'Alice');
assert.equal(watcher('visitor').sprite.text, 'Bob 👑');
assert.ok(disposed.has(oldHost.group) && disposed.has(oldVisitor.group));
assert.equal(attached.size, 2);

state.users = [];
refresh();
assert.equal(state.watchers.size, 0);
assert.equal(attached.size, 0);
console.log('PASS: host/visitor names, replacement disposal, unchanged reuse, host-transfer crowns, disconnect cleanup');
