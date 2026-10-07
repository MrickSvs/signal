// Terminal spinner for the demo scripts (demo:reset, digest): the current step and the elapsed
// time on one line, redrawn in place. Without a terminal (CI, a pipe), one line per step instead.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CLEAR_LINE = "\r\x1b[2K";
const INTERVAL_MS = 80;

/** One spinner line (pure). */
export function spinnerLine(frame: number, text: string, elapsedMs: number): string {
  return `${FRAMES[frame % FRAMES.length]} ${text} · ${Math.floor(elapsedMs / 1000)} s`;
}

export type Spinner = {
  /** Changes the current step. */
  update(text: string): void;
  /** Prints a message above the spinner line. */
  log(message: string): void;
  stop(): void;
};

type Output = { isTTY?: boolean; write(chunk: string): unknown };

export function startSpinner(
  text: string,
  options: { stream?: Output; print?: (message: string) => void; now?: () => number } = {},
): Spinner {
  const stream = options.stream ?? process.stderr;
  const print = options.print ?? ((message: string) => console.log(message));
  const now = options.now ?? Date.now;
  if (!stream.isTTY) {
    stream.write(`${text}…\n`);
    return {
      update: (next) => void stream.write(`${next}…\n`),
      log: print,
      stop: () => {},
    };
  }
  const started = now();
  let current = text;
  let frame = 0;
  const draw = () =>
    void stream.write(`${CLEAR_LINE}${spinnerLine(frame++, current, now() - started)}`);
  const timer = setInterval(draw, INTERVAL_MS);
  draw();
  return {
    update(next) {
      current = next;
      draw();
    },
    log(message) {
      stream.write(CLEAR_LINE);
      print(message);
      draw();
    },
    stop() {
      clearInterval(timer);
      stream.write(CLEAR_LINE);
    },
  };
}
