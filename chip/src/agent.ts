import type { Model, ToolStatus } from './protocol';
import { runTool, type Host } from './tools';

/** The conversation with Chip and the loop around it: ask, run the tools Chip called, send back the
 * results, until Chip is done. History only ever grows, exactly as the API sent it: earlier turns
 * carry thinking that stops being valid if they're edited. */

export type Block = { type: string; id?: string; name?: string; input?: unknown; [key: string]: unknown };
export type Message = { role: 'user' | 'assistant'; content: string | Block[] };

export type StepEvent = { t: 'think' | 'text'; text: string } | { t: 'tool'; id: string; name: string };

export type StepResult = { kind: 'done'; stop: string | null; content: Block[] } | { kind: 'refusal' };

/** One call to Chip's server. Throws StepError when it fails. */
export type Step = (messages: Message[], model: Model, onEvent: (e: StepEvent) => void, signal: AbortSignal) => Promise<StepResult>;

export class StepError extends Error {
  constructor(
    message: string,
    /** Asking again as it was may work. */
    readonly retry = false,
    /** Sign in, or today's allowance is used. */
    readonly why?: 'account' | 'limit',
  ) {
    super(message);
  }
}

export interface AgentView {
  turn(): void;
  think(text: string): void;
  text(text: string): void;
  tool(id: string, label: string, status: ToolStatus, detail?: string): void;
  note(text: string, tone?: 'warn'): void;
}

const MOST_STEPS = 40;
const TOOL_WORDS: Record<string, string> = {
  read_file: 'Reading…',
  list_files: 'Looking around…',
  find_files: 'Finding files…',
  search_text: 'Searching…',
  get_problems: 'Checking for problems…',
  edit_file: 'Writing a change…',
  write_file: 'Writing a file…',
  run_command: 'Preparing a command…',
};

export class Agent {
  readonly messages: Message[] = [];
  private stopper: AbortController | null = null;

  constructor(
    private readonly step: Step,
    private readonly host: Host,
    private readonly view: AgentView,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get busy() {
    return this.stopper !== null;
  }

  stop() {
    this.stopper?.abort();
  }

  /** Sends [text], with any files, to Chip and works until it's finished, stopped or fails. */
  async send(text: string, model: Model, files: Block[] = []): Promise<void> {
    if (this.stopper) return;
    const stopper = (this.stopper = new AbortController());
    this.messages.push({ role: 'user', content: files.length ? [...files, { type: 'text', text }] : text });
    try {
      await this.work(model, stopper.signal);
    } catch (e) {
      if (!stopper.signal.aborted) throw e;
    } finally {
      this.stopper = null;
    }
  }

  private async work(model: Model, signal: AbortSignal) {
    for (let n = 0; n < MOST_STEPS; n++) {
      this.view.turn();
      const result = await this.ask(model, signal);
      if (result.kind === 'refusal') {
        this.view.note('Chip won’t help with this one.', 'warn');
        return;
      }
      this.messages.push({ role: 'assistant', content: result.content });
      const calls = result.content.filter((b) => b.type === 'tool_use');
      if (!calls.length) {
        if (result.stop === 'max_tokens') this.view.note('Chip ran out of room in that answer. Say “continue” to carry on.', 'warn');
        return;
      }
      // A cut-off answer may have cut off a tool call too: its input can't be trusted.
      const cut = result.stop === 'max_tokens';
      const results: Block[] = [];
      for (const call of calls) results.push(await this.run(call, cut, signal));
      this.messages.push({ role: 'user', content: results });
      if (signal.aborted) return;
    }
    this.view.note(`That was ${MOST_STEPS} steps. Say “continue” if you want Chip to keep going.`);
  }

  private async ask(model: Model, signal: AbortSignal): Promise<StepResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.step(
          this.messages,
          model,
          (e) => {
            if (e.t === 'think') this.view.think(e.text);
            else if (e.t === 'text') this.view.text(e.text);
            else if (e.t === 'tool') this.view.tool(e.id, TOOL_WORDS[e.name] ?? e.name, 'running');
          },
          signal,
        );
      } catch (e) {
        if (!(e instanceof StepError) || !e.retry || attempt >= 2 || signal.aborted) throw e;
        await this.wait(1500 * (attempt + 1));
      }
    }
  }

  private async run(call: Block, cut: boolean, signal: AbortSignal): Promise<Block> {
    const id = String(call.id);
    const answer = (content: string | Block[], failed: boolean): Block => ({ type: 'tool_result', tool_use_id: id, content, ...(failed ? { is_error: true } : {}) });
    if (cut) {
      this.view.tool(id, 'Cut off before it finished', 'failed');
      return answer('Your answer hit the output limit and this call was cut off, so it did not run. Make smaller changes.', true);
    }
    if (signal.aborted) {
      this.view.tool(id, 'Stopped', 'skipped');
      return answer('The developer stopped this.', true);
    }
    let output = '';
    const result = await runTool(String(call.name), call.input, this.host, signal, (text) => {
      output += text;
      this.view.tool(id, 'Running…', 'running', output.slice(-4000));
    });
    this.view.tool(id, result.label, result.skipped ? 'skipped' : result.failed ? 'failed' : 'done', result.detail);
    return answer((result.blocks as Block[] | undefined) ?? result.text, !!result.failed || !!result.skipped);
  }
}
