/** What the extension and Chip's chat panel say to each other. */

export type Model = 'best' | 'fast';

export interface PanelState {
  signedIn: boolean;
  email: string | null;
  model: Model;
  /** The account's tier and a line about what's left today, when known. */
  tier: string | null;
  left: string | null;
}

export type ApprovalKind = 'edit' | 'command' | 'secret';

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  /** The command to run, or the changed lines (each starting with +, - or a space). */
  body: string;
  added?: number;
  removed?: number;
}

export type ToolStatus = 'running' | 'done' | 'failed' | 'skipped';

export type ToPanel =
  | { type: 'state'; state: PanelState }
  | { type: 'reset' }
  | { type: 'user'; text: string; files: string[] }
  | { type: 'turn' }
  | { type: 'think'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; label: string; status: ToolStatus; detail?: string }
  | { type: 'approve'; approval: Approval }
  | { type: 'approved'; id: string; ok: boolean }
  | { type: 'busy'; busy: boolean }
  | { type: 'note'; text: string; tone?: 'warn' }
  | { type: 'context'; file: string | null; lines: string | null }
  | { type: 'signin'; step: 'email' | 'code'; email?: string; error?: string; busy?: boolean }
  | { type: 'prefill'; text: string };

export type FromPanel =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'new' }
  | { type: 'answer'; id: string; ok: boolean; always?: boolean }
  | { type: 'diff'; id: string }
  | { type: 'open'; path: string; line?: number }
  | { type: 'otp'; email: string }
  | { type: 'verify'; email: string; code: string }
  | { type: 'restart-signin' }
  | { type: 'signout' }
  | { type: 'model'; model: Model }
  | { type: 'insert'; code: string };
