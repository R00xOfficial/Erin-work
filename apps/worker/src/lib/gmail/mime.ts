import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { randomUUID } from "node:crypto";

export interface MimeInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[];
  inReplyTo?: string | null;
  references?: string | null;
  messageIdDomain: string;
}

/** Builds an RFC 2822 message and returns it base64url-encoded for the Gmail API plus the Message-ID we set. */
export async function buildMime(i: MimeInput): Promise<{ raw: string; messageId: string }> {
  const messageId = `<${randomUUID()}@${i.messageIdDomain}>`;
  const composer = new MailComposer({
    from: i.from,
    to: i.to,
    subject: i.subject,
    text: i.text,
    messageId,
    inReplyTo: i.inReplyTo ?? undefined,
    references: i.references ?? undefined,
    attachments: i.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    headers: { "X-AJIS": "1" },
  });
  const buf: Buffer = await new Promise((resolve, reject) => composer.compile().build((err: Error | null, msg: Buffer) => (err ? reject(err) : resolve(msg))));
  return { raw: buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), messageId };
}
