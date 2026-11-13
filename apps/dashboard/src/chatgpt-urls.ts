const chatGptOrigin = 'https://chatgpt.com'

export function chatGptProjectUrl(projectId: string): string {
  return `${chatGptOrigin}/g/${encodeURIComponent(projectId)}`
}

export function chatGptConversationUrl(conversationId: string): string {
  return `${chatGptOrigin}/c/${encodeURIComponent(conversationId)}`
}
