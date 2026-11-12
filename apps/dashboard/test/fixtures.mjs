export function syntheticExport(count = 70) {
  return Array.from({ length: count }, (_, index) => {
    const id = `chat-${index}`
    const at = Date.UTC(2026, 0, index + 1, 12) / 1000
    const nodes = [
      { id: `${id}-root`, parent: null, message: null },
      {
        id: `${id}-user`,
        parent: `${id}-root`,
        message: {
          author: { role: 'user' },
          create_time: at,
          content: {
            content_type: 'text',
            parts: [`Study repeated evidence carefully. ${'research '.repeat(index + 1)}`],
          },
        },
      },
      {
        id: `${id}-assistant`,
        parent: `${id}-user`,
        message: {
          author: { role: 'assistant' },
          create_time: at + 90,
          content: {
            content_type: 'text',
            parts: [`Consider repeated evidence carefully. ${'explanation '.repeat(index + 1)}`],
          },
        },
      },
    ]
    return {
      id,
      title: `Research workflow ${index}`,
      create_time: at,
      update_time: at + 90,
      conversation_template_id: index % 2 ? 'project-writing' : 'project-research',
      mapping: Object.fromEntries(nodes.map(node => [node.id, node])),
    }
  })
}
