import { describe, expect, it, vi } from 'vitest';
import { Agent, StepError, type AgentView, type Block, type Step, type StepResult } from '../src/agent';
import { EventParser } from '../src/sse';
import { applyEdit, changedLines, looksSecret, runTool, safePath, type Host } from '../src/tools';

const never = new AbortController().signal;

function fakeHost(files: Record<string, string> = {}, approve = true): Host & { files: Record<string, string>; asked: string[] } {
  const asked: string[] = [];
  return {
    files,
    asked,
    read: async (p) => {
      if (!(p in files)) throw new Error(`${p} doesn't exist`);
      return files[p];
    },
    exists: async (p) => p in files,
    list: async () => [{ name: 'src', dir: true }, { name: 'a.ts', dir: false }],
    find: async () => ['a.ts'],
    search: async () => ['a.ts:1: hello'],
    problems: async () => [],
    write: async (p, t) => void (files[p] = t),
    run: async () => ({ code: 0, output: 'ok', timedOut: false }),
    approve: async (r) => (asked.push(r.kind), approve),
  };
}

describe('staying inside the project', () => {
  it('cleans relative paths', () => {
    expect(safePath('./src//a.ts')).toBe('src/a.ts');
    expect(safePath('src/../b.ts')).toBe('b.ts');
    expect(safePath('src\\win.ts')).toBe('src/win.ts');
    expect(safePath('')).toBe('');
  });

  it('refuses anything that leaves it', async () => {
    for (const path of ['../secret', 'src/../../secret', '/etc/passwd', 'C:\\Windows\\win.ini', '~/.ssh/id_rsa']) {
      const r = await runTool('read_file', { path }, fakeHost(), never);
      expect(r.failed, path).toBe(true);
    }
  });

  it('asks before reading a file that may hold secrets', async () => {
    for (const path of ['.env', 'config/.env.local', 'id_rsa', 'certs/server.pem']) expect(looksSecret(path), path).toBe(true);
    for (const path of ['.env.example', 'src/env.ts', 'keys.ts']) expect(looksSecret(path), path).toBe(false);
    const host = fakeHost({ '.env': 'KEY=abc' }, false);
    const r = await runTool('read_file', { path: '.env' }, host, never);
    expect(host.asked).toEqual(['secret']);
    expect(r.skipped).toBe(true);
    expect(r.text).not.toContain('abc');
  });
});

describe('edits', () => {
  it('replaces text that appears once', () => {
    expect(applyEdit('a b c', 'b', 'x', false)).toEqual({ after: 'a x c' });
  });

  it('says why it can’t', () => {
    expect(applyEdit('a b', 'z', 'x', false)).toHaveProperty('error');
    expect(applyEdit('b b', 'b', 'x', false)).toHaveProperty('error');
    expect(applyEdit('b b', 'b', 'x', true)).toEqual({ after: 'x x' });
    expect(applyEdit('b', '', 'x', false)).toHaveProperty('error');
  });

  it('treats $ in the new text as text', () => {
    expect(applyEdit('a', 'a', "$& $' $1", false)).toEqual({ after: "$& $' $1" });
  });

  it('keeps Windows line endings', () => {
    expect(applyEdit('one\r\ntwo\r\n', 'one\ntwo', 'three\nfour', false)).toEqual({ after: 'three\r\nfour\r\n' });
  });

  it('shows only what changed', () => {
    const d = changedLines('a\nb\nc\nd', 'a\nx\ny\nd');
    expect(d).toEqual({ body: '-b\n-c\n+x\n+y', added: 2, removed: 2 });
    expect(changedLines('', 'new').added).toBe(1);
  });

  it('writes only when approved', async () => {
    const host = fakeHost({ 'a.ts': 'old' });
    await runTool('edit_file', { path: 'a.ts', old_text: 'old', new_text: 'new' }, host, never);
    expect(host.files['a.ts']).toBe('new');
    const no = fakeHost({ 'a.ts': 'old' }, false);
    const r = await runTool('edit_file', { path: 'a.ts', old_text: 'old', new_text: 'new' }, no, never);
    expect(no.files['a.ts']).toBe('old');
    expect(r.skipped).toBe(true);
  });

  it('asks before every command', async () => {
    const host = fakeHost({}, false);
    const run = vi.spyOn(host, 'run');
    const r = await runTool('run_command', { command: 'rm -rf build' }, host, never);
    expect(run).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
  });

  it('answers bad input as an error, without running anything', async () => {
    const host = fakeHost({ 'a.ts': 'old' });
    const r = await runTool('edit_file', { path: 'a.ts', old_text: 'old' }, host, never);
    expect(r.failed).toBe(true);
    expect(r.text).toContain('INVALID_JSON');
    expect(host.files['a.ts']).toBe('old');
  });
});

