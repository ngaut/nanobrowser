import { z } from 'zod';

/**
 * Core agent execution types
 */
export interface AgentStepInfo {
  stepNumber: number;
  maxSteps: number;
}

export interface ActionResultParams {
  isDone?: boolean;
  extractedContent?: string | null;
  error?: string | null;
  includeInMemory?: boolean;
}

export class ActionResult {
  isDone: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;

  constructor(params: ActionResultParams = {}) {
    this.isDone = params.isDone ?? false;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

/**
 * Generic agent output interface
 */
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}

/**
 * Planning system types
 */
export const plannerOutputSchema = z.object({
  observation: z.string(),
  next_steps: z.array(z.string()),
  current_step: z.string(),
  web_task: z.boolean(),
  done: z.boolean(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export interface PlannerWaitingUserResponse {
  status: 'awaiting_user_plan_response';
  planProposed: PlannerOutput;
}

/**
 * User response interpretation schemas
 */
export const userResponseInterpretationSchema = z.object({
  action: z.enum(['approve', 'reject', 'modify']),
  feedback: z.string().optional(),
  modifications: z.array(z.string()).optional(),
});

export type UserResponseInterpretation = z.infer<typeof userResponseInterpretationSchema>;

/**
 * Agent brain schema for cognitive operations
 */
export const agentBrainSchema = z.object({
  evaluation_previous_goal: z.string(),
  memory: z.string(),
  next_goal: z.string(),
});

export type AgentBrain = z.infer<typeof agentBrainSchema>;
