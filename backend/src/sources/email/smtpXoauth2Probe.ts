import net from "node:net";
import tls from "node:tls";

interface SmtpXoauth2ProbeInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  accessToken: string;
  timeoutMs: number;
}

export function buildSmtpXoauth2Token(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
}

export async function verifySmtpXoauth2(input: SmtpXoauth2ProbeInput): Promise<void> {
  const socket = await connect(input);
  const session = new SmtpSession(socket, input.timeoutMs);

  try {
    await session.expectCode(220);
    await session.command("EHLO invoice-processor");
    await session.expectCode(250);
    await session.command(`AUTH XOAUTH2 ${buildSmtpXoauth2Token(input.user, input.accessToken)}`);
    const authResponse = await session.readResponse();
    if (authResponse.code === 334) {
      await session.command("");
      const retryResponse = await session.readResponse();
      if (retryResponse.code !== 235) {
        throw new Error(`SMTP XOAUTH2 auth failed: ${retryResponse.code} ${retryResponse.message}`);
      }
    } else if (authResponse.code !== 235) {
      throw new Error(`SMTP XOAUTH2 auth failed: ${authResponse.code} ${authResponse.message}`);
    }

    await session.command("QUIT");
  } finally {
    socket.destroy();
  }
}

async function connect(input: SmtpXoauth2ProbeInput): Promise<net.Socket | tls.TLSSocket> {
  const timeoutMs = Math.max(1_000, input.timeoutMs);
  return await new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const onTimeout = () => reject(new Error("SMTP connection timed out."));
    const socket = input.secure
      ? tls.connect({
          host: input.host,
          port: input.port,
          servername: input.host,
          minVersion: "TLSv1.2"
        })
      : net.connect({
          host: input.host,
          port: input.port
        });

    socket.setTimeout(timeoutMs);
    socket.once("timeout", onTimeout);
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.removeListener("timeout", onTimeout);
      socket.removeListener("error", onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

class SmtpSession {
  private buffer = "";
  private readonly lineQueue: string[] = [];
  private readonly waiterQueue: Array<(line: string) => void> = [];

  constructor(
    private readonly socket: net.Socket | tls.TLSSocket,
    private readonly timeoutMs: number
  ) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.flushLines();
    });
  }

  async command(command: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${command}\r\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async expectCode(code: number): Promise<void> {
    const response = await this.readResponse();
    if (response.code !== code) {
      throw new Error(`SMTP unexpected response: expected ${code}, got ${response.code} (${response.message})`);
    }
  }

  async readResponse(): Promise<{ code: number; message: string }> {
    const firstLine = await this.nextLine();
    const parsed = parseResponseLine(firstLine);
    let message = parsed.message;

    if (parsed.moreLines) {
      while (true) {
        const continuationLine = await this.nextLine();
        const continuation = parseResponseLine(continuationLine);
        message = `${message}\n${continuation.message}`;
        if (!continuation.moreLines) {
          if (continuation.code !== parsed.code) {
            throw new Error(
              `SMTP multiline response code mismatch: expected ${parsed.code}, got ${continuation.code}.`
            );
          }
          break;
        }
      }
    }

    return {
      code: parsed.code,
      message
    };
  }

  private async nextLine(): Promise<string> {
    if (this.lineQueue.length > 0) {
      return this.lineQueue.shift() ?? "";
    }

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(new Error("Timed out waiting for SMTP response."));
      }, this.timeoutMs);

      const waiter = (line: string) => {
        clearTimeout(timeout);
        resolve(line);
      };
      this.waiterQueue.push(waiter);
    });
  }

  private flushLines(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");
      const waiter = this.waiterQueue.shift();
      if (waiter) {
        waiter(line);
      } else {
        this.lineQueue.push(line);
      }
    }
  }

  private removeWaiter(waiter: (line: string) => void): void {
    const index = this.waiterQueue.indexOf(waiter);
    if (index >= 0) {
      this.waiterQueue.splice(index, 1);
    }
  }
}

function parseResponseLine(line: string): { code: number; moreLines: boolean; message: string } {
  const match = /^(\d{3})([\s-])(.*)$/.exec(line);
  if (!match) {
    throw new Error(`SMTP response line format is invalid: '${line}'.`);
  }

  return {
    code: Number.parseInt(match[1] ?? "0", 10),
    moreLines: match[2] === "-",
    message: match[3] ?? ""
  };
}
