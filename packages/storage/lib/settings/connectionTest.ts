import { ProviderTypeEnum, type ProviderConfig } from './types';

interface TestConnectionResult {
  success: boolean;
  error?: string;
  details?: string;
}

async function testOpenAIConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `OpenAI API Error (${response.status})`,
        details: error.error?.message || 'Unknown error',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details: error instanceof Error ? error.message : 'Failed to connect to OpenAI API',
    };
  }
}

async function testAnthropicConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `Anthropic API Error (${response.status})`,
        details: error.error?.message || 'Unknown error',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details: error instanceof Error ? error.message : 'Failed to connect to Anthropic API',
    };
  }
}

async function testOllamaConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  try {
    const baseUrl = config.baseUrl || 'http://localhost:11434';

    // First, check basic connectivity
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!tagsResponse.ok) {
      return {
        success: false,
        error: `Ollama API Error (${tagsResponse.status})`,
        details: 'Failed to connect to Ollama server. Make sure Ollama is running and OLLAMA_ORIGINS is set correctly.',
      };
    }

    // Get available models
    let availableModels: string[] = [];
    try {
      const modelsResponse = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
      });

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        if (modelsData.models) {
          availableModels = modelsData.models.map((model: any) => model.name);
        }
      }
    } catch (error) {
      // Silently ignore errors fetching models list
    }

    // Use the model from config if available, otherwise use the first available model or a safe fallback
    let modelToTest = '';

    // If modelNames is provided in the config, use the first one
    if (config.modelNames && config.modelNames.length > 0 && config.modelNames[0]) {
      modelToTest = config.modelNames[0];
    }
    // Fallback: if we have available models, use the first one
    else if (availableModels.length > 0) {
      modelToTest = availableModels[0];
    }
    // Last resort fallback
    else {
      modelToTest = 'mistral';
    }

    // Next, test the chat API with a JSON format request to detect format issues
    try {
      const chatResponse = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
          format: 'json', // This tests the format parameter handling
          options: {
            num_ctx: 2048,
          },
        }),
      });

      // Check if we get a 400 Bad Request which might indicate format issues
      if (chatResponse.status === 400) {
        const errorText = await chatResponse.text();
        if (errorText.includes('unmarshal') && errorText.includes('format')) {
          return {
            success: false,
            error: 'Format Parameter Error',
            details:
              'The Ollama API rejected the request due to a format parameter issue. This may indicate a compatibility problem with the current version of Ollama.',
          };
        }
      }

      // If the chat request didn't succeed, but it's not a format issue
      if (!chatResponse.ok) {
        // Don't fail the test if this is just a missing model issue
        const errorJson = await chatResponse.json().catch(() => ({}));
        const errorMessage = errorJson.error || '';

        // Check for version compatibility issues
        if (
          chatResponse.status === 500 &&
          (errorMessage.includes('not supported by your version') || errorMessage.includes('need to upgrade'))
        ) {
          return {
            success: false,
            error: 'Ollama Version Compatibility Error',
            details: `${errorMessage}. Please upgrade Ollama to the latest version using your package manager (e.g., 'brew upgrade ollama' on macOS).`,
          };
        }

        // Check for missing model errors
        if (errorMessage.includes('model not found')) {
          // Continue with success, just note the model wasn't found
          return {
            success: true,
            details: `Basic connection successful, but model '${modelToTest}' not found. Please pull this model first with 'ollama pull ${modelToTest}'.`,
          };
        }

        return {
          success: false,
          error: `Ollama Chat API Error (${chatResponse.status})`,
          details: errorMessage || 'Unknown error during chat request',
        };
      }
    } catch (chatError) {
      // If the chat test fails but the tags request worked, still return success
      // but with a warning about potential issues with chat requests
      return {
        success: true,
        details: `Basic connection successful, but chat API test failed: ${chatError instanceof Error ? chatError.message : 'Unknown error'}. This might indicate issues with JSON format handling.`,
      };
    }

    return {
      success: true,
      details:
        availableModels.length > 0
          ? `Connection successful. Available models: ${availableModels.join(', ')}.`
          : 'Connection successful.',
    };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details:
        error instanceof Error ? error.message : 'Failed to connect to Ollama server. Make sure Ollama is running.',
    };
  }
}

async function testAzureOpenAIConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  if (!config.baseUrl || !config.azureDeploymentNames?.[0] || !config.azureApiVersion) {
    return {
      success: false,
      error: 'Configuration Error',
      details: 'Missing required Azure OpenAI configuration (endpoint, deployment name, or API version)',
    };
  }

  try {
    const endpoint = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    const deploymentName = config.azureDeploymentNames[0];
    const apiVersion = config.azureApiVersion;
    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `Azure OpenAI API Error (${response.status})`,
        details: error.error?.message || 'Unknown error',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details: error instanceof Error ? error.message : 'Failed to connect to Azure OpenAI API',
    };
  }
}

async function testOpenRouterConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  try {
    const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `OpenRouter API Error (${response.status})`,
        details: error.error?.message || 'Unknown error',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details: error instanceof Error ? error.message : 'Failed to connect to OpenRouter API',
    };
  }
}

async function testCustomOpenAIConnection(config: ProviderConfig): Promise<TestConnectionResult> {
  if (!config.baseUrl) {
    return {
      success: false,
      error: 'Configuration Error',
      details: 'Base URL is required for custom OpenAI provider',
    };
  }

  try {
    const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: `Custom OpenAI API Error (${response.status})`,
        details: error.error?.message || 'Unknown error',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'Connection Error',
      details: error instanceof Error ? error.message : 'Failed to connect to custom OpenAI API',
    };
  }
}

export async function testProviderConnection(
  providerId: string,
  config: ProviderConfig,
): Promise<TestConnectionResult> {
  const providerType = config.type || providerId;

  switch (providerType) {
    case ProviderTypeEnum.OpenAI:
      return testOpenAIConnection(config);
    case ProviderTypeEnum.Anthropic:
      return testAnthropicConnection(config);
    case ProviderTypeEnum.Ollama:
      return testOllamaConnection(config);
    case ProviderTypeEnum.AzureOpenAI:
      return testAzureOpenAIConnection(config);
    case ProviderTypeEnum.OpenRouter:
      return testOpenRouterConnection(config);
    case ProviderTypeEnum.CustomOpenAI:
      return testCustomOpenAIConnection(config);
    default:
      return {
        success: false,
        error: 'Unsupported Provider',
        details: `Provider type ${providerType} is not supported for connection testing`,
      };
  }
}
