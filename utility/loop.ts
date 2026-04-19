// TODO: add docs

import { APIUserAbortError } from "openai";
import { TerminationError, TerminationSuccess, TerminationTimeout } from "./tools";

export async function loop(fn: () => Promise<void>) {
  while (true) {
    try {
      await fn();
    } catch (err) {
      if (err instanceof TerminationSuccess) {
        console.log(`Session termination success`);
        break;
      }

      // Open AI
      if (err instanceof APIUserAbortError) {
        continue;
      }

      // Open AI + Google Gen AI
      if (err instanceof DOMException && err.name == 'AbortError') {
        continue;
      }

      if (err instanceof TerminationTimeout) {
        console.log(`Session timeout terminated`);
        break;
      }

      if (err instanceof TerminationError) {
        console.log(`Session error terminated, Error: `, err?.toString());
        throw err;
      }

      console.log(err);
      throw err;
    }
  }
}
