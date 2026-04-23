// ============================================================
// /api/ai — Natural language interface powered by Claude
// ============================================================

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/client';
import { applyDelta, addCriminalRecord } from '../services/simulation.service';
import {
  getVoicePrompt,
  toneForGodModeSingle,
  type Tone,
} from '../services/tone.service';
import { TONES } from '@civ-sim/shared';
import { Prisma } from '@prisma/client';
import type { PersonDelta, EmotionalImpact, CriminalRecord } from '../types/person';

const router = Router();
const anthropic = new Anthropic();

// --------------- Tool definitions ---------------

const tools: Anthropic.Tool[] = [
  {
    name: 'list_characters',
    description: 'Get all characters currently in the simulation',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_character',
    description: 'Get full details and recent memory of a specific character',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Character UUID' } },
      required: ['id'],
    },
  },
  {
    name: 'apply_delta',
    description: 'Apply stat changes to a character with a narrative description. Use this to change current_health, money, age, occupation, relationship_status, religion, physical_appearance, sexuality, or death_age. To change identity traits (charisma, ambition, loyalty, resilience, etc.) prefix the key with "trait." e.g. "trait.charisma".',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Character UUID' },
        delta: {
          type: 'object',
          description: 'Fields to update and their new values. Scalar columns: current_health, money, age, death_age. String columns: occupation, relationship_status, religion, physical_appearance. Identity traits: use "trait.<key>" e.g. "trait.charisma".',
          properties: {
            current_health:      { type: 'number' },
            money:               { type: 'number' },
            age:                 { type: 'number' },
            occupation:          { type: 'string' },
            death_age:           { type: 'number' },
            relationship_status: { type: 'string' },
            religion:            { type: 'string' },
            physical_appearance: { type: 'string' },
          },
        },
        event_summary:    { type: 'string', description: 'What happened to cause this change' },
        emotional_impact: { type: 'string', enum: ['traumatic', 'negative', 'neutral', 'positive', 'euphoric'] },
        force:            { type: 'boolean', description: 'Bypass simulation rules (God Mode). Default false.' },
        tone:             {
          type: 'string',
          enum: [...TONES],
          description: 'Narrative voice for the memory entry. tabloid = scandal, literary = quiet weight, epic = mythic, reportage = terse dispatch, neutral = plain log. Match the voice to the event — a tragic death is literary, an affair is tabloid, a coronation is epic. Defaults to tabloid if omitted.',
        },
      },
      required: ['id', 'delta', 'event_summary', 'emotional_impact'],
    },
  },
  {
    name: 'add_criminal_record',
    description: 'Add a criminal record entry to a character',
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'string', description: 'Character UUID' },
        offense:       { type: 'string' },
        date:          { type: 'string', description: 'YYYY-MM-DD' },
        severity:      { type: 'string', enum: ['minor', 'moderate', 'severe'] },
        status:        { type: 'string', enum: ['pending', 'convicted', 'acquitted'] },
        notes:         { type: 'string' },
        event_summary: { type: 'string' },
        tone:          {
          type: 'string',
          enum: [...TONES],
          description: 'Narrative voice. Crimes usually read tabloid; literary works for tragic or reluctant offenses. Defaults to tabloid if omitted.',
        },
      },
      required: ['id', 'offense', 'date', 'severity', 'status', 'event_summary'],
    },
  },
  {
    name: 'create_character',
    description: 'Create a new character in the simulation',
    input_schema: {
      type: 'object',
      properties: {
        name:                { type: 'string' },
        sexuality:           { type: 'string', enum: ['HETEROSEXUAL', 'HOMOSEXUAL', 'BISEXUAL', 'ASEXUAL', 'PANSEXUAL', 'OTHER'] },
        gender:              { type: 'string' },
        race:                { type: 'string' },
        occupation:          { type: 'string' },
        age:                 { type: 'number' },
        death_age:           { type: 'number' },
        relationship_status: { type: 'string' },
        religion:            { type: 'string' },
        current_health:      { type: 'number' },
        physical_appearance: { type: 'string' },
        money:               { type: 'number' },
      },
      required: ['name', 'sexuality', 'gender', 'race', 'age', 'death_age', 'relationship_status', 'religion', 'physical_appearance'],
    },
  },
  {
    name: 'delete_character',
    description: 'Permanently delete a character from the simulation',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Character UUID' } },
      required: ['id'],
    },
  },
];

// --------------- Tool execution ---------------

type ToolOutcome = {
  message:       string;
  touched_ids:   string[];
  roster_changed: boolean;
};

