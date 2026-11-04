import type { Block, Message, StepResult } from './agent';
import { StepError } from './agent';
import type { Model } from './protocol';
import { EventParser } from './sse';

/** Talks to Chip's server: signing in, the account, and streamed answers. Holds no keys: the
 * instructions and Claude's key stay on the server. */

const SERVER = 'https://atrgasakfnmixhictynh.supabase.co/functions/v1/chip-code';

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email: string | null;
}

export interface SessionStore {
  get(): Promise<Session | null>;
  set(session: Session | null): Promise<void>;
}

export type ServerEvent =
  | { t: 'start'; model: Model; note: string | null }
  | { t: 'think' | 'text'; text: string }
  | { t: 'tool'; id: string; name: string }
  | { t: 'ping' }
  | { t: 'done'; stop: string | null; content: Block[]; model: Model }
  | { t: 'refusal' }
  | { t: 'error'; error: string; retry?: boolean };

export class ChipApi {
  constructor(
    private readonly store: SessionStore,
    private readonly server: () => string,
  ) {}

  private get url() {
    return this.server() || SERVER;
  }

  private async post(body: unknown, token?: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new StepError('Chip can’t be reached. Check your connection.', true);
    }
  }

  private async plain<T>(body: unknown): Promise<T> {
    const res = await this.post(body);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new StepError(data.error ?? 'That didn’t work. Try again.');
    return data;
  }

  sendCode(email: string) {
    return this.plain<{ ok: true }>({ action: 'otp', email });
  }

  async verify(email: string, code: string) {
    await this.store.set(await this.plain<Session>({ action: 'verify', email, code }));
  }

  /** A token that's good for a while yet, refreshed when it's nearly over. */
  private async token(force = false): Promise<string> {
    const session = await this.store.get();
    if (!session) throw new StepError('Sign in to use Chip.', false, 'account');
    if (!force && session.expires_at - Date.now() / 1000 > 60) return session.access_token;
    try {
      const fresh = await this.plain<Session>({ action: 'refresh', refresh_token: session.refresh_token });
      await this.store.set({ ...fresh, email: fresh.email ?? session.email });
      return fresh.access_token;
    } catch (e) {
      if ((e as StepError).retry) throw e;
      await this.store.set(null);
      throw new StepError('Please sign in again.', false, 'account');
    }
  }

  private async authed(body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await this.post(body, await this.token(), signal);
    return res.status === 401 ? this.post(body, await this.token(true), signal) : res;
  }

  async me(): Promise<Record<string, unknown>> {
    const res = await this.authed({ action: 'me' });
    if (!res.ok) throw new StepError('Couldn’t load your account.', true);
    return (await res.json()) as Record<string, unknown>;
  }

  /** Streams one job's events to [onEvent], and answers the last. */
  async stream(body: Record<string, unknown>, onEvent: (e: ServerEvent) => void, signal: AbortSignal): Promise<ServerEvent> {
    const res = await this.authed(body, signal);
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; why?: string };
      const why = data.why === 'account' ? 'account' : data.why === 'limit' || data.why === 'busy' ? 'limit' : undefined;
      throw new StepError(data.error ?? 'Chip couldn’t think just now.', !why && res.status >= 500, why);
    }
    const parser = new EventParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let last: ServerEvent | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true })) as ServerEvent[]) {
        last = event;
        onEvent(event);
      }
    }
    if (!last || (last.t !== 'done' && last.t !== 'refusal' && last.t !== 'error')) throw new StepError('The connection dropped before Chip finished.', true);
    return last;
  }

  /** One step of the agent. */
  async step(messages: Message[], model: Model, onEvent: (e: ServerEvent) => void, signal: AbortSignal): Promise<StepResult> {
    const last = await this.stream({ action: 'ask', messages, model }, onEvent, signal);
    if (last.t === 'refusal') return { kind: 'refusal' };
    if (last.t === 'error') throw new StepError(last.error, !!last.retry);
    if (last.t !== 'done') throw new StepError('Chip couldn’t think just now.', true);
    return { kind: 'done', stop: last.stop, content: last.content };
  }
}
