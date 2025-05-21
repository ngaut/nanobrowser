/*
 * Changes:
 * - Added a searchable select component with filtering capability for model selection
 * - Implemented keyboard navigation and accessibility for the custom dropdown
 * - Added search functionality that filters models based on user input
 * - Added keyboard event handlers to close dropdowns with Escape key
 * - Styling for both light and dark mode themes
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '@extension/ui';
import {
  llmProviderStore,
  agentModelStore,
  AgentNameEnum,
  llmProviderModelNames,
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  getDefaultAgentModelParams,
  type ProviderConfig,
  testProviderConnection,
  fetchOllamaModels,
} from '@extension/storage';

// Helper function to check if a model is an O-series model
function isOpenAIOModel(modelName: string): boolean {
  if (modelName.startsWith('openai/')) {
    return modelName.startsWith('openai/o');
  }
  return modelName.startsWith('o');
}

interface ModelSettingsProps {
  isDarkMode?: boolean; // Controls dark/light theme styling
}

export const ModelSettings = ({ isDarkMode = false }: ModelSettingsProps) => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [modifiedProviders, setModifiedProviders] = useState<Set<string>>(new Set());
  const [providersFromStorage, setProvidersFromStorage] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Record<AgentNameEnum, string>>({
    [AgentNameEnum.Navigator]: '',
    [AgentNameEnum.Planner]: '',
    [AgentNameEnum.Validator]: '',
  });
  const [modelParameters, setModelParameters] = useState<Record<AgentNameEnum, { temperature: number; topP: number }>>({
    [AgentNameEnum.Navigator]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Planner]: { temperature: 0, topP: 0 },
    [AgentNameEnum.Validator]: { temperature: 0, topP: 0 },
  });

  // State for reasoning effort for O-series models
  const [reasoningEffort, setReasoningEffort] = useState<Record<AgentNameEnum, 'low' | 'medium' | 'high' | undefined>>({
    [AgentNameEnum.Navigator]: undefined,
    [AgentNameEnum.Planner]: undefined,
    [AgentNameEnum.Validator]: undefined,
  });
  const [newModelInputs, setNewModelInputs] = useState<Record<string, string>>({});
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const newlyAddedProviderRef = useRef<string | null>(null);
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  // Add state for tracking API key visibility
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>({});
  // Create a non-async wrapper for use in render functions
  const [availableModels, setAvailableModels] = useState<
    Array<{ provider: string; providerName: string; model: string }>
  >([]);
  // State for model input handling
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; error?: string; details?: string }>
  >({});
  const [isTesting, setIsTesting] = useState<Record<string, boolean>>({});
  const [ollamaModels, setOllamaModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const allProviders = await llmProviderStore.getAllProviders();
        console.log('allProviders', allProviders);

        // Track which providers are from storage
        const fromStorage = new Set(Object.keys(allProviders));
        setProvidersFromStorage(fromStorage);

        // Only use providers from storage, don't add default ones
        setProviders(allProviders);

        // Load models for any Ollama providers
        Object.entries(allProviders).forEach(([providerId, config]) => {
          if (config.type === ProviderTypeEnum.Ollama && config.baseUrl) {
            loadOllamaModels(providerId, config);
          }
        });
      } catch (error) {
        console.error('Error loading providers:', error);
        // Set empty providers on error
        setProviders({});
        // No providers from storage on error
        setProvidersFromStorage(new Set());
      }
    };

    loadProviders();
  }, []);

  // Load existing agent models and parameters on mount
  useEffect(() => {
    const loadAgentModels = async () => {
      try {
        const models: Record<AgentNameEnum, string> = {
          [AgentNameEnum.Planner]: '',
          [AgentNameEnum.Navigator]: '',
          [AgentNameEnum.Validator]: '',
        };

        for (const agent of Object.values(AgentNameEnum)) {
          const config = await agentModelStore.getAgentModel(agent);
          if (config) {
            models[agent] = config.modelName;
            if (config.parameters?.temperature !== undefined || config.parameters?.topP !== undefined) {
              setModelParameters(prev => ({
                ...prev,
                [agent]: {
                  temperature: config.parameters?.temperature ?? prev[agent].temperature,
                  topP: config.parameters?.topP ?? prev[agent].topP,
                },
              }));
            }
            // Also load reasoningEffort if available
            if (config.reasoningEffort) {
              setReasoningEffort(prev => ({
                ...prev,
                [agent]: config.reasoningEffort as 'low' | 'medium' | 'high',
              }));
            }
          }
        }
        setSelectedModels(models);
      } catch (error) {
        console.error('Error loading agent models:', error);
      }
    };

    loadAgentModels();
  }, []);

  // Auto-focus the input field when a new provider is added
  useEffect(() => {
    // Only focus if we have a newly added provider reference
    if (newlyAddedProviderRef.current && providers[newlyAddedProviderRef.current]) {
      const providerId = newlyAddedProviderRef.current;
      const config = providers[providerId];

      // For custom providers, focus on the name input
      if (config.type === ProviderTypeEnum.CustomOpenAI) {
        const nameInput = document.getElementById(`${providerId}-name`);
        if (nameInput) {
          nameInput.focus();
        }
      } else {
        // For default providers, focus on the API key input
        const apiKeyInput = document.getElementById(`${providerId}-api-key`);
        if (apiKeyInput) {
          apiKeyInput.focus();
        }
      }

      // Clear the ref after focusing
      newlyAddedProviderRef.current = null;
    }
  }, [providers]);

  // Add a click outside handler to close the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isProviderSelectorOpen && !target.closest('.provider-selector-container')) {
        setIsProviderSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProviderSelectorOpen]);

  // Create a memoized version of getAvailableModels
  const getAvailableModelsCallback = useCallback(async () => {
    const models: Array<{ provider: string; providerName: string; model: string }> = [];

    try {
      // Load providers directly from storage
      const storedProviders = await llmProviderStore.getAllProviders();

      // Only use providers that are actually in storage
      for (const [provider, config] of Object.entries(storedProviders)) {
        if (config.type === ProviderTypeEnum.AzureOpenAI) {
          // Handle Azure providers specially - use deployment names as models
          const deploymentNames = config.azureDeploymentNames || [];

          models.push(
            ...deploymentNames.map(deployment => ({
              provider,
              providerName: config.name || provider,
              model: deployment,
            })),
          );
        } else {
          // Standard handling for non-Azure providers
          const providerModels =
            config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
          models.push(
            ...providerModels.map(model => ({
              provider,
              providerName: config.name || provider,
              model,
            })),
          );
        }
      }
    } catch (error) {
      console.error('Error loading providers for model selection:', error);
    }

    return models;
  }, []);

  // Update available models whenever providers change
  useEffect(() => {
    const updateAvailableModels = async () => {
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    };

    updateAvailableModels();
  }, [getAvailableModelsCallback]); // Only depends on the callback

  const handleApiKeyChange = (provider: string, apiKey: string, baseUrl?: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        apiKey: apiKey.trim(),
        baseUrl: baseUrl !== undefined ? baseUrl.trim() : prev[provider]?.baseUrl,
      },
    }));
  };

  // Add a toggle handler for API key visibility
  const toggleApiKeyVisibility = (provider: string) => {
    setVisibleApiKeys(prev => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleNameChange = (provider: string, name: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const updated = {
        ...prev,
        [provider]: {
          ...prev[provider],
          name: name.trim(),
        },
      };
      return updated;
    });
  };

  const handleModelsChange = (provider: string, modelsString: string) => {
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: modelsString,
    }));
  };

  const addModel = (provider: string, model: string) => {
    if (!model.trim()) return;

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Get current models - either from provider config or default models
      let currentModels = providerData.modelNames;
      if (currentModels === undefined) {
        currentModels = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      // Don't add duplicates
      if (currentModels.includes(model.trim())) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: [...currentModels, model.trim()],
        },
      };
    });

    // Clear the input
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  const removeModel = (provider: string, modelToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};

      // If modelNames doesn't exist in the provider data yet, we need to initialize it
      // with the default models from llmProviderModelNames first
      if (!providerData.modelNames) {
        const defaultModels = llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        const filteredModels = defaultModels.filter(model => model !== modelToRemove);

        return {
          ...prev,
          [provider]: {
            ...providerData,
            modelNames: filteredModels,
          },
        };
      }

      // If modelNames already exists, just filter out the model to remove
      return {
        ...prev,
        [provider]: {
          ...providerData,
          modelNames: providerData.modelNames.filter(model => model !== modelToRemove),
        },
      };
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, provider: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const value = newModelInputs[provider] || '';
      addModel(provider, value);
    }
  };

  const getButtonProps = (provider: string) => {
    const isInStorage = providersFromStorage.has(provider);
    const isModified = modifiedProviders.has(provider);

    // For deletion, we only care if it's in storage and not modified
    if (isInStorage && !isModified) {
      return {
        theme: isDarkMode ? 'dark' : 'light',
        variant: 'danger' as const,
        children: 'Delete',
        disabled: false,
      };
    }

    // For saving, we need to check if it has the required inputs
    let hasInput = false;
    const providerType = providers[provider]?.type;
    const config = providers[provider];

    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      hasInput = Boolean(config?.baseUrl?.trim()); // Custom needs Base URL, name checked elsewhere
    } else if (providerType === ProviderTypeEnum.Ollama) {
      hasInput = Boolean(config?.baseUrl?.trim()); // Ollama needs Base URL
    } else if (providerType === ProviderTypeEnum.AzureOpenAI) {
      // Azure needs API Key, Endpoint, Deployment Names, and API Version
      hasInput =
        Boolean(config?.apiKey?.trim()) &&
        Boolean(config?.baseUrl?.trim()) &&
        Boolean(config?.azureDeploymentNames?.length) &&
        Boolean(config?.azureApiVersion?.trim());
    } else if (providerType === ProviderTypeEnum.OpenRouter) {
      // OpenRouter needs API Key and optionally Base URL (has default)
      hasInput = Boolean(config?.apiKey?.trim()) && Boolean(config?.baseUrl?.trim());
    } else {
      // Other built-in providers just need API Key
      hasInput = Boolean(config?.apiKey?.trim());
    }

    return {
      theme: isDarkMode ? 'dark' : 'light',
      variant: 'primary' as const,
      children: 'Save',
      disabled: !hasInput || !isModified,
    };
  };

  const handleSave = async (provider: string) => {
    try {
      // Check if name contains spaces for custom providers
      if (providers[provider].type === ProviderTypeEnum.CustomOpenAI && providers[provider].name?.includes(' ')) {
        setNameErrors(prev => ({
          ...prev,
          [provider]: 'Spaces are not allowed in provider names. Please use underscores or other characters instead.',
        }));
        return;
      }

      // Check if base URL is required but missing for custom_openai, ollama, azure_openai or openrouter
      if (
        (providers[provider].type === ProviderTypeEnum.CustomOpenAI ||
          providers[provider].type === ProviderTypeEnum.Ollama ||
          providers[provider].type === ProviderTypeEnum.AzureOpenAI ||
          providers[provider].type === ProviderTypeEnum.OpenRouter) &&
        (!providers[provider].baseUrl || !providers[provider].baseUrl.trim())
      ) {
        alert(`Base URL is required for ${getDefaultDisplayNameFromProviderId(provider)}. Please enter it.`);
        return;
      }

      // Ensure modelNames is provided
      let modelNames = providers[provider].modelNames;
      if (!modelNames) {
        // Use default model names if not explicitly set
        modelNames = [...(llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [])];
      }

      // Prepare data for saving using the correctly typed config from state
      // We can directly pass the relevant parts of the state config
      // Create a copy to avoid modifying state directly if needed, though setProvider likely handles it
      const configToSave: Partial<ProviderConfig> = { ...providers[provider] }; // Use Partial to allow deleting modelNames

      // Explicitly set required fields that might be missing in partial state updates (though unlikely now)
      configToSave.apiKey = providers[provider].apiKey || '';
      configToSave.name = providers[provider].name || getDefaultDisplayNameFromProviderId(provider);
      configToSave.type = providers[provider].type;
      configToSave.createdAt = providers[provider].createdAt || Date.now();
      // baseUrl, azureDeploymentName, azureApiVersion should be correctly set by handlers

      if (providers[provider].type === ProviderTypeEnum.AzureOpenAI) {
        // Ensure modelNames is NOT included for Azure
        configToSave.modelNames = undefined;
      } else {
        // Ensure modelNames IS included for non-Azure
        // Use existing modelNames from state, or default if somehow missing
        configToSave.modelNames =
          providers[provider].modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
      }

      // Pass the cleaned config to setProvider
      // Cast to ProviderConfig as we've ensured necessary fields based on type
      await llmProviderStore.setProvider(provider, configToSave as ProviderConfig);

      // Clear any name errors on successful save
      setNameErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[provider];
        return newErrors;
      });

      // Add to providersFromStorage since it's now saved
      setProvidersFromStorage(prev => new Set(prev).add(provider));

      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Refresh available models
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  };

  const handleDelete = async (provider: string) => {
    try {
      // Delete the provider from storage regardless of its API key value
      await llmProviderStore.removeProvider(provider);

      // Remove from providersFromStorage
      setProvidersFromStorage(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Remove from providers state
      setProviders(prev => {
        const next = { ...prev };
        delete next[provider];
        return next;
      });

      // Also remove from modifiedProviders if it's there
      setModifiedProviders(prev => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });

      // Refresh available models
      const models = await getAvailableModelsCallback();
      setAvailableModels(models);
    } catch (error) {
      console.error('Error deleting provider:', error);
    }
  };

  const handleCancelProvider = (providerId: string) => {
    // Remove the provider from the state
    setProviders(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    // Remove from modified providers
    setModifiedProviders(prev => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
  };

  const handleModelChange = async (agentName: AgentNameEnum, modelValue: string) => {
    // modelValue will be in format "provider>model"
    const [provider, model] = modelValue.split('>');

    console.log(`[handleModelChange] Setting ${agentName} model: provider=${provider}, model=${model}`);

    // Set parameters based on provider type
    const newParameters = getDefaultAgentModelParams(provider, agentName);

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    setSelectedModels(prev => ({
      ...prev,
      [agentName]: model,
    }));

    try {
      if (model) {
        const providerConfig = providers[provider];

        // For Azure, verify the model is in the deployment names list
        if (providerConfig && providerConfig.type === ProviderTypeEnum.AzureOpenAI) {
          console.log(`[handleModelChange] Azure model selected: ${model}`);
        }

        // Reset reasoning effort if switching models
        if (isOpenAIOModel(model)) {
          // Keep existing reasoning effort if already set for O-series models
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: prev[agentName] || 'medium', // Default to medium if not set
          }));
        } else {
          // Clear reasoning effort for non-O-series models
          setReasoningEffort(prev => ({
            ...prev,
            [agentName]: undefined,
          }));
        }

        await agentModelStore.setAgentModel(agentName, {
          provider,
          modelName: model,
          parameters: newParameters,
          reasoningEffort: isOpenAIOModel(model) ? reasoningEffort[agentName] || 'medium' : undefined,
        });
      } else {
        // Reset storage if no model is selected
        await agentModelStore.resetAgentModel(agentName);
      }
    } catch (error) {
      console.error('Error saving agent model:', error);
    }
  };

  const handleReasoningEffortChange = async (agentName: AgentNameEnum, value: 'low' | 'medium' | 'high') => {
    setReasoningEffort(prev => ({
      ...prev,
      [agentName]: value,
    }));

    // Only update if we have a selected model
    if (selectedModels[agentName] && isOpenAIOModel(selectedModels[agentName])) {
      try {
        // Find provider
        const provider = getProviderForModel(selectedModels[agentName]);

        if (provider) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: selectedModels[agentName],
            parameters: modelParameters[agentName],
            reasoningEffort: value,
          });
        }
      } catch (error) {
        console.error('Error saving reasoning effort:', error);
      }
    }
  };

  const handleParameterChange = async (agentName: AgentNameEnum, paramName: 'temperature' | 'topP', value: number) => {
    const newParameters = {
      ...modelParameters[agentName],
      [paramName]: value,
    };

    setModelParameters(prev => ({
      ...prev,
      [agentName]: newParameters,
    }));

    // Only update if we have a selected model
    if (selectedModels[agentName]) {
      try {
        // Find provider
        let provider: string | undefined;
        for (const [providerKey, providerConfig] of Object.entries(providers)) {
          if (providerConfig.type === ProviderTypeEnum.AzureOpenAI) {
            // Check Azure deployment names
            const deploymentNames = providerConfig.azureDeploymentNames || [];
            if (deploymentNames.includes(selectedModels[agentName])) {
              provider = providerKey;
              break;
            }
          } else {
            // Check standard model names for non-Azure providers
            const modelNames =
              providerConfig.modelNames ||
              llmProviderModelNames[providerKey as keyof typeof llmProviderModelNames] ||
              [];
            if (modelNames.includes(selectedModels[agentName])) {
              provider = providerKey;
              break;
            }
          }
        }

        if (provider) {
          await agentModelStore.setAgentModel(agentName, {
            provider,
            modelName: selectedModels[agentName],
            parameters: newParameters,
          });
        }
      } catch (error) {
        console.error('Error saving agent parameters:', error);
      }
    }
  };

  const renderModelSelect = (agentName: AgentNameEnum) => {
    // Prepare the combined model list with dynamic Ollama models
    const standardModels = [...availableModels];

    // Add dynamically loaded Ollama models that aren't in the standard list
    const additionalOllamaModels = Object.entries(ollamaModels).flatMap(([providerId, models]) => {
      if (!providers[providerId]) return [];

      const providerConfig = providers[providerId];
      const existingModels = new Set(standardModels.filter(m => m.provider === providerId).map(m => m.model));

      return models
        .filter(model => !existingModels.has(model))
        .map(model => ({
          provider: providerId,
          providerName: providerConfig.name || providerId,
          model,
        }));
    });

    // Combine all models for the dropdown
    const allModels = [...standardModels, ...additionalOllamaModels];

    return (
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-gray-50'} p-4`}>
        <h3 className={`mb-2 text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {agentName.charAt(0).toUpperCase() + agentName.slice(1)}
        </h3>
        <p className={`mb-4 text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {getAgentDescription(agentName)}
        </p>

        <div className="space-y-4">
          {/* Model Selection */}
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-model`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Model
            </label>
            <select
              id={`${agentName}-model`}
              className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              disabled={allModels.length === 0}
              value={
                selectedModels[agentName]
                  ? `${getProviderForModel(selectedModels[agentName])}>${selectedModels[agentName]}`
                  : ''
              }
              onChange={e => handleModelChange(agentName, e.target.value)}>
              <option key="default" value="">
                Choose model
              </option>
              {allModels.map(({ provider, providerName, model }) => (
                <option key={`${provider}>${model}`} value={`${provider}>${model}`}>
                  {`${providerName} > ${model}`}
                </option>
              ))}
            </select>
          </div>

          {/* Temperature Slider */}
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-temperature`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Temperature
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <input
                id={`${agentName}-temperature`}
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={modelParameters[agentName].temperature}
                onChange={e => handleParameterChange(agentName, 'temperature', Number.parseFloat(e.target.value))}
                style={{
                  background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${(modelParameters[agentName].temperature / 2) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${(modelParameters[agentName].temperature / 2) * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
                }}
                className={`flex-1 ${isDarkMode ? 'accent-blue-500' : 'accent-blue-400'} h-1 appearance-none rounded-full`}
              />
              <div className="flex items-center space-x-2">
                <span className={`w-12 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {modelParameters[agentName].temperature.toFixed(2)}
                </span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  value={modelParameters[agentName].temperature}
                  onChange={e => {
                    const value = Number.parseFloat(e.target.value);
                    if (!Number.isNaN(value) && value >= 0 && value <= 2) {
                      handleParameterChange(agentName, 'temperature', value);
                    }
                  }}
                  className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} px-2 py-1 text-sm`}
                  aria-label={`${agentName} temperature number input`}
                />
              </div>
            </div>
          </div>

          {/* Top P Slider */}
          <div className="flex items-center">
            <label
              htmlFor={`${agentName}-topP`}
              className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Top P
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <input
                id={`${agentName}-topP`}
                type="range"
                min="0"
                max="1"
                step="0.001"
                value={modelParameters[agentName].topP}
                onChange={e => handleParameterChange(agentName, 'topP', Number.parseFloat(e.target.value))}
                style={{
                  background: `linear-gradient(to right, ${isDarkMode ? '#3b82f6' : '#60a5fa'} 0%, ${isDarkMode ? '#3b82f6' : '#60a5fa'} ${modelParameters[agentName].topP * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} ${modelParameters[agentName].topP * 100}%, ${isDarkMode ? '#475569' : '#cbd5e1'} 100%)`,
                }}
                className={`flex-1 ${isDarkMode ? 'accent-blue-500' : 'accent-blue-400'} h-1 appearance-none rounded-full`}
              />
              <div className="flex items-center space-x-2">
                <span className={`w-12 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {modelParameters[agentName].topP.toFixed(3)}
                </span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  value={modelParameters[agentName].topP}
                  onChange={e => {
                    const value = Number.parseFloat(e.target.value);
                    if (!Number.isNaN(value) && value >= 0 && value <= 1) {
                      handleParameterChange(agentName, 'topP', value);
                    }
                  }}
                  className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} px-2 py-1 text-sm`}
                  aria-label={`${agentName} top P number input`}
                />
              </div>
            </div>
          </div>

          {/* Reasoning Effort Selector (only for O-series models) */}
          {selectedModels[agentName] && isOpenAIOModel(selectedModels[agentName]) && (
            <div className="flex items-center">
              <label
                htmlFor={`${agentName}-reasoning-effort`}
                className={`w-24 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Reasoning
              </label>
              <div className="flex flex-1 items-center space-x-2">
                <select
                  id={`${agentName}-reasoning-effort`}
                  value={reasoningEffort[agentName] || 'medium'}
                  onChange={e => handleReasoningEffortChange(agentName, e.target.value as 'low' | 'medium' | 'high')}
                  className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}>
                  <option value="low">Low (Faster)</option>
                  <option value="medium">Medium (Balanced)</option>
                  <option value="high">High (More thorough)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const getAgentDescription = (agentName: AgentNameEnum) => {
    switch (agentName) {
      case AgentNameEnum.Navigator:
        return 'Navigates websites and performs actions';
      case AgentNameEnum.Planner:
        return 'Develops and refines strategies to complete tasks';
      case AgentNameEnum.Validator:
        return 'Checks if tasks are completed successfully';
      default:
        return '';
    }
  };

  const getMaxCustomProviderNumber = () => {
    let maxNumber = 0;
    for (const providerId of Object.keys(providers)) {
      if (providerId.startsWith('custom_openai_')) {
        const match = providerId.match(/custom_openai_(\d+)/);
        if (match) {
          const number = Number.parseInt(match[1], 10);
          maxNumber = Math.max(maxNumber, number);
        }
      }
    }
    return maxNumber;
  };

  const addCustomProvider = () => {
    const nextNumber = getMaxCustomProviderNumber() + 1;
    const providerId = `custom_openai_${nextNumber}`;

    setProviders(prev => ({
      ...prev,
      [providerId]: {
        apiKey: '',
        name: `CustomProvider${nextNumber}`,
        type: ProviderTypeEnum.CustomOpenAI,
        baseUrl: '',
        modelNames: [],
        createdAt: Date.now(),
      },
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));

    // Set the newly added provider ref
    newlyAddedProviderRef.current = providerId;

    // Scroll to the newly added provider after render
    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Function to load Ollama models for a provider
  const loadOllamaModels = async (providerId: string, config: ProviderConfig) => {
    if (!config.baseUrl) return;
    setIsTesting(prev => ({ ...prev, [providerId]: true }));
    try {
      const modelsFromApi = await fetchOllamaModels(config.baseUrl);
      setOllamaModels(prev => ({ ...prev, [providerId]: modelsFromApi }));

      // Update the provider's modelNames in the main 'providers' state
      setProviders(prev => ({
        ...prev,
        [providerId]: {
          ...prev[providerId],
          modelNames: modelsFromApi, // Replace with fetched models
        },
      }));
      // Mark the provider as modified so the user can save it
      setModifiedProviders(prev => new Set(prev).add(providerId));

      setTestResults(prev => ({
        ...prev,
        [providerId]: { success: true, details: `Found ${modelsFromApi.length} models.` },
      }));
    } catch (error) {
      console.error(`Error loading Ollama models for ${providerId}:`, error);
      setTestResults(prev => ({
        ...prev,
        [providerId]: { success: false, error: (error as Error).message },
      }));
    } finally {
      setIsTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  // Enhance handleTestConnection to update Ollama models after successful connection
  const handleTestConnection = async (providerId: string) => {
    const config = providers[providerId];
    if (!config) return;

    setIsTesting(prev => ({ ...prev, [providerId]: true }));
    setTestResults(prev => ({ ...prev, [providerId]: { success: false } }));

    try {
      const result = await testProviderConnection(providerId, config);
      setTestResults(prev => ({ ...prev, [providerId]: result }));

      // If this is an Ollama provider and the connection was successful, fetch models
      if (config.type === ProviderTypeEnum.Ollama && result.success) {
        await loadOllamaModels(providerId, config);
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [providerId]: {
          success: false,
          error: 'Error',
          details: error instanceof Error ? error.message : 'An unknown error occurred',
        },
      }));
    } finally {
      setIsTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  // Sort providers to ensure newly added providers appear at the bottom
  const getSortedProviders = () => {
    // Filter providers to only include those from storage and newly added providers
    const filteredProviders = Object.entries(providers).filter(([providerId, config]) => {
      // ALSO filter out any provider missing a config or type, to satisfy TS
      if (!config || !config.type) {
        console.warn(`Filtering out provider ${providerId} with missing config or type.`);
        return false;
      }

      // Include if it's from storage
      if (providersFromStorage.has(providerId)) {
        return true;
      }

      // Include if it's a newly added provider (has been modified)
      if (modifiedProviders.has(providerId)) {
        return true;
      }

      // Exclude providers that aren't from storage and haven't been modified
      return false;
    });

    // Sort the filtered providers
    return filteredProviders.sort(([keyA, configA], [keyB, configB]) => {
      // Separate newly added providers from stored providers
      const isNewA = !providersFromStorage.has(keyA) && modifiedProviders.has(keyA);
      const isNewB = !providersFromStorage.has(keyB) && modifiedProviders.has(keyB);

      // If one is new and one is stored, new ones go to the end
      if (isNewA && !isNewB) return 1;
      if (!isNewA && isNewB) return -1;

      // If both are new or both are stored, sort by createdAt
      if (configA.createdAt && configB.createdAt) {
        return configA.createdAt - configB.createdAt; // Sort in ascending order (oldest first)
      }

      // If only one has createdAt, put the one without createdAt at the end
      if (configA.createdAt) return -1;
      if (configB.createdAt) return 1;

      // If neither has createdAt, sort by type and then name
      const isCustomA = configA.type === ProviderTypeEnum.CustomOpenAI;
      const isCustomB = configB.type === ProviderTypeEnum.CustomOpenAI;

      if (isCustomA && !isCustomB) {
        return 1; // Custom providers come after non-custom
      }

      if (!isCustomA && isCustomB) {
        return -1; // Non-custom providers come before custom
      }

      // Sort alphabetically by name within each group
      return (configA.name || keyA).localeCompare(configB.name || keyB);
    });
  };

  const handleProviderSelection = (providerType: string) => {
    // Close the dropdown immediately
    setIsProviderSelectorOpen(false);

    // Handle custom provider
    if (providerType === ProviderTypeEnum.CustomOpenAI) {
      addCustomProvider();
      return;
    }

    // Handle Azure OpenAI specially to allow multiple instances
    if (providerType === ProviderTypeEnum.AzureOpenAI) {
      addAzureProvider();
      return;
    }

    // Handle built-in supported providers
    addBuiltInProvider(providerType);
  };

  // New function to add Azure providers with unique IDs
  const addAzureProvider = () => {
    // Count existing Azure providers
    const azureProviders = Object.keys(providers).filter(
      key => key === ProviderTypeEnum.AzureOpenAI || key.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`),
    );
    const nextNumber = azureProviders.length + 1;

    // Create unique ID
    const providerId =
      nextNumber === 1 ? ProviderTypeEnum.AzureOpenAI : `${ProviderTypeEnum.AzureOpenAI}_${nextNumber}`;

    // Create config with appropriate name
    const config = getDefaultProviderConfig(ProviderTypeEnum.AzureOpenAI);
    config.name = `Azure OpenAI ${nextNumber}`;

    // Add to providers
    setProviders(prev => ({
      ...prev,
      [providerId]: config,
    }));

    setModifiedProviders(prev => new Set(prev).add(providerId));
    newlyAddedProviderRef.current = providerId;

    // Scroll to the newly added provider after render
    setTimeout(() => {
      const providerElement = document.getElementById(`provider-${providerId}`);
      if (providerElement) {
        providerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  // Enhance addBuiltInProvider to load Ollama models when an Ollama provider is added
  const addBuiltInProvider = (provider: string) => {
    // Ensure this is a valid built-in provider
    if (!Object.values(ProviderTypeEnum).includes(provider as ProviderTypeEnum)) {
      console.error(`Invalid provider type: ${provider}`);
      return;
    }

    const providerConfig = getDefaultProviderConfig(provider);
    const providerId = provider;

    // Add the new provider to state
    setProviders(prevProviders => ({
      ...prevProviders,
      [providerId]: providerConfig,
    }));

    // Mark it as modified
    setModifiedProviders(prev => {
      const newSet = new Set(prev);
      newSet.add(providerId);
      return newSet;
    });

    // Set newly added provider for auto-focus
    newlyAddedProviderRef.current = providerId;

    // Close the provider selector
    setIsProviderSelectorOpen(false);

    // If this is an Ollama provider, try to load models
    if (provider === ProviderTypeEnum.Ollama && providerConfig.baseUrl) {
      loadOllamaModels(providerId, providerConfig);
    }
  };

  const getProviderForModel = (modelName: string): string => {
    for (const [provider, config] of Object.entries(providers)) {
      // Check Azure deployment names
      if (config.type === ProviderTypeEnum.AzureOpenAI) {
        const deploymentNames = config.azureDeploymentNames || [];
        if (deploymentNames.includes(modelName)) {
          return provider;
        }
      } else {
        // Check regular model names for non-Azure providers
        const modelNames =
          config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
        if (modelNames.includes(modelName)) {
          return provider;
        }
      }
    }
    return '';
  };

  // Add and remove Azure deployments
  const addAzureDeployment = (provider: string, deploymentName: string) => {
    if (!deploymentName.trim()) return;

    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Initialize or use existing deploymentNames array
      const deploymentNames = providerData.azureDeploymentNames || [];

      // Don't add duplicates
      if (deploymentNames.includes(deploymentName.trim())) return prev;

      return {
        ...prev,
        [provider]: {
          ...providerData,
          azureDeploymentNames: [...deploymentNames, deploymentName.trim()],
        },
      };
    });

    // Clear the input
    setNewModelInputs(prev => ({
      ...prev,
      [provider]: '',
    }));
  };

  const removeAzureDeployment = (provider: string, deploymentToRemove: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));

    setProviders(prev => {
      const providerData = prev[provider] || {};

      // Get current deployments
      const deploymentNames = providerData.azureDeploymentNames || [];

      // Filter out the deployment to remove
      const filteredDeployments = deploymentNames.filter(name => name !== deploymentToRemove);

      return {
        ...prev,
        [provider]: {
          ...providerData,
          azureDeploymentNames: filteredDeployments,
        },
      };
    });
  };

  const handleAzureApiVersionChange = (provider: string, apiVersion: string) => {
    setModifiedProviders(prev => new Set(prev).add(provider));
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        azureApiVersion: apiVersion.trim(),
      },
    }));
  };

  return (
    <section className="space-y-6">
      {/* LLM Providers Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          LLM Providers
        </h2>
        <div className="space-y-6">
          {getSortedProviders().length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p className="mb-4">No providers configured yet. Add a provider to get started.</p>
            </div>
          ) : (
            getSortedProviders().map(([providerId, providerConfig]) => {
              // Add type guard to satisfy TypeScript
              if (!providerConfig || !providerConfig.type) {
                console.warn(`Skipping rendering for providerId ${providerId} due to missing config or type`);
                return null; // Skip rendering this item if config/type is somehow missing
              }

              return (
                <div
                  key={providerId}
                  id={`provider-${providerId}`}
                  className={`space-y-4 ${modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) ? `rounded-lg border p-4 ${isDarkMode ? 'border-blue-700 bg-slate-700' : 'border-blue-200 bg-blue-50/70'}` : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {providerConfig.name || providerId}
                    </h3>
                    <div className="flex space-x-2">
                      {/* Show Cancel button for newly added providers */}
                      {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                        <Button variant="secondary" onClick={() => handleCancelProvider(providerId)}>
                          Cancel
                        </Button>
                      )}
                      <Button
                        variant={getButtonProps(providerId).variant}
                        disabled={getButtonProps(providerId).disabled}
                        onClick={() =>
                          providersFromStorage.has(providerId) && !modifiedProviders.has(providerId)
                            ? handleDelete(providerId)
                            : handleSave(providerId)
                        }>
                        {getButtonProps(providerId).children}
                      </Button>
                    </div>
                  </div>

                  {/* Show message for newly added providers */}
                  {modifiedProviders.has(providerId) && !providersFromStorage.has(providerId) && (
                    <div className={`mb-2 text-sm ${isDarkMode ? 'text-teal-300' : 'text-teal-700'}`}>
                      <p>This provider is newly added. Enter your API key and click Save to configure it.</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {/* Name input (only for custom_openai) - moved to top for prominence */}
                    {providerConfig.type === ProviderTypeEnum.CustomOpenAI && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-name`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Name
                          </label>
                          <input
                            id={`${providerId}-name`}
                            type="text"
                            placeholder="Provider name"
                            value={providerConfig.name || ''}
                            onChange={e => {
                              console.log('Name input changed:', e.target.value);
                              handleNameChange(providerId, e.target.value);
                            }}
                            className={`flex-1 rounded-md border p-2 text-sm ${
                              nameErrors[providerId]
                                ? isDarkMode
                                  ? 'border-red-700 bg-slate-700 text-gray-200 focus:border-red-600 focus:ring-2 focus:ring-red-900'
                                  : 'border-red-300 bg-gray-50 focus:border-red-400 focus:ring-2 focus:ring-red-200'
                                : isDarkMode
                                  ? 'border-blue-700 bg-slate-700 text-gray-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-900'
                                  : 'border-blue-300 bg-gray-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'
                            } outline-none`}
                          />
                        </div>
                        {nameErrors[providerId] ? (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                            {nameErrors[providerId]}
                          </p>
                        ) : (
                          <p className={`ml-20 mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Provider name (spaces are not allowed when saving)
                          </p>
                        )}
                      </div>
                    )}

                    {/* API Key input with label */}
                    <div className="flex items-center">
                      <label
                        htmlFor={`${providerId}-api-key`}
                        className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        API Key
                        {/* Show asterisk only if required */}
                        {providerConfig.type !== ProviderTypeEnum.CustomOpenAI &&
                        providerConfig.type !== ProviderTypeEnum.Ollama
                          ? '*'
                          : ''}
                      </label>
                      <div className="relative flex-1">
                        <input
                          id={`${providerId}-api-key`}
                          type={visibleApiKeys[providerId] ? 'text' : 'password'}
                          placeholder={
                            providerConfig.type === ProviderTypeEnum.CustomOpenAI
                              ? `${providerConfig.name || providerId} API key (optional)`
                              : providerConfig.type === ProviderTypeEnum.Ollama
                                ? 'API Key (leave empty for Ollama)'
                                : `${providerConfig.name || providerId} API key (required)`
                          }
                          value={providerConfig.apiKey || ''}
                          onChange={e => handleApiKeyChange(providerId, e.target.value, providerConfig.baseUrl)}
                          className={`w-full rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                        />
                        {/* Show eye button only for newly added providers */}
                        {modifiedProviders.has(providerId) && (
                          <button
                            type="button"
                            onClick={() => toggleApiKeyVisibility(providerId)}
                            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 ${
                              isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-100'
                            }`}
                            aria-label={visibleApiKeys[providerId] ? 'Hide API key' : 'Show API key'}>
                            <svg
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg">
                              {visibleApiKeys[providerId] ? (
                                <>
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                  />
                                </>
                              ) : (
                                <>
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                  />
                                </>
                              )}
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Display API key for newly added providers only when visible */}
                    {modifiedProviders.has(providerId) &&
                      !providersFromStorage.has(providerId) &&
                      visibleApiKeys[providerId] &&
                      providerConfig.apiKey && (
                        <div className="ml-20 mt-1">
                          <p
                            className={`break-words font-mono text-sm ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            {providerConfig.apiKey}
                          </p>
                        </div>
                      )}

                    {/* Base URL input (for custom_openai, ollama, azure_openai, and openrouter) */}
                    {(providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                      providerConfig.type === ProviderTypeEnum.Ollama ||
                      providerConfig.type === ProviderTypeEnum.AzureOpenAI ||
                      providerConfig.type === ProviderTypeEnum.OpenRouter) && (
                      <div className="flex flex-col">
                        <div className="flex items-center">
                          <label
                            htmlFor={`${providerId}-base-url`}
                            className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {providerConfig.type === ProviderTypeEnum.AzureOpenAI ? 'Endpoint' : 'Base URL'}
                            {providerConfig.type === ProviderTypeEnum.CustomOpenAI ||
                            providerConfig.type === ProviderTypeEnum.AzureOpenAI
                              ? '*'
                              : ''}
                          </label>
                          <input
                            id={`${providerId}-base-url`}
                            type="text"
                            placeholder={
                              providerConfig.type === ProviderTypeEnum.CustomOpenAI
                                ? 'Required OpenAI-compatible API endpoint'
                                : providerConfig.type === ProviderTypeEnum.AzureOpenAI
                                  ? 'https://YOUR_RESOURCE_NAME.openai.azure.com/'
                                  : providerConfig.type === ProviderTypeEnum.OpenRouter
                                    ? 'OpenRouter Base URL (optional, defaults to https://openrouter.ai/api/v1)'
                                    : 'Ollama base URL'
                            }
                            value={providerConfig.baseUrl || ''}
                            onChange={e => handleApiKeyChange(providerId, providerConfig.apiKey || '', e.target.value)}
                            className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Azure Deployment Name input as tags/chips like OpenRouter models */}
                    {(providerConfig.type as ProviderTypeEnum) === ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-start">
                        <label
                          htmlFor={`${providerId}-azure-deployment`}
                          className={`w-20 pt-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Deployment*
                        </label>
                        <div className="flex-1 space-y-2">
                          <div
                            className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                            {(providerConfig.azureDeploymentNames || []).length > 0
                              ? (providerConfig.azureDeploymentNames || []).map((deploymentName: string) => (
                                  <div
                                    key={deploymentName}
                                    className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                    <span>{deploymentName}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeAzureDeployment(providerId, deploymentName)}
                                      className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                      aria-label={`Remove ${deploymentName}`}>
                                      ×
                                    </button>
                                  </div>
                                ))
                              : null}
                            <input
                              id={`${providerId}-azure-deployment-input`}
                              type="text"
                              placeholder="Enter Azure model name (e.g. gpt-4o, gpt-4o-mini)"
                              value={newModelInputs[providerId] || ''}
                              onChange={e => handleModelsChange(providerId, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  const value = newModelInputs[providerId] || '';
                                  if (value.trim()) {
                                    addAzureDeployment(providerId, value.trim());
                                    setNewModelInputs(prev => ({ ...prev, [providerId]: '' }));
                                  }
                                }
                              }}
                              className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                            />
                          </div>
                          <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Type model name and press Enter or Space to set. Deployment name should match OpenAI model
                            name (e.g., gpt-4o) for best compatibility.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Azure API Version input */}
                    {(providerConfig.type as ProviderTypeEnum) === ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-center">
                        <label
                          htmlFor={`${providerId}-azure-version`}
                          className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          API Version*
                        </label>
                        <input
                          id={`${providerId}-azure-version`}
                          type="text"
                          placeholder="e.g., 2024-02-15-preview"
                          value={providerConfig.azureApiVersion || ''}
                          onChange={e => handleAzureApiVersionChange(providerId, e.target.value)}
                          className={`flex-1 rounded-md border text-sm ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-800' : 'border-gray-300 bg-white text-gray-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-200'} p-2 outline-none`}
                        />
                      </div>
                    )}

                    {/* Models input section (for non-Azure providers) */}
                    {(providerConfig.type as ProviderTypeEnum) !== ProviderTypeEnum.AzureOpenAI && (
                      <div className="flex items-start">
                        <label
                          htmlFor={`${providerId}-models-label`}
                          className={`w-20 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Models
                        </label>
                        <div className="flex-1 space-y-2">
                          <div
                            className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} p-2`}>
                            {/* Display model chips/tags */}
                            {(providerConfig.modelNames || []).length > 0
                              ? (providerConfig.modelNames || []).map((model: string) => (
                                  <div
                                    key={model}
                                    className={`flex items-center rounded-full ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-100 text-blue-800'} px-2 py-1 text-sm`}>
                                    <span>{model}</span>
                                    <button
                                      type="button"
                                      onClick={() => removeModel(providerId, model)}
                                      className={`ml-1 font-bold ${isDarkMode ? 'text-blue-300 hover:text-blue-100' : 'text-blue-600 hover:text-blue-800'}`}
                                      aria-label={`Remove ${model}`}>
                                      ×
                                    </button>
                                  </div>
                                ))
                              : null}
                            <input
                              id={`${providerId}-models-input`}
                              type="text"
                              placeholder="Add model name"
                              value={newModelInputs[providerId] || ''}
                              onChange={e => handleModelsChange(providerId, e.target.value)}
                              onKeyDown={e => handleKeyDown(e, providerId)}
                              className={`min-w-[150px] flex-1 border-none text-sm ${isDarkMode ? 'bg-transparent text-gray-200' : 'bg-transparent text-gray-700'} p-1 outline-none`}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              Type model name and press Enter to add
                            </p>
                            <button
                              type="button"
                              onClick={() => addModel(providerId, newModelInputs[providerId] || '')}
                              disabled={!(newModelInputs[providerId] || '').trim()}
                              className={`rounded px-2 py-1 text-xs ${
                                !(newModelInputs[providerId] || '').trim()
                                  ? `${isDarkMode ? 'bg-slate-600 text-gray-400' : 'bg-gray-200 text-gray-400'} cursor-not-allowed`
                                  : `${isDarkMode ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-blue-500 text-white hover:bg-blue-400'}`
                              }`}>
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Test Connection Button & Results */}
                    <div className="mt-4 flex items-start">
                      <div className="w-20"></div>
                      <div className="flex-1 space-y-2">
                        <Button
                          variant="secondary"
                          onClick={() => handleTestConnection(providerId)}
                          disabled={
                            isTesting[providerId] ||
                            (!providerConfig.baseUrl && providerConfig.type === ProviderTypeEnum.Ollama)
                          }
                          className="flex items-center space-x-1">
                          {isTesting[providerId] ? (
                            <>
                              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                              Testing...
                            </>
                          ) : (
                            'Test Connection'
                          )}
                        </Button>

                        {/* Test Results Display */}
                        {testResults[providerId] && (
                          <div
                            className={`mt-2 rounded-lg border px-4 py-2 ${
                              testResults[providerId].success
                                ? isDarkMode
                                  ? 'border-emerald-800 bg-emerald-950 text-emerald-200'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : isDarkMode
                                  ? 'border-rose-800 bg-rose-950 text-rose-200'
                                  : 'border-rose-200 bg-rose-50 text-rose-800'
                            }`}>
                            <div className="flex items-start">
                              <div className="mt-0.5 mr-2">
                                {testResults[providerId].success ? (
                                  <svg className="size-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                ) : (
                                  <svg className="size-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-5a1 1 0 112 0v-2a1 1 0 11-2 0v2zm0-6a1 1 0 112 0 1 1 0 01-2 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </div>
                              <div>
                                <p className="font-medium">
                                  {testResults[providerId].success
                                    ? 'Connection Successful'
                                    : testResults[providerId].error || 'Connection Failed'}
                                </p>
                                {testResults[providerId].details && (
                                  <p className="mt-1 text-sm">{testResults[providerId].details}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add Provider Button */}
        <div className="mt-6 flex justify-end">
          <div className="relative provider-selector-container">
            <Button
              variant="primary"
              onClick={() => setIsProviderSelectorOpen(!isProviderSelectorOpen)}
              theme={isDarkMode ? 'dark' : 'light'}>
              Add Provider
            </Button>
            {isProviderSelectorOpen && (
              <div
                className={`absolute right-0 mt-2 w-56 origin-top-right rounded-md shadow-lg ${
                  isDarkMode
                    ? 'bg-slate-800 ring-1 ring-black ring-opacity-5'
                    : 'bg-white ring-1 ring-black ring-opacity-5'
                }`}>
                <div className="rounded-md" role="menu" aria-orientation="vertical" aria-labelledby="provider-selector">
                  <div
                    className={`border-b px-4 py-2 text-sm font-medium ${isDarkMode ? 'border-gray-700 text-gray-200' : 'border-gray-200 text-gray-700'}`}>
                    Select Provider Type
                  </div>
                  <div className="py-1">
                    {Object.values(ProviderTypeEnum).map(provider => (
                      <button
                        key={provider}
                        className={`block w-full px-4 py-2 text-left text-sm ${
                          isDarkMode ? 'text-gray-200 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
                        }`}
                        role="menuitem"
                        onClick={() => handleProviderSelection(provider)}>
                        {getDefaultDisplayNameFromProviderId(provider)}
                      </button>
                    ))}
                    <button
                      className={`block w-full px-4 py-2 text-left text-sm ${
                        isDarkMode ? 'text-gray-200 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      role="menuitem"
                      onClick={() => handleProviderSelection(ProviderTypeEnum.CustomOpenAI)}>
                      Custom OpenAI-compatible API
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent Model Settings Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Agent Models</h2>
        <div className="space-y-4">
          {renderModelSelect(AgentNameEnum.Planner)}
          {renderModelSelect(AgentNameEnum.Navigator)}
          {renderModelSelect(AgentNameEnum.Validator)}
        </div>
      </div>
    </section>
  );
};
