// ============================================================
// /api/ai — Natural language interface powered by Claude
// ============================================================

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/client';
import { applyDelta, addCriminalRecord } from '../services/simulation.service';
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
    description: 'Apply stat changes to a character with a narrative description. Use this to change health, happiness, wealth, morality, reputation, influence, intelligence, age, occupation, relationship_status, religion, physical_appearance, sexuality, or death_age.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Character UUID' },
        delta: {
          type: 'object',
          description: 'Fields to update and their new values',
          properties: {
            health:              { type: 'number' },
            happiness:           { type: 'number' },
            wealth:              { type: 'number' },
            morality:            { type: 'number' },
            reputation:          { type: 'number' },
            influence:           { type: 'number' },
            intelligence:        { type: 'number' },
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
        health:              { type: 'number' },
        morality:            { type: 'number' },
        happiness:           { type: 'number' },
        reputation:          { type: 'number' },
        influence:           { type: 'number' },
        intelligence:        { type: 'number' },
        physical_appearance: { type: 'string' },
        wealth:              { type: 'number' },
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

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'list_characters': {
        const chars = await prisma.person.findMany({
          select: { id: true, name: true, age: true, health: true, happiness: true, wealth: true },
          orderBy: { name: 'asc' },
        });
        return JSON.stringify(chars, null, 2);
      }

      case 'get_character': {
        const person = await prisma.person.findUnique({
          where: { id: input.id as string },
          include: { memory_bank: { orderBy: { timestamp: 'desc' }, take: 10 } },
        });
        return person ? JSON.stringify(person, null, 2) : 'Character not found';
      }

      case 'apply_delta': {
        const result = await applyDelta({
          personId:         input.id as string,
          delta:            input.delta as PersonDelta,
          event_summary:    input.event_summary as string,
          emotional_impact: input.emotional_impact as EmotionalImpact,
          force:            (input.force as boolean) ?? false,
        });
        return `Updated ${result.person.name} — ${JSON.stringify(input.delta)}`;
      }

      case 'add_criminal_record': {
        const record: CriminalRecord = {
          offense:  input.offense as string,
          date:     input.date as string,
          severity: input.severity as CriminalRecord['severity'],
          status:   input.status as CriminalRecord['status'],
          notes:    input.notes as string | undefined,
        };
        const result = await addCriminalRecord(input.id as string, record, input.event_summary as string);
        return `Criminal record added for ${result.person.name}: ${input.offense}`;
      }

      case 'create_character': {
        const person = await prisma.person.create({
          data: { ...(input as any), criminal_record: [] as Prisma.InputJsonValue },
        });
        return `Created character: ${person.name} (id: ${person.id})`;
      }

      case 'delete_character': {
        await prisma.person.delete({ where: { id: input.id as string } });
        return 'Character deleted';
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
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

    // Agentic loop with streaming
    while (true) {
      const stream = anthropic.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: `You are the narrator and omnipotent overseer of a civilization simulation. You can create characters, shape their lives, change their stats, and influence the world.

${worldContext}

When the user gives instructions, use your tools to act on them, then narrate what happened in a vivid, immersive way. Be concise but evocative. Refer to characters by name. After making changes, briefly describe the outcome as if telling a story.`,
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

      for (const tool of toolCalls) {
        send({ type: 'tool', name: tool.name });
        const result = await executeTool(tool.name, tool.input as Record<string, unknown>);
        send({ type: 'tool_done', name: tool.name, result });
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
});

export default router;
