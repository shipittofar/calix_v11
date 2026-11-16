import type { ChannelName } from "@/lib/settings/schema";

export type ChannelResult = { channel: ChannelName; result: string; ms: number };
export type Job = { channel: ChannelName; timeoutMs: number; send: () => Promise<string> };

/**
 * Runs every channel at once and waits for all of them. Each channel has its own deadline, a
 * channel that throws becomes `<channel>_error`, and nothing a channel does can throw out of here
 * or make another channel wait. Results keep the order of `jobs`.
 */
export async function dispatch(jobs: Job[]): Promise<ChannelResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      const started = Date.now();
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(`${job.channel}_timeout`), job.timeoutMs);
      });
      let result: string;
      try {
        result = await Promise.race([job.send().catch(() => `${job.channel}_error`), deadline]);
      } catch {
        result = `${job.channel}_error`;
      } finally {
        clearTimeout(timer);
      }
      return { channel: job.channel, result, ms: Date.now() - started };
    }),
  );
}
