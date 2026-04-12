import { LLMProvider } from '@/types/assistant'

export interface ModelLimitations {
  supportsTemperature: boolean
  temperatureNote?: string
  maxOutputTokens?: number
}

/**
 * OpenAI reasoning models: o-series and GPT-5 family don't accept temperature.
 * GPT-4.1 and GPT-4o families support temperature normally.
 */
function isOpenAIReasoningModel(model: string): boolean {
  return (
    /^(o1|o3|o4)/.test(model) ||
    model.startsWith('gpt-5')
  )
}

/**
 * Gemini 2.5+ and 3.x models are "thinking" models — temperature works
 * but Google strongly recommends keeping it at the default (1.0).
 */
function isGeminiThinkingModel(model: string): boolean {
  return /gemini-(2\.5|3)/.test(model)
}

export function getModelLimitations(provider: LLMProvider, model: string): ModelLimitations {
  if (provider === 'openai') {
    if (isOpenAIReasoningModel(model)) {
      return {
        supportsTemperature: false,
        temperatureNote: 'Modelos de raciocínio da OpenAI não suportam temperatura personalizada.',
      }
    }
  }

  if (provider === 'gemini') {
    if (isGeminiThinkingModel(model)) {
      return {
        supportsTemperature: true,
        temperatureNote: 'O Google recomenda manter a temperatura em 1.0 para modelos com "thinking". Valores diferentes podem causar degradação.',
      }
    }
  }

  // Claude: all models support temperature, no special restrictions
  return { supportsTemperature: true }
}
