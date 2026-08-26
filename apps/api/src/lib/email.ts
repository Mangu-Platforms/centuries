// Email provider interface (Phase B2). NEXUS has no real transactional
// email provider credentials configured yet (no SMTP/Resend/etc. — same
// "gate on env, ship the code path" treatment as the X/Instagram connectors
// in Phase C), so the only implementation today is a console transport:
// good enough for local dev and for tests to assert against, and it means
// password reset / email verification work end-to-end right now without
// waiting on a human to supply provider credentials. A real provider is a
// drop-in EmailProvider implementation later — nothing above this
// interface (the routes) needs to change.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `\n----- [email:console] -----\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n----------------------------\n`,
    );
  }
}

let provider: EmailProvider = new ConsoleEmailProvider();

/** Test/future-provider seam — swap the active provider without touching call sites. */
export function setEmailProvider(next: EmailProvider): void {
  provider = next;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await provider.send(message);
}
