// ============================================================
// AIConsole — Natural language interface to the simulation
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type OutputItem =
  | { kind: 'user';     text: string }
  | { kind: 'text';     text: string }
  | { kind: 'tool';     name: string }
  | { kind: 'tool_done'; name: string; result: string }
  | { kind: 'progress'; current: number; total: number; name: string }
  | { kind: 'error';    message: string };

const TOOL_LABELS: Record<string, string> = {
  list_characters:    'reading world state',
  get_character:      'reading character',
  apply_delta:        'updating character',
  add_criminal_record:'adding criminal record',
  create_character:   'creating character',
  delete_character:   'deleting character',
};

export default function AIConsole() {
  const qc = useQueryClient();
  const [input, setInput]       = useState('');
  const [output, setOutput]     = useState<OutputItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Auto-scroll as output grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  async function submit() {
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    setStreaming(true);

    setOutput(prev => [...prev, { kind: 'user', text: userMessage }]);

    // Round 6 — preserve input on error so the user doesn't lose their prompt.
    // Only clear once the request cleanly reaches the server stream.
    let submittedOk = false;

    try {
      const response = await fetch('/api/ai', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: userMessage }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      submittedOk = true;
      setInput('');

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      // Start a fresh text block for this response
      setOutput(prev => [...prev, { kind: 'text', text: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data: any;
          try { data = JSON.parse(line.slice(6)); } catch { continue; }

          switch (data.type) {
            case 'text':
              // Append to the last text block
              setOutput(prev => {
                const last = prev[prev.length - 1];
                if (last?.kind === 'text') {
                  return [...prev.slice(0, -1), { kind: 'text', text: last.text + data.text }];
                }
                return [...prev, { kind: 'text', text: data.text }];
              });
              break;

            case 'tool':
              setOutput(prev => [...prev, { kind: 'tool', name: data.name }]);
              // Start a fresh text block for any narration after the tool
              setOutput(prev => [...prev, { kind: 'text', text: '' }]);
              break;

            case 'tool_done':
              setOutput(prev => [...prev, { kind: 'tool_done', name: data.name, result: data.result }]);
              break;

            case 'progress':
              setOutput(prev => [...prev, {
                kind:    'progress',
                current: data.current,
                total:   data.total,
                name:    data.name,
              }]);
              break;

            case 'done':
              // Round 6 — reconcile UI. Invalidate per-character caches for
              // every touched id; if the roster changed, invalidate the
              // list-level queries too so People / Dashboard refresh.
              if (Array.isArray(data.touched_ids)) {
                for (const id of data.touched_ids as string[]) {
                  qc.invalidateQueries({ queryKey: ['character', id] });
                }
              }
              if (data.roster_changed) {
                qc.invalidateQueries({ queryKey: ['characters'] });
                qc.invalidateQueries({ queryKey: ['people:search'] });
              }
              break;

            case 'error':
              setOutput(prev => [...prev, { kind: 'error', message: data.message }]);
              break;
          }
        }
      }
    } catch (err) {
      setOutput(prev => [...prev, { kind: 'error', message: String(err) }]);
      // Input was never cleared; leave it so the user can retry.
      if (submittedOk) setInput(userMessage); // restore if we cleared after stream began
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="panel flex flex-col" style={{ height: '420px' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-display text-xs text-gold tracking-widest uppercase">Divine Oracle</span>
        {streaming && (
          <span className="text-[10px] text-amber-400/80 animate-pulse tracking-wide">shaping fate…</span>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed space-y-1">
        {output.length === 0 && (
          <p className="text-muted italic leading-relaxed">
            Speak your will and the world shall obey.<br />
            <span className="text-gray-500 not-italic">
              Try: <span className="text-gray-400">"make Marcus fall gravely ill"</span> · <span className="text-gray-400">"create a ruthless elven merchant"</span>
            </span>
          </p>
        )}

        {output.map((item, i) => {
          switch (item.kind) {
            case 'user':
              return (
                <div key={i} className="text-emerald-400/80 font-medium">
                  &gt; {item.text}
                </div>
              );
            case 'text':
              return item.text ? (
                <span key={i} className="text-gray-200 whitespace-pre-wrap">{item.text}</span>
              ) : null;
            case 'tool':
              return (
                <div key={i} className="text-amber-500/50 text-[10px]">
                  ⚙ {TOOL_LABELS[item.name] ?? item.name}…
                </div>
              );
            case 'progress':
              // Only surface progress on multi-tool turns; a single tool's
              // "1 of 1" is visual noise.
              return item.total > 1 ? (
                <div key={i} className="text-amber-600/60 text-[10px]">
                  step {item.current} / {item.total}
                </div>
              ) : null;
            case 'tool_done':
              return (
                <div key={i} className="text-emerald-700/70 text-[10px]">
                  ✓ {item.result}
                </div>
              );
            case 'error':
              return (
                <div key={i} className="text-red-400 text-[10px]">
                  Error: {item.message}
                </div>
              );
          }
        })}

        {/* Blinking cursor while streaming */}
        {streaming && (
          <span className="inline-block w-[7px] h-[13px] bg-gray-400 animate-pulse align-middle" />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border flex items-end gap-2 p-3 shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak your will… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={streaming}
          className="flex-1 bg-surface border border-border rounded px-3 py-2 text-xs text-gray-200 placeholder-muted resize-none focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={!input.trim() || streaming}
          className="btn-sim self-end"
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>

    </div>
  );
}
