const STEPS = [
  ['Drop a log', 'Export the log of a run from your agent framework and drop it in, or paste it.'],
  ['Get the cause', 'See the step where it went wrong and a one-sentence explanation of why.'],
  ['Fix it', 'Get specific changes to make so it doesn’t happen again.'],
]

const PY = `pip install "git+https://github.com/gfxroy/agent-autopsy#subdirectory=python"

from agent_autopsy import Recorder
rec = Recorder("run.jsonl")

@rec.tool_fn
def search(query): ...`

export function Landing() {
  return (
    <div data-testid="landing">
      <section className="wrap pt-24 pb-20 sm:pt-32 sm:pb-24">
        <h1 className="max-w-2xl text-4xl leading-[1.08] font-semibold tracking-tight sm:text-6xl">
          Find out why your AI agent failed.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-neutral-500">
          Drop in a log of an agent run. Get the cause, the exact failing step, and how to fix it.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-5">
          <a href="#/examine" className="btn-primary !px-6 !py-3 !text-base" data-testid="cta">
            Examine a log
          </a>
          <span className="text-sm text-neutral-500">Free. No sign-up.</span>
        </div>
      </section>

      <section className="border-t border-neutral-200">
        <div className="wrap py-20">
          <h2 className="label">How it works</h2>
          <ol className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <div className="font-mono text-sm text-neutral-400">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="mt-2 font-medium">{title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-14 text-sm text-neutral-400" data-testid="works-with">
            Works with OpenAI, Anthropic, LangChain, OpenTelemetry, MCP.
          </p>
        </div>
      </section>

      <section className="border-t border-neutral-200">
        <div className="wrap py-20">
          <h2 className="label">For developers</h2>
          <p className="mt-4 max-w-xl text-neutral-600">
            Record your own agent runs in Python. Every decorated tool call is written to a log file
            you can examine here.
          </p>
          <pre className="code mt-6" data-testid="python-snippet">
            <code>{PY}</code>
          </pre>
        </div>
      </section>

      <section className="border-t border-neutral-200">
        <div className="wrap py-14">
          <p className="text-neutral-600">
            <span className="font-medium text-neutral-900">Private by design.</span> Runs in your
            browser. Nothing is uploaded.
          </p>
        </div>
      </section>
    </div>
  )
}