async function executeTool(
  name:  string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'list_characters': {
        const chars = await prisma.person.findMany({
          select: { id: true, name: true, age: true, current_health: true, money: true },
          orderBy: { name: 'asc' },
        });
        return { message: JSON.stringify(chars, null, 2), touched_ids: [], roster_changed: false };
      }

      case 'get_character': {
        const person = await prisma.person.findUnique({
          where: { id: input.id as string },
          include: { memory_bank: { orderBy: { timestamp: 'desc' }, take: 10 } },
        });
        return {
          message:        person ? JSON.stringify(person, null, 2) : 'Character not found',
          touched_ids:    [],
          roster_changed: false,
        };
      }

      case 'apply_delta': {
        const result = await applyDelta({
          personId:         input.id as string,
          delta:            input.delta as PersonDelta,
          event_summary:    input.event_summary as string,
          emotional_impact: input.emotional_impact as EmotionalImpact,
          force:            (input.force as boolean) ?? false,
          tone:             input.tone as Tone | undefined,
        });
        return {
          message:        `Updated ${result.person.name} — ${JSON.stringify(input.delta)}`,
          touched_ids:    [input.id as string],
          roster_changed: false,
        };
      }

      case 'add_criminal_record': {
        const record: CriminalRecord = {
          offense:  input.offense as string,
          date:     input.date as string,
          severity: input.severity as CriminalRecord['severity'],
          status:   input.status as CriminalRecord['status'],
          notes:    input.notes as string | undefined,
        };
        const result = await addCriminalRecord(
          input.id as string,
          record,
          input.event_summary as string,
          input.tone as Tone | undefined,
        );
        return {
          message:        `Criminal record added for ${result.person.name}: ${input.offense}`,
          touched_ids:    [input.id as string],
          roster_changed: false,
        };
      }

      case 'create_character': {
        const person = await prisma.person.create({
          data: { ...(input as any), criminal_record: [] as Prisma.InputJsonValue },
        });
        return {
          message:        `Created character: ${person.name} (id: ${person.id})`,
          touched_ids:    [person.id],
          roster_changed: true,
        };
      }

      case 'delete_character': {
        const id = input.id as string;
        await prisma.person.delete({ where: { id } });
        return { message: 'Character deleted', touched_ids: [id], roster_changed: true };
      }

      default:
        return { message: `Unknown tool: ${name}`, touched_ids: [], roster_changed: false };
    }
  } catch (err) {
    return { message: `Error: ${(err as Error).message}`, touched_ids: [], roster_changed: false };
  }
}

// --------------- Route ---------------

router.post('/', async (req: Request, res: Response) => {
  const { message: userMessage } = req.body;

  if (!userMessage || typeof userMessage !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Build world context
    const chars = await prisma.person.findMany({
      select: { id: true, name: true, age: true },
      orderBy: { name: 'asc' },
    });

    const worldContext = chars.length > 0
      ? `Characters in the world:\n${chars.map(c => `- ${c.name} (id: ${c.id}, age ${c.age})`).join('\n')}`
      : 'The world is currently empty — no characters exist yet.';

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    // Round 6 — reconciliation. Accumulate every character touched across
    // the whole agentic loop so the client can invalidate the right queries
    // in the `done` event without needing to diff roster manually.
    const touchedIds   = new Set<string>();
    let   rosterChanged = false;

    // Voice reference block — lets Claude choose per-event tones deliberately
    // when it invokes apply_delta / add_criminal_record. God Mode writes
    // default to tabloid server-side if Claude omits the `tone` field.
    const defaultTone: Tone = toneForGodModeSingle();
    const voiceReference = TONES
      .map((t) => `### ${t}\n${getVoicePrompt(t)}`)
      .join('\n\n');

    // Agentic loop with streaming
    while (true) {
      const stream = anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: `You are the narrator and omnipotent overseer of a civilization simulation. You can create characters, shape their lives, change their stats, and influence the world.

${worldContext}

When the user gives instructions, use your tools to act on them, then narrate what happened in a vivid, immersive way. Be concise but evocative. Refer to characters by name. After making changes, briefly describe the outcome as if telling a story.

## Narrative voice

Every memory you write must carry a voice tag. When you call \`apply_delta\` or \`add_criminal_record\`, pass a \`tone\` chosen from the taxonomy below so the chronicle reads in the right register. If you omit \`tone\`, the server defaults to "${defaultTone}".

${voiceReference}

Match the voice to the event, not to the user's request — a quiet death is literary even if the user asked playfully; a scandalous affair is tabloid even if phrased politely. Your own narration back to the user should also lean into the voice you chose for the memory, so the chronicle and your reply feel of a piece.`,
        tools,
        messages,
      });

      stream.on('text', (delta) => send({ type: 'text', text: delta }));

      const aiResponse = await stream.finalMessage();

      if (aiResponse.stop_reason === 'end_turn') break;

      const toolCalls = aiResponse.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      if (toolCalls.length === 0) break;

      messages.push({ role: 'assistant', content: aiResponse.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (let i = 0; i < toolCalls.length; i++) {
        const tool = toolCalls[i];
        // Round 6 — emit progress before each tool so the client can show
        // a "tool 2 of 3" indicator on multi-tool turns.
        send({ type: 'progress', current: i + 1, total: toolCalls.length, name: tool.name });
        send({ type: 'tool', name: tool.name });
        const outcome = await executeTool(tool.name, tool.input as Record<string, unknown>);
        for (const id of outcome.touched_ids) touchedIds.add(id);
        if (outcome.roster_changed) rosterChanged = true;
        send({ type: 'tool_done', name: tool.name, result: outcome.message });
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: outcome.message });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    // Round 6 — reconciliation payload. Client invalidates per-character
    // queries for every touched id + the roster-level queries when a
    // character was created or deleted.
    send({
      type:            'done',
      touched_ids:     [...touchedIds],
      roster_changed:  rosterChanged,
    });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
});

export default router;
