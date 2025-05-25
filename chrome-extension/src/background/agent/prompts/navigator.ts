/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { createLogger } from '@src/background/log';
import { navigatorSystemPromptTemplate } from './templates/navigator';

const logger = createLogger('agent/prompts/navigator');

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(private readonly maxActionsPerStep = 10) {
    super();

    const promptTemplate = navigatorSystemPromptTemplate;
    // Format the template with the maxActionsPerStep
    const formattedPrompt = promptTemplate.replace('{{max_actions}}', this.maxActionsPerStep.toString()).trim();
    this.systemMessage = new SystemMessage(formattedPrompt);
  }

  getSystemMessage(): SystemMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns SystemMessage containing the formatted system prompt
     */
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    const baseMessage = await this.buildBrowserStateUserMessage(context);

    // Enhance with Planner's page_elements context if available
    if (context.currentNavigatorContext?.pageElements) {
      const plannerContext = `\n\n🎯 PLANNER'S ELEMENT CONTEXT (PRIORITIZE THESE INDICES):\n${context.currentNavigatorContext.pageElements}\n\nIMPORTANT: When your plan refers to specific elements, use the indices from the PLANNER'S ELEMENT CONTEXT above, not the current page elements below.`;

      if (typeof baseMessage.content === 'string') {
        return new HumanMessage(baseMessage.content + plannerContext);
      } else if (Array.isArray(baseMessage.content)) {
        // Handle multimodal content (text + image)
        const textContent = baseMessage.content.find(item => item.type === 'text');
        if (textContent && 'text' in textContent) {
          textContent.text += plannerContext;
        }
        return new HumanMessage({ content: baseMessage.content });
      }
    }

    return baseMessage;
  }
}