describe('reading', () => {
  it('numbers lines and says when there’s more', async () => {
    const host = fakeHost({ 'a.ts': Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n') });
    const r = await runTool('read_file', { path: 'a.ts' }, host, never);
    expect(r.text.startsWith('1\tline 1\n')).toBe(true);
    expect(r.text).toContain('500 more lines: read on with start_line 2001');
    const part = await runTool('read_file', { path: 'a.ts', start_line: 10, end_line: 11 }, host, never);
    expect(part.text.split('\n').slice(0, 2)).toEqual(['10\tline 10', '11\tline 11']);
  });
});

describe('the stream', () => {
  it('joins messages split across chunks', () => {
    const p = new EventParser();
    expect(p.push('data: {"t":"te')).toEqual([]);
    expect(p.push('xt"}\n\ndata: {"t":"done"}\n\n')).toEqual([{ t: 'text' }, { t: 'done' }]);
  });

  it('skips what isn’t JSON', () => {
    expect(new EventParser().push(': comment\n\ndata: nope\n\ndata: 1\n\n')).toEqual([1]);
  });
});

describe('the agent', () => {
  const view = (): AgentView & { notes: string[] } => {
    const notes: string[] = [];
    return { notes, turn() {}, think() {}, text() {}, tool() {}, note: (t) => void notes.push(t) };
  };
  const call = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input });
  const steps = (...results: (StepResult | Error)[]): Step =>
    async () => {
      const r = results.shift()!;
      if (r instanceof Error) throw r;
      return r;
    };

  it('runs tools and sends every result back together', async () => {
    const seen: number[] = [];
    const script: StepResult[] = [
      { kind: 'done', stop: 'tool_use', content: [{ type: 'thinking', thinking: 'x', signature: 'sig' }, call('1', 'read_file', { path: 'a.ts' }), call('2', 'find_files', { glob: '*' })] },
      { kind: 'done', stop: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    ];
    const step: Step = async (m) => (seen.push(m.length), script.shift()!);
    const agent = new Agent(step, fakeHost({ 'a.ts': 'x' }), view());
    await agent.send('hi', 'best');
    expect(seen).toEqual([1, 3]);
    const [, assistant, results] = agent.messages;
    // What the API sent goes back unchanged, thinking and all.
    expect((assistant.content as Block[])[0]).toEqual({ type: 'thinking', thinking: 'x', signature: 'sig' });
    expect((results.content as Block[]).map((b) => b.tool_use_id)).toEqual(['1', '2']);
  });

  it('doesn’t run a tool call from an answer that was cut off', async () => {
    const host = fakeHost({ 'a.ts': 'old' });
    const agent = new Agent(
      steps(
        { kind: 'done', stop: 'max_tokens', content: [call('1', 'write_file', { path: 'a.ts', content: 'half of the' })] },
        { kind: 'done', stop: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
      ),
      host,
      view(),
    );
    await agent.send('hi', 'best');
    expect(host.files['a.ts']).toBe('old');
    expect((agent.messages[2].content as Block[])[0].is_error).toBe(true);
  });

  it('stops on a refusal without keeping the turn', async () => {
    const v = view();
    const agent = new Agent(steps({ kind: 'refusal' }), fakeHost(), v);
    await agent.send('hi', 'best');
    expect(agent.messages).toHaveLength(1);
    expect(v.notes[0]).toContain('won’t help');
  });

  it('asks again when told it may work, then gives up', async () => {
    const wait = async () => {};
    const ok: StepResult = { kind: 'done', stop: 'end_turn', content: [] };
    const again = new Agent(steps(new StepError('busy', true), ok), fakeHost(), view(), wait);
    await again.send('hi', 'best');
    expect(again.messages).toHaveLength(2);
    const fail = new Agent(steps(new StepError('a', true), new StepError('b', true), new StepError('c', true)), fakeHost(), view(), wait);
    await expect(fail.send('hi', 'best')).rejects.toThrow('c');
    const never2 = new Agent(steps(new StepError('limit')), fakeHost(), view(), wait);
    await expect(never2.send('hi', 'best')).rejects.toThrow('limit');
  });

  it('stopping answers the calls it didn’t run, so the conversation can carry on', async () => {
    const host = fakeHost({ 'a.ts': 'old' });
    let agent: Agent;
    const approve = host.approve;
    host.approve = async (r) => {
      agent.stop();
      return approve(r).then(() => false);
    };
    agent = new Agent(
      steps({ kind: 'done', stop: 'tool_use', content: [call('1', 'edit_file', { path: 'a.ts', old_text: 'old', new_text: 'new' }), call('2', 'read_file', { path: 'a.ts' })] }),
      host,
      view(),
    );
    await agent.send('hi', 'best');
    expect((agent.messages[2].content as Block[]).map((b) => b.tool_use_id)).toEqual(['1', '2']);
    expect(host.files['a.ts']).toBe('old');
    expect(agent.busy).toBe(false);
  });
});
