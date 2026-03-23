const FROM_EMAIL = "contact@lyceon.ai";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Sends an email using the Resend API via native fetch.
 * This avoids needing the '@resend/sdk' package.
 */
export async function sendEmail(options: SendEmailOptions) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not set. Email will not be sent.");
    console.log("Mock Email Content:", options);
    return { success: false, error: "RESEND_API_KEY missing" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      console.error("Resend API error:", error);
      return { success: false, error };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    console.error("Failed to send email via Resend:", error);
    return { success: false, error };
  }
}
