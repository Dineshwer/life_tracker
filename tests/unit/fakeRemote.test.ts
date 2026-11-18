import { describe, expect, it } from 'vitest';
import { FakeRemote, FakeServer } from './fakeRemote';
import { describeRemoteContract } from './remote.contract';

describeRemoteContract('FakeRemote', () => { const server = new FakeServer(); return { remote: (u, d) => new FakeRemote(server, u, d ?? 'dev') }; });

describe('FakeServer controls', () => {
  const it1 = { collection: 'tasks', id: 't', data: { a: 1 }, deleted: false, base_version: 0 };
  it('failNext throws then recovers; skip lets calls through first', async () => {
    const s = new FakeServer(); const r = new FakeRemote(s, 'u', 'a');
    s.failNext(1, 'push'); await expect(r.push([it1], 'a')).rejects.toThrow(/injected/);
    expect((await r.push([it1], 'a'))[0].status).toBe('ok');
    s.failNext(1, 'pull', 1); await r.pull(0); await expect(r.pull(0)).rejects.toThrow();
  });
  it('loseResponseNext applies the write but throws', async () => {
    const s = new FakeServer(); const r = new FakeRemote(s, 'u', 'a');
    s.loseResponseNext(); await expect(r.push([it1], 'a')).rejects.toThrow(/lost/);
    expect(s.liveRows('u')).toHaveLength(1);
    expect((await r.push([it1], 'a'))[0].status).toBe('conflict');
  });
  it('offline device throws; dropRealtime/deliverPending are controllable', async () => {
    const s = new FakeServer(); s.autoDeliver = false; const a = new FakeRemote(s, 'u', 'a'); const b = new FakeRemote(s, 'u', 'b');
    const got: string[] = []; const st: string[] = []; b.subscribe(r => got.push(r.id), x => st.push(x));
    await a.push([it1], 'a'); expect(got).toEqual([]); s.deliverPending(); expect(got).toEqual(['t']);
    s.dropRealtime(); await a.push([{ ...it1, id: 'u2' }], 'a'); s.deliverPending(); expect(got).toEqual(['t']); expect(st).toContain('down');
    s.setOffline('a', true); await expect(a.pull(0)).rejects.toThrow(/offline/);
  });
  it('purgeTombstones makes base>0 writes gone', async () => {
    const s = new FakeServer(); const r = new FakeRemote(s, 'u', 'a');
    await r.push([it1], 'a'); await r.push([{ ...it1, deleted: true, base_version: 1 }], 'a');
    expect(s.purgeTombstones()).toBe(1);
    expect((await r.push([{ ...it1, base_version: 2 }], 'a'))[0].status).toBe('gone');
  });
});
