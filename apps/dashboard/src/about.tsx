export function About() {
  return (
    <section class="about-page">
      <h3>Understand how you use ChatGPT</h3>
      <p>
        Import your ChatGPT export ZIP or its extracted folder. All analysis happens locally in a browser worker.
        Conversations are not uploaded or persisted; project names are saved in browser storage.
      </p>
      <p>
        <a
          href="https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data"
          target="_blank"
          rel="noreferrer">
          Request a ChatGPT data export from OpenAI
        </a>
        , then choose it above.
      </p>
      <h3>Follow a question, not a statistic</h3>
      <ol>
        <li>Choose a period, timezone, and optional project.</li>
        <li>Use Overview to compare activity and identify contributors.</li>
        <li>Explore Time and rhythm to understand daily habits and session structure.</li>
        <li>Inspect the conversations and messages behind a pattern.</li>
        <li>Prepare scoped evidence and a modular recap prompt.</li>
      </ol>
      <h3>What the export can establish</h3>
      <p>
        Message timestamps and text describe recorded activity, not attention or wellbeing. Interaction time is a typing
        and reading estimate. First-reply delay includes system and network delays. Session span is elapsed time, not
        time spent. Output volume is not proof that the output was read or useful.
      </p>
      <p>
        Word counts use Unicode word segments; character counts use text characters. They are not token counts. Custom
        instructions and hidden reasoning are excluded from text-volume metrics. Exported branches are retained. Missing
        history is not evidence of inactivity.
      </p>
    </section>
  )
}
