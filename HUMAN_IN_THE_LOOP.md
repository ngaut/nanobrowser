# Human-in-the-Loop Feature

## Overview

Nanobrowser now supports **human-in-the-loop** interaction, allowing users to provide context, guidance, and clarification to AI agents while they're actively working on tasks. This feature makes the system more collaborative and responsive to user needs.

## How It Works

### Before (Traditional Flow)
```
User: "Book a flight to Paris"
→ Agent executes entire task autonomously
→ User can only stop or wait for completion
→ User provides follow-up after completion
```

### Now (Human-in-the-Loop Flow)
```
User: "Book a flight to Paris"
→ Agent starts working
→ User: "I prefer Delta airlines" (provides context while agent is working)
→ Agent incorporates user preference and continues
→ User: "My budget is under $500" (provides more context)
→ Agent adjusts search criteria and completes task
```

## Key Features

### 1. **Real-time Context Sharing**
- Users can type messages anytime during task execution
- Input field remains active with "💬 Providing context" indicator
- Placeholder changes to "What's the context?" during execution

### 2. **Seamless Integration**
- No interruption to agent workflow
- Context is automatically incorporated into agent decision-making
- Maintains conversation history for future reference

### 3. **Visual Feedback**
- Clear indicators when context input is available
- Different UI states for new tasks vs. context provision
- Maintains familiar chat interface

## Usage Examples

### Example 1: Shopping Assistance
```
User: "Find the best laptop under $1000"
Agent: [Starts searching various websites]
User: "I need it for gaming"
Agent: [Adjusts search to focus on gaming laptops]
User: "NVIDIA graphics preferred"
Agent: [Refines search criteria and finds suitable options]
```

### Example 2: Travel Planning
```
User: "Plan a weekend trip to San Francisco"
Agent: [Begins researching hotels and activities]
User: "I'm traveling with kids"
Agent: [Shifts focus to family-friendly options]
User: "Budget is $200/night for hotel"
Agent: [Filters hotel options by price range]
```

### Example 3: Research Tasks
```
User: "Research competitors for my SaaS product"
Agent: [Starts gathering competitor information]
User: "Focus on companies with under 50 employees"
Agent: [Narrows research scope to smaller competitors]
User: "Particularly interested in their pricing models"
Agent: [Emphasizes pricing information in research]
```

## Technical Implementation

### Message Flow
1. **User Context Input**: Sent as `user_context` message type
2. **Background Processing**: Added to message history with `user_context` type
3. **Agent Integration**: Navigator agent checks for recent context before each step
4. **Incorporation**: Context included in LLM prompts for decision-making

### Message Types
- `new_task`: Initial task (existing)
- `follow_up_task`: Follow-up after completion (existing)
- `user_context`: Real-time context during execution (new)

### UI States
- **Idle**: Normal task input
- **Executing**: Context input enabled with visual indicators
- **Follow-up**: Post-completion follow-up (existing)

## Benefits

### For Users
- **More Control**: Guide agents without micromanaging
- **Better Results**: Provide domain knowledge and preferences
- **Natural Interaction**: Feels like collaborating with a human assistant
- **Reduced Iterations**: Get desired results faster

### For Agents
- **Reduced Ambiguity**: Clear guidance on user preferences
- **Better Decision Making**: Access to real-time user input
- **Improved Success Rate**: Less guessing, more informed actions
- **Contextual Awareness**: Understanding of user priorities

## Best Practices

### For Users
1. **Be Specific**: Provide clear, actionable guidance
2. **Be Timely**: Share context when it's most relevant
3. **Be Concise**: Keep context messages focused and brief
4. **Be Patient**: Allow agents time to incorporate your guidance

### Example Good Context
- ✅ "I prefer Delta airlines"
- ✅ "Budget is under $500"
- ✅ "Focus on family-friendly options"
- ✅ "I need this for gaming"

### Example Poor Context
- ❌ "Do it better"
- ❌ "That's wrong"
- ❌ "I don't like this"
- ❌ "Change everything"

## Future Enhancements

### Planned Features
- **Agent Questions**: Agents can ask specific questions when uncertain
- **Context Suggestions**: System suggests relevant context based on task type
- **Context History**: Better management and reuse of provided context
- **Smart Pausing**: Agents pause at decision points for user input

### Advanced Capabilities
- **Multi-agent Context**: Share context across all agents (Planner, Navigator, Validator)
- **Context Prioritization**: Weight different types of context appropriately
- **Learning from Context**: Improve future task execution based on user patterns

## Troubleshooting

### Common Issues
1. **Context Not Applied**: Ensure you're providing context during execution, not after completion
2. **Input Disabled**: Check that a task is actively running (Stop button visible)
3. **Context Ignored**: Make context specific and actionable rather than vague

### Debug Information
- Check browser console for "🧠 Incorporating user context" messages
- Verify context appears in chat history with user guidance format
- Ensure message type is `user_context` in background logs

## Migration Notes

### Backward Compatibility
- All existing functionality remains unchanged
- Follow-up tasks work exactly as before
- No breaking changes to existing workflows

### New Behavior
- Input field stays enabled during task execution
- New visual indicators for context provision
- Additional message type handling in background script

This feature represents a significant step toward more collaborative AI assistance, making Nanobrowser feel more like working with an intelligent human assistant rather than just an automated tool. 